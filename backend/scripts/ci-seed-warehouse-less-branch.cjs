#!/usr/bin/env node
// WP-009 Phase A, PR1 -- CI-only fixture for `migration-gate`'s populated-
// database scenario.
//
// The populated step's baseline seed (`prisma/seed.ts`) creates BOLD-01/
// BOLD-02 -- but AFTER `prisma migrate deploy` already ran, so
// 202608020002's one-time Location/Warehouse backfill (which only acts on
// branches that exist at ITS execution time) has nothing to do yet either:
// in this CI flow, BOLD-01/BOLD-02 start out just as Location-less as any
// other branch. On the live demo database the ordering happened to be the
// other way around (those two branches already existed when that migration
// ran), which is why they're the only two with a Location there -- but nothing
// in this job can rely on that ordering. Either way, this script inserts one
// more such branch directly, bypassing the app -- which is realistic:
// `BranchesRepository.save()` doesn't create a Location/Warehouse either
// (see the WP-009 Phase A PR description for why that gap is tracked as a
// separate follow-up, not fixed in this PR). Wired into `ci.yml` right after
// the populated database's baseline seed runs and before this PR's
// migrations apply, so migration 202608220002 always has a real case to
// close, permanently.
//
// Pass --ambiguous to ALSO construct a Location with TWO `is_default = true`
// Warehouses, deliberately creating the case migration 202608220003's
// pre-check must refuse. Built from scratch (its own Branch/Location) rather
// than assuming one already exists, since nothing this early in the flow can
// be assumed to. This flag exists only for that guard's drill (see the
// WP-009 Phase A PR description) -- it must never be wired into the
// permanent CI step this fixture ships on.
async function main() {
  const { PrismaClient } = require('@prisma/client');
  const prisma = new PrismaClient();
  try {
    const tenant = await prisma.tenant.findFirstOrThrow({
      where: { name: 'Initial ATHR Demo Tenant' },
    });

    const branch = await prisma.branch.create({
      data: {
        code: 'WP009-PHASEA-ORPHAN',
        name_ar: 'فرع بدون مستودع (تجهيزة CI)',
        name_en: 'Warehouse-less branch (CI fixture)',
        tenant_id: tenant.id,
      },
    });
    console.log(
      `Inserted warehouse-less Branch ${branch.id} (${branch.code}) with no Location -- migration 202608220002 must close this.`,
    );

    if (process.argv.includes('--ambiguous')) {
      const legalEntity = await prisma.legalEntity.findFirstOrThrow({
        where: { tenant_id: tenant.id, is_primary: true },
      });
      const ambiguousBranch = await prisma.branch.create({
        data: {
          code: 'WP009-PHASEA-AMBIGUOUS-DRILL',
          name_ar: 'فرع بمستودعين افتراضيين (تجهيزة اختبار الحارس)',
          name_en: 'Branch with two default warehouses (guard-drill fixture)',
          tenant_id: tenant.id,
        },
      });
      const location = await prisma.location.create({
        data: {
          id: ambiguousBranch.id,
          tenantId: tenant.id,
          legal_entity_id: legalEntity.id,
          code: ambiguousBranch.code,
          name_ar: ambiguousBranch.name_ar,
          name_en: ambiguousBranch.name_en,
        },
      });
      const firstWarehouse = await prisma.warehouse.create({
        data: {
          tenant_id: tenant.id,
          location_id: location.id,
          name: 'DRILL: first default warehouse',
          is_default: true,
        },
      });
      const secondWarehouse = await prisma.warehouse.create({
        data: {
          tenant_id: tenant.id,
          location_id: location.id,
          name: 'DRILL: second default warehouse (must make the migration fail)',
          is_default: true,
        },
      });
      console.log(
        `DRILL: Branch ${ambiguousBranch.id} (${ambiguousBranch.code}) resolves to TWO is_default=true Warehouses (${firstWarehouse.id}, ${secondWarehouse.id}) on Location ${location.id} -- migration 202608220003's pre-check must now refuse to proceed.`,
      );
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
