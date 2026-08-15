#!/usr/bin/env node
// WP-008 Phase C — flat `tax_percent` -> versioned `TaxCode` migration
// accounting (CLAUDE.md §6 "fail loud on ambiguous data").
//
// Same pattern and the same reason as `validate-pricing-rule-migration.cjs`:
// the "202608130003" migration has its own guard, but a migration's output is
// invisible. `prisma migrate deploy` does not surface PostgreSQL NOTICE
// messages at all -- a Phase B lesson, where a "fail loud" mechanism built on
// RAISE NOTICE turned out to be silent -- and even the RAISE EXCEPTION the
// migration does use gives one terse line with no per-tenant breakdown. This
// tool runs in CI's migration-gate BEFORE the deploy, so the ambiguity is
// reported in full while it can still be acted on.
//
// Pre-migration (default):
//   Enumerates the distinct live tax rates per tenant, from
//   `PriceBookEntry` joined to the ACTIVE DEFAULT `PriceBook` -- the exact set
//   `PricingService.loadActiveRules` reads, i.e. what is actually charged.
//   `PricingRule.tax_percent` is reported alongside for contrast but is NOT
//   authoritative: since Phase B nothing reads it.
//   HARD STOP if any tenant charges more than one distinct rate: collapsing
//   that into a single TaxCode v1 would require deciding which products keep
//   which rate, and nothing in the schema records that intent.
//   Tenants with products but no observable rate are reported as INFO -- they
//   get a TaxCategory and no TaxCode, and fail loud at sale time
//   (TAX_NO_ACTIVE_CODE) rather than being handed an invented 14%.
//
// Post-migration (--post-check): HARD STOP unless
//   1. every Product has a tax_category_id (the NOT NULL is already enforced
//      by 202608130004; this catches a partially-applied deploy), and
//   2. every tenant whose entries showed exactly one rate has an active
//      TaxCode carrying exactly that rate -- the "no value silently changed"
//      invariant. A rate that shifted during migration would be a real tax
//      error on every subsequent sale.

const LIVE_RATE_SQL = `
  SELECT e."tenant_id"::text AS tenant_id,
         e."tax_percent"::text AS rate,
         count(*)::int AS entries
  FROM "PriceBookEntry" e
  JOIN "PriceBook" b ON b."id" = e."price_book_id" AND b."tenant_id" = e."tenant_id"
  WHERE e."status" = 'active' AND b."status" = 'active' AND b."is_default" = true
  GROUP BY 1, 2
  ORDER BY 1, 2`;

async function runPreCheck(runQuery, log = console.log, logError = console.error) {
  log('WP-008 Phase C tax_percent -> TaxCode migration accounting (pre-migration)');

  const liveRates = await runQuery(LIVE_RATE_SQL);
  const legacyRates = await runQuery(
    `SELECT "tenant_id"::text AS tenant_id, "tax_percent"::text AS rate, count(*)::int AS rules
     FROM "PricingRule" WHERE "is_active" = true GROUP BY 1, 2 ORDER BY 1, 2`,
  );
  const productlessTenants = await runQuery(
    `SELECT t."id"::text AS tenant_id, count(p."id")::int AS products
     FROM "Tenant" t
     JOIN "Product" p ON p."tenant_id" = t."id"
     WHERE NOT EXISTS (
       SELECT 1 FROM "PriceBookEntry" e
       JOIN "PriceBook" b ON b."id" = e."price_book_id" AND b."tenant_id" = e."tenant_id"
       WHERE e."tenant_id" = t."id" AND e."status" = 'active'
         AND b."status" = 'active' AND b."is_default" = true
     )
     GROUP BY 1 ORDER BY 1`,
  );

  const byTenant = new Map();
  for (const row of liveRates) {
    const rates = byTenant.get(row.tenant_id) ?? [];
    rates.push(row);
    byTenant.set(row.tenant_id, rates);
  }

  const totalEntries = liveRates.reduce((sum, row) => sum + row.entries, 0);
  log(
    `Live (active default Price Book) entries: ${totalEntries} across ${byTenant.size} tenant(s).`,
  );
  for (const [tenantId, rates] of byTenant) {
    for (const row of rates) {
      log(`  tenant ${tenantId}: ${row.entries} entr(ies) at ${row.rate}%`);
    }
  }

  log(
    `Legacy PricingRule.tax_percent (NOT authoritative -- unread since Phase B): ${
      legacyRates.length
        ? legacyRates.map((r) => `${r.rules} rule(s) at ${r.rate}% (tenant ${r.tenant_id})`).join('; ')
        : 'none'
    }`,
  );

  for (const row of productlessTenants) {
    log(
      `  INFO tenant ${row.tenant_id} owns ${row.products} product(s) but has no live priced entry -- ` +
        `it will receive a STANDARD TaxCategory and NO TaxCode. Selling those items will fail loudly ` +
        `with TAX_NO_ACTIVE_CODE until a rate is activated; a rate is deliberately NOT invented for it.`,
    );
  }

  const ambiguous = [...byTenant.entries()].filter(([, rates]) => rates.length > 1);
  if (ambiguous.length) {
    logError(
      `FAILED: ${ambiguous.length} tenant(s) charge more than one distinct tax rate through the ` +
        `active default Price Book. A single TaxCode v1 cannot be derived without guessing which ` +
        `products keep which rate, and nothing in the schema records that intent.`,
    );
    for (const [tenantId, rates] of ambiguous) {
      logError(
        `  tenant ${tenantId}: ${rates.map((r) => `${r.entries} entr(ies) at ${r.rate}%`).join(', ')}`,
      );
    }
    logError(
      '  Resolve by creating the TaxCategory/TaxCode rows for each rate and repointing the affected ' +
        'products explicitly, before re-running this deploy. Do NOT default-assign.',
    );
    return { ok: false, ambiguous: ambiguous.map(([tenantId]) => tenantId), totalEntries };
  }

  log(`PASSED: every tenant charges exactly one distinct rate (or none); no ambiguity to resolve.`);
  return {
    ok: true,
    ambiguous: [],
    totalEntries,
    ratesByTenant: Object.fromEntries([...byTenant].map(([id, rates]) => [id, rates[0].rate])),
  };
}

async function runPostCheck(runQuery, log = console.log, logError = console.error) {
  log('WP-008 Phase C tax_percent -> TaxCode migration accounting (post-migration)');

  const [{ count: uncategorised }] = await runQuery(
    `SELECT count(*)::int AS count FROM "Product" WHERE "tax_category_id" IS NULL`,
  );
  if (uncategorised > 0) {
    logError(
      `FAILED: ${uncategorised} Product row(s) have no tax_category_id. Every product must resolve ` +
        `to a tax category (BR-TAX-201); a NULL reintroduces the implicit-rate hole this phase closes.`,
    );
    return { ok: false, uncategorised };
  }

  // Every tenant with exactly one observable live rate must now have an
  // active TaxCode at precisely that rate. `rate` is Decimal(7,4) and
  // `tax_percent` was Decimal(5,2), so compare numerically, not as text.
  const mismatches = await runQuery(
    `WITH observed AS (
       SELECT e."tenant_id",
              min(e."tax_percent") AS rate,
              count(DISTINCT e."tax_percent") AS distinct_rates
       FROM "PriceBookEntry" e
       JOIN "PriceBook" b ON b."id" = e."price_book_id" AND b."tenant_id" = e."tenant_id"
       WHERE e."status" = 'active' AND b."status" = 'active' AND b."is_default" = true
       GROUP BY e."tenant_id"
     )
     SELECT o."tenant_id"::text AS tenant_id,
            o.rate::text AS observed_rate,
            coalesce(c."rate"::text, '(none)') AS migrated_rate
     FROM observed o
     LEFT JOIN "TaxCode" c
       ON c."tenant_id" = o."tenant_id" AND c."status" = 'active' AND c."code" = 'STANDARD'
     WHERE o.distinct_rates = 1
       AND (c."rate" IS NULL OR c."rate" <> o.rate)`,
  );

  if (mismatches.length) {
    logError(
      `FAILED: ${mismatches.length} tenant(s) whose live rate was not carried into an active TaxCode ` +
        `unchanged. Every existing value must be accounted for.`,
    );
    for (const row of mismatches) {
      logError(
        `  tenant ${row.tenant_id}: charged ${row.observed_rate}%, migrated TaxCode rate ${row.migrated_rate}`,
      );
    }
    return { ok: false, mismatches };
  }

  const [{ count: activeCodes }] = await runQuery(
    `SELECT count(*)::int AS count FROM "TaxCode" WHERE "status" = 'active'`,
  );
  const [{ count: categories }] = await runQuery(
    `SELECT count(*)::int AS count FROM "TaxCategory"`,
  );
  log(
    `PASSED: every Product carries a tax category (${categories} categor(ies), ${activeCodes} active ` +
      `TaxCode(s)); every migrated rate matches the rate that was being charged.`,
  );
  return { ok: true, activeCodes, categories };
}

async function main() {
  const { PrismaClient } = require('@prisma/client');
  const prisma = new PrismaClient();
  const runQuery = (sql) => prisma.$queryRawUnsafe(sql);
  try {
    const result = process.argv.includes('--post-check')
      ? await runPostCheck(runQuery)
      : await runPreCheck(runQuery);
    if (!result.ok) process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}

module.exports = { runPreCheck, runPostCheck };
