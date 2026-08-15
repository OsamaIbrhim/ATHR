import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()
const tenantId = '00000000-0000-0000-0000-000000000001'

async function snapshotShape(label) {
  const cursor = await prisma.syncChange.aggregate({
    where: { tenant_id: tenantId },
    _max: { sequence: true },
  })
  const branch = await prisma.branch.findFirst({ where: { tenant_id: tenantId, is_active: true } })
  const t0 = Date.now()
  const [variants, stock, rules, sellers, taxCodes] = await Promise.all([
    prisma.productVariant.findMany({
      where: { tenant_id: tenantId, is_active: true, product: { is_active: true, tenant_id: tenantId } },
      include: { product: true },
    }),
    prisma.inventoryStock.findMany({ where: { tenant_id: tenantId, branch_id: branch.id } }),
    prisma.priceBookEntry.findMany({
      where: {
        tenant_id: tenantId, status: 'active',
        price_book: { tenant_id: tenantId, status: 'active', is_default: true },
      },
    }),
    prisma.user.findMany({
      where: { memberships: { some: { tenantId } }, branch_id: branch.id, role: 'seller', is_active: true },
      select: { id: true, name: true },
    }),
    prisma.taxCode.findMany({ where: { tenant_id: tenantId, status: 'active' } }),
  ])
  console.log(`${label}: ok in ${Date.now() - t0}ms, variants=${variants.length} stock=${stock.length} rules=${rules.length} sellers=${sellers.length} taxCodes=${taxCodes.length} cursor=${cursor._max.sequence}`)
}

try {
  // First call: mimics the very first /sync/pull after boot, hitting a
  // freshly connected/warmed pool for the first time under concurrency.
  await snapshotShape('cold')
  // Second call: same shape, on an already-used pool, to see whether only
  // the *first* concurrent use of every pooled connection fails.
  await snapshotShape('warm')
} catch (error) {
  console.error('REPRO FAILED:', error?.message || error)
  if (error?.stack) console.error(error.stack)
  process.exitCode = 1
} finally {
  await prisma.$disconnect()
}
