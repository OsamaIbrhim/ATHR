import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

const requiredAccounts = [
  ['+200100000000', 'owner'],
  ['+200100000001', 'branch_manager'],
  ['+200100000002', 'cashier'],
  ['+200100000003', 'warehouse_manager'],
  ['+200100000004', 'seller'],
]

async function main() {
  const phones = requiredAccounts.map(([phone]) => phone)
  const users = await prisma.user.findMany({
    where: { phone: { in: phones } },
    select: {
      phone: true,
      role: true,
      branch_id: true,
      is_active: true,
    },
  })
  const usersByPhone = new Map(users.map((user) => [user.phone, user]))

  for (const [phone, role] of requiredAccounts) {
    const user = usersByPhone.get(phone)
    if (!user || user.role !== role || !user.is_active || !user.branch_id) {
      throw new Error(
        `Development seed contract requires active ${role} account ${phone} with a branch`,
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
      branch_id: cashier.branch_id,
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
      mutation_stock: mutationStock.qty_on_hand,
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
