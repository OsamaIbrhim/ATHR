#!/usr/bin/env node
// WP-009 Phase A -- CI-only fixture to drill each individual assertion in
// validate-warehouse-backfill.cjs's post-check, one at a time, against the
// REAL upgraded populated database, after the real backfill migration has
// already run and the normal post-check has already passed. This exists
// only to be wired into ci.yml TEMPORARILY for a drill run (see the PR
// description for each drill's RED/GREEN commit SHAs) -- it must never be
// wired into the permanent CI step.
//
// Modes (--mode=<name>), each isolated to trip exactly one assertion:
//
//   null-warehouse
//     Nulls warehouse_id on one InventoryStock row directly. Drills
//     stockNullWarehouse. InventoryStock carries no append-only guard (see
//     migration 202608220003's own header comment), so this needs no
//     SET LOCAL ledger-maintenance flag.
//
//   duplicate-pair
//     Points one row's warehouse_id at a DIFFERENT branch's default
//     warehouse that already backs another row for the SAME variant_id,
//     so two InventoryStock rows collide onto one (warehouse_id,
//     variant_id) pair. Drills the row-count-vs-distinct-pairs check.
//     Necessarily ALSO trips the branch/warehouse round-trip divergence
//     check -- in this schema a warehouse belongs to exactly one branch, so
//     any such collision is, by construction, also a misattribution for
//     one of the two rows. Both assertions correctly firing together is
//     expected, not a bug in either check.
//
//   misattribute
//     Points one row's warehouse_id at another branch's default warehouse,
//     chosen specifically because that branch has no InventoryStock row for
//     the same variant_id -- so this corruption trips ONLY the branch/
//     warehouse round-trip divergence check, in isolation from the
//     row-count-vs-distinct-pairs check.

async function main() {
  const mode = process.argv.find((a) => a.startsWith('--mode='))?.split('=')[1];
  if (!['null-warehouse', 'duplicate-pair', 'misattribute'].includes(mode)) {
    console.error('Usage: ci-corrupt-warehouse-backfill.cjs --mode=<null-warehouse|duplicate-pair|misattribute>');
    process.exit(1);
  }

  const { PrismaClient } = require('@prisma/client');
  const prisma = new PrismaClient();
  try {
    if (mode === 'null-warehouse') {
      const [row] = await prisma.$queryRawUnsafe(
        `SELECT "tenant_id", "branch_id", "variant_id" FROM "InventoryStock" WHERE "warehouse_id" IS NOT NULL LIMIT 1`,
      );
      if (!row) throw new Error('DRILL null-warehouse: no InventoryStock row available to corrupt.');
      await prisma.$executeRawUnsafe(
        `UPDATE "InventoryStock" SET "warehouse_id" = NULL WHERE "tenant_id" = '${row.tenant_id}' AND "branch_id" = '${row.branch_id}' AND "variant_id" = '${row.variant_id}'`,
      );
      console.log(
        `DRILL null-warehouse: nulled warehouse_id on InventoryStock (tenant ${row.tenant_id}, branch ${row.branch_id}, variant ${row.variant_id}) -- post-check must now report 1 NULL warehouse_id row.`,
      );
      return;
    }

    if (mode === 'duplicate-pair') {
      // A variant carried by two different branches, each still pointing at
      // its OWN correct default warehouse today.
      const [pair] = await prisma.$queryRawUnsafe(`
        SELECT a."tenant_id", a."branch_id" AS branch_a, a."warehouse_id" AS warehouse_a,
               b."branch_id" AS branch_b, b."warehouse_id" AS warehouse_b, a."variant_id"
        FROM "InventoryStock" a
        JOIN "InventoryStock" b
          ON b."tenant_id" = a."tenant_id" AND b."variant_id" = a."variant_id" AND b."branch_id" <> a."branch_id"
        WHERE a."warehouse_id" IS NOT NULL AND b."warehouse_id" IS NOT NULL
        LIMIT 1
      `);
      if (!pair) throw new Error('DRILL duplicate-pair: no variant carried by two different branches to collide.');
      await prisma.$executeRawUnsafe(
        `UPDATE "InventoryStock" SET "warehouse_id" = '${pair.warehouse_b}' WHERE "tenant_id" = '${pair.tenant_id}' AND "branch_id" = '${pair.branch_a}' AND "variant_id" = '${pair.variant_id}'`,
      );
      console.log(
        `DRILL duplicate-pair: pointed InventoryStock (tenant ${pair.tenant_id}, branch ${pair.branch_a}, variant ${pair.variant_id}) at branch ${pair.branch_b}'s warehouse ${pair.warehouse_b} (was ${pair.warehouse_a}) -- post-check must now report a row-count/distinct-pair mismatch (and, correctly, a round-trip divergence too, since that row no longer belongs to its own branch's warehouse).`,
      );
      return;
    }

    // misattribute: branch_b must NOT already stock variant_v, so this
    // corruption trips ONLY the round-trip divergence check.
    const [target] = await prisma.$queryRawUnsafe(`
      SELECT s."tenant_id", s."branch_id", s."variant_id", s."warehouse_id" AS own_warehouse,
             other_w."id" AS foreign_warehouse, other_w."location_id" AS foreign_branch
      FROM "InventoryStock" s
      JOIN "Warehouse" other_w
        ON other_w."tenant_id" = s."tenant_id" AND other_w."is_default" = true AND other_w."location_id" <> s."branch_id"
      WHERE s."warehouse_id" IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM "InventoryStock" other_s
          WHERE other_s."tenant_id" = s."tenant_id"
            AND other_s."branch_id" = other_w."location_id"
            AND other_s."variant_id" = s."variant_id"
        )
      LIMIT 1
    `);
    if (!target) throw new Error('DRILL misattribute: no isolated (row, foreign warehouse) pair available.');
    await prisma.$executeRawUnsafe(
      `UPDATE "InventoryStock" SET "warehouse_id" = '${target.foreign_warehouse}' WHERE "tenant_id" = '${target.tenant_id}' AND "branch_id" = '${target.branch_id}' AND "variant_id" = '${target.variant_id}'`,
    );
    console.log(
      `DRILL misattribute: pointed InventoryStock (tenant ${target.tenant_id}, branch ${target.branch_id}, variant ${target.variant_id}) at foreign warehouse ${target.foreign_warehouse} (belongs to branch ${target.foreign_branch}'s Location, was ${target.own_warehouse}) -- post-check must now report a branch/warehouse round-trip divergence for this (tenant, variant), with no row-count/distinct-pair mismatch.`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
