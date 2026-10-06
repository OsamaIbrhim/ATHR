import { Prisma } from '@prisma/client';
import { hasBranchAccess, toScopeSet } from '../auth/branch-access';
import type { CreateSaleDto } from './dto/create-sale.dto';

/**
 * The people and the shift a sale points at, as far as the server can verify
 * them. A reference that does not resolve is dropped and flagged, never refused
 * (a finished sale is always recorded).
 */
export async function resolveSaleActors(
  tx: Prisma.TransactionClient,
  tenantId: string,
  dto: CreateSaleDto,
  occurredAt: Date,
) {
  const warnings: string[] = [];
  const [shift, staff] = await Promise.all([
    tx.shift.findFirst({ where: { id: dto.shift_id, tenant_id: tenantId } }),
    // Staff are resolved through their Membership: `User` has no tenant data.
    tx.membership.findMany({
      where: { tenant_id: tenantId, user_id: { in: [dto.origin_cashier_id, dto.seller_id] } },
      select: { user_id: true, role: true, access_scope_assignments: true, granted_permissions: true, revoked_permissions: true },
    }),
  ]);
  const originCashier = staff.find((m) => m.user_id === dto.origin_cashier_id);
  const seller = staff.find((m) => m.user_id === dto.seller_id);
  const worksInBranch = (m: typeof originCashier) =>
    !!m && hasBranchAccess({ scope_set: toScopeSet(m.access_scope_assignments) }, dto.branch_id);
  const linkedCashier = originCashier && worksInBranch(originCashier) ? { id: originCashier.user_id } : null;
  if (!linkedCashier) warnings.push('CASHIER_REFERENCE_MISSING');
  const linkedSeller = seller && seller.role === 'seller' && worksInBranch(seller) ? { id: seller.user_id } : null;
  if (!linkedSeller) warnings.push('SELLER_REFERENCE_MISSING');
  const linkedShift = shift?.branch_id === dto.branch_id ? shift : null;
  if (!linkedShift) {
    warnings.push('SHIFT_REFERENCE_MISSING');
  } else if (
    linkedShift.status === 'closed' ||
    occurredAt < linkedShift.opened_at ||
    (linkedShift.closed_at && occurredAt > linkedShift.closed_at)
  ) {
    warnings.push('LATE_SYNC');
  }
  return { originCashier, linkedCashier, linkedSeller, linkedShift, warnings };
}
