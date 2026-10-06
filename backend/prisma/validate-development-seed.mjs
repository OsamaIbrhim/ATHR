import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

// phone, membership role, and whether the account is scoped to a single branch
// (owner and warehouse manager are tenant-wide).
const requiredAccounts = [
  ['+200100000000', 'tenant_owner', false],
  ['+200100000001', 'location_manager', true],
  ['+200100000002', 'cashier', true],
  ['+200100000003', 'warehouse_manager', false],
  ['+200100000004', 'seller', true],
]

async function main() {
  const phones = requiredAccounts.map(([phone]) => phone)
  const rows = await prisma.user.findMany({
    where: { phone: { in: phones } },
    select: {
      phone: true,
      is_active: true,
      memberships: {
        where: { status: 'active' },
        select: {
          role: true,
          access_scope_assignments: { select: { scope_type: true, scope_ref_id: true } },
        },
      },
    },
  })
  const users = rows.map(({ memberships: [membership], ...user }) => ({
    ...user,
    role: membership?.role,
    tenant_wide: !!membership?.access_scope_assignments.some((scope) => scope.scope_type === 'tenant_wide'),
    branch_id:
      membership?.access_scope_assignments.find((scope) => scope.scope_type === 'location')?.scope_ref_id ?? null,
  }))
  const usersByPhone = new Map(users.map((user) => [user.phone, user]))

  for (const [phone, role, branchScoped] of requiredAccounts) {
    const user = usersByPhone.get(phone)
    const scoped = branchScoped ? !!user?.branch_id : user?.tenant_wide
    if (!user || user.role !== role || !user.is_active || !scoped) {
      throw new Error(
        `Development seed contract requires active ${role} account ${phone} with ${branchScoped ? 'a branch scope' : 'a tenant-wide scope'}`,
      )
    }
  }

  const cashier = usersByPhone.get('+200100000002')
  const seller = usersByPhone.get('+200100000004')
  if (cashier.branch_id !== seller.branch_id) {
    throw new Error(
      'Development seed cashier and seller must belong to the same branch',
    )
  }

  const mutationStock = await prisma.inventoryStock.findFirst({
    where: {
      warehouse: { branch_id: cashier.branch_id, is_default: true },
      qty_on_hand: { gte: 12 },
      qty_reserved: 0,
      variant: {
        is_active: true,
        product: { is_active: true },
      },
    },
    select: { variant_id: true, qty_on_hand: true },
  })
  if (!mutationStock) {
    throw new Error(
      'Development seed requires an active unreserved variant with at least 12 units for mutation smoke tests',
    )
  }

  // Stock must equal the sum of its ledger (the seed writes through InventoryService).
  const [{ mismatches }] = await prisma.$queryRaw`
    SELECT COUNT(*)::integer AS mismatches
    FROM "InventoryStock" stock
    FULL OUTER JOIN (
      SELECT "warehouse_id", "variant_id", SUM("on_hand_delta") AS on_hand, SUM("reserved_delta") AS reserved
      FROM "InventoryMovement"
      GROUP BY "warehouse_id", "variant_id"
    ) ledger
      ON ledger."warehouse_id" = stock."warehouse_id" AND ledger."variant_id" = stock."variant_id"
    WHERE COALESCE(stock."qty_on_hand", 0) <> COALESCE(ledger.on_hand, 0)
       OR COALESCE(stock."qty_reserved", 0) <> COALESCE(ledger.reserved, 0)
  `
  if (mismatches !== 0) {
    throw new Error(`Development seed inventory does not reconcile with its ledger (${mismatches} stock row(s))`)
  }

  const [products, variants, branches] = await Promise.all([
    prisma.product.count({ where: { is_active: true } }),
    prisma.productVariant.count({ where: { is_active: true } }),
    prisma.branch.count({ where: { is_active: true } }),
  ])
  if (products === 0 || variants === 0 || branches === 0) {
    throw new Error(
      'Development seed requires active branches, products, and variants',
    )
  }

  process.stdout.write(
    `${JSON.stringify({
      suite: 'development-seed-contract',
      users: users.length,
      branches,
      products,
      variants,
      mutation_variant_id: mutationStock.variant_id,
      mutation_stock: Number(mutationStock.qty_on_hand),
    })}\n`,
  )
}

main()
  .catch((error) => {
    process.stderr.write(
      `${JSON.stringify({
        suite: 'development-seed-contract',
        ok: false,
        message:
          error instanceof Error ? error.message : 'Unknown seed contract error',
      })}\n`,
    )
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
