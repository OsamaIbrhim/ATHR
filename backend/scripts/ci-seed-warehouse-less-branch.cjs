#!/usr/bin/env node
// WP-009 Phase A, PR1 -- CI-only fixture for `migration-gate`'s populated-
// database scenario.
//
// `ci.yml`'s populated-path step runs `npm run prisma:seed` against the
// `migration-base` checkout -- the pinned pre-Phase-A baseline ref (see
// check-migration-policy.cjs's POPULATED_PROOF_BASELINE_REF), not HEAD. That
// commit's `prisma/seed.ts` predates the Location + default Warehouse
// creation logic entirely, so BOLD-01/BOLD-02 come out of that seed run
// Location-less, same as every other Branch created before 202608020002's
// one-time backfill or through `POST /branches` today (`BranchesRepository
// .save()` still doesn't create a Location/Warehouse for a branch created
// through the app -- see the WP-009 Phase A PR description for why that gap
// is tracked as a separate follow-up, not fixed here). BOLD-01/BOLD-02 are
// therefore already a warehouse-less case in this scenario, not the only
// one -- this script inserts one FURTHER branch directly, bypassing the
// app, so the scenario has a deterministic, named case to assert against
// regardless of which baseline commit is pinned, keeping migration
// 202608220002's catch-up guard proven against a real case it can name.
// Wired into `ci.yml` right after the populated database's baseline seed
// runs and before this PR's migrations apply.
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
