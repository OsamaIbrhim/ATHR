import { Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import type { TenantContext } from '../identity/tenant-context.type';
import type { AuthenticatedUser } from '../auth/authenticated-user';
import { assertBranchAccess } from '../auth/branch-access';
import { InventoryService } from '../inventory/inventory.service';
import { loadStockVariants } from '../inventory/inventory-variants';
import { domainError, UNPROCESSABLE } from '../common/domain-error';
import { quantityNumber } from '../common/quantity';
import { postOpeningBalance, type OpeningLineResult } from './opening-balance';
import type { PostOpeningBalanceDto } from './dto/opening-balance.dto';

/** The wire shape of one line's outcome. */
function presentResult(result: OpeningLineResult) {
  return result.status === 'posted'
    ? {
        index: result.index,
        variant_id: result.variant_id,
        status: result.status,
        qty_after: quantityNumber(result.qty_after),
        avg_cost: result.avg_cost.toFixed(4),
      }
    : result;
}

@Injectable()
export class OpeningBalanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly inventory: InventoryService,
  ) {}

  /**
   * Starting quantities (and unit cost) of many variants into a branch's
   * default warehouse: one engine command for the lines that are allowed,
   * a per-line verdict for the rest. Nothing posted at all is a 422 that
   * carries every line's reason in `data.results`.
   */
  async post(context: TenantContext, dto: PostOpeningBalanceDto, actor: AuthenticatedUser) {
    assertBranchAccess(actor, dto.branch_id);
    const branch = await this.prisma.branch.findFirst({
      where: { id: dto.branch_id, tenant_id: context.tenantId, is_active: true },
      select: { id: true },
    });
    if (!branch) throw new NotFoundException('Branch not found');

    const results = await this.prisma.$transaction(
      async (tx) => {
        const warehouseId = await this.inventory.defaultWarehouseId(tx, context.tenantId, dto.branch_id);
        const variants = await loadStockVariants(tx, context.tenantId, dto.lines.map((line) => line.variant_id));
        const outcome = await postOpeningBalance(this.inventory, tx, {
          tenantId: context.tenantId,
          warehouseId,
          actorId: actor.sub,
          idempotencyKey: `opening:${dto.idempotency_key}`,
          referenceId: randomUUID(),
          variants,
          lines: dto.lines.map((line, index) => ({
            index,
            variantId: line.variant_id,
            qty: line.qty,
            unitCost: line.unit_cost ?? null,
          })),
        });
        const posted = outcome.filter((result) => result.status === 'posted').length;
        if (posted) {
          await tx.auditLog.create({
            data: {
              tenant_id: context.tenantId,
              user_id: actor.sub,
              action: 'inventory.opening_balance.posted',
              entity: 'Branch',
              entity_id: dto.branch_id,
              meta: { idempotency_key: dto.idempotency_key, lines_posted: posted, lines_rejected: outcome.length - posted },
            },
          });
        }
        return outcome;
      },
      { maxWait: 15_000, timeout: 60_000 },
    );

    const presented = results.map(presentResult);
    const posted = results.filter((result) => result.status === 'posted').length;
    if (!posted) {
      throw domainError(
        UNPROCESSABLE,
        'OPENING_BALANCE_REJECTED',
        'None of the lines could be posted',
        'تعذّر تسجيل أي صنف من الأسطر المرسلة.',
        { results: presented },
      );
    }
    return {
      branch_id: dto.branch_id,
      posted,
      rejected: results.length - posted,
      results: presented,
    };
  }
}
