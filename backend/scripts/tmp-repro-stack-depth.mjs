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

// Binary-search-ish threshold scan: at what `take` size does
// include:{product:true} start failing, against the already-seeded ~10k
// variant table from perf:seed?
for (const take of [100, 250, 500, 750, 1000, 1500, 2000, 3000, 5000, 7500, 10031]) {
  await attempt(`include take=${take}`, () =>
    prisma.productVariant.findMany({
      where: { tenant_id: tenantId, is_active: true, product: { is_active: true, tenant_id: tenantId } },
      include: { product: true },
      take,
    }),
  )
}

await prisma.$disconnect()
