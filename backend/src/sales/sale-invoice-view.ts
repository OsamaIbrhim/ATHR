import { NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { TenantContext } from '../identity/tenant-context.type';
import type { AuthenticatedUser } from '../auth/authenticated-user';
import { assertBranchAccess } from '../auth/branch-access';
import { CostVisibilityService } from '../pricing/cost-visibility.service';

/** One invoice with lines, payments and returns; cost fields are stripped unless the actor may see them. */
export async function loadInvoiceView(
  prisma: PrismaService,
  costVisibility: CostVisibilityService,
  context: TenantContext,
  id: string,
  actor: AuthenticatedUser,
) {
  const invoice = await prisma.salesInvoice.findFirst({
    where: { id, tenant_id: context.tenantId },
    include: {
      items: { include: { variant: { include: { product: true } }, return_items: { where: { return_record: { status: 'completed' } } } } },
      payments: { orderBy: { sequence: 'asc' } },
      branch: true, customer: true,
      cashier: { select: { id: true, name: true } },
      seller: { select: { id: true, name: true } },
      receiver: { select: { id: true, name: true } },
      shift: true,
      terminal: { select: { id: true, terminal_code: true, name: true } },
      original_returns: { include: { items: true }, orderBy: { created_at: 'desc' } },
    },
  });
  if (!invoice) throw new NotFoundException('Invoice not found');
  assertBranchAccess(actor, invoice.branch_id);
  // BR-CST-101 / Matrix §17 §51: this row discloses exact cost four ways —
  // `items[].unit_cost` (cost at the moment of sale), the joined
  // `items[].variant.cost_price` (cost today), and the same sale-line cost
  // carried onto the return through *either* join, `items[].return_items[]`
  // and `original_returns[].items[]`. Both return joins matter: they reach
  // the same `ReturnItem` rows from opposite ends, so masking one leaves the
  // figure reachable through the other. `cashier` clears this endpoint on
  // `sales.sale.view` and does not hold `sales.sale.view-cost-margin`, so
  // all four are stripped for the till. Only the response is projected; the
  // stored rows keep the true values, and the margin reports that need them
  // read those rows directly behind their own `reports.*.view-cost-margin`
  // guard.
  if (await costVisibility.canViewSaleCostMargin(actor)) return invoice;
  const withoutLineCost = <T extends { unit_cost?: unknown }>({ unit_cost: _unitCost, ...line }: T) =>
    line;
  return {
    ...invoice,
    items: invoice.items.map(({ unit_cost: _unitCost, variant, return_items, ...item }) => {
      const { cost_price: _costPrice, ...visibleVariant } = variant;
      return { ...item, variant: visibleVariant, return_items: return_items.map(withoutLineCost) };
    }),
    original_returns: invoice.original_returns.map((record) => ({
      ...record,
      items: record.items.map(withoutLineCost),
    })),
  };
}
