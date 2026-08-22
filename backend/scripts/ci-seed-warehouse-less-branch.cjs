#!/usr/bin/env node
// WP-009 Phase A, PR1 -- CI-only fixture for `migration-gate`'s populated-
// database scenario.
//
// The populated step seeds only the two branches the release-baseline
// `prisma/seed.ts` creates (BOLD-01/BOLD-02), both of which already have a
// Location/Warehouse from the one-time 202608020002 backfill. That can never
// exercise this PR's catch-up-backfill migration for a Branch with NO
// Location -- exactly the case 90 of 92 branches are in on the live demo
// database today (measured 2026-08-22). This script inserts one such branch
// directly, bypassing the app -- which is realistic: `BranchesRepository
// .save()` doesn't create a Location/Warehouse either (see the WP-009 Phase
// A PR description for why that gap is tracked as a separate follow-up, not
// fixed in this PR). Wired into `ci.yml` right after the populated
// database's baseline seed runs and before this PR's migrations apply, so
// migration 202608220002 has a real case to close on every run of this job,
// permanently.
//
// Pass --ambiguous to ALSO insert a second `is_default = true` Warehouse on
// an existing Location, deliberately creating the case migration
// 202608220003's pre-check must refuse. This flag exists only for that
// guard's drill (see the WP-009 Phase A PR description) -- it must never be
// wired into the permanent CI step this fixture ships on.
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
      const location = await prisma.location.findFirstOrThrow({
        where: { tenantId: tenant.id },
      });
      const duplicate = await prisma.warehouse.create({
        data: {
          tenant_id: tenant.id,
          location_id: location.id,
          name: 'DRILL: second default warehouse (must make the migration fail)',
          is_default: true,
        },
      });
      console.log(
        `DRILL: inserted a SECOND is_default=true Warehouse ${duplicate.id} on Location ${location.id} -- migration 202608220003's pre-check must now refuse to proceed.`,
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
