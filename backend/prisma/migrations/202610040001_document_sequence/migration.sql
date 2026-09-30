-- W3: per-tenant document numbers replace the two global sequences, which leaked
-- how many adjustments and counts other tenants had made and left gaps.

-- CreateTable
CREATE TABLE "DocumentSequence" (
    "tenant_id" UUID NOT NULL,
    "key" VARCHAR(40) NOT NULL,
    "last_value" BIGINT NOT NULL,

    CONSTRAINT "DocumentSequence_pkey" PRIMARY KEY ("tenant_id","key")
);

DROP SEQUENCE "StockAdjustmentNumberSequence";
DROP SEQUENCE "StockCountNumberSequence";
