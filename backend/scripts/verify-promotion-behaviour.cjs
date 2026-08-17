#!/usr/bin/env node
// WP-008 Phase D — database-level proof for the invariants that live in SQL,
// not in application code. Runs against a real, freshly-migrated Postgres
// (wired into the CI `migration-gate` job's `athr_migrations_clean` database),
// same convention as `verify-tax-code-behaviour.cjs`/`verify-price-book-
// behaviour.cjs`.
//
// `fakePrisma` (backend/src/identity/testing/cross-tenant-harness.ts)
// enforces NO unique constraint at all (backlog item F7c — confirmed by
// reading its `create`/`update` implementations, not merely assumed). Coupon
// code uniqueness (BR-CPN-201) and idempotent redemption (BR-CPN-204) are
// therefore invisible to any jest spec written against the fake, no matter
// how green. This script is where both actually get proven.
//
// Proves:
//   P1  `Coupon_tenant_id_code_normalized_key` (BR-CPN-201) — a normalized
//       code is unique WITHIN a tenant, and only within a tenant: the same
//       code in a different tenant is unaffected.
//   P2  `CouponRedemption_tenant_id_coupon_id_idempotency_key_key`
//       (BR-CPN-204) is what makes redemption idempotent STRUCTURALLY, not
//       via a read-then-write check that races — proven with two GENUINELY
//       CONCURRENT `create` calls against the same
//       (tenant, coupon, idempotency_key), not two sequential ones. Exactly
//       one must succeed; the loser must see a real P2002, not a stall or a
//       silent second row.
//   P3  The `use_count` capacity gate (`CouponRepository.redeem`'s atomic
//       `UPDATE ... WHERE use_count < max_total_uses`) is safe under the same
//       kind of real concurrency — two genuinely concurrent capacity claims
//       against a coupon with `max_total_uses = 1` must resolve to exactly
//       one winner, never both, and never neither. A `SELECT` then `UPDATE`
//       pair could not make this guarantee (the two reads could both observe
//       capacity available before either write lands); the single
//       conditional `UPDATE` statement can, because Postgres serializes
//       concurrent writers on the same row.
//   P4  A replayed redemption (same idempotency key, resubmitted) does not
//       increment `use_count` a second time — the counter reflects distinct
//       successful redemptions only.
//   P5  Independent-review follow-up on PR #76 (BR-CPN-202): a coupon shaped
//       exactly like what `CouponService.create` now derives for
//       `type: 'single_use'` (`max_total_uses: 1`) accepts a first
//       redemption and rejects a SECOND, genuinely distinct one (a different
//       idempotency key, not a replay — P2/P4 already cover the replay
//       case), leaving no orphan row and no second `use_count` increment.
//
// Deliberate omission for THIS script (see the two-migration split in
// 202608160001_add_promotion_coupon_bundle_tables /
// 202608160002_add_promotion_coupon_uniqueness_constraints, and the Phase D
// PR description): the RED half of the standing "a guard must be seen
// failing" rule comes from running this SAME script against the schema state
// migration 202608160001 alone produces (both P1 and P2's positive
// assertions fail there, since the constraints do not exist yet), not from a
// second code path inside this file.
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

function isUniqueViolation(error) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

async function expectUniqueViolation(name, attempt) {
  try {
    await attempt();
    record(name, false, 'expected a unique constraint violation but the write succeeded');
  } catch (error) {
    const ok = isUniqueViolation(error);
    record(name, ok, ok ? undefined : `unexpected error: ${error?.code ?? ''} ${error?.message ?? error}`);
  }
}

// --- fixture helpers ---------------------------------------------------------

async function createTenant(label) {
  return prisma.tenant.create({ data: { name: `${label}-${randomUUID()}`, default_currency: 'EGP' } });
}

/** Written directly at whatever status the test needs — this script exercises the database, not `PromotionService`'s state machine. */
function promotionData(tenantId, overrides = {}) {
  return {
    tenant_id: tenantId,
    name: 'Verify promotion',
    status: 'active',
    starts_at: new Date(Date.now() - 60_000),
    benefit_type: 'percentage',
    benefit_value: new Prisma.Decimal('10.00'),
    scope_type: 'all',
    return_policy: 'line_prorated',
    updated_at: new Date(),
    ...overrides,
  };
}

function couponData(tenantId, promotionId, code, overrides = {}) {
  return {
    tenant_id: tenantId,
    promotion_id: promotionId,
    code_normalized: code.trim().toUpperCase(),
    code_display: code,
    type: 'public',
    status: 'active',
    updated_at: new Date(),
    ...overrides,
  };
}

// --- P1: coupon code uniqueness ---------------------------------------------

async function verifyCouponCodeUniqueness(tenantA, tenantB) {
  const promoA = await prisma.promotion.create({ data: promotionData(tenantA.id, { name: 'P1-A' }) });
  await prisma.coupon.create({ data: couponData(tenantA.id, promoA.id, 'SAVE10') });

  await expectUniqueViolation(
    'P1 a second coupon with the same normalized code in the same tenant is rejected',
    () => prisma.coupon.create({ data: couponData(tenantA.id, promoA.id, '  save10  ') }),
  );

  const stillOne = await prisma.coupon.count({
    where: { tenant_id: tenantA.id, code_normalized: 'SAVE10' },
  });
  expectEqual('P1 the rejected duplicate did not leave a second row behind', stillOne, 1);

  // A different tenant is a different uniqueness scope entirely.
  const promoB = await prisma.promotion.create({ data: promotionData(tenantB.id, { name: 'P1-B' }) });
  const otherTenantCoupon = await prisma.coupon.create({
    data: couponData(tenantB.id, promoB.id, 'SAVE10'),
  });
  expectEqual(
    'P1 the same code is unaffected in a different tenant',
    otherTenantCoupon.code_normalized,
    'SAVE10',
  );
}

// --- P2: idempotent redemption under real concurrency -----------------------

async function verifyIdempotentRedemptionConcurrency(tenant) {
  const promotion = await prisma.promotion.create({ data: promotionData(tenant.id, { name: 'P2' }) });
  const coupon = await prisma.coupon.create({ data: couponData(tenant.id, promotion.id, 'P2-CODE') });
  const idempotencyKey = `p2-${randomUUID()}`;

  const attempt = () =>
    prisma.couponRedemption.create({
      data: {
        tenant_id: tenant.id,
        coupon_id: coupon.id,
        idempotency_key: idempotencyKey,
        redeemed_at: new Date(),
      },
    });

  // Genuinely concurrent: both requests fire before either can observe the
  // other's result. A read-then-write check ("does a row for this key exist
  // yet?") could not guarantee this; the unique constraint can, because it is
  // Postgres itself that rejects the loser at INSERT time.
  const [first, second] = await Promise.allSettled([attempt(), attempt()]);
  const settled = [first, second];
  const succeeded = settled.filter((result) => result.status === 'fulfilled');
  const rejected = settled.filter((result) => result.status === 'rejected');

  expectEqual('P2 exactly one concurrent redemption with the same idempotency key succeeds', succeeded.length, 1);
  expectEqual(
    'P2 the other is rejected as a real unique-constraint violation, not some other error',
    rejected.length === 1 && isUniqueViolation(rejected[0].reason),
    true,
  );

  const rowCount = await prisma.couponRedemption.count({
    where: { tenant_id: tenant.id, coupon_id: coupon.id, idempotency_key: idempotencyKey },
  });
  expectEqual('P2 exactly one CouponRedemption row exists for this (coupon, idempotency_key)', rowCount, 1);

  // A later, sequential retry with the same key must also be rejected —
  // idempotency holds after the race resolves, not just during it.
  await expectUniqueViolation(
    'P2 a subsequent sequential retry with the same idempotency key is also rejected',
    attempt,
  );

  return { promotion, coupon, idempotencyKey };
}

// --- P3: the use_count capacity gate under real concurrency ------------------

async function verifyCapacityGateConcurrency(tenant) {
  const promotion = await prisma.promotion.create({ data: promotionData(tenant.id, { name: 'P3' }) });
  const coupon = await prisma.coupon.create({
    data: couponData(tenant.id, promotion.id, 'P3-CODE', { max_total_uses: 1 }),
  });

  const claimCapacity = () =>
    prisma.$executeRaw`
      UPDATE "Coupon"
      SET "use_count" = "use_count" + 1, "updated_at" = CURRENT_TIMESTAMP
      WHERE "id" = ${coupon.id}::uuid
        AND "tenant_id" = ${tenant.id}::uuid
        AND "status" = 'active'::"CouponStatus"
        AND ("max_total_uses" IS NULL OR "use_count" < "max_total_uses")
    `;

  // Two genuinely concurrent claims against a coupon whose capacity is 1.
  const [a, b] = await Promise.all([claimCapacity(), claimCapacity()]);
  const affectedTotal = Number(a) + Number(b);
  expectEqual(
    'P3 exactly one of two concurrent capacity claims against max_total_uses=1 succeeds',
    affectedTotal,
    1,
  );

  const finalCoupon = await prisma.coupon.findUnique({ where: { id: coupon.id } });
  expectEqual('P3 use_count reflects exactly the one successful claim, never both', finalCoupon.use_count, 1);

  // A third claim, now that capacity is exhausted, must also fail.
  const third = await claimCapacity();
  expectEqual('P3 a further claim against an exhausted coupon affects zero rows', Number(third), 0);
  expectEqual(
    'P3 use_count did not move past capacity',
    (await prisma.coupon.findUnique({ where: { id: coupon.id } })).use_count,
    1,
  );
}

// --- P4: a replay never double-counts ----------------------------------------

async function verifyReplayDoesNotDoubleCount(tenant) {
  const promotion = await prisma.promotion.create({ data: promotionData(tenant.id, { name: 'P4' }) });
  const coupon = await prisma.coupon.create({ data: couponData(tenant.id, promotion.id, 'P4-CODE') });
  const idempotencyKey = `p4-${randomUUID()}`;

  // First redemption: insert succeeds, capacity claim succeeds (mirrors
  // `CouponRepository.redeem`'s two-phase sequence for the non-racing case).
  await prisma.couponRedemption.create({
    data: { tenant_id: tenant.id, coupon_id: coupon.id, idempotency_key: idempotencyKey, redeemed_at: new Date() },
  });
  await prisma.$executeRaw`
    UPDATE "Coupon" SET "use_count" = "use_count" + 1
    WHERE "id" = ${coupon.id}::uuid AND "tenant_id" = ${tenant.id}::uuid
      AND ("max_total_uses" IS NULL OR "use_count" < "max_total_uses")
  `;

  // Replay: the INSERT for the SAME key must fail before any capacity claim
  // is attempted (this is `CouponRepository.redeem`'s ordering — insert
  // first, only claim capacity for a genuinely new row).
  await expectUniqueViolation('P4 a replayed redemption cannot insert a second row', () =>
    prisma.couponRedemption.create({
      data: { tenant_id: tenant.id, coupon_id: coupon.id, idempotency_key: idempotencyKey, redeemed_at: new Date() },
    }),
  );

  const finalCoupon = await prisma.coupon.findUnique({ where: { id: coupon.id } });
  expectEqual('P4 use_count reflects one redemption, not two, after the replay', finalCoupon.use_count, 1);
  expectEqual(
    'P4 exactly one redemption row exists',
    await prisma.couponRedemption.count({ where: { tenant_id: tenant.id, coupon_id: coupon.id } }),
    1,
  );
}

// --- P5: a single_use coupon rejects a genuinely SECOND redemption ----------
//
// Review follow-up on PR #76 (BR-CPN-202): before this fix, `CouponService.
// create` never derived `max_total_uses` from `type` -- a "single_use"
// coupon created without an explicit `max_total_uses` was persisted with
// `max_total_uses: null` (unlimited), identical in DB-visible behaviour to
// `public`. The fix makes `CouponService.create` set `max_total_uses: 1` for
// `type: 'single_use'` -- a pure application-layer derivation, proven by a
// jest unit test against a mocked repository (`coupon.service.spec.ts`,
// "single_use enforcement"). What that unit test CANNOT prove is the
// consequence: that a coupon actually shaped `max_total_uses: 1` really does
// reject a second redemption. That is `CouponRepository.redeem`'s job, and
// like P1-P4, it is real-Postgres-only. This check mirrors
// `CouponRepository.redeem`'s exact two-phase sequence (insert the
// redemption row, then an atomic conditional capacity claim, compensating
// with a delete if capacity was not available) for two GENUINELY DISTINCT
// redemption attempts (different idempotency keys -- this is not a replay,
// which P2/P4 already cover) against a coupon shaped exactly like what
// `CouponService.create` now derives for `type: 'single_use'`.
async function redeemTwoPhase(tenant, coupon, idempotencyKey) {
  const inserted = await prisma.couponRedemption.create({
    data: { tenant_id: tenant.id, coupon_id: coupon.id, idempotency_key: idempotencyKey, redeemed_at: new Date() },
  });
  const capacity = await prisma.$executeRaw`
    UPDATE "Coupon" SET "use_count" = "use_count" + 1, "updated_at" = CURRENT_TIMESTAMP
    WHERE "id" = ${coupon.id}::uuid AND "tenant_id" = ${tenant.id}::uuid
      AND "status" = 'active'::"CouponStatus"
      AND ("max_total_uses" IS NULL OR "use_count" < "max_total_uses")
  `;
  if (Number(capacity) !== 1) {
    await prisma.couponRedemption.delete({ where: { id: inserted.id } });
    return { accepted: false };
  }
  return { accepted: true, redemptionId: inserted.id };
}

async function verifySingleUseCouponRejectsSecondRedemption(tenant) {
  const promotion = await prisma.promotion.create({ data: promotionData(tenant.id, { name: 'P5' }) });
  // Exactly what `CouponService.create` now derives for `type: 'single_use'`
  // with no explicit `max_total_uses` -- see that method's BR-CPN-202 comment.
  const coupon = await prisma.coupon.create({
    data: couponData(tenant.id, promotion.id, 'P5-CODE', { type: 'single_use', max_total_uses: 1 }),
  });

  const first = await redeemTwoPhase(tenant, coupon, `p5-first-${randomUUID()}`);
  expectEqual('P5 the first redemption of a single_use coupon is accepted', first.accepted, true);

  const second = await redeemTwoPhase(tenant, coupon, `p5-second-${randomUUID()}`);
  expectEqual(
    'P5 a second, genuinely distinct redemption of the same single_use coupon is rejected',
    second.accepted,
    false,
  );

  const finalCoupon = await prisma.coupon.findUnique({ where: { id: coupon.id } });
  expectEqual('P5 use_count reflects exactly the one accepted redemption', finalCoupon.use_count, 1);
  expectEqual(
    'P5 the rejected second attempt left no orphan CouponRedemption row behind',
    await prisma.couponRedemption.count({ where: { tenant_id: tenant.id, coupon_id: coupon.id } }),
    1,
  );
}

async function main() {
  const tenantA = await createTenant('wp008d-verify-a');
  const tenantB = await createTenant('wp008d-verify-b');

  await verifyCouponCodeUniqueness(tenantA, tenantB);
  await verifyIdempotentRedemptionConcurrency(tenantA);
  await verifyCapacityGateConcurrency(tenantA);
  await verifyReplayDoesNotDoubleCount(tenantA);
  await verifySingleUseCouponRejectsSecondRedemption(tenantA);

  process.stdout.write(failed ? `\n${failed} check(s) FAILED\n` : '\nAll Promotion/Coupon behaviour checks passed\n');
  if (failed) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
