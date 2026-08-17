-- WP-008 Phase D (BR-CPN-201, BR-CPN-204) -- promotes the two ordinary
-- indexes the previous migration deliberately left non-unique to real UNIQUE
-- constraints:
--
--   - BR-CPN-201: "Code normalized وفريدة داخل نطاقها" -- a coupon code is
--     unique within its tenant. Without this, two `Coupon` rows could share a
--     `code_normalized` and which one a redemption resolves to would be
--     arbitrary.
--   - BR-CPN-204: "الاستخدام Idempotent" -- redeeming the same
--     (coupon, idempotency_key) pair twice must produce the SAME redemption
--     row, never a second one. `CouponRepository.redeem` relies on this being
--     a real constraint -- the redemption `INSERT` is attempted directly and
--     a `P2002` violation is what signals a replay, not a read-then-write
--     check that races -- see that method and `verify-promotion-behaviour.cjs`.
--
-- Split into its own migration (rather than folded into the previous one) so
-- "verify-promotion-behaviour.cjs" can be run against the schema state
-- BEFORE this migration (where both assertions genuinely fail -- RED) and
-- again AFTER it (where they genuinely pass -- GREEN), per the standing rule
-- that a new proof script must be seen failing before it is trusted. See the
-- Phase D PR description for both CI run SHAs. This migration is purely
-- additive -- it drops no data, only replaces two plain indexes with unique
-- ones of the same column set.

DROP INDEX "Coupon_tenant_id_code_normalized_idx";

-- CreateIndex
CREATE UNIQUE INDEX "Coupon_tenant_id_code_normalized_key" ON "Coupon"("tenant_id", "code_normalized");

DROP INDEX "CouponRedemption_tenant_id_coupon_id_idempotency_key_idx";

-- CreateIndex
CREATE UNIQUE INDEX "CouponRedemption_tenant_id_coupon_id_idempotency_key_key" ON "CouponRedemption"("tenant_id", "coupon_id", "idempotency_key");
