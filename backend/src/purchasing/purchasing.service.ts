import { FIRST_PAGE, pageArgs, pageOf, type PageQuery } from '../common/pagination'
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { createHash, randomUUID } from 'node:crypto'
import { PrismaService } from '../prisma/prisma.service'
import type { TenantContext, TenantScope } from '../identity/tenant-context.type'
import {
  CreateSupplierReturnDto,
  ReceivePurchaseDto,
  ReversePurchaseDto,
} from './dto/receive-purchase.dto'
import { AuthenticatedUser } from '../auth/authenticated-user'
import { hasBranchAccess } from '../auth/branch-access'
import {
  PreparedPurchaseReceipt,
  calculateSupplierReturnCredit,
  preparePurchaseReceipt,
} from './purchasing-accounting'
import { InventoryService } from '../inventory/inventory.service'
import { MAX_MONEY, unitCost } from '../common/money'
import {
  addItemLots,
  assertLotsMatchTracking,
  emptyLots,
  lotsFingerprint,
  toStockLots,
  type ItemLots,
} from './purchasing-lots'
import {
  assertQuantityPrecision,
  quantity,
  quantityNumber,
  variantQuantityPrecision,
} from '../common/quantity'

const purchaseInclude = {
  branch: true,
  supplier: true,
  creator: {
    select: { id: true, name: true },
  },
  reverser: {
    select: { id: true, name: true },
  },
  items: {
    include: {
      variant: { include: { product: true } },
    },
  },
  cost_movements: {
    orderBy: { sequence: 'asc' as const },
  },
  supplier_returns: {
    include: {
      creator: {
        select: { id: true, name: true },
      },
      items: {
        include: {
          variant: { include: { product: true } },
        },
      },
    },
    orderBy: { occurred_at: 'desc' as const },
  },
} satisfies Prisma.PurchaseInvoiceInclude

@Injectable()
export class PurchasingService {
  constructor(
    private prisma: PrismaService,
    private inventory: InventoryService,
  ) {}

  async list(context: TenantContext, branch_id?: string, paging: PageQuery = FIRST_PAGE) {
    const where = {
      tenant_id: context.tenantId,
      ...(branch_id ? { branch_id } : {}),
    }
    const [items, total] = await Promise.all([
      this.prisma.purchaseInvoice.findMany({
        where,
        include: {
          branch: true,
          supplier: true,
          creator: { select: { id: true, name: true } },
          items: { include: { variant: { include: { product: true } } } },
        },
        orderBy: [{ received_at: 'desc' }, { id: 'desc' }],
        ...pageArgs(paging),
      }),
      this.prisma.purchaseInvoice.count({ where }),
    ])
    return pageOf(items, total, paging)
  }

  get(context: TenantContext, id: string) {
    return this.prisma.purchaseInvoice.findFirst({
      where: { id, tenant_id: context.tenantId },
      include: purchaseInclude,
    })
  }

  async receive(context: TenantContext, dto: ReceivePurchaseDto, actor: AuthenticatedUser) {
    if (
      dto.discount_amount !== undefined &&
      dto.discount_percent !== undefined
    ) {
      throw new BadRequestException(
        'Use either discount_amount or discount_percent, not both',
      )
    }

    let prepared: PreparedPurchaseReceipt
    try {
      prepared = preparePurchaseReceipt(dto)
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error ? error.message : 'Invalid purchase receipt',
      )
    }

    if (!hasBranchAccess(actor, dto.branch_id)) {
      throw new ForbiddenException(
        'You cannot receive stock for another branch',
      )
    }

    const receivedAt = dto.received_at
      ? new Date(dto.received_at)
      : new Date()
    if (
      Number.isNaN(receivedAt.getTime()) ||
      receivedAt.getTime() > Date.now() + 300_000
    ) {
      throw new BadRequestException(
        'received_at must be a valid time that is not in the future',
      )
    }

    try {
      return await this.serializable(async (tx) => {
        const replay = await this.findReplay(
          tx,
          context,
          prepared,
          dto.supplier_id,
        )
        if (replay) return replay

        const [branch, supplier] = await Promise.all([
          // Both the receiving branch and the supplier must belong to the
          // caller's tenant; an unscoped supplier lookup would let a purchase
          // be booked against another tenant's supplier account.
          tx.branch.findFirst({
            where: { id: dto.branch_id, tenant_id: context.tenantId, is_active: true },
            select: { id: true },
          }),
          tx.supplier.findFirst({
            where: { id: dto.supplier_id, tenant_id: context.tenantId },
            select: { id: true },
          }),
        ])
        if (!branch) throw new NotFoundException('Active branch not found')
        if (!supplier) throw new NotFoundException('Supplier not found')

        const variantIds = prepared.lines
          .map((line) => line.variant_id)
          .sort()
        await this.lockVariants(tx, context, variantIds)

        const variants = await tx.productVariant.findMany({
          where: { id: { in: variantIds }, tenant_id: context.tenantId },
          select: { id: true, sku: true, tracking: true, base_uom: { select: { precision: true } } },
        })
        if (variants.length !== variantIds.length) {
          throw new NotFoundException(
            'One or more product variants were not found',
          )
        }
        const variantById = new Map(variants.map((variant) => [variant.id, variant]))
        for (const line of prepared.lines) {
          const variant = variantById.get(line.variant_id)!
          assertQuantityPrecision(line.qty, variantQuantityPrecision(variant), variant.sku)
        }
        assertLotsMatchTracking(
          prepared.lines.map((line) => ({
            variantId: line.variant_id,
            sku: variantById.get(line.variant_id)!.sku,
            lots: line.lots,
          })),
          new Map(variants.map((variant) => [variant.id, variant.tracking])),
        )

        const invoice = await tx.purchaseInvoice.create({
          data: {
            tenant_id: context.tenantId,
            supplier_id: dto.supplier_id,
            branch_id: dto.branch_id,
            invoice_number: dto.invoice_number?.trim() || null,
            normalized_invoice_number:
              prepared.normalizedInvoiceNumber,
            invoice_date: dto.invoice_date
              ? new Date(dto.invoice_date)
              : undefined,
            status: 'posted',
            accounting_version: 2,
            idempotency_key: prepared.idempotencyKey,
            command_fingerprint: prepared.commandFingerprint,
            subtotal: prepared.subtotal,
            discount_amount: prepared.discount,
            discount_percent: dto.discount_percent || 0,
            total: prepared.total,
            ocr_source_file: dto.ocr_source_file,
            received_at: receivedAt,
            created_by: actor.sub,
            items: {
              // tenant_id is deliberately omitted: PurchaseInvoiceItem.purchase_invoice
              // is a composite FK on (tenant_id, purchase_invoice_id), so Prisma's
              // nested-create input for this relation excludes tenant_id and auto-fills
              // it from the parent. Passing it explicitly throws
              // PrismaClientValidationError: Unknown argument tenant_id.
              create: prepared.lines.map((line) => ({
                variant_id: line.variant_id,
                qty: line.qty,
                unit_cost: line.unit_cost,
                line_subtotal: line.line_subtotal,
                allocated_discount: line.allocated_discount,
                net_line_total: line.net_line_total,
                net_unit_cost: line.net_unit_cost,
              })),
            },
          },
          include: { items: true },
        })

        const itemIdByVariant = new Map(
          invoice.items.map((item) => [item.variant_id, item.id]),
        )
        // The receipt moves the branch's default warehouse and its
        // moving-average cost, all lines in one inventory command.
        await this.inventory.apply(tx, {
          tenantId: context.tenantId,
          warehouseId: await this.inventory.defaultWarehouseId(
            tx,
            context.tenantId,
            dto.branch_id,
          ),
          occurredAt: receivedAt,
          actorId: actor.sub,
          type: 'purchase_receipt',
          costType: 'purchase_receipt',
          reference: { type: 'PurchaseInvoice', id: invoice.id },
          idempotencyKey: `purchase-receipt:${invoice.id}`,
          allowNegative: true,
          metadata: {
            supplier_id: dto.supplier_id,
            invoice_number: dto.invoice_number || null,
          },
          lines: prepared.lines.map((line) => {
            const itemId = itemIdByVariant.get(line.variant_id)
            if (!itemId) {
              throw new NotFoundException(
                `Created purchase line is missing for variant ${line.variant_id}`,
              )
            }
            const lots = toStockLots(line.lots)
            return {
              variantId: line.variant_id,
              qtyDelta: line.qty,
              referenceLineId: itemId,
              unitCost: line.net_unit_cost,
              value: line.net_line_total,
              ...(lots ? { lots } : {}),
              links: { purchaseInvoiceId: invoice.id, purchaseInvoiceItemId: itemId },
              metadata: {
                net_line_total: line.net_line_total.toFixed(2),
                net_unit_cost: line.net_unit_cost.toFixed(4),
                gross_line_total: line.line_subtotal.toFixed(2),
                allocated_discount: line.allocated_discount.toFixed(2),
              },
            }
          }),
        })

        await tx.auditLog.create({
          data: {
            tenant_id: context.tenantId,
            user_id: actor.sub,
            action: 'purchase.receipt.posted',
            entity: 'PurchaseInvoice',
            entity_id: invoice.id,
            meta: {
              accounting_version: 2,
              idempotency_key: prepared.idempotencyKey,
              command_fingerprint: prepared.commandFingerprint,
              supplier_id: dto.supplier_id,
              branch_id: dto.branch_id,
              invoice_number: dto.invoice_number || null,
              normalized_invoice_number:
                prepared.normalizedInvoiceNumber,
              subtotal: prepared.subtotal.toFixed(2),
              discount: prepared.discount.toFixed(2),
              total: prepared.total.toFixed(2),
              received_at: receivedAt.toISOString(),
            },
          },
        })

        return tx.purchaseInvoice.findFirstOrThrow({
          where: { id: invoice.id, tenant_id: context.tenantId },
          include: purchaseInclude,
        })
      })
    } catch (error) {
      if (this.isUniqueConflict(error)) {
        const replay = await this.findReplay(
          this.prisma,
          context,
          prepared,
          dto.supplier_id,
        )
        if (replay) return replay
        throw new ConflictException(
          'Supplier invoice number or purchase command was already used',
        )
      }
      throw error
    }
  }


  async returnToSupplier(
    context: TenantContext,
    invoiceId: string,
    dto: CreateSupplierReturnDto,
    actor: AuthenticatedUser,
  ) {
    if (!dto.command_id) {
      throw new BadRequestException(
        'command_id is required for supplier returns',
      )
    }
    const reason = dto.reason.trim()
    if (!reason) {
      throw new BadRequestException('Supplier return reason is required')
    }

    const occurredAt = dto.occurred_at
      ? new Date(dto.occurred_at)
      : new Date()
    if (
      Number.isNaN(occurredAt.getTime()) ||
      occurredAt.getTime() > Date.now() + 300_000
    ) {
      throw new BadRequestException(
        'occurred_at must be a valid time that is not in the future',
      )
    }

    const requested = new Map<string, Prisma.Decimal>()
    const requestedLots = new Map<string, ItemLots>()
    for (const item of dto.items) {
      const next = (
        requested.get(item.purchase_invoice_item_id) ?? new Prisma.Decimal(0)
      ).plus(quantity(item.qty))
      if (next.gt(99_999_999.999)) {
        throw new BadRequestException(
          'Supplier return quantity exceeds supported range',
        )
      }
      requested.set(item.purchase_invoice_item_id, next)
      const lots = requestedLots.get(item.purchase_invoice_item_id) ?? emptyLots()
      try {
        addItemLots(lots, item, quantity(item.qty))
      } catch (error) {
        throw new BadRequestException(error instanceof Error ? error.message : 'Invalid tracking data')
      }
      requestedLots.set(item.purchase_invoice_item_id, lots)
    }
    const canonicalItems = [...requested.entries()]
      .map(([purchase_invoice_item_id, qty]) => ({
        purchase_invoice_item_id,
        qty,
        lots: requestedLots.get(purchase_invoice_item_id) ?? emptyLots(),
      }))
      .sort((left, right) =>
        left.purchase_invoice_item_id.localeCompare(
          right.purchase_invoice_item_id,
        ),
      )
    const fingerprint = createHash('sha256')
      .update(
        JSON.stringify({
          version: 1,
          purchase_invoice_id: invoiceId,
          reason,
          occurred_at: dto.occurred_at
            ? occurredAt.toISOString()
            : null,
          items: canonicalItems.map((item) => ({
            purchase_invoice_item_id: item.purchase_invoice_item_id,
            qty: quantityNumber(item.qty),
            ...lotsFingerprint(item.lots),
          })),
        }),
      )
      .digest('hex')
    const idempotencyKey = `supplier-return:${dto.command_id}`

    try {
      return await this.serializable(async (tx) => {
        await tx.$queryRaw`
          SELECT "id"
          FROM "PurchaseInvoice"
          WHERE "id" = ${invoiceId}::uuid
          FOR UPDATE
        `

        const replay = await tx.supplierReturn.findFirst({
          where: { tenant_id: context.tenantId, idempotency_key: idempotencyKey },
          include: {
            purchase_invoice: true,
            supplier: true,
            branch: true,
            creator: {
              select: { id: true, name: true },
            },
            items: {
              include: {
                variant: { include: { product: true } },
              },
            },
            cost_movements: {
              orderBy: { sequence: 'asc' },
            },
          },
        })
        if (replay) {
          if (replay.command_fingerprint !== fingerprint) {
            throw new ConflictException(
              'Supplier return command belongs to different return data',
            )
          }
          return replay
        }

        const invoice = await tx.purchaseInvoice.findFirst({
          where: { id: invoiceId, tenant_id: context.tenantId },
          include: { items: true },
        })
        if (!invoice) {
          throw new NotFoundException('Purchase invoice not found')
        }
        if (invoice.status !== 'posted') {
          throw new ConflictException(
            'Supplier returns require a posted purchase invoice',
          )
        }
        if (
          invoice.accounting_version < 2 &&
          new Prisma.Decimal(invoice.discount_amount).greaterThan(0)
        ) {
          throw new ConflictException(
            'A discounted legacy purchase has no reproducible line allocation and requires manual accounting review',
          )
        }
        if (!hasBranchAccess(actor, invoice.branch_id)) {
          throw new ForbiddenException(
            'You cannot return stock for another branch',
          )
        }

        type PurchaseLine = {
          id: string
          variant_id: string
          qty: Prisma.Decimal
          unit_cost: Prisma.Decimal
          net_unit_cost: Prisma.Decimal | null
          net_line_total: Prisma.Decimal | null
        }
        const invoiceItemById = new Map<string, PurchaseLine>(
          invoice.items.map((item) => [
            item.id,
            {
              id: item.id,
              variant_id: item.variant_id,
              qty: item.qty,
              unit_cost: item.unit_cost,
              net_unit_cost: item.net_unit_cost,
              net_line_total: item.net_line_total,
            },
          ]),
        )
        for (const request of canonicalItems) {
          if (!invoiceItemById.has(request.purchase_invoice_item_id)) {
            throw new BadRequestException(
              `Purchase line ${request.purchase_invoice_item_id} does not belong to invoice ${invoiceId}`,
            )
          }
        }

        const variantIds = [
          ...new Set(
            canonicalItems.map(
              (request) =>
                invoiceItemById.get(
                  request.purchase_invoice_item_id,
                )!.variant_id,
            ),
          ),
        ].sort()
        await this.lockVariants(tx, context, variantIds)

        // The goods leave the branch's default warehouse at its current
        // moving-average cost, which the removal is priced with below.
        const warehouseId = await this.inventory.defaultWarehouseId(
          tx,
          context.tenantId,
          invoice.branch_id,
        )
        const [variants, returned, averageCosts] = await Promise.all([
          tx.productVariant.findMany({
            where: { tenant_id: context.tenantId, id: { in: variantIds } },
            select: { id: true, sku: true, cost_price: true, tracking: true, base_uom: { select: { precision: true } } },
          }),
          tx.supplierReturnItem.groupBy({
            by: ['purchase_invoice_item_id'],
            where: {
              purchase_invoice_item_id: {
                in: canonicalItems.map(
                  (item) => item.purchase_invoice_item_id,
                ),
              },
            },
            _sum: { qty: true, credit_total: true },
          }),
          this.inventory.averageCosts(tx, context.tenantId, warehouseId, variantIds),
        ])
        const variantById = new Map(variants.map((variant) => [variant.id, variant]))
        const returnedByLine = new Map<
          string,
          { qty: Prisma.Decimal; creditTotal: Prisma.Decimal }
        >(
          returned.map((row) => [
            row.purchase_invoice_item_id,
            {
              qty: new Prisma.Decimal(row._sum.qty ?? 0),
              creditTotal: new Prisma.Decimal(
                row._sum.credit_total || 0,
              ),
            },
          ]),
        )

        const preparedItems = canonicalItems.map((request) => {
          const purchaseItem = invoiceItemById.get(
            request.purchase_invoice_item_id,
          )!
          const previousReturn = returnedByLine.get(
            purchaseItem.id,
          ) || {
            qty: new Prisma.Decimal(0),
            creditTotal: new Prisma.Decimal(0),
          }
          const variant = variantById.get(purchaseItem.variant_id)
          if (!variant) {
            throw new NotFoundException(
              `Variant not found: ${purchaseItem.variant_id}`,
            )
          }
          assertQuantityPrecision(request.qty, variantQuantityPrecision(variant), variant.sku)

          const originalLineCredit = new Prisma.Decimal(
            purchaseItem.net_line_total ||
              new Prisma.Decimal(purchaseItem.unit_cost)
                .mul(purchaseItem.qty)
                .toDecimalPlaces(2),
          ).toDecimalPlaces(2)
          let credit: ReturnType<
            typeof calculateSupplierReturnCredit
          >
          try {
            credit = calculateSupplierReturnCredit({
              lineQty: purchaseItem.qty,
              lineCreditTotal: originalLineCredit,
              returnedQty: previousReturn.qty,
              returnedCredit: previousReturn.creditTotal,
              requestedQty: request.qty,
              defaultUnitCredit:
                purchaseItem.net_unit_cost ||
                purchaseItem.unit_cost,
            })
          } catch (error) {
            throw new ConflictException(
              error instanceof Error
                ? `${error.message} for purchase line ${purchaseItem.id}`
                : `Invalid supplier return for purchase line ${purchaseItem.id}`,
            )
          }
          const creditTotal = credit.creditTotal
          const creditUnitCost = credit.creditUnitCost
          const inventoryUnitCost = unitCost(
            averageCosts.get(purchaseItem.variant_id) ?? variant.cost_price,
          )
          const inventoryValueRemoved = inventoryUnitCost
            .mul(request.qty)
            .toDecimalPlaces(2)

          return {
            purchaseItem,
            qty: request.qty,
            lots: request.lots,
            creditUnitCost,
            creditTotal,
            inventoryUnitCost,
            inventoryValueRemoved,
            variance: creditTotal
              .minus(inventoryValueRemoved)
              .toDecimalPlaces(2),
          }
        })

        assertLotsMatchTracking(
          preparedItems.map((item) => ({
            variantId: item.purchaseItem.variant_id,
            sku: variantById.get(item.purchaseItem.variant_id)!.sku,
            lots: item.lots,
          })),
          new Map(variants.map((variant) => [variant.id, variant.tracking])),
        )

        const creditTotal = preparedItems
          .reduce(
            (sum, item) => sum.plus(item.creditTotal),
            new Prisma.Decimal(0),
          )
          .toDecimalPlaces(2)
        const inventoryValueRemoved = preparedItems
          .reduce(
            (sum, item) =>
              sum.plus(item.inventoryValueRemoved),
            new Prisma.Decimal(0),
          )
          .toDecimalPlaces(2)
        const variance = creditTotal
          .minus(inventoryValueRemoved)
          .toDecimalPlaces(2)
        if (
          creditTotal.greaterThan(MAX_MONEY) ||
          inventoryValueRemoved.greaterThan(MAX_MONEY) ||
          variance.abs().greaterThan(MAX_MONEY)
        ) {
          throw new BadRequestException(
            'Supplier return exceeds supported accounting value range',
          )
        }

        const returnRecord = await tx.supplierReturn.create({
          data: {
            tenant_id: context.tenantId,
            purchase_invoice_id: invoice.id,
            supplier_id: invoice.supplier_id,
            branch_id: invoice.branch_id,
            return_number:
              `SR-${occurredAt.getTime()}-${randomUUID().slice(0, 8)}`,
            status: 'posted',
            idempotency_key: idempotencyKey,
            command_fingerprint: fingerprint,
            reason,
            credit_total: creditTotal,
            inventory_value_removed: inventoryValueRemoved,
            purchase_price_variance: variance,
            occurred_at: occurredAt,
            created_by: actor.sub,
            items: {
              create: preparedItems.map((item) => ({
                purchase_invoice_item_id:
                  item.purchaseItem.id,
                variant_id: item.purchaseItem.variant_id,
                qty: item.qty,
                credit_unit_cost: item.creditUnitCost,
                credit_total: item.creditTotal,
                inventory_unit_cost: item.inventoryUnitCost,
                inventory_value_removed:
                  item.inventoryValueRemoved,
                purchase_price_variance: item.variance,
              })),
            },
          },
          include: { items: true },
        })
        const returnItemByPurchaseLine = new Map(
          returnRecord.items.map((item) => [item.purchase_invoice_item_id, item.id]),
        )

        await this.inventory.apply(tx, {
          tenantId: context.tenantId,
          warehouseId,
          occurredAt,
          actorId: actor.sub,
          type: 'reversal',
          costType: 'supplier_return',
          reference: { type: 'SupplierReturn', id: returnRecord.id },
          idempotencyKey: `supplier-return-stock:${returnRecord.id}`,
          allowNegative: false,
          metadata: { purchase_invoice_id: invoice.id },
          lines: preparedItems.map((item) => {
            const returnItemId = returnItemByPurchaseLine.get(item.purchaseItem.id)
            if (!returnItemId) {
              throw new ConflictException('Created supplier return line is missing')
            }
            const lots = toStockLots(item.lots)
            return {
              variantId: item.purchaseItem.variant_id,
              qtyDelta: item.qty.negated(),
              referenceLineId: returnItemId,
              value: item.inventoryValueRemoved.negated(),
              ...(lots ? { lots } : {}),
              links: {
                purchaseInvoiceId: invoice.id,
                purchaseInvoiceItemId: item.purchaseItem.id,
                supplierReturnId: returnRecord.id,
                supplierReturnItemId: returnItemId,
              },
              metadata: {
                credit_total: item.creditTotal.toFixed(2),
                inventory_value_removed: item.inventoryValueRemoved.toFixed(2),
                purchase_price_variance: item.variance.toFixed(2),
              },
            }
          }),
        })

        await tx.auditLog.create({
          data: {
            tenant_id: context.tenantId,
            user_id: actor.sub,
            action: 'purchase.supplier_return.posted',
            entity: 'SupplierReturn',
            entity_id: returnRecord.id,
            meta: {
              purchase_invoice_id: invoice.id,
              reason,
              credit_total: creditTotal.toFixed(2),
              inventory_value_removed:
                inventoryValueRemoved.toFixed(2),
              purchase_price_variance: variance.toFixed(2),
              occurred_at: occurredAt.toISOString(),
            },
          },
        })

        return tx.supplierReturn.findFirstOrThrow({
          where: { id: returnRecord.id, tenant_id: context.tenantId },
          include: {
            purchase_invoice: true,
            supplier: true,
            branch: true,
            creator: {
              select: { id: true, name: true },
            },
            items: {
              include: {
                variant: { include: { product: true } },
              },
            },
            cost_movements: {
              orderBy: { sequence: 'asc' },
            },
          },
        })
      })
    } catch (error) {
      if (this.isUniqueConflict(error)) {
        const existing =
          await this.prisma.supplierReturn.findFirst({
            where: { tenant_id: context.tenantId, idempotency_key: idempotencyKey },
            include: {
              purchase_invoice: true,
              supplier: true,
              branch: true,
              creator: {
                select: { id: true, name: true },
              },
              items: {
                include: {
                  variant: { include: { product: true } },
                },
              },
              cost_movements: {
                orderBy: { sequence: 'asc' },
              },
            },
          })
        if (existing) {
          if (existing.command_fingerprint === fingerprint) {
            return existing
          }
          throw new ConflictException(
            'Supplier return command belongs to different return data',
          )
        }
      }
      throw error
    }
  }

  listSupplierReturns(context: TenantContext, branchId?: string, take = 100) {
    const safeTake = Math.min(500, Math.max(1, Number(take) || 100))
    return this.prisma.supplierReturn.findMany({
      where: {
        tenant_id: context.tenantId,
        ...(branchId ? { branch_id: branchId } : {}),
      },
      include: {
        purchase_invoice: true,
        supplier: true,
        branch: true,
        creator: {
          select: { id: true, name: true },
        },
        items: {
          include: {
            variant: { include: { product: true } },
          },
        },
      },
      orderBy: [
        { occurred_at: 'desc' },
        { id: 'desc' },
      ],
      take: safeTake,
    })
  }

  async reverse(
    context: TenantContext,
    invoiceId: string,
    dto: ReversePurchaseDto,
    actor: AuthenticatedUser,
  ) {
    const reason = dto.reason.trim()
    if (!reason) {
      throw new BadRequestException('Reversal reason is required')
    }

    const fingerprint = createHash('sha256')
      .update(
        JSON.stringify({
          version: 1,
          invoice_id: invoiceId,
          reason,
        }),
      )
      .digest('hex')
    const idempotencyKey = dto.command_id
      ? `purchase-reversal:${dto.command_id}`
      : `purchase-reversal:${invoiceId}`

    return this.serializable(async (tx) => {
      await tx.$queryRaw`
        SELECT "id"
        FROM "PurchaseInvoice"
        WHERE "id" = ${invoiceId}::uuid
          AND "tenant_id" = ${context.tenantId}::uuid
        FOR UPDATE
      `

      const invoice = await tx.purchaseInvoice.findFirst({
        where: { id: invoiceId, tenant_id: context.tenantId },
        include: { items: true },
      })
      if (!invoice) {
        throw new NotFoundException('Purchase invoice not found')
      }

      if (!hasBranchAccess(actor, invoice.branch_id)) {
        throw new ForbiddenException(
          'You cannot reverse a purchase for another branch',
        )
      }

      if (invoice.status === 'reversed') {
        if (
          invoice.reversal_idempotency_key === idempotencyKey &&
          invoice.reversal_command_fingerprint === fingerprint
        ) {
          return tx.purchaseInvoice.findFirstOrThrow({
            where: { id: invoiceId, tenant_id: context.tenantId },
            include: purchaseInclude,
          })
        }
        throw new ConflictException(
          'Purchase invoice was already reversed by a different command',
        )
      }
      if (invoice.status !== 'posted') {
        throw new ConflictException(
          'Only a posted purchase invoice can be reversed',
        )
      }

      const variantIds = invoice.items
        .map((item) => item.variant_id)
        .sort()
      await this.lockVariants(tx, context, variantIds)

      const reversedAt = new Date()
      const [receiptCosts, receiptStocks, variantRows] = await Promise.all([
        tx.inventoryCostMovement.findMany({
          where: {
            tenant_id: context.tenantId,
            purchase_invoice_id: invoice.id,
            movement_type: 'purchase_receipt',
          },
        }),
        tx.inventoryMovement.findMany({
          where: {
            tenant_id: context.tenantId,
            reference_type: 'PurchaseInvoice',
            reference_id: invoice.id,
            movement_type: 'purchase_receipt',
          },
        }),
        tx.productVariant.findMany({
          where: { tenant_id: context.tenantId, id: { in: variantIds } },
          select: { id: true, item_type: true, tracking: true },
        }),
      ])
      // Undoing a receipt would have to pick the lots to take back; the supplier return does it properly.
      if (variantRows.some((variant) => variant.tracking === 'serial' || variant.tracking === 'batch')) {
        throw new ConflictException({
          code: 'TRACKED_PURCHASE_REVERSAL_NOT_SUPPORTED',
          message: 'A receipt of serial- or batch-tracked items cannot be reversed; return the goods to the supplier instead',
          message_ar: 'لا يمكن عكس استلام يحتوي أصنافًا متتبعة؛ استخدم مرتجع المورد بدلًا منه.',
        })
      }
      const stocked = new Set(
        variantRows.filter((variant) => variant.item_type === 'stocked').map((variant) => variant.id),
      )
      const costByItem = new Map(receiptCosts.map((movement) => [movement.purchase_invoice_item_id, movement]))
      const stockByVariant = new Map(receiptStocks.map((movement) => [movement.variant_id, movement]))
      // Non-stocked lines never moved stock, so there is nothing to reverse for them.
      const reversible = invoice.items.filter((item) => stocked.has(item.variant_id))
      for (const item of reversible) {
        if (!costByItem.has(item.id) || !stockByVariant.has(item.variant_id)) {
          throw new ConflictException(
            'Legacy or incomplete purchase receipts cannot be reversed automatically',
          )
        }
      }

      if (reversible.length) {
        // Only an untouched latest receipt can be reversed: the warehouse must
        // hold exactly what the receipt left (quantity and average cost) and
        // nothing may have been posted against the variant since.
        const warehouseId = costByItem.get(reversible[0].id)!.warehouse_id
        const variants = reversible.map((item) => item.variant_id)
        const [downstream, stockRows] = await Promise.all([
          tx.$queryRaw<Array<{ variant_id: string }>>`
            SELECT DISTINCT r."variant_id"
            FROM unnest(
              ${variants}::uuid[],
              ${reversible.map((item) => costByItem.get(item.id)!.sequence.toString())}::bigint[],
              ${reversible.map((item) => stockByVariant.get(item.variant_id)!.sequence.toString())}::bigint[]
            ) AS r("variant_id", "cost_sequence", "stock_sequence")
            WHERE EXISTS (
                SELECT 1 FROM "InventoryCostMovement" m
                WHERE m."warehouse_id" = ${warehouseId}::uuid
                  AND m."variant_id" = r."variant_id"
                  AND m."sequence" > r."cost_sequence"
              )
              OR EXISTS (
                SELECT 1 FROM "InventoryMovement" m
                WHERE m."warehouse_id" = ${warehouseId}::uuid
                  AND m."variant_id" = r."variant_id"
                  AND m."sequence" > r."stock_sequence"
              )
          `,
          tx.inventoryStock.findMany({
            where: { tenant_id: context.tenantId, warehouse_id: warehouseId, variant_id: { in: variants } },
          }),
        ])
        const stockByItemVariant = new Map(stockRows.map((row) => [row.variant_id, row]))
        const untouched = reversible.every((item) => {
          const receipt = costByItem.get(item.id)!
          const current = stockByItemVariant.get(item.variant_id)
          return (
            current &&
            current.qty_on_hand.equals(receipt.quantity_after) &&
            current.avg_cost.equals(receipt.cost_after)
          )
        })
        if (downstream.length || !untouched) {
          throw new ConflictException(
            'Purchase receipt has downstream inventory activity and cannot be fully reversed',
          )
        }

        await this.inventory.apply(tx, {
          tenantId: context.tenantId,
          warehouseId,
          occurredAt: reversedAt,
          actorId: actor.sub,
          type: 'reversal',
          costType: 'purchase_reversal',
          reference: { type: 'PurchaseInvoice', id: invoice.id },
          idempotencyKey: `purchase-reversal-stock:${invoice.id}`,
          allowNegative: false,
          metadata: { reason },
          lines: reversible.map((item) => {
            const receipt = costByItem.get(item.id)!
            return {
              variantId: item.variant_id,
              qtyDelta: item.qty.negated(),
              referenceLineId: item.id,
              value: receipt.movement_value.negated(),
              restoreCost: receipt.cost_before,
              links: { purchaseInvoiceId: invoice.id, purchaseInvoiceItemId: item.id },
              metadata: {
                original_movement_id: stockByVariant.get(item.variant_id)!.id,
                original_cost_movement_id: receipt.id,
              },
            }
          }),
        })
      }

      await tx.$queryRaw`
        SELECT set_config(
          'bold.purchase_accounting_document_write',
          'on',
          true
        )
      `
      const reversed = await tx.purchaseInvoice.update({
        where: { id: invoice.id },
        data: {
          status: 'reversed',
          reversal_idempotency_key: idempotencyKey,
          reversal_command_fingerprint: fingerprint,
          reversal_reason: reason,
          reversed_at: reversedAt,
          reversed_by: actor.sub,
        },
      })
      await tx.$queryRaw`
        SELECT set_config(
          'bold.purchase_accounting_document_write',
          'off',
          true
        )
      `

      await tx.auditLog.create({
        data: {
          tenant_id: context.tenantId,
          user_id: actor.sub,
          action: 'purchase.receipt.reversed',
          entity: 'PurchaseInvoice',
          entity_id: invoice.id,
          meta: {
            reason,
            idempotency_key: idempotencyKey,
            command_fingerprint: fingerprint,
            reversed_at: reversedAt.toISOString(),
          },
        },
      })

      return tx.purchaseInvoice.findFirstOrThrow({
        where: { id: reversed.id, tenant_id: context.tenantId },
        include: purchaseInclude,
      })
    })
  }

  listCostMovements(
    context: TenantContext,
    branchId?: string,
    variantId?: string,
    take = 100,
  ) {
    const safeTake = Math.min(500, Math.max(1, Number(take) || 100))
    return this.prisma.inventoryCostMovement.findMany({
      where: {
        tenant_id: context.tenantId,
        ...(branchId ? { warehouse: { branch_id: branchId } } : {}),
        ...(variantId ? { variant_id: variantId } : {}),
      },
      include: {
        variant: { include: { product: true } },
        warehouse: { include: { branch: true } },
        purchase_invoice: {
          include: { supplier: true },
        },
        creator: {
          select: { id: true, name: true },
        },
      },
      orderBy: { sequence: 'desc' },
      take: safeTake,
    })
  }

  async costReconciliation(context: TenantContext, variantId?: string) {
    return this.prisma.$queryRaw<
      Array<{
        variant_id: string
        sku: string
        product_name: string
        materialized_cost: Prisma.Decimal
        ledger_cost: Prisma.Decimal | null
        current_global_qty: Prisma.Decimal
        reconciled: boolean
      }>
    >`
      WITH latest AS (
        SELECT DISTINCT ON (movement."variant_id")
          movement."variant_id",
          movement."cost_after"
        FROM "InventoryCostMovement" movement
        WHERE movement."tenant_id" = ${context.tenantId}::uuid
        ORDER BY
          movement."variant_id",
          movement."sequence" DESC
      ),
      on_hand AS (
        SELECT
          record."variant_id",
          COALESCE(SUM(record."qty_on_hand"), 0) AS "qty"
        FROM "InventoryStock" record
        WHERE record."tenant_id" = ${context.tenantId}::uuid
        GROUP BY record."variant_id"
      )
      SELECT
        variant."id" AS "variant_id",
        variant."sku",
        product."name_en" AS "product_name",
        variant."cost_price" AS "materialized_cost",
        latest."cost_after" AS "ledger_cost",
        COALESCE(on_hand."qty", 0) AS "current_global_qty",
        (
          (
            latest."cost_after" IS NULL
            AND COALESCE(on_hand."qty", 0) = 0
          )
          OR latest."cost_after" = variant."cost_price"
        ) AS "reconciled"
      FROM "ProductVariant" variant
      JOIN "Product" product
        ON product."id" = variant."product_id"
      LEFT JOIN latest
        ON latest."variant_id" = variant."id"
      LEFT JOIN on_hand
        ON on_hand."variant_id" = variant."id"
      WHERE variant."tenant_id" = ${context.tenantId}::uuid
        AND product."tenant_id" = ${context.tenantId}::uuid
        AND (${variantId || null}::uuid IS NULL
          OR variant."id" = ${variantId || null}::uuid)
      ORDER BY "reconciled" ASC, variant."sku" ASC
    `
  }

  async ocrImport(fileUrl: string) {
    return {
      draft: true,
      source: fileUrl,
      items: [],
      message:
        'Upload supplier invoice – edit then confirm – supplier alias mapping supported',
    }
  }

  private async findReplay(
    db: Pick<Prisma.TransactionClient, 'purchaseInvoice'>,
    context: TenantScope,
    prepared: PreparedPurchaseReceipt,
    supplierId: string,
  ) {
    const existing = await db.purchaseInvoice.findFirst({
      where: {
        tenant_id: context.tenantId,
        OR: [
          { idempotency_key: prepared.idempotencyKey },
          ...(prepared.normalizedInvoiceNumber
            ? [
                {
                  supplier_id: supplierId,
                  normalized_invoice_number:
                    prepared.normalizedInvoiceNumber,
                },
              ]
            : []),
        ],
      },
      include: purchaseInclude,
    })

    if (!existing) return null
    if (
      existing.command_fingerprint !==
      prepared.commandFingerprint
    ) {
      throw new ConflictException(
        'Purchase command or supplier invoice number belongs to different receipt data',
      )
    }
    return existing
  }

  private async lockVariants(
    tx: Prisma.TransactionClient,
    context: TenantScope,
    variantIds: string[],
  ) {
    if (!variantIds.length) return
    await tx.$queryRaw(
      Prisma.sql`
        SELECT variant."id"
        FROM "ProductVariant" variant
        WHERE variant."tenant_id" = ${context.tenantId}::uuid
          AND variant."id" IN (
          ${Prisma.join(
            variantIds.map(
              (id) => Prisma.sql`${id}::uuid`,
            ),
          )}
        )
        ORDER BY variant."id"
        FOR UPDATE
      `,
    )
  }

  private async serializable<T>(
    operation: (tx: Prisma.TransactionClient) => Promise<T>,
  ) {
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        return await this.prisma.$transaction(operation, {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
          maxWait: 10_000,
          timeout: 45_000,
        })
      } catch (error) {
        if (
          attempt < 3 &&
          this.prismaErrorCode(error) === 'P2034'
        ) {
          continue
        }
        throw error
      }
    }
    throw new ConflictException(
      'Purchase transaction could not be serialized',
    )
  }

  private isUniqueConflict(error: unknown) {
    return this.prismaErrorCode(error) === 'P2002'
  }

  private prismaErrorCode(error: unknown) {
    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error
    ) {
      return String((error as { code?: unknown }).code || '')
    }
    return ''
  }
}
