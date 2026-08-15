import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()
const tenantId = '00000000-0000-0000-0000-000000000001'

async function attempt(label, fn) {
  const t0 = Date.now()
  try {
    const result = await fn()
    const count = Array.isArray(result) ? result.length : JSON.stringify(result).length
    console.log(`${label}: ok in ${Date.now() - t0}ms, n=${count}`)
  } catch (error) {
    console.log(`${label}: FAILED in ${Date.now() - t0}ms: ${error?.message?.split('\n').find((l) => l.includes('stack depth')) || error?.message || error}`)
  }
}

const branch = await prisma.branch.findFirst({ where: { tenant_id: tenantId, is_active: true } })

// 1: the filter-only query (matches what psql bisection A-E already proved passes)
await attempt('1 filter-only, no include, sequential/alone', () =>
  prisma.productVariant.findMany({
    where: { tenant_id: tenantId, is_active: true, product: { is_active: true, tenant_id: tenantId } },
  }),
)

// 2: same filter, WITH include: { product: true } -- exercises Prisma's relation
// fan-out (a second, chunked query per ~20 ids) that psql never covered.
await attempt('2 WITH include, sequential/alone', () =>
  prisma.productVariant.findMany({
    where: { tenant_id: tenantId, is_active: true, product: { is_active: true, tenant_id: tenantId } },
    include: { product: true },
  }),
)

// 3: the actual snapshot() shape -- 5 queries concurrently via Promise.all,
// known to fail from the prior run.
await attempt('3 5-way Promise.all (known-fail baseline)', () =>
  Promise.all([
    prisma.productVariant.findMany({
      where: { tenant_id: tenantId, is_active: true, product: { is_active: true, tenant_id: tenantId } },
      include: { product: true },
    }),
    prisma.inventoryStock.findMany({ where: { tenant_id: tenantId, branch_id: branch.id } }),
    prisma.priceBookEntry.findMany({
      where: { tenant_id: tenantId, status: 'active', price_book: { tenant_id: tenantId, status: 'active', is_default: true } },
    }),
    prisma.user.findMany({
      where: { memberships: { some: { tenantId } }, branch_id: branch.id, role: 'seller', is_active: true },
      select: { id: true, name: true },
    }),
    prisma.taxCode.findMany({ where: { tenant_id: tenantId, status: 'active' } }),
  ]),
)

// 4: include, bounded to 100 rows -- tells us whether bounding the page size
// would actually fix it if (2) turns out to be the mechanism.
await attempt('4 WITH include, take 100, sequential/alone', () =>
  prisma.productVariant.findMany({
    where: { tenant_id: tenantId, is_active: true, product: { is_active: true, tenant_id: tenantId } },
    include: { product: true },
    take: 100,
  }),
)

await prisma.$disconnect()
