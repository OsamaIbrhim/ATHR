import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { AuthenticatedUser } from '../auth/authenticated-user';
import { assertBranchAccess } from '../auth/branch-access';
import { quantityNumber } from '../common/quantity';
import type { TenantContext } from '../identity/tenant-context.type';
import { PrismaService } from '../prisma/prisma.service';
import { ListReturnsDto } from './dto/list-returns.dto';

@Injectable()
export class ReturnsReadService {
  constructor(private prisma: PrismaService) {}

  async findReturnableInvoice(context: TenantContext, reference: string, actor: AuthenticatedUser) {
    const byId =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        reference,
      );
    const invoice = await this.prisma.salesInvoice.findFirst({
      where: {
        tenant_id: context.tenantId,
        ...(byId ? { id: reference } : { invoice_number: reference }),
      },
      select: {
        id: true,
        invoice_number: true,
        branch_id: true,
        total: true,
        occurred_at: true,
        created_at: true,
        items: {
          select: {
            id: true,
            variant_id: true,
            qty: true,
            unit_price: true,
            unit_tax: true,
            discount_amount: true,
            tax_amount: true,
            variant: {
              select: {
                sku: true,
                product: { select: { name_en: true, name_ar: true } },
              },
            },
            return_items: {
              where: { return_record: { status: 'completed' } },
              select: { qty: true },
            },
          },
        },
      },
    });
    if (!invoice) throw new NotFoundException('Invoice not found');
    assertBranchAccess(actor, invoice.branch_id);
    return {
      ...invoice,
      items: invoice.items.map((item) => {
        const returnedQty = item.return_items.reduce(
          (sum, record) => sum.plus(record.qty),
          new Prisma.Decimal(0),
        );
        const { return_items: _returnItems, ...safe } = item;
        return {
          ...safe,
          returned_qty: quantityNumber(returnedQty),
          returnable_qty: quantityNumber(item.qty.minus(returnedQty)),
        };
      }),
    };
  }

  async listReturns(context: TenantContext, dto: ListReturnsDto, branchId?: string) {
    const q = dto.q.trim();
    const where: Prisma.ReturnWhereInput = {
      tenant_id: context.tenantId,
      ...(branchId ? { branch_id: branchId } : {}),
      ...(q
        ? {
            OR: [
              {
                return_invoice_number: {
                  contains: q,
                  mode: 'insensitive',
                },
              },
              {
                original_invoice: {
                  invoice_number: {
                    contains: q,
                    mode: 'insensitive',
                  },
                },
              },
              {
                original_invoice: {
                  customer: { phone: { contains: q } },
                },
              },
            ],
          }
        : {}),
    };

    const [total, items] = await Promise.all([
      this.prisma.return.count({ where }),
      this.prisma.return.findMany({
        where,
        select: {
          id: true,
          return_invoice_number: true,
          original_invoice_id: true,
          branch_id: true,
          reason: true,
          is_partial: true,
          created_by: true,
          refund_subtotal: true,
          refund_tax: true,
          refund_total: true,
          refund_method: true,
          status: true,
          created_at: true,
          _count: { select: { items: true } },
          original_invoice: {
            select: {
              id: true,
              invoice_number: true,
              total: true,
              payments: { select: { method: true, amount: true }, orderBy: { sequence: 'asc' } },
              customer: {
                select: { id: true, name: true, phone: true },
              },
              terminal: {
                select: { id: true, terminal_code: true, name: true },
              },
            },
          },
        },
        orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
        skip: (dto.page - 1) * dto.page_size,
        take: dto.page_size,
      }),
    ]);

    return {
      items,
      total,
      page: dto.page,
      page_size: dto.page_size,
      total_pages: Math.max(1, Math.ceil(total / dto.page_size)),
      server_time: new Date().toISOString(),
    };
  }

}
