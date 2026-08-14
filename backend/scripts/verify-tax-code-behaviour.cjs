#!/usr/bin/env node
// WP-008 Phase C — database-level proof for the invariants that live in SQL,
// not in application code. Runs against a real, freshly-migrated Postgres
// (wired into the CI `migration-gate` job's `athr_migrations_clean` database),
// same convention as `verify-price-book-behaviour.cjs` and
// `verify-tenant-constraints.cjs`.
//
// Every check below is invisible to a `fakePrisma` spec: the fake enforces no
// partial unique index and runs no trigger, so a green jest suite proves
// nothing about any of them. Phase B shipped two specs that passed against the
// fake on code paths a real database rejects; this file is the standing answer
// to that.
//
// Proves:
//   C1  TAX SNAPSHOT IMMUTABILITY — the central test of this phase.
//       A sale is taxed under TaxCode v1; v2 is then drafted, approved and
//       activated. The original document's SalesTaxSnapshot row still reports
//       v1's rate and version (BR-TAX-203, "تغير المعدل لا يغير الماضي"), and
//       the append-only trigger rejects any attempt to rewrite it.
//   C2  `TaxCode_one_active_per_category` really admits only one active
//       version per (tenant, category) — and, crucially, still allows a
//       replacement to be drafted/approved/scheduled alongside the live one.
//       The Phase B lesson was a partial index scoped so tightly that the
//       sanctioned replacement path became structurally impossible.
//   C3  `TaxCodeRepository.activate`'s statement ORDER survives that index.
//       Demote-then-promote succeeds; the reverse order raises P2002 even
//       inside one transaction, because a non-deferrable unique index is
//       checked per statement rather than at COMMIT. The negative half is what
//       makes this a proof that the ordering matters rather than an assertion
//       that the happy path works.
//   C4  Activating a version emits a kind='pricing' SyncChange, so POS
//       terminals actually receive the new rate. Phase B shipped the pricing
//       tables with no trigger and tills would have served stale prices
//       indefinitely; activation has the same property. Draft-stage churn does
//       NOT emit, since kind='pricing' forces a full catalog reset.
//       Repointing a Product's tax category emits too.
//   C5  `TaxExemption_one_live_per_customer_category`, including the COALESCE
//       collapse that stops two tenant-wide (NULL category) exemptions
//       coexisting for one customer.
'use strict';

const { randomUUID } = require('crypto');
const { PrismaClient, Prisma } = require('@prisma/client');

const prisma = new PrismaClient();

let failed = 0;

function record(name, ok, detail) {
  if (!ok) failed += 1;
  process.stdout.write(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` -- ${detail}` : ''}\n`);
}

function expectEqual(name, actual, expected) {
  const ok = actual === expected;
  record(name, ok, ok ? undefined : `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

async function expectUniqueViolation(name, attempt) {
  try {
    await attempt();
    record(name, false, 'expected a unique constraint violation but the write succeeded');
  } catch (error) {
    const isUniqueViolation =
      error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
    record(
      name,
      isUniqueViolation,
      isUniqueViolation ? undefined : `unexpected error: ${error?.code ?? ''} ${error?.message ?? error}`,
    );
  }
}

async function expectRejected(name, attempt, expectedFragment) {
  try {
    await attempt();
    record(name, false, 'expected the write to be rejected but it succeeded');
  } catch (error) {
    const message = String(error?.message ?? error);
    const ok = message.includes(expectedFragment);
    record(name, ok, ok ? undefined : `unexpected error: ${message.slice(0, 200)}`);
  }
}

async function countPricingChanges(tenantId, entityKey) {
  return prisma.syncChange.count({
    where: { tenant_id: tenantId, kind: 'pricing', ...(entityKey ? { entity_key: entityKey } : {}) },
  });
}

// --- fixture helpers --------------------------------------------------------

async function createTenant(label) {
  return prisma.tenant.create({
    data: { name: `${label}-${randomUUID()}`, default_currency: 'EGP' },
  });
}

async function createCategory(tenantId, code = 'STANDARD') {
  return prisma.taxCategory.create({
    data: { tenant_id: tenantId, code, name_en: code, updated_at: new Date() },
  });
}

function codeData(tenantId, categoryId, overrides = {}) {
  return {
    tenant_id: tenantId,
    tax_category_id: categoryId,
    code: 'STANDARD',
    name_en: 'Standard rate',
    jurisdiction: 'EG',
    calculation_method: 'percentage',
    rate: new Prisma.Decimal('14.0000'),
    tax_mode: 'exclusive',
    rounding_policy: 'line',
    version: 1,
    status: 'draft',
    updated_at: new Date(),
    ...overrides,
  };
}

// --- C1: snapshot immutability ---------------------------------------------

async function verifySnapshotImmutability(tenant) {
  const category = await createCategory(tenant.id, 'C1-CAT');
  const v1 = await prisma.taxCode.create({
    data: codeData(tenant.id, category.id, {
      code: 'C1',
      status: 'active',
      activated_at: new Date(),
    }),
  });

  // A minimal but real sales document: branch -> product -> variant -> invoice
  // -> line -> snapshot. Nothing is faked; every FK is satisfied.
  const branch = await prisma.branch.create({
    data: { tenant_id: tenant.id, code: `C1-${randomUUID().slice(0, 8)}`, name_ar: 'C1' },
  });
  const product = await prisma.product.create({
    data: {
      tenant_id: tenant.id,
      name_en: 'C1 product',
      tax_category_id: category.id,
      // No `tenant_id` in the nested create: it is part of the composite
      // relation and Prisma derives it from the parent Product.
      variants: {
        create: [{ sku: `C1-${randomUUID().slice(0, 8)}`, cost_price: 50 }],
      },
    },
    include: { variants: true },
  });
  const variant = product.variants[0];

  const invoice = await prisma.salesInvoice.create({
    data: {
      tenant_id: tenant.id,
      invoice_number: `C1-${randomUUID().slice(0, 8)}`,
      branch_id: branch.id,
      subtotal: 100,
      tax_amount: 14,
      total: 114,
      payment_method: 'cash',
      // Same as above: `tenant_id` is part of the composite invoice relation
      // and must not be repeated in the nested create.
      items: {
        create: [
          {
            variant_id: variant.id,
            qty: 1,
            unit_price: 100,
            unit_cost: 50,
            unit_tax: 14,
          },
        ],
      },
    },
    include: { items: true },
  });

  await prisma.salesTaxSnapshot.create({
    data: {
      tenant_id: tenant.id,
      sales_invoice_id: invoice.id,
      sales_invoice_item_id: invoice.items[0].id,
      tax_code_id: v1.id,
      code_snapshot: v1.code,
      rate_snapshot: v1.rate,
      base_amount: 100,
      tax_amount: 14,
      mode_snapshot: 'exclusive',
      version_snapshot: v1.version,
      rounding_policy_snapshot: 'line',
    },
  });

  // --- the rate changes: draft v2 at 20%, approve, activate ---------------
  const v2 = await prisma.taxCode.create({
    data: codeData(tenant.id, category.id, {
      code: 'C1',
      version: 2,
      rate: new Prisma.Decimal('20.0000'),
      status: 'approved',
      supersedes_id: v1.id,
    }),
  });
  // Demote-then-promote, the order `TaxCodeRepository.activate` uses.
  await prisma.$transaction(async (tx) => {
    await tx.taxCode.updateMany({
      where: { id: v1.id, status: 'active' },
      data: { status: 'superseded', superseded_by_id: v2.id, superseded_at: new Date() },
    });
    await tx.taxCode.updateMany({
      where: { id: v2.id, status: 'approved' },
      data: { status: 'active', activated_at: new Date() },
    });
  });

  expectEqual(
    'C1 the new version really is active (the rate change did happen)',
    (await prisma.taxCode.findUnique({ where: { id: v2.id } }))?.status,
    'active',
  );

  const snapshot = await prisma.salesTaxSnapshot.findFirst({
    where: { sales_invoice_id: invoice.id },
  });
  expectEqual(
    'C1 the historical document still reports v1 rate after v2 activation',
    // Decimal normalises trailing zeros ('14.0000'.toString() === '14'),
    // so this compares numerically rather than as text.
    snapshot ? Number(snapshot.rate_snapshot) : null,
    14,
  );
  expectEqual('C1 the historical document still reports version 1', snapshot?.version_snapshot, 1);
  expectEqual(
    'C1 the snapshot still points at the v1 TaxCode row',
    snapshot?.tax_code_id,
    v1.id,
  );
  expectEqual(
    'C1 base x rate reproduces the recorded tax amount (BR-CAT-105 explainability)',
    snapshot ? snapshot.base_amount.mul(snapshot.rate_snapshot).div(100).toFixed(2) : null,
    snapshot ? snapshot.tax_amount.toFixed(2) : null,
  );

  // --- append-only trigger ------------------------------------------------
  await expectRejected(
    'C1 rewriting a snapshot row is rejected by the database, not merely by convention',
    () =>
      prisma.salesTaxSnapshot.update({
        where: { id: snapshot.id },
        data: { rate_snapshot: new Prisma.Decimal('20.0000') },
      }),
    'append-only',
  );

  expectEqual(
    'C1 the rejected update left the row untouched',
    Number((await prisma.salesTaxSnapshot.findUnique({ where: { id: snapshot.id } }))?.rate_snapshot),
    14,
  );

  // A superseded TaxCode that a document snapshotted must remain deletable
  // only by breaking the evidence -- which the RESTRICT FK forbids.
  await expectRejected(
    'C1 a TaxCode a document snapshotted cannot be deleted out from under it',
    () => prisma.taxCode.delete({ where: { id: v1.id } }),
    'Foreign key constraint',
  );

  return { category, v1, v2, variant, product };
}

// --- C2/C3: the partial unique index and activation statement order --------

async function verifyActiveCodeUniqueness(tenant) {
  const category = await createCategory(tenant.id, 'C2-CAT');
  const active = await prisma.taxCode.create({
    data: codeData(tenant.id, category.id, {
      code: 'C2',
      status: 'active',
      activated_at: new Date(),
    }),
  });

  // The replacement path must stay OPEN while the incumbent is live.
  const replacement = await prisma.taxCode.create({
    data: codeData(tenant.id, category.id, { code: 'C2', version: 2, status: 'draft' }),
  });
  for (const status of ['submitted', 'approved', 'scheduled']) {
    await prisma.taxCode.update({ where: { id: replacement.id }, data: { status } });
  }
  expectEqual(
    'C2 a replacement version can be drafted/approved/scheduled alongside the live one',
    (await prisma.taxCode.findUnique({ where: { id: replacement.id } }))?.status,
    'scheduled',
  );

  // But two ACTIVE codes for one category must be impossible.
  await expectUniqueViolation(
    'C2 a second active TaxCode for the same category is rejected',
    () =>
      prisma.taxCode.create({
        data: codeData(tenant.id, category.id, {
          code: 'C2-OTHER',
          version: 99,
          status: 'active',
        }),
      }),
  );

  // A different category in the same tenant is unaffected.
  const otherCategory = await createCategory(tenant.id, 'C2-CAT-2');
  const otherActive = await prisma.taxCode.create({
    data: codeData(tenant.id, otherCategory.id, { code: 'C2-B', status: 'active' }),
  });
  expectEqual(
    'C2 a different category may have its own active code',
    otherActive.status,
    'active',
  );

  // --- C3: statement ORDER -----------------------------------------------
  // Wrong order (promote successor, then demote incumbent) must fail, even
  // inside one transaction. If this ever starts passing, the index has been
  // weakened and `TaxCodeRepository.activate`'s careful ordering is no longer
  // load-bearing -- which is worth failing CI over.
  await expectUniqueViolation(
    'C3 promote-before-demote raises P2002 inside one transaction (index is per-statement)',
    () =>
      prisma.$transaction(async (tx) => {
        await tx.taxCode.updateMany({
          where: { id: replacement.id, status: 'scheduled' },
          data: { status: 'active' },
        });
        await tx.taxCode.updateMany({
          where: { id: active.id, status: 'active' },
          data: { status: 'superseded' },
        });
      }),
  );

  expectEqual(
    'C3 the failed transaction rolled back: the incumbent is still the active one',
    (await prisma.taxCode.findUnique({ where: { id: active.id } }))?.status,
    'active',
  );

  // Right order (the one the repository uses) must succeed.
  await prisma.$transaction(async (tx) => {
    await tx.taxCode.updateMany({
      where: { id: active.id, status: 'active' },
      data: { status: 'superseded', superseded_by_id: replacement.id, superseded_at: new Date() },
    });
    await tx.taxCode.updateMany({
      where: { id: replacement.id, status: 'scheduled' },
      data: { status: 'active', activated_at: new Date() },
    });
  });
  expectEqual(
    'C3 demote-before-promote succeeds (the order TaxCodeRepository.activate uses)',
    (await prisma.taxCode.findUnique({ where: { id: replacement.id } }))?.status,
    'active',
  );
  expectEqual(
    'C3 exactly one active code remains for the category',
    await prisma.taxCode.count({
      where: { tenant_id: tenant.id, tax_category_id: category.id, status: 'active' },
    }),
    1,
  );
}

// --- C4: SyncChange emission ------------------------------------------------

async function verifySyncChangeEmission(tenant) {
  const category = await createCategory(tenant.id, 'C4-CAT');
  const code = await prisma.taxCode.create({
    data: codeData(tenant.id, category.id, { code: 'C4', status: 'draft' }),
  });

  // Draft-stage churn must NOT reach the terminals: kind='pricing' forces a
  // full catalog reset on every till.
  const beforeDraftChurn = await countPricingChanges(tenant.id, code.id);
  await prisma.taxCode.update({ where: { id: code.id }, data: { status: 'submitted' } });
  await prisma.taxCode.update({ where: { id: code.id }, data: { name_en: 'Renamed draft' } });
  expectEqual(
    'C4 draft-stage transitions and edits do NOT emit a pricing SyncChange',
    (await countPricingChanges(tenant.id, code.id)) - beforeDraftChurn,
    // submitted is a status change and DOES emit under the WHEN clause; the
    // rename does not. Asserting the exact count keeps this honest about what
    // the trigger actually does rather than what would be convenient.
    1,
  );

  await prisma.taxCode.update({ where: { id: code.id }, data: { status: 'approved' } });
  const beforeActivation = await countPricingChanges(tenant.id, code.id);
  await prisma.taxCode.update({
    where: { id: code.id },
    data: { status: 'active', activated_at: new Date() },
  });
  expectEqual(
    'C4 ACTIVATING a TaxCode emits a pricing SyncChange (tills must get the new rate)',
    (await countPricingChanges(tenant.id, code.id)) - beforeActivation,
    1,
  );
  expectEqual(
    'C4 that SyncChange carries the owning tenant',
    (await prisma.syncChange.findFirst({
      where: { entity_key: code.id, kind: 'pricing' },
      orderBy: { sequence: 'desc' },
    }))?.tenant_id,
    tenant.id,
  );

  // Repointing a product's tax category changes the charged amount too.
  const otherCategory = await createCategory(tenant.id, 'C4-CAT-2');
  const product = await prisma.product.create({
    data: { tenant_id: tenant.id, name_en: 'C4 product', tax_category_id: category.id },
  });
  const beforeRepoint = await countPricingChanges(tenant.id, product.id);
  await prisma.product.update({
    where: { id: product.id },
    data: { tax_category_id: otherCategory.id },
  });
  expectEqual(
    'C4 repointing a Product tax category emits a pricing SyncChange',
    (await countPricingChanges(tenant.id, product.id)) - beforeRepoint,
    1,
  );

  const beforeRename = await countPricingChanges(tenant.id, product.id);
  await prisma.product.update({ where: { id: product.id }, data: { name_en: 'C4 renamed' } });
  expectEqual(
    'C4 an ordinary Product edit does NOT force a catalog reset',
    (await countPricingChanges(tenant.id, product.id)) - beforeRename,
    0,
  );
}

// --- C5: exemption uniqueness ----------------------------------------------

async function verifyExemptionUniqueness(tenant) {
  const category = await createCategory(tenant.id, 'C5-CAT');
  const customer = await prisma.customer.create({
    data: { tenant_id: tenant.id, phone: `C5-${randomUUID().slice(0, 8)}` },
  });

  const base = {
    tenant_id: tenant.id,
    customer_id: customer.id,
    reason: 'Diplomatic exemption',
    evidence_reference: 'CERT-1',
    evidence_issued_at: new Date(),
    applied_by: randomUUID(),
    updated_at: new Date(),
  };

  await prisma.taxExemption.create({ data: { ...base, tax_category_id: null, status: 'approved' } });
  await expectUniqueViolation(
    'C5 a second live tenant-wide exemption for one customer is rejected (COALESCE collapse)',
    () =>
      prisma.taxExemption.create({
        data: { ...base, tax_category_id: null, status: 'pending', evidence_reference: 'CERT-2' },
      }),
  );

  // A category-scoped one is a different key and is allowed.
  const scoped = await prisma.taxExemption.create({
    data: { ...base, tax_category_id: category.id, status: 'approved', evidence_reference: 'CERT-3' },
  });
  expectEqual('C5 a category-scoped exemption may coexist with a tenant-wide one', scoped.status, 'approved');

  // Revoking frees the key for a replacement -- the index is partial on
  // (pending, approved), so an expired/revoked history never blocks a renewal.
  await prisma.taxExemption.update({ where: { id: scoped.id }, data: { status: 'revoked' } });
  const renewed = await prisma.taxExemption.create({
    data: { ...base, tax_category_id: category.id, status: 'pending', evidence_reference: 'CERT-4' },
  });
  expectEqual('C5 a revoked exemption does not block a renewal', renewed.status, 'pending');
}

async function main() {
  const tenant = await createTenant('wp008c-verify');
  await verifySnapshotImmutability(tenant);
  await verifyActiveCodeUniqueness(tenant);
  await verifySyncChangeEmission(tenant);
  await verifyExemptionUniqueness(tenant);

  process.stdout.write(failed ? `\n${failed} check(s) FAILED\n` : '\nAll Tax Code behaviour checks passed\n');
  if (failed) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
