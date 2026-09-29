-- ATHR baseline schema. Replaces the former incremental migration history;
-- it recreates the complete database (enums, tables, SQL functions, triggers,
-- partial and trigram indexes). Later changes are new forward-only migrations.

-- ======================================================================
-- Extensions
-- ======================================================================

CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public;

-- ======================================================================
-- Enum types
-- ======================================================================

CREATE TYPE "AccessScopeType" AS ENUM (
    'tenant_wide',
    'location',
    'warehouse',
    'terminal'
);

CREATE TYPE "BundleAllocationMethod" AS ENUM (
    'proportional_price'
);

CREATE TYPE "BundleReturnPolicy" AS ENUM (
    'whole_bundle_only',
    'component_prorated'
);

CREATE TYPE "BundleStatus" AS ENUM (
    'draft',
    'active',
    'ended'
);

CREATE TYPE "CouponStatus" AS ENUM (
    'active',
    'disabled'
);

CREATE TYPE "CouponType" AS ENUM (
    'public',
    'single_use',
    'customer_bound'
);

CREATE TYPE "DiscountBasis" AS ENUM (
    'percentage',
    'fixed_amount'
);

CREATE TYPE "InventoryCostMovementType" AS ENUM (
    'opening_balance',
    'purchase_receipt',
    'purchase_reversal',
    'supplier_return',
    'customer_return',
    'adjustment'
);

CREATE TYPE "InventoryMovementType" AS ENUM (
    'opening_balance',
    'sale',
    'return',
    'purchase_receipt',
    'transfer_out',
    'transfer_in',
    'adjustment',
    'stock_count',
    'reservation',
    'reservation_release',
    'cancellation',
    'reversal'
);

CREATE TYPE "InvitationStatus" AS ENUM (
    'pending',
    'accepted',
    'expired',
    'revoked'
);

CREATE TYPE "ItemType" AS ENUM (
    'stocked',
    'non_stock',
    'service',
    'bundle_kit_placeholder'
);

CREATE TYPE "MembershipRole" AS ENUM (
    'tenant_owner',
    'location_manager',
    'cashier',
    'warehouse_manager',
    'seller'
);

CREATE TYPE "MembershipStatus" AS ENUM (
    'invited',
    'pending_verification',
    'active',
    'suspended',
    'deactivated',
    'expired'
);

CREATE TYPE "PriceBookScope" AS ENUM (
    'tenant_default',
    'location',
    'customer_group',
    'contract',
    'wholesale'
);

CREATE TYPE "PriceBookStatus" AS ENUM (
    'draft',
    'submitted',
    'approved',
    'scheduled',
    'active',
    'ended',
    'archived'
);

CREATE TYPE "PriceEntryScopeType" AS ENUM (
    'variant',
    'product',
    'brand',
    'category',
    'global'
);

CREATE TYPE "PriceEntryStatus" AS ENUM (
    'active',
    'superseded'
);

CREATE TYPE "PromotionBenefitType" AS ENUM (
    'percentage',
    'fixed_amount',
    'fixed_price',
    'bogo'
);

CREATE TYPE "PromotionMinSpendBasis" AS ENUM (
    'before_tax',
    'after_tax'
);

CREATE TYPE "PromotionReturnPolicy" AS ENUM (
    'line_prorated',
    'whole_promotion_only'
);

CREATE TYPE "PromotionScopeType" AS ENUM (
    'variant',
    'product',
    'brand',
    'category',
    'all'
);

CREATE TYPE "PromotionStackability" AS ENUM (
    'exclusive',
    'stackable_group',
    'stackable_manual'
);

CREATE TYPE "PromotionStatus" AS ENUM (
    'draft',
    'scheduled',
    'active',
    'paused',
    'ended',
    'cancelled',
    'archived'
);

CREATE TYPE "PurchaseInvoiceStatus" AS ENUM (
    'posted',
    'reversed'
);

CREATE TYPE "ReturnStatus" AS ENUM (
    'completed',
    'voided'
);

CREATE TYPE "Role" AS ENUM (
    'owner',
    'branch_manager',
    'cashier',
    'warehouse_manager',
    'seller'
);

CREATE TYPE "SupplierReturnStatus" AS ENUM (
    'posted'
);

CREATE TYPE "SupportAccessMode" AS ENUM (
    'metadata_only',
    'read_only_diagnostic',
    'assisted_operation',
    'break_glass'
);

CREATE TYPE "TaxCalculationMethod" AS ENUM (
    'percentage'
);

CREATE TYPE "TaxCodeStatus" AS ENUM (
    'draft',
    'submitted',
    'approved',
    'scheduled',
    'active',
    'superseded',
    'archived'
);

CREATE TYPE "TaxExemptionStatus" AS ENUM (
    'pending',
    'approved',
    'rejected',
    'revoked',
    'expired'
);

CREATE TYPE "TaxMode" AS ENUM (
    'inclusive',
    'exclusive'
);

CREATE TYPE "TaxRoundingPolicy" AS ENUM (
    'line',
    'document'
);

CREATE TYPE "TenantAccessMode" AS ENUM (
    'provisioning',
    'internal_demo',
    'trial',
    'active',
    'payment_grace',
    'read_only',
    'restricted',
    'suspended',
    'closure_requested',
    'closed',
    'deletion_pending'
);

CREATE TYPE "TransferCommandType" AS ENUM (
    'ship',
    'receive',
    'cancel'
);

CREATE TYPE "TransferStatus" AS ENUM (
    'pending',
    'shipped',
    'received',
    'cancelled',
    'partially_received'
);

CREATE TYPE "TransferTransitMovementType" AS ENUM (
    'shipped',
    'received',
    'damaged',
    'missing',
    'correction'
);

CREATE TYPE "UomConversionStatus" AS ENUM (
    'active',
    'superseded'
);

CREATE TYPE "UomKind" AS ENUM (
    'base',
    'derived'
);

-- ======================================================================
-- Tables
-- ======================================================================

CREATE TABLE "AccessScopeAssignment" (
    id uuid NOT NULL,
    membership_id uuid NOT NULL,
    scope_type "AccessScopeType" NOT NULL,
    scope_ref_id uuid,
    grant_source character varying(64) NOT NULL,
    effective_from timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    effective_to timestamp(3) without time zone,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE TABLE "Assortment" (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    branch_id uuid NOT NULL,
    variant_id uuid NOT NULL,
    is_sellable boolean DEFAULT true NOT NULL,
    is_purchasable boolean DEFAULT true NOT NULL,
    is_displayable boolean DEFAULT true NOT NULL,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL
);

CREATE TABLE "AuditLog" (
    id uuid NOT NULL,
    user_id uuid,
    action text NOT NULL,
    entity text,
    entity_id uuid,
    meta jsonb,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    tenant_id uuid NOT NULL
);

CREATE TABLE "Branch" (
    id uuid NOT NULL,
    code text NOT NULL,
    name_ar text NOT NULL,
    name_en text,
    address text,
    phone text,
    cash_drawer_enabled boolean DEFAULT false NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    tenant_id uuid NOT NULL
);

CREATE TABLE "Brand" (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    name text NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL
);

CREATE TABLE "Bundle" (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    name text NOT NULL,
    status "BundleStatus" DEFAULT 'draft'::"BundleStatus" NOT NULL,
    allocation_method "BundleAllocationMethod" DEFAULT 'proportional_price'::"BundleAllocationMethod" NOT NULL,
    return_policy "BundleReturnPolicy",
    version integer DEFAULT 1 NOT NULL,
    supersedes_id uuid,
    superseded_at timestamp(3) without time zone,
    superseded_by_id uuid,
    created_by uuid,
    activated_by uuid,
    activated_at timestamp(3) without time zone,
    ended_by uuid,
    ended_at timestamp(3) without time zone,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL
);

CREATE TABLE "BundleComponent" (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    bundle_id uuid NOT NULL,
    variant_id uuid NOT NULL,
    qty numeric(12,3) NOT NULL,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE TABLE "Category" (
    id uuid NOT NULL,
    name_ar text NOT NULL,
    name_en text,
    parent_id uuid,
    tenant_id uuid NOT NULL
);

CREATE TABLE "Coupon" (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    promotion_id uuid NOT NULL,
    code_normalized text NOT NULL,
    code_display text NOT NULL,
    type "CouponType" DEFAULT 'public'::"CouponType" NOT NULL,
    status "CouponStatus" DEFAULT 'active'::"CouponStatus" NOT NULL,
    customer_id uuid,
    max_total_uses integer,
    max_uses_per_customer integer,
    use_count integer DEFAULT 0 NOT NULL,
    expires_at timestamp(3) without time zone,
    created_by uuid,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL
);

CREATE TABLE "CouponRedemption" (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    coupon_id uuid NOT NULL,
    idempotency_key text NOT NULL,
    customer_id uuid,
    amount_applied numeric(12,2),
    redeemed_by uuid,
    redeemed_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE TABLE "Customer" (
    id uuid NOT NULL,
    name text,
    phone text,
    whatsapp text,
    email text,
    is_vip boolean DEFAULT false NOT NULL,
    vip_price_tier text DEFAULT 'cost_plus_overhead'::text NOT NULL,
    total_invoices integer DEFAULT 0 NOT NULL,
    total_spent numeric(12,2) DEFAULT 0 NOT NULL,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    tenant_id uuid NOT NULL
);

CREATE TABLE "Discount" (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    variant_id uuid NOT NULL,
    reference text,
    source text DEFAULT 'manual'::text NOT NULL,
    basis "DiscountBasis" NOT NULL,
    amount numeric(12,2) NOT NULL,
    base_price numeric(12,2) NOT NULL,
    final_price numeric(12,2) NOT NULL,
    reason text,
    applied_by uuid NOT NULL,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT "Discount_amount_not_negative" CHECK ((amount >= (0)::numeric)),
    CONSTRAINT "Discount_final_price_not_negative" CHECK ((final_price >= (0)::numeric))
);

CREATE TABLE "InventoryCostMovement" (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    sequence bigint NOT NULL,
    variant_id uuid NOT NULL,
    branch_id uuid,
    movement_type "InventoryCostMovementType" NOT NULL,
    quantity_delta integer NOT NULL,
    global_quantity_before integer NOT NULL,
    global_quantity_after integer NOT NULL,
    unit_cost numeric(18,6) NOT NULL,
    cost_before numeric(12,2) NOT NULL,
    cost_after numeric(12,2) NOT NULL,
    inventory_value_before numeric(18,2) NOT NULL,
    movement_value numeric(18,2) NOT NULL,
    inventory_value_after numeric(18,2) NOT NULL,
    rounding_adjustment numeric(18,2) DEFAULT 0 NOT NULL,
    reference_type character varying(64) NOT NULL,
    reference_id character varying(128) NOT NULL,
    reference_line_id character varying(128),
    purchase_invoice_id uuid,
    purchase_invoice_item_id uuid,
    supplier_return_id uuid,
    supplier_return_item_id uuid,
    idempotency_key character varying(191) NOT NULL,
    occurred_at timestamp(3) without time zone NOT NULL,
    recorded_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    created_by uuid,
    metadata jsonb,
    tenant_id uuid NOT NULL,
    warehouse_id uuid,
    CONSTRAINT "InventoryCostMovement_nonnegative_costs" CHECK (((unit_cost >= (0)::numeric) AND (cost_before >= (0)::numeric) AND (cost_after >= (0)::numeric) AND (inventory_value_before >= (0)::numeric) AND (inventory_value_after >= (0)::numeric))),
    CONSTRAINT "InventoryCostMovement_quantity_consistency" CHECK (((quantity_delta <> 0) AND ((global_quantity_before + quantity_delta) = global_quantity_after))),
    CONSTRAINT "InventoryCostMovement_type_direction" CHECK ((((movement_type = 'opening_balance'::"InventoryCostMovementType") AND (quantity_delta > 0) AND (movement_value >= (0)::numeric) AND (global_quantity_before = 0) AND (cost_before = (0)::numeric)) OR ((movement_type = ANY (ARRAY['purchase_receipt'::"InventoryCostMovementType", 'customer_return'::"InventoryCostMovementType"])) AND (quantity_delta > 0) AND (movement_value >= (0)::numeric)) OR ((movement_type = ANY (ARRAY['purchase_reversal'::"InventoryCostMovementType", 'supplier_return'::"InventoryCostMovementType"])) AND (quantity_delta < 0) AND (movement_value <= (0)::numeric)) OR (movement_type = 'adjustment'::"InventoryCostMovementType"))),
    CONSTRAINT "InventoryCostMovement_value_equation" CHECK ((inventory_value_after = ((inventory_value_before + movement_value) + rounding_adjustment)))
);

CREATE TABLE "InventoryMovement" (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    branch_id uuid NOT NULL,
    variant_id uuid NOT NULL,
    movement_type "InventoryMovementType" NOT NULL,
    on_hand_delta integer NOT NULL,
    reserved_delta integer DEFAULT 0 NOT NULL,
    on_hand_after integer NOT NULL,
    reserved_after integer NOT NULL,
    reference_type character varying(64) NOT NULL,
    reference_id character varying(128) NOT NULL,
    reference_line_id character varying(128),
    idempotency_key character varying(191) NOT NULL,
    occurred_at timestamp(3) without time zone NOT NULL,
    recorded_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    created_by uuid,
    metadata jsonb,
    sequence bigint NOT NULL,
    tenant_id uuid NOT NULL,
    warehouse_id uuid,
    CONSTRAINT "InventoryMovement_nonzero_delta" CHECK (((on_hand_delta <> 0) OR (reserved_delta <> 0))),
    CONSTRAINT "InventoryMovement_reserved_nonnegative" CHECK ((reserved_after >= 0)),
    CONSTRAINT "InventoryMovement_reserved_not_above_available_on_hand" CHECK ((reserved_after <= GREATEST(on_hand_after, 0)))
);

CREATE TABLE "InventoryStock" (
    branch_id uuid NOT NULL,
    variant_id uuid NOT NULL,
    qty_on_hand integer DEFAULT 0 NOT NULL,
    qty_reserved integer DEFAULT 0 NOT NULL,
    last_sold_at timestamp(3) without time zone,
    tenant_id uuid NOT NULL,
    warehouse_id uuid,
    CONSTRAINT "InventoryStock_qty_reserved_nonnegative" CHECK ((qty_reserved >= 0)),
    CONSTRAINT "InventoryStock_reserved_not_above_available_on_hand" CHECK ((qty_reserved <= GREATEST(qty_on_hand, 0)))
);

CREATE TABLE "Invitation" (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    email text NOT NULL,
    role "MembershipRole" NOT NULL,
    scope_type "AccessScopeType" NOT NULL,
    scope_ref_id uuid,
    token_hash text NOT NULL,
    status "InvitationStatus" DEFAULT 'pending'::"InvitationStatus" NOT NULL,
    invited_by_id uuid,
    purpose text,
    expires_at timestamp(3) without time zone NOT NULL,
    accepted_at timestamp(3) without time zone,
    accepted_membership_id uuid,
    revoked_at timestamp(3) without time zone,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL
);

CREATE TABLE "LegalEntity" (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    legal_name text NOT NULL,
    is_primary boolean DEFAULT true NOT NULL,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL
);

CREATE TABLE "Location" (
    id uuid NOT NULL,
    "tenantId" uuid NOT NULL,
    legal_entity_id uuid NOT NULL,
    code text NOT NULL,
    name_ar text NOT NULL,
    name_en text,
    address text,
    phone text,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL
);

CREATE TABLE "Membership" (
    id uuid NOT NULL,
    "tenantId" uuid NOT NULL,
    "identityId" uuid NOT NULL,
    role "MembershipRole" NOT NULL,
    status "MembershipStatus" DEFAULT 'active'::"MembershipStatus" NOT NULL,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL
);

CREATE TABLE "OfferSuggestion" (
    id uuid NOT NULL,
    variant_id uuid NOT NULL,
    branch_id uuid NOT NULL,
    days_unsold integer NOT NULL,
    current_price numeric(12,2) NOT NULL,
    suggested_price numeric(12,2) NOT NULL,
    min_allowed_price numeric(12,2) NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    reviewed_by uuid,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    tenant_id uuid NOT NULL
);

CREATE TABLE "OrganizationProfile" (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    display_name text NOT NULL,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL
);

CREATE TABLE "PermissionPolicySnapshot" (
    id uuid NOT NULL,
    version integer NOT NULL,
    grants jsonb NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE TABLE "PosTerminal" (
    id uuid NOT NULL,
    device_id uuid NOT NULL,
    terminal_code text NOT NULL,
    name text NOT NULL,
    branch_id uuid NOT NULL,
    app_version text,
    last_seen_at timestamp(3) without time zone,
    last_sync_at timestamp(3) without time zone,
    last_sync_status text DEFAULT 'never'::text NOT NULL,
    last_error text,
    pending_count integer DEFAULT 0 NOT NULL,
    is_revoked boolean DEFAULT false NOT NULL,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL,
    device_token_hash text,
    enrolled_by uuid,
    enrolled_at timestamp(3) without time zone,
    last_sale_sequence bigint DEFAULT 0 NOT NULL,
    tenant_id uuid NOT NULL,
    CONSTRAINT "PosTerminal_last_sale_sequence_nonnegative" CHECK ((last_sale_sequence >= 0))
);

CREATE TABLE "PosTerminalEnrollment" (
    id uuid NOT NULL,
    code_hash text NOT NULL,
    branch_id uuid NOT NULL,
    terminal_name text,
    created_by uuid NOT NULL,
    expires_at timestamp(3) without time zone NOT NULL,
    used_at timestamp(3) without time zone,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    tenant_id uuid NOT NULL
);

CREATE TABLE "PriceBook" (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    name text NOT NULL,
    currency text NOT NULL,
    scope "PriceBookScope" DEFAULT 'tenant_default'::"PriceBookScope" NOT NULL,
    scope_ref_id uuid,
    status "PriceBookStatus" DEFAULT 'draft'::"PriceBookStatus" NOT NULL,
    is_default boolean DEFAULT false NOT NULL,
    effective_from timestamp(3) without time zone,
    effective_to timestamp(3) without time zone,
    created_by uuid,
    submitted_by uuid,
    submitted_at timestamp(3) without time zone,
    approved_by uuid,
    approved_at timestamp(3) without time zone,
    scheduled_by uuid,
    scheduled_at timestamp(3) without time zone,
    activated_by uuid,
    activated_at timestamp(3) without time zone,
    ended_by uuid,
    ended_at timestamp(3) without time zone,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL
);

CREATE TABLE "PriceBookEntry" (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    price_book_id uuid NOT NULL,
    scope_type "PriceEntryScopeType" NOT NULL,
    scope_id uuid,
    min_qty numeric(12,3) DEFAULT 1 NOT NULL,
    unit_price numeric(12,2) NOT NULL,
    allow_zero_price boolean DEFAULT false NOT NULL,
    tax_percent numeric(5,2) DEFAULT 14 NOT NULL,
    floor_price numeric(12,2),
    effective_from timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    effective_to timestamp(3) without time zone,
    version integer DEFAULT 1 NOT NULL,
    status "PriceEntryStatus" DEFAULT 'active'::"PriceEntryStatus" NOT NULL,
    superseded_by_id uuid,
    superseded_at timestamp(3) without time zone,
    created_by uuid,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    tax_mode "TaxMode" NOT NULL,
    CONSTRAINT "PriceBookEntry_min_qty_positive" CHECK ((min_qty > (0)::numeric)),
    CONSTRAINT "PriceBookEntry_unit_price_not_negative" CHECK ((unit_price >= (0)::numeric)),
    CONSTRAINT "PriceBookEntry_zero_price_requires_allowance" CHECK (((unit_price > (0)::numeric) OR (allow_zero_price = true)))
);

CREATE TABLE "PriceOverride" (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    variant_id uuid NOT NULL,
    reference text,
    base_price numeric(12,2) NOT NULL,
    override_price numeric(12,2) NOT NULL,
    floor_price numeric(12,2),
    is_below_floor boolean DEFAULT false NOT NULL,
    reason text NOT NULL,
    applied_by uuid NOT NULL,
    approved_by uuid,
    approved_at timestamp(3) without time zone,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT "PriceOverride_below_floor_requires_approval" CHECK (((is_below_floor = false) OR (approved_by IS NOT NULL))),
    CONSTRAINT "PriceOverride_override_price_not_negative" CHECK ((override_price >= (0)::numeric))
);

CREATE TABLE "PriceOverridePolicy" (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    role "MembershipRole" NOT NULL,
    max_discount_percent numeric(5,2),
    max_discount_amount numeric(12,2),
    allow_price_increase boolean DEFAULT true NOT NULL,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL
);

CREATE TABLE "PricingRule" (
    id uuid NOT NULL,
    name text NOT NULL,
    scope_type text NOT NULL,
    scope_id text,
    overhead_percent numeric(5,2) DEFAULT 0 NOT NULL,
    profit_percent numeric(5,2) DEFAULT 0 NOT NULL,
    tax_percent numeric(5,2) DEFAULT 14 NOT NULL,
    formula text DEFAULT 'compound'::text NOT NULL,
    is_protected boolean DEFAULT false NOT NULL,
    priority integer DEFAULT 100 NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    tenant_id uuid NOT NULL
);

CREATE TABLE "Product" (
    id uuid NOT NULL,
    sku_base text,
    name_en text NOT NULL,
    name_ar text,
    category_id uuid,
    brand text,
    image_url text,
    is_active boolean DEFAULT true NOT NULL,
    has_variants boolean DEFAULT true NOT NULL,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    tenant_id uuid NOT NULL,
    brand_id uuid,
    tax_category_id uuid NOT NULL
);

CREATE TABLE "ProductVariant" (
    id uuid NOT NULL,
    product_id uuid NOT NULL,
    sku text NOT NULL,
    barcode_ean13 text,
    barcode_internal text,
    size text,
    color text,
    style text,
    cost_price numeric(12,2) NOT NULL,
    return_count integer DEFAULT 0 NOT NULL,
    qa_flag boolean DEFAULT false NOT NULL,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    tenant_id uuid NOT NULL,
    item_type "ItemType" DEFAULT 'stocked'::"ItemType" NOT NULL,
    base_uom_id uuid,
    tax_category_id uuid
);

CREATE TABLE "Promotion" (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    name text NOT NULL,
    status "PromotionStatus" DEFAULT 'draft'::"PromotionStatus" NOT NULL,
    timezone text DEFAULT 'Africa/Cairo'::text NOT NULL,
    starts_at timestamp(3) without time zone NOT NULL,
    ends_at timestamp(3) without time zone,
    priority integer DEFAULT 100 NOT NULL,
    stackability "PromotionStackability" DEFAULT 'exclusive'::"PromotionStackability" NOT NULL,
    stack_group text,
    benefit_type "PromotionBenefitType" NOT NULL,
    benefit_value numeric(12,4),
    bogo_buy_qty integer,
    bogo_get_qty integer,
    bogo_get_discount_percent numeric(5,2),
    max_discount_amount numeric(12,2),
    max_units_per_order integer,
    max_uses_per_customer integer,
    scope_type "PromotionScopeType" DEFAULT 'all'::"PromotionScopeType" NOT NULL,
    scope_id uuid,
    min_qty numeric(12,3),
    min_spend numeric(12,2),
    min_spend_basis "PromotionMinSpendBasis",
    branch_id uuid,
    customer_id uuid,
    requires_coupon boolean DEFAULT false NOT NULL,
    return_policy "PromotionReturnPolicy",
    created_by uuid,
    submitted_by uuid,
    submitted_at timestamp(3) without time zone,
    approved_by uuid,
    approved_at timestamp(3) without time zone,
    scheduled_by uuid,
    scheduled_at timestamp(3) without time zone,
    activated_by uuid,
    activated_at timestamp(3) without time zone,
    paused_by uuid,
    paused_at timestamp(3) without time zone,
    resumed_by uuid,
    resumed_at timestamp(3) without time zone,
    ended_by uuid,
    ended_at timestamp(3) without time zone,
    cancelled_by uuid,
    cancelled_at timestamp(3) without time zone,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL
);

CREATE TABLE "PurchaseInvoice" (
    id uuid NOT NULL,
    supplier_id uuid NOT NULL,
    branch_id uuid NOT NULL,
    invoice_number text,
    invoice_date date,
    subtotal numeric(18,2) NOT NULL,
    discount_amount numeric(18,2) DEFAULT 0 NOT NULL,
    discount_percent numeric(5,2) DEFAULT 0 NOT NULL,
    total numeric(18,2) NOT NULL,
    ocr_source_file text,
    created_by uuid,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    normalized_invoice_number character varying(100),
    status "PurchaseInvoiceStatus" DEFAULT 'posted'::"PurchaseInvoiceStatus" NOT NULL,
    accounting_version integer DEFAULT 1 NOT NULL,
    idempotency_key character varying(191) NOT NULL,
    command_fingerprint character varying(64),
    received_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    reversal_idempotency_key character varying(191),
    reversal_command_fingerprint character varying(64),
    reversal_reason text,
    reversed_at timestamp(3) without time zone,
    reversed_by uuid,
    tenant_id uuid NOT NULL,
    CONSTRAINT "PurchaseInvoice_accounting_contract" CHECK (((accounting_version >= 1) AND (char_length((idempotency_key)::text) > 0) AND ((accounting_version = 1) OR ((char_length((command_fingerprint)::text) = 64) AND (total = (subtotal - discount_amount)))))),
    CONSTRAINT "PurchaseInvoice_nonnegative_amounts" CHECK (((subtotal >= (0)::numeric) AND (discount_amount >= (0)::numeric) AND (discount_amount <= subtotal) AND (total >= (0)::numeric))),
    CONSTRAINT "PurchaseInvoice_reversal_fields" CHECK ((((status = 'posted'::"PurchaseInvoiceStatus") AND (reversal_idempotency_key IS NULL) AND (reversal_command_fingerprint IS NULL) AND (reversed_at IS NULL) AND (reversed_by IS NULL) AND (reversal_reason IS NULL)) OR ((status = 'reversed'::"PurchaseInvoiceStatus") AND (reversal_idempotency_key IS NOT NULL) AND (reversal_command_fingerprint IS NOT NULL) AND (reversed_at IS NOT NULL) AND (reversal_reason IS NOT NULL))))
);

CREATE TABLE "PurchaseInvoiceItem" (
    id uuid NOT NULL,
    purchase_invoice_id uuid NOT NULL,
    variant_id uuid NOT NULL,
    qty integer NOT NULL,
    unit_cost numeric(18,6) NOT NULL,
    line_subtotal numeric(18,2),
    allocated_discount numeric(18,2),
    net_line_total numeric(18,2),
    net_unit_cost numeric(18,6),
    global_qty_before integer,
    global_qty_after integer,
    cost_before numeric(12,2),
    cost_after numeric(12,2),
    tenant_id uuid NOT NULL,
    CONSTRAINT "PurchaseInvoiceItem_cost_snapshot" CHECK ((((global_qty_before IS NULL) AND (global_qty_after IS NULL) AND (cost_before IS NULL) AND (cost_after IS NULL)) OR ((global_qty_before IS NOT NULL) AND (global_qty_after IS NOT NULL) AND (cost_before IS NOT NULL) AND (cost_after IS NOT NULL) AND (global_qty_before >= 0) AND (global_qty_after = (global_qty_before + qty))))),
    CONSTRAINT "PurchaseInvoiceItem_financial_snapshot" CHECK ((((line_subtotal IS NULL) AND (allocated_discount IS NULL) AND (net_line_total IS NULL) AND (net_unit_cost IS NULL)) OR ((line_subtotal IS NOT NULL) AND (allocated_discount IS NOT NULL) AND (net_line_total IS NOT NULL) AND (net_unit_cost IS NOT NULL) AND (allocated_discount <= line_subtotal) AND (net_line_total = (line_subtotal - allocated_discount))))),
    CONSTRAINT "PurchaseInvoiceItem_nonnegative_costs" CHECK (((unit_cost >= (0)::numeric) AND ((line_subtotal IS NULL) OR (line_subtotal >= (0)::numeric)) AND ((allocated_discount IS NULL) OR (allocated_discount >= (0)::numeric)) AND ((net_line_total IS NULL) OR (net_line_total >= (0)::numeric)) AND ((net_unit_cost IS NULL) OR (net_unit_cost >= (0)::numeric)) AND ((cost_before IS NULL) OR (cost_before >= (0)::numeric)) AND ((cost_after IS NULL) OR (cost_after >= (0)::numeric)))),
    CONSTRAINT "PurchaseInvoiceItem_positive_qty" CHECK ((qty > 0))
);

CREATE TABLE "RefreshToken" (
    id uuid NOT NULL,
    user_id uuid NOT NULL,
    token_hash text NOT NULL,
    expires_at timestamp(3) without time zone NOT NULL,
    revoked_at timestamp(3) without time zone,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE TABLE "Return" (
    id uuid NOT NULL,
    original_invoice_id uuid NOT NULL,
    new_invoice_id uuid,
    return_invoice_number text NOT NULL,
    reason text,
    is_partial boolean DEFAULT false NOT NULL,
    created_by uuid,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    branch_id uuid NOT NULL,
    refund_subtotal numeric(12,2) DEFAULT 0 NOT NULL,
    refund_tax numeric(12,2) DEFAULT 0 NOT NULL,
    refund_total numeric(12,2) DEFAULT 0 NOT NULL,
    status "ReturnStatus" DEFAULT 'completed'::"ReturnStatus" NOT NULL,
    shift_id uuid,
    tenant_id uuid NOT NULL
);

CREATE TABLE "ReturnItem" (
    id uuid NOT NULL,
    return_id uuid NOT NULL,
    sales_invoice_item_id uuid NOT NULL,
    variant_id uuid NOT NULL,
    qty integer NOT NULL,
    unit_price numeric(12,2) NOT NULL,
    unit_cost numeric(12,2) NOT NULL,
    unit_tax numeric(12,2) NOT NULL,
    tenant_id uuid NOT NULL,
    CONSTRAINT "ReturnItem_qty_positive" CHECK ((qty > 0))
);

CREATE TABLE "SalesInvoice" (
    id uuid NOT NULL,
    invoice_number text NOT NULL,
    branch_id uuid NOT NULL,
    customer_id uuid,
    cashier_id uuid,
    status text DEFAULT 'completed'::text NOT NULL,
    subtotal numeric(12,2) NOT NULL,
    discount_amount numeric(12,2) DEFAULT 0 NOT NULL,
    tax_amount numeric(12,2) NOT NULL,
    total numeric(12,2) NOT NULL,
    payment_method text NOT NULL,
    language text DEFAULT 'ar'::text NOT NULL,
    sync_id uuid,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    terminal_id uuid,
    received_by uuid,
    shift_id uuid,
    offline_session_id uuid,
    terminal_sequence bigint,
    command_fingerprint character varying(64),
    occurred_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    received_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    seller_id uuid,
    event_version integer DEFAULT 1 NOT NULL,
    warning_codes text[] DEFAULT ARRAY[]::text[] NOT NULL,
    cashier_name_snapshot character varying(200),
    seller_name_snapshot character varying(200),
    tenant_id uuid NOT NULL,
    CONSTRAINT "SalesInvoice_command_fingerprint_format" CHECK (((command_fingerprint IS NULL) OR ((command_fingerprint)::text ~ '^[0-9a-f]{64}$'::text))),
    CONSTRAINT "SalesInvoice_offline_accounting_context_complete" CHECK ((((terminal_sequence IS NULL) AND (shift_id IS NULL) AND (offline_session_id IS NULL) AND (command_fingerprint IS NULL)) OR ((terminal_id IS NOT NULL) AND (terminal_sequence IS NOT NULL) AND (shift_id IS NOT NULL) AND (offline_session_id IS NOT NULL) AND (cashier_id IS NOT NULL) AND (received_by IS NOT NULL) AND (command_fingerprint IS NOT NULL)))),
    CONSTRAINT "SalesInvoice_terminal_sequence_positive" CHECK (((terminal_sequence IS NULL) OR (terminal_sequence > 0)))
);

CREATE TABLE "SalesInvoiceItem" (
    id uuid NOT NULL,
    sales_invoice_id uuid NOT NULL,
    variant_id uuid NOT NULL,
    qty integer NOT NULL,
    unit_price numeric(12,2) NOT NULL,
    unit_cost numeric(12,2) NOT NULL,
    unit_tax numeric(12,2) DEFAULT 0 NOT NULL,
    sku_snapshot character varying(191),
    name_ar_snapshot character varying(300),
    name_en_snapshot character varying(300),
    size_snapshot character varying(100),
    color_snapshot character varying(100),
    tenant_id uuid NOT NULL
);

CREATE TABLE "SalesTaxSnapshot" (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    sales_invoice_id uuid NOT NULL,
    sales_invoice_item_id uuid NOT NULL,
    tax_code_id uuid NOT NULL,
    code_snapshot text NOT NULL,
    rate_snapshot numeric(7,4) NOT NULL,
    base_amount numeric(12,2) NOT NULL,
    tax_amount numeric(12,2) NOT NULL,
    mode_snapshot "TaxMode" NOT NULL,
    version_snapshot integer NOT NULL,
    rounding_policy_snapshot "TaxRoundingPolicy" NOT NULL,
    exemption_id uuid,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE TABLE "SellerCommissionOverride" (
    seller_id uuid NOT NULL,
    rate numeric(5,2),
    target numeric(12,2),
    bonus numeric(12,2),
    updated_at timestamp(3) without time zone NOT NULL,
    tenant_id uuid NOT NULL,
    CONSTRAINT "SellerCommissionOverride_rate_check" CHECK (((rate IS NULL) OR ((rate >= (0)::numeric) AND (rate <= (100)::numeric))))
);

CREATE TABLE "SellerCommissionPeriod" (
    id uuid NOT NULL,
    period_start timestamp(3) without time zone NOT NULL,
    period_end_exclusive timestamp(3) without time zone NOT NULL,
    period_length_days integer NOT NULL,
    default_rate numeric(5,2) NOT NULL,
    default_target numeric(12,2),
    default_bonus numeric(12,2) NOT NULL,
    closed_by uuid NOT NULL,
    closed_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    tenant_id uuid NOT NULL,
    CONSTRAINT "SellerCommissionPeriod_range_check" CHECK ((period_start < period_end_exclusive))
);

CREATE TABLE "SellerCommissionPeriodRow" (
    period_id uuid NOT NULL,
    seller_id uuid NOT NULL,
    seller_name text NOT NULL,
    branch_id uuid,
    branch_name text,
    invoice_count integer NOT NULL,
    gross_sales_before_tax numeric(12,2) NOT NULL,
    return_count integer NOT NULL,
    returns_before_tax numeric(12,2) NOT NULL,
    net_sales_before_tax numeric(12,2) NOT NULL,
    commission_rate numeric(5,2) NOT NULL,
    percentage_commission numeric(12,2) NOT NULL,
    target numeric(12,2),
    target_achieved boolean NOT NULL,
    target_bonus numeric(12,2) NOT NULL,
    estimated_total numeric(12,2) NOT NULL,
    tenant_id uuid NOT NULL
);

CREATE TABLE "SellerCommissionSettings" (
    id integer DEFAULT 1 NOT NULL,
    default_rate numeric(5,2) DEFAULT 0 NOT NULL,
    default_target numeric(12,2),
    default_bonus numeric(12,2) DEFAULT 0 NOT NULL,
    period_length_days integer DEFAULT 30 NOT NULL,
    period_anchor timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL,
    tenant_id uuid NOT NULL,
    CONSTRAINT "SellerCommissionSettings_period_check" CHECK (((period_length_days >= 1) AND (period_length_days <= 366))),
    CONSTRAINT "SellerCommissionSettings_rate_check" CHECK (((default_rate >= (0)::numeric) AND (default_rate <= (100)::numeric))),
    CONSTRAINT "SellerCommissionSettings_singleton_check" CHECK ((id = 1))
);

CREATE TABLE "Shift" (
    id uuid NOT NULL,
    branch_id uuid NOT NULL,
    opened_by uuid NOT NULL,
    closed_by uuid,
    opening_cash numeric(12,2) DEFAULT 0 NOT NULL,
    closing_cash numeric(12,2),
    expected_cash numeric(12,2),
    difference numeric(12,2),
    opened_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    closed_at timestamp(3) without time zone,
    status text DEFAULT 'open'::text NOT NULL,
    notes text,
    tenant_id uuid NOT NULL
);

CREATE TABLE "Supplier" (
    id uuid NOT NULL,
    name text NOT NULL,
    company_name text,
    phone text,
    alias_names text[],
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    tenant_id uuid NOT NULL
);

CREATE TABLE "SupplierReturn" (
    id uuid NOT NULL,
    purchase_invoice_id uuid NOT NULL,
    supplier_id uuid NOT NULL,
    branch_id uuid NOT NULL,
    return_number character varying(100) NOT NULL,
    status "SupplierReturnStatus" DEFAULT 'posted'::"SupplierReturnStatus" NOT NULL,
    idempotency_key character varying(191) NOT NULL,
    command_fingerprint character varying(64) NOT NULL,
    reason text NOT NULL,
    credit_total numeric(18,2) NOT NULL,
    inventory_value_removed numeric(18,2) NOT NULL,
    purchase_price_variance numeric(18,2) NOT NULL,
    occurred_at timestamp(3) without time zone NOT NULL,
    created_by uuid,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    tenant_id uuid NOT NULL,
    CONSTRAINT "SupplierReturn_accounting_contract" CHECK (((char_length((idempotency_key)::text) > 0) AND (char_length((command_fingerprint)::text) = 64) AND (purchase_price_variance = (credit_total - inventory_value_removed)))),
    CONSTRAINT "SupplierReturn_nonnegative_values" CHECK (((credit_total >= (0)::numeric) AND (inventory_value_removed >= (0)::numeric)))
);

CREATE TABLE "SupplierReturnItem" (
    id uuid NOT NULL,
    supplier_return_id uuid NOT NULL,
    purchase_invoice_item_id uuid NOT NULL,
    variant_id uuid NOT NULL,
    qty integer NOT NULL,
    credit_unit_cost numeric(18,6) NOT NULL,
    credit_total numeric(18,2) NOT NULL,
    inventory_unit_cost numeric(12,2) NOT NULL,
    inventory_value_removed numeric(18,2) NOT NULL,
    purchase_price_variance numeric(18,2) NOT NULL,
    tenant_id uuid NOT NULL,
    CONSTRAINT "SupplierReturnItem_accounting_contract" CHECK ((purchase_price_variance = (credit_total - inventory_value_removed))),
    CONSTRAINT "SupplierReturnItem_nonnegative_values" CHECK (((credit_unit_cost >= (0)::numeric) AND (credit_total >= (0)::numeric) AND (inventory_unit_cost >= (0)::numeric) AND (inventory_value_removed >= (0)::numeric))),
    CONSTRAINT "SupplierReturnItem_positive_qty" CHECK ((qty > 0))
);

CREATE TABLE "SupportAccessGrant" (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    operator_identity_id uuid NOT NULL,
    mode "SupportAccessMode" NOT NULL,
    purpose text NOT NULL,
    scopes jsonb NOT NULL,
    read_only boolean DEFAULT true NOT NULL,
    approved_by_identity_id uuid,
    consent_obtained boolean DEFAULT false NOT NULL,
    starts_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    expires_at timestamp(3) without time zone NOT NULL,
    revoked_at timestamp(3) without time zone,
    revoked_reason text,
    reason text NOT NULL,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE TABLE "SyncChange" (
    sequence bigint NOT NULL,
    kind text NOT NULL,
    branch_id uuid,
    entity_key text,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    tenant_id uuid NOT NULL
);

CREATE TABLE "TaxCategory" (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    code text NOT NULL,
    name_en text NOT NULL,
    name_ar text,
    description text,
    is_active boolean DEFAULT true NOT NULL,
    created_by uuid,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL
);

CREATE TABLE "TaxCode" (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    tax_category_id uuid NOT NULL,
    code text NOT NULL,
    name_en text NOT NULL,
    name_ar text,
    jurisdiction text DEFAULT 'EG'::text NOT NULL,
    calculation_method "TaxCalculationMethod" DEFAULT 'percentage'::"TaxCalculationMethod" NOT NULL,
    rate numeric(7,4) NOT NULL,
    tax_mode "TaxMode" NOT NULL,
    rounding_policy "TaxRoundingPolicy" DEFAULT 'line'::"TaxRoundingPolicy" NOT NULL,
    exemption_allowed boolean DEFAULT false NOT NULL,
    effective_from timestamp(3) without time zone,
    effective_to timestamp(3) without time zone,
    version integer DEFAULT 1 NOT NULL,
    status "TaxCodeStatus" DEFAULT 'draft'::"TaxCodeStatus" NOT NULL,
    supersedes_id uuid,
    superseded_at timestamp(3) without time zone,
    superseded_by_id uuid,
    created_by uuid,
    submitted_by uuid,
    submitted_at timestamp(3) without time zone,
    approved_by uuid,
    approved_at timestamp(3) without time zone,
    scheduled_by uuid,
    scheduled_at timestamp(3) without time zone,
    activated_by uuid,
    activated_at timestamp(3) without time zone,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL
);

CREATE TABLE "TaxExemption" (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    customer_id uuid NOT NULL,
    tax_category_id uuid,
    status "TaxExemptionStatus" DEFAULT 'pending'::"TaxExemptionStatus" NOT NULL,
    reason text NOT NULL,
    evidence_reference text NOT NULL,
    evidence_issued_at timestamp(3) without time zone NOT NULL,
    expires_at timestamp(3) without time zone,
    applied_by uuid NOT NULL,
    approved_by uuid,
    approved_at timestamp(3) without time zone,
    revoked_by uuid,
    revoked_at timestamp(3) without time zone,
    revoked_reason text,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL
);

CREATE TABLE "Tenant" (
    id uuid NOT NULL,
    name text NOT NULL,
    access_mode "TenantAccessMode" DEFAULT 'active'::"TenantAccessMode" NOT NULL,
    default_locale text DEFAULT 'ar'::text NOT NULL,
    default_timezone text DEFAULT 'Africa/Cairo'::text NOT NULL,
    default_currency text DEFAULT 'EGP'::text NOT NULL,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL
);

CREATE TABLE "Transfer" (
    id uuid NOT NULL,
    from_branch_id uuid NOT NULL,
    to_branch_id uuid NOT NULL,
    status "TransferStatus" DEFAULT 'pending'::"TransferStatus" NOT NULL,
    transfer_number text NOT NULL,
    created_by uuid,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    shipped_by uuid,
    shipped_at timestamp(3) without time zone,
    received_by uuid,
    received_at timestamp(3) without time zone,
    idempotency_key character varying(191),
    command_fingerprint character varying(64),
    cancelled_by uuid,
    cancelled_at timestamp(3) without time zone,
    cancellation_reason character varying(500),
    updated_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    tenant_id uuid NOT NULL,
    CONSTRAINT "Transfer_cancellation_fields" CHECK ((((status = 'cancelled'::"TransferStatus") AND (cancelled_at IS NOT NULL) AND (cancellation_reason IS NOT NULL) AND (char_length(btrim((cancellation_reason)::text)) > 0)) OR ((status <> 'cancelled'::"TransferStatus") AND (cancelled_by IS NULL) AND (cancelled_at IS NULL) AND (cancellation_reason IS NULL)))),
    CONSTRAINT "Transfer_creation_identity" CHECK ((((idempotency_key IS NULL) AND (command_fingerprint IS NULL)) OR ((idempotency_key IS NOT NULL) AND (char_length((idempotency_key)::text) > 0) AND (char_length((command_fingerprint)::text) = 64)))),
    CONSTRAINT "Transfer_distinct_branches" CHECK ((from_branch_id <> to_branch_id))
);

CREATE TABLE "TransferCommand" (
    id uuid NOT NULL,
    transfer_id uuid NOT NULL,
    command_type "TransferCommandType" NOT NULL,
    idempotency_key character varying(191) NOT NULL,
    command_fingerprint character varying(64) NOT NULL,
    result_status character varying(32) NOT NULL,
    created_by uuid,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    tenant_id uuid NOT NULL,
    CONSTRAINT "TransferCommand_identity_contract" CHECK (((char_length((idempotency_key)::text) > 0) AND (char_length((command_fingerprint)::text) = 64) AND (char_length((result_status)::text) > 0)))
);

CREATE TABLE "TransferItem" (
    id uuid NOT NULL,
    transfer_id uuid NOT NULL,
    variant_id uuid NOT NULL,
    qty integer NOT NULL,
    shipped_qty integer DEFAULT 0 NOT NULL,
    received_qty integer DEFAULT 0 NOT NULL,
    damaged_qty integer DEFAULT 0 NOT NULL,
    missing_qty integer DEFAULT 0 NOT NULL,
    tenant_id uuid NOT NULL,
    CONSTRAINT "TransferItem_qty_positive" CHECK ((qty > 0)),
    CONSTRAINT "TransferItem_resolution_nonnegative" CHECK (((received_qty >= 0) AND (damaged_qty >= 0) AND (missing_qty >= 0))),
    CONSTRAINT "TransferItem_resolution_not_above_shipped" CHECK ((((received_qty + damaged_qty) + missing_qty) <= shipped_qty)),
    CONSTRAINT "TransferItem_shipped_qty_range" CHECK (((shipped_qty >= 0) AND (shipped_qty <= qty)))
);

CREATE TABLE "TransferTransitMovement" (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    sequence bigint NOT NULL,
    transfer_id uuid NOT NULL,
    transfer_item_id uuid NOT NULL,
    variant_id uuid NOT NULL,
    movement_type "TransferTransitMovementType" NOT NULL,
    quantity_delta integer NOT NULL,
    in_transit_after integer NOT NULL,
    idempotency_key character varying(191) NOT NULL,
    occurred_at timestamp(3) without time zone NOT NULL,
    recorded_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    created_by uuid,
    metadata jsonb,
    tenant_id uuid NOT NULL,
    CONSTRAINT "TransferTransitMovement_identity_contract" CHECK ((char_length((idempotency_key)::text) > 0)),
    CONSTRAINT "TransferTransitMovement_nonnegative_balance" CHECK ((in_transit_after >= 0)),
    CONSTRAINT "TransferTransitMovement_nonzero_delta" CHECK ((quantity_delta <> 0))
);

CREATE TABLE "UnitOfMeasure" (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    code text NOT NULL,
    name_en text NOT NULL,
    name_ar text,
    kind "UomKind" DEFAULT 'base'::"UomKind" NOT NULL,
    "precision" integer DEFAULT 0 NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL
);

CREATE TABLE "UomConversion" (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    from_uom_id uuid NOT NULL,
    to_uom_id uuid NOT NULL,
    factor numeric(18,6) NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    status "UomConversionStatus" DEFAULT 'active'::"UomConversionStatus" NOT NULL,
    superseded_by_id uuid,
    superseded_at timestamp(3) without time zone,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT "UomConversion_factor_positive" CHECK ((factor > (0)::numeric))
);

CREATE TABLE "User" (
    id uuid NOT NULL,
    branch_id uuid,
    name text NOT NULL,
    phone text,
    email text,
    password_hash text NOT NULL,
    role "Role" NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    granted_capabilities text[] DEFAULT ARRAY[]::text[] NOT NULL,
    revoked_capabilities text[] DEFAULT ARRAY[]::text[] NOT NULL
);

CREATE TABLE "Warehouse" (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    location_id uuid,
    name text NOT NULL,
    is_default boolean DEFAULT false NOT NULL,
    is_centralized boolean DEFAULT false NOT NULL,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL
);

-- ======================================================================
-- Sequences
-- ======================================================================

CREATE SEQUENCE "InventoryCostMovement_sequence_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

CREATE SEQUENCE "InventoryMovement_sequence_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

CREATE SEQUENCE "SyncChange_sequence_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

CREATE SEQUENCE "TransferNumberSequence"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

CREATE SEQUENCE "TransferTransitMovement_sequence_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

-- ======================================================================
-- Sequence ownership
-- ======================================================================

ALTER SEQUENCE "InventoryCostMovement_sequence_seq" OWNED BY "InventoryCostMovement".sequence;

ALTER SEQUENCE "InventoryMovement_sequence_seq" OWNED BY "InventoryMovement".sequence;

ALTER SEQUENCE "SyncChange_sequence_seq" OWNED BY "SyncChange".sequence;

ALTER SEQUENCE "TransferTransitMovement_sequence_seq" OWNED BY "TransferTransitMovement".sequence;

-- ======================================================================
-- Column defaults
-- ======================================================================

ALTER TABLE ONLY "InventoryCostMovement" ALTER COLUMN sequence SET DEFAULT nextval('"InventoryCostMovement_sequence_seq"'::regclass);

ALTER TABLE ONLY "InventoryMovement" ALTER COLUMN sequence SET DEFAULT nextval('"InventoryMovement_sequence_seq"'::regclass);

ALTER TABLE ONLY "SyncChange" ALTER COLUMN sequence SET DEFAULT nextval('"SyncChange_sequence_seq"'::regclass);

ALTER TABLE ONLY "TransferTransitMovement" ALTER COLUMN sequence SET DEFAULT nextval('"TransferTransitMovement_sequence_seq"'::regclass);

-- ======================================================================
-- Primary keys and unique constraints
-- ======================================================================

ALTER TABLE ONLY "AccessScopeAssignment"
    ADD CONSTRAINT "AccessScopeAssignment_pkey" PRIMARY KEY (id);

ALTER TABLE ONLY "Assortment"
    ADD CONSTRAINT "Assortment_pkey" PRIMARY KEY (id);

ALTER TABLE ONLY "AuditLog"
    ADD CONSTRAINT "AuditLog_pkey" PRIMARY KEY (id);

ALTER TABLE ONLY "Branch"
    ADD CONSTRAINT "Branch_pkey" PRIMARY KEY (id);

ALTER TABLE ONLY "Branch"
    ADD CONSTRAINT "Branch_tenant_id_id_key" UNIQUE (tenant_id, id);

ALTER TABLE ONLY "Brand"
    ADD CONSTRAINT "Brand_pkey" PRIMARY KEY (id);

ALTER TABLE ONLY "BundleComponent"
    ADD CONSTRAINT "BundleComponent_pkey" PRIMARY KEY (id);

ALTER TABLE ONLY "Bundle"
    ADD CONSTRAINT "Bundle_pkey" PRIMARY KEY (id);

ALTER TABLE ONLY "Category"
    ADD CONSTRAINT "Category_pkey" PRIMARY KEY (id);

ALTER TABLE ONLY "Category"
    ADD CONSTRAINT "Category_tenant_id_id_key" UNIQUE (tenant_id, id);

ALTER TABLE ONLY "CouponRedemption"
    ADD CONSTRAINT "CouponRedemption_pkey" PRIMARY KEY (id);

ALTER TABLE ONLY "Coupon"
    ADD CONSTRAINT "Coupon_pkey" PRIMARY KEY (id);

ALTER TABLE ONLY "Customer"
    ADD CONSTRAINT "Customer_pkey" PRIMARY KEY (id);

ALTER TABLE ONLY "Customer"
    ADD CONSTRAINT "Customer_tenant_id_id_key" UNIQUE (tenant_id, id);

ALTER TABLE ONLY "Discount"
    ADD CONSTRAINT "Discount_pkey" PRIMARY KEY (id);

ALTER TABLE ONLY "InventoryCostMovement"
    ADD CONSTRAINT "InventoryCostMovement_pkey" PRIMARY KEY (id);

ALTER TABLE ONLY "InventoryMovement"
    ADD CONSTRAINT "InventoryMovement_idempotency_key_key" UNIQUE (idempotency_key);

ALTER TABLE ONLY "InventoryMovement"
    ADD CONSTRAINT "InventoryMovement_pkey" PRIMARY KEY (id);

ALTER TABLE ONLY "InventoryStock"
    ADD CONSTRAINT "InventoryStock_pkey" PRIMARY KEY (branch_id, variant_id);

ALTER TABLE ONLY "Invitation"
    ADD CONSTRAINT "Invitation_pkey" PRIMARY KEY (id);

ALTER TABLE ONLY "LegalEntity"
    ADD CONSTRAINT "LegalEntity_pkey" PRIMARY KEY (id);

ALTER TABLE ONLY "Location"
    ADD CONSTRAINT "Location_pkey" PRIMARY KEY (id);

ALTER TABLE ONLY "Membership"
    ADD CONSTRAINT "Membership_pkey" PRIMARY KEY (id);

ALTER TABLE ONLY "OfferSuggestion"
    ADD CONSTRAINT "OfferSuggestion_pkey" PRIMARY KEY (id);

ALTER TABLE ONLY "OrganizationProfile"
    ADD CONSTRAINT "OrganizationProfile_pkey" PRIMARY KEY (id);

ALTER TABLE ONLY "PermissionPolicySnapshot"
    ADD CONSTRAINT "PermissionPolicySnapshot_pkey" PRIMARY KEY (id);

ALTER TABLE ONLY "PosTerminalEnrollment"
    ADD CONSTRAINT "PosTerminalEnrollment_pkey" PRIMARY KEY (id);

ALTER TABLE ONLY "PosTerminal"
    ADD CONSTRAINT "PosTerminal_pkey" PRIMARY KEY (id);

ALTER TABLE ONLY "PosTerminal"
    ADD CONSTRAINT "PosTerminal_tenant_id_id_key" UNIQUE (tenant_id, id);

ALTER TABLE ONLY "PriceBookEntry"
    ADD CONSTRAINT "PriceBookEntry_pkey" PRIMARY KEY (id);

ALTER TABLE ONLY "PriceBook"
    ADD CONSTRAINT "PriceBook_pkey" PRIMARY KEY (id);

ALTER TABLE ONLY "PriceOverridePolicy"
    ADD CONSTRAINT "PriceOverridePolicy_pkey" PRIMARY KEY (id);

ALTER TABLE ONLY "PriceOverride"
    ADD CONSTRAINT "PriceOverride_pkey" PRIMARY KEY (id);

ALTER TABLE ONLY "PricingRule"
    ADD CONSTRAINT "PricingRule_pkey" PRIMARY KEY (id);

ALTER TABLE ONLY "ProductVariant"
    ADD CONSTRAINT "ProductVariant_pkey" PRIMARY KEY (id);

ALTER TABLE ONLY "ProductVariant"
    ADD CONSTRAINT "ProductVariant_tenant_id_id_key" UNIQUE (tenant_id, id);

ALTER TABLE ONLY "Product"
    ADD CONSTRAINT "Product_pkey" PRIMARY KEY (id);

ALTER TABLE ONLY "Product"
    ADD CONSTRAINT "Product_tenant_id_id_key" UNIQUE (tenant_id, id);

ALTER TABLE ONLY "Promotion"
    ADD CONSTRAINT "Promotion_pkey" PRIMARY KEY (id);

ALTER TABLE ONLY "PurchaseInvoiceItem"
    ADD CONSTRAINT "PurchaseInvoiceItem_pkey" PRIMARY KEY (id);

ALTER TABLE ONLY "PurchaseInvoiceItem"
    ADD CONSTRAINT "PurchaseInvoiceItem_tenant_id_id_key" UNIQUE (tenant_id, id);

ALTER TABLE ONLY "PurchaseInvoice"
    ADD CONSTRAINT "PurchaseInvoice_pkey" PRIMARY KEY (id);

ALTER TABLE ONLY "PurchaseInvoice"
    ADD CONSTRAINT "PurchaseInvoice_tenant_id_id_key" UNIQUE (tenant_id, id);

ALTER TABLE ONLY "RefreshToken"
    ADD CONSTRAINT "RefreshToken_pkey" PRIMARY KEY (id);

ALTER TABLE ONLY "ReturnItem"
    ADD CONSTRAINT "ReturnItem_pkey" PRIMARY KEY (id);

ALTER TABLE ONLY "Return"
    ADD CONSTRAINT "Return_pkey" PRIMARY KEY (id);

ALTER TABLE ONLY "Return"
    ADD CONSTRAINT "Return_tenant_id_id_key" UNIQUE (tenant_id, id);

ALTER TABLE ONLY "SalesInvoiceItem"
    ADD CONSTRAINT "SalesInvoiceItem_pkey" PRIMARY KEY (id);

ALTER TABLE ONLY "SalesInvoiceItem"
    ADD CONSTRAINT "SalesInvoiceItem_tenant_id_id_key" UNIQUE (tenant_id, id);

ALTER TABLE ONLY "SalesInvoice"
    ADD CONSTRAINT "SalesInvoice_pkey" PRIMARY KEY (id);

ALTER TABLE ONLY "SalesInvoice"
    ADD CONSTRAINT "SalesInvoice_tenant_id_id_key" UNIQUE (tenant_id, id);

ALTER TABLE ONLY "SalesTaxSnapshot"
    ADD CONSTRAINT "SalesTaxSnapshot_pkey" PRIMARY KEY (id);

ALTER TABLE ONLY "SellerCommissionOverride"
    ADD CONSTRAINT "SellerCommissionOverride_pkey" PRIMARY KEY (seller_id);

ALTER TABLE ONLY "SellerCommissionPeriodRow"
    ADD CONSTRAINT "SellerCommissionPeriodRow_pkey" PRIMARY KEY (period_id, seller_id);

ALTER TABLE ONLY "SellerCommissionPeriod"
    ADD CONSTRAINT "SellerCommissionPeriod_pkey" PRIMARY KEY (id);

ALTER TABLE ONLY "SellerCommissionPeriod"
    ADD CONSTRAINT "SellerCommissionPeriod_tenant_id_id_key" UNIQUE (tenant_id, id);

ALTER TABLE ONLY "SellerCommissionSettings"
    ADD CONSTRAINT "SellerCommissionSettings_pkey" PRIMARY KEY (id);

ALTER TABLE ONLY "Shift"
    ADD CONSTRAINT "Shift_pkey" PRIMARY KEY (id);

ALTER TABLE ONLY "Shift"
    ADD CONSTRAINT "Shift_tenant_id_id_key" UNIQUE (tenant_id, id);

ALTER TABLE ONLY "SupplierReturnItem"
    ADD CONSTRAINT "SupplierReturnItem_pkey" PRIMARY KEY (id);

ALTER TABLE ONLY "SupplierReturnItem"
    ADD CONSTRAINT "SupplierReturnItem_tenant_id_id_key" UNIQUE (tenant_id, id);

ALTER TABLE ONLY "SupplierReturn"
    ADD CONSTRAINT "SupplierReturn_pkey" PRIMARY KEY (id);

ALTER TABLE ONLY "SupplierReturn"
    ADD CONSTRAINT "SupplierReturn_tenant_id_id_key" UNIQUE (tenant_id, id);

ALTER TABLE ONLY "Supplier"
    ADD CONSTRAINT "Supplier_pkey" PRIMARY KEY (id);

ALTER TABLE ONLY "Supplier"
    ADD CONSTRAINT "Supplier_tenant_id_id_key" UNIQUE (tenant_id, id);

ALTER TABLE ONLY "SupportAccessGrant"
    ADD CONSTRAINT "SupportAccessGrant_pkey" PRIMARY KEY (id);

ALTER TABLE ONLY "SyncChange"
    ADD CONSTRAINT "SyncChange_pkey" PRIMARY KEY (sequence);

ALTER TABLE ONLY "TaxCategory"
    ADD CONSTRAINT "TaxCategory_pkey" PRIMARY KEY (id);

ALTER TABLE ONLY "TaxCode"
    ADD CONSTRAINT "TaxCode_pkey" PRIMARY KEY (id);

ALTER TABLE ONLY "TaxExemption"
    ADD CONSTRAINT "TaxExemption_pkey" PRIMARY KEY (id);

ALTER TABLE ONLY "Tenant"
    ADD CONSTRAINT "Tenant_pkey" PRIMARY KEY (id);

ALTER TABLE ONLY "TransferCommand"
    ADD CONSTRAINT "TransferCommand_idempotency_key_key" UNIQUE (idempotency_key);

ALTER TABLE ONLY "TransferCommand"
    ADD CONSTRAINT "TransferCommand_pkey" PRIMARY KEY (id);

ALTER TABLE ONLY "TransferItem"
    ADD CONSTRAINT "TransferItem_pkey" PRIMARY KEY (id);

ALTER TABLE ONLY "TransferItem"
    ADD CONSTRAINT "TransferItem_tenant_id_id_key" UNIQUE (tenant_id, id);

ALTER TABLE ONLY "TransferTransitMovement"
    ADD CONSTRAINT "TransferTransitMovement_idempotency_key_key" UNIQUE (idempotency_key);

ALTER TABLE ONLY "TransferTransitMovement"
    ADD CONSTRAINT "TransferTransitMovement_pkey" PRIMARY KEY (id);

ALTER TABLE ONLY "TransferTransitMovement"
    ADD CONSTRAINT "TransferTransitMovement_sequence_key" UNIQUE (sequence);

ALTER TABLE ONLY "Transfer"
    ADD CONSTRAINT "Transfer_pkey" PRIMARY KEY (id);

ALTER TABLE ONLY "Transfer"
    ADD CONSTRAINT "Transfer_tenant_id_id_key" UNIQUE (tenant_id, id);

ALTER TABLE ONLY "UnitOfMeasure"
    ADD CONSTRAINT "UnitOfMeasure_pkey" PRIMARY KEY (id);

ALTER TABLE ONLY "UomConversion"
    ADD CONSTRAINT "UomConversion_pkey" PRIMARY KEY (id);

ALTER TABLE ONLY "User"
    ADD CONSTRAINT "User_pkey" PRIMARY KEY (id);

ALTER TABLE ONLY "Warehouse"
    ADD CONSTRAINT "Warehouse_pkey" PRIMARY KEY (id);

-- ======================================================================
-- Indexes
-- ======================================================================

CREATE INDEX "AccessScopeAssignment_membership_id_idx" ON "AccessScopeAssignment" USING btree (membership_id);

CREATE INDEX "Assortment_branch_id_idx" ON "Assortment" USING btree (branch_id);

CREATE UNIQUE INDEX "Assortment_tenant_id_branch_id_variant_id_key" ON "Assortment" USING btree (tenant_id, branch_id, variant_id);

CREATE UNIQUE INDEX "Assortment_tenant_id_id_key" ON "Assortment" USING btree (tenant_id, id);

CREATE INDEX "Assortment_tenant_id_idx" ON "Assortment" USING btree (tenant_id);

CREATE INDEX "Assortment_variant_id_idx" ON "Assortment" USING btree (variant_id);

CREATE INDEX "AuditLog_tenant_id_idx" ON "AuditLog" USING btree (tenant_id);

CREATE UNIQUE INDEX "Branch_tenant_id_code_key" ON "Branch" USING btree (tenant_id, code);

CREATE INDEX "Branch_tenant_id_idx" ON "Branch" USING btree (tenant_id);

CREATE UNIQUE INDEX "Brand_tenant_id_id_key" ON "Brand" USING btree (tenant_id, id);

CREATE INDEX "Brand_tenant_id_idx" ON "Brand" USING btree (tenant_id);

CREATE UNIQUE INDEX "Brand_tenant_id_name_key" ON "Brand" USING btree (tenant_id, name);

CREATE INDEX "BundleComponent_tenant_id_bundle_id_idx" ON "BundleComponent" USING btree (tenant_id, bundle_id);

CREATE UNIQUE INDEX "BundleComponent_tenant_id_id_key" ON "BundleComponent" USING btree (tenant_id, id);

CREATE INDEX "BundleComponent_tenant_id_idx" ON "BundleComponent" USING btree (tenant_id);

CREATE UNIQUE INDEX "Bundle_tenant_id_id_key" ON "Bundle" USING btree (tenant_id, id);

CREATE INDEX "Bundle_tenant_id_idx" ON "Bundle" USING btree (tenant_id);

CREATE INDEX "Bundle_tenant_id_status_idx" ON "Bundle" USING btree (tenant_id, status);

CREATE INDEX "Category_tenant_id_idx" ON "Category" USING btree (tenant_id);

CREATE UNIQUE INDEX "CouponRedemption_tenant_id_coupon_id_idempotency_key_key" ON "CouponRedemption" USING btree (tenant_id, coupon_id, idempotency_key);

CREATE INDEX "CouponRedemption_tenant_id_coupon_id_idx" ON "CouponRedemption" USING btree (tenant_id, coupon_id);

CREATE UNIQUE INDEX "CouponRedemption_tenant_id_id_key" ON "CouponRedemption" USING btree (tenant_id, id);

CREATE INDEX "CouponRedemption_tenant_id_idx" ON "CouponRedemption" USING btree (tenant_id);

CREATE UNIQUE INDEX "Coupon_tenant_id_code_normalized_key" ON "Coupon" USING btree (tenant_id, code_normalized);

CREATE UNIQUE INDEX "Coupon_tenant_id_id_key" ON "Coupon" USING btree (tenant_id, id);

CREATE INDEX "Coupon_tenant_id_idx" ON "Coupon" USING btree (tenant_id);

CREATE INDEX "Coupon_tenant_id_promotion_id_idx" ON "Coupon" USING btree (tenant_id, promotion_id);

CREATE INDEX "Customer_name_trgm_idx" ON "Customer" USING gin (name gin_trgm_ops);

CREATE INDEX "Customer_tenant_id_idx" ON "Customer" USING btree (tenant_id);

CREATE UNIQUE INDEX "Customer_tenant_id_phone_key" ON "Customer" USING btree (tenant_id, phone);

CREATE UNIQUE INDEX "Discount_tenant_id_id_key" ON "Discount" USING btree (tenant_id, id);

CREATE INDEX "Discount_tenant_id_idx" ON "Discount" USING btree (tenant_id);

CREATE INDEX "Discount_tenant_id_variant_id_idx" ON "Discount" USING btree (tenant_id, variant_id);

CREATE INDEX "InventoryCostMovement_branch_occurred_at_idx" ON "InventoryCostMovement" USING btree (branch_id, occurred_at);

CREATE INDEX "InventoryCostMovement_created_by_occurred_at_idx" ON "InventoryCostMovement" USING btree (created_by, occurred_at);

CREATE UNIQUE INDEX "InventoryCostMovement_idempotency_key_key" ON "InventoryCostMovement" USING btree (idempotency_key);

CREATE INDEX "InventoryCostMovement_purchase_invoice_recorded_at_idx" ON "InventoryCostMovement" USING btree (purchase_invoice_id, recorded_at);

CREATE INDEX "InventoryCostMovement_reference_idx" ON "InventoryCostMovement" USING btree (reference_type, reference_id);

CREATE UNIQUE INDEX "InventoryCostMovement_sequence_key" ON "InventoryCostMovement" USING btree (sequence);

CREATE INDEX "InventoryCostMovement_supplier_return_item_idx" ON "InventoryCostMovement" USING btree (supplier_return_item_id);

CREATE INDEX "InventoryCostMovement_supplier_return_sequence_idx" ON "InventoryCostMovement" USING btree (supplier_return_id, sequence);

CREATE INDEX "InventoryCostMovement_tenant_id_idx" ON "InventoryCostMovement" USING btree (tenant_id);

CREATE INDEX "InventoryCostMovement_variant_sequence_idx" ON "InventoryCostMovement" USING btree (variant_id, sequence);

CREATE INDEX "InventoryMovement_branch_id_variant_id_occurred_at_idx" ON "InventoryMovement" USING btree (branch_id, variant_id, occurred_at);

CREATE INDEX "InventoryMovement_created_by_occurred_at_idx" ON "InventoryMovement" USING btree (created_by, occurred_at);

CREATE INDEX "InventoryMovement_movement_type_occurred_at_idx" ON "InventoryMovement" USING btree (movement_type, occurred_at);

CREATE INDEX "InventoryMovement_recorded_at_idx" ON "InventoryMovement" USING btree (recorded_at);

CREATE INDEX "InventoryMovement_reference_type_reference_id_idx" ON "InventoryMovement" USING btree (reference_type, reference_id);

CREATE UNIQUE INDEX "InventoryMovement_sequence_key" ON "InventoryMovement" USING btree (sequence);

CREATE INDEX "InventoryMovement_tenant_id_idx" ON "InventoryMovement" USING btree (tenant_id);

CREATE INDEX "InventoryMovement_variant_sequence_idx" ON "InventoryMovement" USING btree (variant_id, sequence);

CREATE INDEX "InventoryMovement_warehouse_id_variant_id_occurred_at_idx" ON "InventoryMovement" USING btree (warehouse_id, variant_id, occurred_at);

CREATE INDEX "InventoryStock_tenant_id_branch_id_idx" ON "InventoryStock" USING btree (tenant_id, branch_id);

CREATE INDEX "InventoryStock_tenant_id_idx" ON "InventoryStock" USING btree (tenant_id);

CREATE INDEX "InventoryStock_tenant_id_warehouse_id_idx" ON "InventoryStock" USING btree (tenant_id, warehouse_id);

CREATE INDEX "InventoryStock_variant_id_idx" ON "InventoryStock" USING btree (variant_id);

CREATE INDEX "Invitation_tenant_id_email_idx" ON "Invitation" USING btree (tenant_id, email);

CREATE INDEX "Invitation_tenant_id_idx" ON "Invitation" USING btree (tenant_id);

CREATE UNIQUE INDEX "Invitation_token_hash_key" ON "Invitation" USING btree (token_hash);

CREATE INDEX "LegalEntity_tenant_id_idx" ON "LegalEntity" USING btree (tenant_id);

CREATE INDEX "Location_legal_entity_id_idx" ON "Location" USING btree (legal_entity_id);

CREATE INDEX "Location_tenantId_idx" ON "Location" USING btree ("tenantId");

CREATE UNIQUE INDEX "Membership_identityId_tenantId_key" ON "Membership" USING btree ("identityId", "tenantId");

CREATE INDEX "Membership_tenantId_idx" ON "Membership" USING btree ("tenantId");

CREATE INDEX "OfferSuggestion_branch_id_status_created_at_idx" ON "OfferSuggestion" USING btree (branch_id, status, created_at);

CREATE UNIQUE INDEX "OfferSuggestion_one_pending_per_stock" ON "OfferSuggestion" USING btree (branch_id, variant_id) WHERE (status = 'pending'::text);

CREATE INDEX "OfferSuggestion_tenant_id_idx" ON "OfferSuggestion" USING btree (tenant_id);

CREATE UNIQUE INDEX "OrganizationProfile_tenant_id_key" ON "OrganizationProfile" USING btree (tenant_id);

CREATE UNIQUE INDEX "PermissionPolicySnapshot_version_key" ON "PermissionPolicySnapshot" USING btree (version);

CREATE INDEX "PosTerminalEnrollment_branch_id_expires_at_idx" ON "PosTerminalEnrollment" USING btree (branch_id, expires_at);

CREATE UNIQUE INDEX "PosTerminalEnrollment_code_hash_key" ON "PosTerminalEnrollment" USING btree (code_hash);

CREATE INDEX "PosTerminalEnrollment_tenant_id_idx" ON "PosTerminalEnrollment" USING btree (tenant_id);

CREATE INDEX "PosTerminal_branch_id_last_seen_at_idx" ON "PosTerminal" USING btree (branch_id, last_seen_at);

CREATE UNIQUE INDEX "PosTerminal_device_id_key" ON "PosTerminal" USING btree (device_id);

CREATE UNIQUE INDEX "PosTerminal_device_token_hash_key" ON "PosTerminal" USING btree (device_token_hash);

CREATE INDEX "PosTerminal_tenant_id_idx" ON "PosTerminal" USING btree (tenant_id);

CREATE UNIQUE INDEX "PosTerminal_tenant_id_terminal_code_key" ON "PosTerminal" USING btree (tenant_id, terminal_code);

CREATE UNIQUE INDEX "PriceBookEntry_one_active_per_scope_qty" ON "PriceBookEntry" USING btree (price_book_id, scope_type, COALESCE(scope_id, '00000000-0000-0000-0000-000000000000'::uuid), min_qty) WHERE (status = 'active'::"PriceEntryStatus");

CREATE UNIQUE INDEX "PriceBookEntry_tenant_id_id_key" ON "PriceBookEntry" USING btree (tenant_id, id);

CREATE INDEX "PriceBookEntry_tenant_id_idx" ON "PriceBookEntry" USING btree (tenant_id);

CREATE INDEX "PriceBookEntry_tenant_id_price_book_id_scope_type_scope_id__idx" ON "PriceBookEntry" USING btree (tenant_id, price_book_id, scope_type, scope_id, status);

CREATE UNIQUE INDEX "PriceBook_one_default_per_scope" ON "PriceBook" USING btree (tenant_id, currency, scope, COALESCE(scope_ref_id, '00000000-0000-0000-0000-000000000000'::uuid)) WHERE ((is_default = true) AND (status = 'active'::"PriceBookStatus"));

CREATE UNIQUE INDEX "PriceBook_tenant_id_id_key" ON "PriceBook" USING btree (tenant_id, id);

CREATE INDEX "PriceBook_tenant_id_idx" ON "PriceBook" USING btree (tenant_id);

CREATE INDEX "PriceBook_tenant_id_status_idx" ON "PriceBook" USING btree (tenant_id, status);

CREATE UNIQUE INDEX "PriceOverridePolicy_tenant_id_id_key" ON "PriceOverridePolicy" USING btree (tenant_id, id);

CREATE INDEX "PriceOverridePolicy_tenant_id_idx" ON "PriceOverridePolicy" USING btree (tenant_id);

CREATE UNIQUE INDEX "PriceOverridePolicy_tenant_id_role_key" ON "PriceOverridePolicy" USING btree (tenant_id, role);

CREATE UNIQUE INDEX "PriceOverride_tenant_id_id_key" ON "PriceOverride" USING btree (tenant_id, id);

CREATE INDEX "PriceOverride_tenant_id_idx" ON "PriceOverride" USING btree (tenant_id);

CREATE INDEX "PriceOverride_tenant_id_variant_id_idx" ON "PriceOverride" USING btree (tenant_id, variant_id);

CREATE INDEX "PricingRule_tenant_id_idx" ON "PricingRule" USING btree (tenant_id);

CREATE INDEX "ProductVariant_barcode_ean13_idx" ON "ProductVariant" USING btree (barcode_ean13);

CREATE INDEX "ProductVariant_base_uom_id_idx" ON "ProductVariant" USING btree (base_uom_id);

CREATE INDEX "ProductVariant_created_at_id_idx" ON "ProductVariant" USING btree (created_at DESC, id);

CREATE INDEX "ProductVariant_product_id_idx" ON "ProductVariant" USING btree (product_id);

CREATE INDEX "ProductVariant_sku_trgm_idx" ON "ProductVariant" USING gin (sku gin_trgm_ops);

CREATE UNIQUE INDEX "ProductVariant_tenant_id_barcode_internal_key" ON "ProductVariant" USING btree (tenant_id, barcode_internal);

CREATE INDEX "ProductVariant_tenant_id_idx" ON "ProductVariant" USING btree (tenant_id);

CREATE UNIQUE INDEX "ProductVariant_tenant_id_sku_key" ON "ProductVariant" USING btree (tenant_id, sku);

CREATE INDEX "ProductVariant_tenant_id_tax_category_id_idx" ON "ProductVariant" USING btree (tenant_id, tax_category_id);

CREATE INDEX "Product_brand_id_idx" ON "Product" USING btree (brand_id);

CREATE INDEX "Product_is_active_created_at_idx" ON "Product" USING btree (is_active, created_at);

CREATE INDEX "Product_name_ar_trgm_idx" ON "Product" USING gin (name_ar gin_trgm_ops);

CREATE INDEX "Product_name_en_trgm_idx" ON "Product" USING gin (name_en gin_trgm_ops);

CREATE INDEX "Product_tenant_id_idx" ON "Product" USING btree (tenant_id);

CREATE UNIQUE INDEX "Product_tenant_id_sku_base_key" ON "Product" USING btree (tenant_id, sku_base);

CREATE INDEX "Product_tenant_id_tax_category_id_idx" ON "Product" USING btree (tenant_id, tax_category_id);

CREATE UNIQUE INDEX "Promotion_tenant_id_id_key" ON "Promotion" USING btree (tenant_id, id);

CREATE INDEX "Promotion_tenant_id_idx" ON "Promotion" USING btree (tenant_id);

CREATE INDEX "Promotion_tenant_id_scope_type_scope_id_idx" ON "Promotion" USING btree (tenant_id, scope_type, scope_id);

CREATE INDEX "Promotion_tenant_id_status_idx" ON "Promotion" USING btree (tenant_id, status);

CREATE INDEX "Promotion_tenant_id_status_priority_idx" ON "Promotion" USING btree (tenant_id, status, priority);

CREATE INDEX "PurchaseInvoiceItem_purchase_invoice_id_idx" ON "PurchaseInvoiceItem" USING btree (purchase_invoice_id);

CREATE INDEX "PurchaseInvoiceItem_tenant_id_idx" ON "PurchaseInvoiceItem" USING btree (tenant_id);

CREATE INDEX "PurchaseInvoiceItem_variant_id_idx" ON "PurchaseInvoiceItem" USING btree (variant_id);

CREATE INDEX "PurchaseInvoice_branch_received_at_idx" ON "PurchaseInvoice" USING btree (branch_id, received_at);

CREATE UNIQUE INDEX "PurchaseInvoice_idempotency_key_key" ON "PurchaseInvoice" USING btree (idempotency_key);

CREATE UNIQUE INDEX "PurchaseInvoice_reversal_idempotency_key_key" ON "PurchaseInvoice" USING btree (reversal_idempotency_key);

CREATE INDEX "PurchaseInvoice_status_received_at_idx" ON "PurchaseInvoice" USING btree (status, received_at);

CREATE INDEX "PurchaseInvoice_supplier_invoice_date_idx" ON "PurchaseInvoice" USING btree (supplier_id, invoice_date);

CREATE UNIQUE INDEX "PurchaseInvoice_supplier_normalized_number_key" ON "PurchaseInvoice" USING btree (supplier_id, normalized_invoice_number);

CREATE INDEX "PurchaseInvoice_tenant_id_idx" ON "PurchaseInvoice" USING btree (tenant_id);

CREATE UNIQUE INDEX "RefreshToken_token_hash_key" ON "RefreshToken" USING btree (token_hash);

CREATE INDEX "RefreshToken_user_id_expires_at_idx" ON "RefreshToken" USING btree (user_id, expires_at);

CREATE INDEX "ReturnItem_sales_invoice_item_id_idx" ON "ReturnItem" USING btree (sales_invoice_item_id);

CREATE INDEX "ReturnItem_tenant_id_idx" ON "ReturnItem" USING btree (tenant_id);

CREATE INDEX "Return_original_invoice_id_created_at_idx" ON "Return" USING btree (original_invoice_id, created_at);

CREATE INDEX "Return_shift_id_created_at_idx" ON "Return" USING btree (shift_id, created_at);

CREATE INDEX "Return_tenant_id_idx" ON "Return" USING btree (tenant_id);

CREATE UNIQUE INDEX "Return_tenant_id_return_invoice_number_key" ON "Return" USING btree (tenant_id, return_invoice_number);

CREATE INDEX "SalesInvoiceItem_sales_invoice_id_idx" ON "SalesInvoiceItem" USING btree (sales_invoice_id);

CREATE INDEX "SalesInvoiceItem_tenant_id_idx" ON "SalesInvoiceItem" USING btree (tenant_id);

CREATE INDEX "SalesInvoice_branch_id_occurred_at_idx" ON "SalesInvoice" USING btree (branch_id, occurred_at);

CREATE INDEX "SalesInvoice_branch_id_payment_method_occurred_at_idx" ON "SalesInvoice" USING btree (branch_id, payment_method, occurred_at);

CREATE INDEX "SalesInvoice_branch_id_status_occurred_at_idx" ON "SalesInvoice" USING btree (branch_id, status, occurred_at);

CREATE INDEX "SalesInvoice_cashier_id_occurred_at_idx" ON "SalesInvoice" USING btree (cashier_id, occurred_at);

CREATE INDEX "SalesInvoice_customer_id_occurred_at_id_idx" ON "SalesInvoice" USING btree (customer_id, occurred_at DESC, id DESC);

CREATE INDEX "SalesInvoice_invoice_number_trgm_idx" ON "SalesInvoice" USING gin (invoice_number gin_trgm_ops);

CREATE INDEX "SalesInvoice_occurred_at_id_idx" ON "SalesInvoice" USING btree (occurred_at DESC, id DESC);

CREATE INDEX "SalesInvoice_received_at_idx" ON "SalesInvoice" USING btree (received_at);

CREATE INDEX "SalesInvoice_seller_id_occurred_at_idx" ON "SalesInvoice" USING btree (seller_id, occurred_at);

CREATE INDEX "SalesInvoice_shift_id_occurred_at_idx" ON "SalesInvoice" USING btree (shift_id, occurred_at);

CREATE UNIQUE INDEX "SalesInvoice_sync_id_key" ON "SalesInvoice" USING btree (sync_id);

CREATE INDEX "SalesInvoice_tenant_id_idx" ON "SalesInvoice" USING btree (tenant_id);

CREATE UNIQUE INDEX "SalesInvoice_tenant_id_invoice_number_key" ON "SalesInvoice" USING btree (tenant_id, invoice_number);

CREATE INDEX "SalesInvoice_terminal_id_occurred_at_idx" ON "SalesInvoice" USING btree (terminal_id, occurred_at);

CREATE UNIQUE INDEX "SalesInvoice_terminal_id_terminal_sequence_key" ON "SalesInvoice" USING btree (terminal_id, terminal_sequence);

CREATE INDEX "SalesTaxSnapshot_sales_invoice_item_id_idx" ON "SalesTaxSnapshot" USING btree (sales_invoice_item_id);

CREATE UNIQUE INDEX "SalesTaxSnapshot_tenant_id_id_key" ON "SalesTaxSnapshot" USING btree (tenant_id, id);

CREATE INDEX "SalesTaxSnapshot_tenant_id_idx" ON "SalesTaxSnapshot" USING btree (tenant_id);

CREATE INDEX "SalesTaxSnapshot_tenant_id_sales_invoice_id_idx" ON "SalesTaxSnapshot" USING btree (tenant_id, sales_invoice_id);

CREATE INDEX "SalesTaxSnapshot_tenant_id_tax_code_id_idx" ON "SalesTaxSnapshot" USING btree (tenant_id, tax_code_id);

CREATE INDEX "SellerCommissionOverride_tenant_id_idx" ON "SellerCommissionOverride" USING btree (tenant_id);

CREATE INDEX "SellerCommissionPeriodRow_seller_id_period_id_idx" ON "SellerCommissionPeriodRow" USING btree (seller_id, period_id);

CREATE INDEX "SellerCommissionPeriodRow_tenant_id_idx" ON "SellerCommissionPeriodRow" USING btree (tenant_id);

CREATE INDEX "SellerCommissionPeriod_closed_at_idx" ON "SellerCommissionPeriod" USING btree (closed_at DESC);

CREATE INDEX "SellerCommissionPeriod_tenant_id_idx" ON "SellerCommissionPeriod" USING btree (tenant_id);

CREATE UNIQUE INDEX "SellerCommissionPeriod_tenant_period_dates_key" ON "SellerCommissionPeriod" USING btree (tenant_id, period_start, period_end_exclusive);

CREATE INDEX "SellerCommissionSettings_tenant_id_idx" ON "SellerCommissionSettings" USING btree (tenant_id);

CREATE INDEX "Shift_branch_id_opened_at_idx" ON "Shift" USING btree (branch_id, opened_at);

CREATE UNIQUE INDEX "Shift_one_open_per_branch" ON "Shift" USING btree (branch_id) WHERE (status = 'open'::text);

CREATE INDEX "Shift_tenant_id_idx" ON "Shift" USING btree (tenant_id);

CREATE INDEX "SupplierReturnItem_purchase_invoice_item_id_idx" ON "SupplierReturnItem" USING btree (purchase_invoice_item_id);

CREATE INDEX "SupplierReturnItem_supplier_return_id_idx" ON "SupplierReturnItem" USING btree (supplier_return_id);

CREATE INDEX "SupplierReturnItem_tenant_id_idx" ON "SupplierReturnItem" USING btree (tenant_id);

CREATE INDEX "SupplierReturnItem_variant_id_idx" ON "SupplierReturnItem" USING btree (variant_id);

CREATE INDEX "SupplierReturn_branch_id_occurred_at_idx" ON "SupplierReturn" USING btree (branch_id, occurred_at);

CREATE UNIQUE INDEX "SupplierReturn_idempotency_key_key" ON "SupplierReturn" USING btree (idempotency_key);

CREATE INDEX "SupplierReturn_purchase_invoice_id_occurred_at_idx" ON "SupplierReturn" USING btree (purchase_invoice_id, occurred_at);

CREATE INDEX "SupplierReturn_supplier_id_occurred_at_idx" ON "SupplierReturn" USING btree (supplier_id, occurred_at);

CREATE INDEX "SupplierReturn_tenant_id_idx" ON "SupplierReturn" USING btree (tenant_id);

CREATE UNIQUE INDEX "SupplierReturn_tenant_id_return_number_key" ON "SupplierReturn" USING btree (tenant_id, return_number);

CREATE INDEX "Supplier_tenant_id_idx" ON "Supplier" USING btree (tenant_id);

CREATE INDEX "SupportAccessGrant_tenant_id_expires_at_idx" ON "SupportAccessGrant" USING btree (tenant_id, expires_at);

CREATE INDEX "SupportAccessGrant_tenant_id_idx" ON "SupportAccessGrant" USING btree (tenant_id);

CREATE INDEX "SyncChange_branch_id_sequence_idx" ON "SyncChange" USING btree (branch_id, sequence);

CREATE INDEX "SyncChange_sequence_kind_idx" ON "SyncChange" USING btree (sequence, kind);

CREATE INDEX "SyncChange_tenant_id_idx" ON "SyncChange" USING btree (tenant_id);

CREATE UNIQUE INDEX "TaxCategory_tenant_id_code_key" ON "TaxCategory" USING btree (tenant_id, code);

CREATE UNIQUE INDEX "TaxCategory_tenant_id_id_key" ON "TaxCategory" USING btree (tenant_id, id);

CREATE INDEX "TaxCategory_tenant_id_idx" ON "TaxCategory" USING btree (tenant_id);

CREATE INDEX "TaxCategory_tenant_id_is_active_idx" ON "TaxCategory" USING btree (tenant_id, is_active);

CREATE UNIQUE INDEX "TaxCode_one_active_per_category" ON "TaxCode" USING btree (tenant_id, tax_category_id) WHERE (status = 'active'::"TaxCodeStatus");

CREATE UNIQUE INDEX "TaxCode_tenant_id_code_version_key" ON "TaxCode" USING btree (tenant_id, code, version);

CREATE UNIQUE INDEX "TaxCode_tenant_id_id_key" ON "TaxCode" USING btree (tenant_id, id);

CREATE INDEX "TaxCode_tenant_id_idx" ON "TaxCode" USING btree (tenant_id);

CREATE INDEX "TaxCode_tenant_id_status_idx" ON "TaxCode" USING btree (tenant_id, status);

CREATE INDEX "TaxCode_tenant_id_tax_category_id_status_idx" ON "TaxCode" USING btree (tenant_id, tax_category_id, status);

CREATE UNIQUE INDEX "TaxExemption_one_live_per_customer_category" ON "TaxExemption" USING btree (tenant_id, customer_id, COALESCE(tax_category_id, '00000000-0000-0000-0000-000000000000'::uuid)) WHERE (status = ANY (ARRAY['pending'::"TaxExemptionStatus", 'approved'::"TaxExemptionStatus"]));

CREATE INDEX "TaxExemption_tenant_id_customer_id_status_idx" ON "TaxExemption" USING btree (tenant_id, customer_id, status);

CREATE UNIQUE INDEX "TaxExemption_tenant_id_id_key" ON "TaxExemption" USING btree (tenant_id, id);

CREATE INDEX "TaxExemption_tenant_id_idx" ON "TaxExemption" USING btree (tenant_id);

CREATE INDEX "TransferCommand_tenant_id_idx" ON "TransferCommand" USING btree (tenant_id);

CREATE INDEX "TransferCommand_transfer_id_created_at_idx" ON "TransferCommand" USING btree (transfer_id, created_at);

CREATE INDEX "TransferItem_tenant_id_idx" ON "TransferItem" USING btree (tenant_id);

CREATE UNIQUE INDEX "TransferItem_transfer_id_variant_id_key" ON "TransferItem" USING btree (transfer_id, variant_id);

CREATE INDEX "TransferTransitMovement_item_sequence_idx" ON "TransferTransitMovement" USING btree (transfer_item_id, sequence);

CREATE INDEX "TransferTransitMovement_tenant_id_idx" ON "TransferTransitMovement" USING btree (tenant_id);

CREATE INDEX "TransferTransitMovement_transfer_sequence_idx" ON "TransferTransitMovement" USING btree (transfer_id, sequence);

CREATE INDEX "TransferTransitMovement_variant_sequence_idx" ON "TransferTransitMovement" USING btree (variant_id, sequence);

CREATE INDEX "Transfer_from_branch_id_created_at_idx" ON "Transfer" USING btree (from_branch_id, created_at);

CREATE UNIQUE INDEX "Transfer_idempotency_key_key" ON "Transfer" USING btree (idempotency_key) WHERE (idempotency_key IS NOT NULL);

CREATE INDEX "Transfer_status_updated_at_idx" ON "Transfer" USING btree (status, updated_at);

CREATE INDEX "Transfer_tenant_id_idx" ON "Transfer" USING btree (tenant_id);

CREATE UNIQUE INDEX "Transfer_tenant_id_transfer_number_key" ON "Transfer" USING btree (tenant_id, transfer_number);

CREATE INDEX "Transfer_to_branch_id_created_at_idx" ON "Transfer" USING btree (to_branch_id, created_at);

CREATE UNIQUE INDEX "UnitOfMeasure_tenant_id_code_key" ON "UnitOfMeasure" USING btree (tenant_id, code);

CREATE UNIQUE INDEX "UnitOfMeasure_tenant_id_id_key" ON "UnitOfMeasure" USING btree (tenant_id, id);

CREATE INDEX "UnitOfMeasure_tenant_id_idx" ON "UnitOfMeasure" USING btree (tenant_id);

CREATE INDEX "UomConversion_from_uom_id_idx" ON "UomConversion" USING btree (from_uom_id);

CREATE UNIQUE INDEX "UomConversion_tenant_id_from_uom_id_to_uom_id_version_key" ON "UomConversion" USING btree (tenant_id, from_uom_id, to_uom_id, version);

CREATE UNIQUE INDEX "UomConversion_tenant_id_id_key" ON "UomConversion" USING btree (tenant_id, id);

CREATE INDEX "UomConversion_tenant_id_idx" ON "UomConversion" USING btree (tenant_id);

CREATE INDEX "UomConversion_to_uom_id_idx" ON "UomConversion" USING btree (to_uom_id);

CREATE UNIQUE INDEX "User_email_key" ON "User" USING btree (email);

CREATE UNIQUE INDEX "User_phone_key" ON "User" USING btree (phone);

CREATE INDEX "Warehouse_location_id_idx" ON "Warehouse" USING btree (location_id);

CREATE UNIQUE INDEX "Warehouse_tenant_id_id_key" ON "Warehouse" USING btree (tenant_id, id);

CREATE INDEX "Warehouse_tenant_id_idx" ON "Warehouse" USING btree (tenant_id);

-- ======================================================================
-- Foreign keys
-- ======================================================================

ALTER TABLE ONLY "AccessScopeAssignment"
    ADD CONSTRAINT "AccessScopeAssignment_membership_id_fkey" FOREIGN KEY (membership_id) REFERENCES "Membership"(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY "Assortment"
    ADD CONSTRAINT "Assortment_tenant_id_branch_id_fkey" FOREIGN KEY (tenant_id, branch_id) REFERENCES "Branch"(tenant_id, id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY "Assortment"
    ADD CONSTRAINT "Assortment_tenant_id_variant_id_fkey" FOREIGN KEY (tenant_id, variant_id) REFERENCES "ProductVariant"(tenant_id, id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY "BundleComponent"
    ADD CONSTRAINT "BundleComponent_tenant_id_bundle_id_fkey" FOREIGN KEY (tenant_id, bundle_id) REFERENCES "Bundle"(tenant_id, id) ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE ONLY "BundleComponent"
    ADD CONSTRAINT "BundleComponent_tenant_id_variant_id_fkey" FOREIGN KEY (tenant_id, variant_id) REFERENCES "ProductVariant"(tenant_id, id) ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE ONLY "Bundle"
    ADD CONSTRAINT "Bundle_tenant_id_supersedes_id_fkey" FOREIGN KEY (tenant_id, supersedes_id) REFERENCES "Bundle"(tenant_id, id) ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE ONLY "CouponRedemption"
    ADD CONSTRAINT "CouponRedemption_tenant_id_coupon_id_fkey" FOREIGN KEY (tenant_id, coupon_id) REFERENCES "Coupon"(tenant_id, id) ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE ONLY "Coupon"
    ADD CONSTRAINT "Coupon_tenant_id_promotion_id_fkey" FOREIGN KEY (tenant_id, promotion_id) REFERENCES "Promotion"(tenant_id, id) ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE ONLY "Discount"
    ADD CONSTRAINT "Discount_tenant_id_variant_id_fkey" FOREIGN KEY (tenant_id, variant_id) REFERENCES "ProductVariant"(tenant_id, id) ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE ONLY "InventoryCostMovement"
    ADD CONSTRAINT "InventoryCostMovement_created_by_fkey" FOREIGN KEY (created_by) REFERENCES "User"(id) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE ONLY "InventoryCostMovement"
    ADD CONSTRAINT "InventoryCostMovement_tenant_id_branch_id_fkey" FOREIGN KEY (tenant_id, branch_id) REFERENCES "Branch"(tenant_id, id) ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE ONLY "InventoryCostMovement"
    ADD CONSTRAINT "InventoryCostMovement_tenant_id_purchase_invoice_id_fkey" FOREIGN KEY (tenant_id, purchase_invoice_id) REFERENCES "PurchaseInvoice"(tenant_id, id) ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE ONLY "InventoryCostMovement"
    ADD CONSTRAINT "InventoryCostMovement_tenant_id_purchase_invoice_item_id_fkey" FOREIGN KEY (tenant_id, purchase_invoice_item_id) REFERENCES "PurchaseInvoiceItem"(tenant_id, id) ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE ONLY "InventoryCostMovement"
    ADD CONSTRAINT "InventoryCostMovement_tenant_id_supplier_return_id_fkey" FOREIGN KEY (tenant_id, supplier_return_id) REFERENCES "SupplierReturn"(tenant_id, id) ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE ONLY "InventoryCostMovement"
    ADD CONSTRAINT "InventoryCostMovement_tenant_id_supplier_return_item_id_fkey" FOREIGN KEY (tenant_id, supplier_return_item_id) REFERENCES "SupplierReturnItem"(tenant_id, id) ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE ONLY "InventoryCostMovement"
    ADD CONSTRAINT "InventoryCostMovement_tenant_id_variant_id_fkey" FOREIGN KEY (tenant_id, variant_id) REFERENCES "ProductVariant"(tenant_id, id) ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE ONLY "InventoryCostMovement"
    ADD CONSTRAINT "InventoryCostMovement_tenant_id_warehouse_id_fkey" FOREIGN KEY (tenant_id, warehouse_id) REFERENCES "Warehouse"(tenant_id, id) ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE ONLY "InventoryMovement"
    ADD CONSTRAINT "InventoryMovement_created_by_fkey" FOREIGN KEY (created_by) REFERENCES "User"(id) ON UPDATE CASCADE ON DELETE SET NULL;

ALTER TABLE ONLY "InventoryMovement"
    ADD CONSTRAINT "InventoryMovement_tenant_id_branch_id_fkey" FOREIGN KEY (tenant_id, branch_id) REFERENCES "Branch"(tenant_id, id) ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE ONLY "InventoryMovement"
    ADD CONSTRAINT "InventoryMovement_tenant_id_variant_id_fkey" FOREIGN KEY (tenant_id, variant_id) REFERENCES "ProductVariant"(tenant_id, id) ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE ONLY "InventoryMovement"
    ADD CONSTRAINT "InventoryMovement_tenant_id_warehouse_id_fkey" FOREIGN KEY (tenant_id, warehouse_id) REFERENCES "Warehouse"(tenant_id, id) ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE ONLY "InventoryStock"
    ADD CONSTRAINT "InventoryStock_tenant_id_branch_id_fkey" FOREIGN KEY (tenant_id, branch_id) REFERENCES "Branch"(tenant_id, id) ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE ONLY "InventoryStock"
    ADD CONSTRAINT "InventoryStock_tenant_id_variant_id_fkey" FOREIGN KEY (tenant_id, variant_id) REFERENCES "ProductVariant"(tenant_id, id) ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE ONLY "InventoryStock"
    ADD CONSTRAINT "InventoryStock_tenant_id_warehouse_id_fkey" FOREIGN KEY (tenant_id, warehouse_id) REFERENCES "Warehouse"(tenant_id, id) ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE ONLY "Invitation"
    ADD CONSTRAINT "Invitation_tenant_id_fkey" FOREIGN KEY (tenant_id) REFERENCES "Tenant"(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY "LegalEntity"
    ADD CONSTRAINT "LegalEntity_tenant_id_fkey" FOREIGN KEY (tenant_id) REFERENCES "Tenant"(id) ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE ONLY "Location"
    ADD CONSTRAINT "Location_legal_entity_id_fkey" FOREIGN KEY (legal_entity_id) REFERENCES "LegalEntity"(id) ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE ONLY "Location"
    ADD CONSTRAINT "Location_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"(id) ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE ONLY "Membership"
    ADD CONSTRAINT "Membership_identityId_fkey" FOREIGN KEY ("identityId") REFERENCES "User"(id) ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE ONLY "Membership"
    ADD CONSTRAINT "Membership_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"(id) ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE ONLY "OfferSuggestion"
    ADD CONSTRAINT "OfferSuggestion_reviewed_by_fkey" FOREIGN KEY (reviewed_by) REFERENCES "User"(id) ON UPDATE CASCADE ON DELETE SET NULL;

ALTER TABLE ONLY "OfferSuggestion"
    ADD CONSTRAINT "OfferSuggestion_tenant_id_branch_id_fkey" FOREIGN KEY (tenant_id, branch_id) REFERENCES "Branch"(tenant_id, id) ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE ONLY "OfferSuggestion"
    ADD CONSTRAINT "OfferSuggestion_tenant_id_variant_id_fkey" FOREIGN KEY (tenant_id, variant_id) REFERENCES "ProductVariant"(tenant_id, id) ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE ONLY "OrganizationProfile"
    ADD CONSTRAINT "OrganizationProfile_tenant_id_fkey" FOREIGN KEY (tenant_id) REFERENCES "Tenant"(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY "PosTerminalEnrollment"
    ADD CONSTRAINT "PosTerminalEnrollment_created_by_fkey" FOREIGN KEY (created_by) REFERENCES "User"(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY "PosTerminalEnrollment"
    ADD CONSTRAINT "PosTerminalEnrollment_tenant_id_branch_id_fkey" FOREIGN KEY (tenant_id, branch_id) REFERENCES "Branch"(tenant_id, id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY "PosTerminal"
    ADD CONSTRAINT "PosTerminal_enrolled_by_fkey" FOREIGN KEY (enrolled_by) REFERENCES "User"(id) ON UPDATE CASCADE ON DELETE SET NULL;

ALTER TABLE ONLY "PosTerminal"
    ADD CONSTRAINT "PosTerminal_tenant_id_branch_id_fkey" FOREIGN KEY (tenant_id, branch_id) REFERENCES "Branch"(tenant_id, id) ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE ONLY "PriceBookEntry"
    ADD CONSTRAINT "PriceBookEntry_tenant_id_price_book_id_fkey" FOREIGN KEY (tenant_id, price_book_id) REFERENCES "PriceBook"(tenant_id, id) ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE ONLY "PriceOverride"
    ADD CONSTRAINT "PriceOverride_tenant_id_variant_id_fkey" FOREIGN KEY (tenant_id, variant_id) REFERENCES "ProductVariant"(tenant_id, id) ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE ONLY "ProductVariant"
    ADD CONSTRAINT "ProductVariant_tenant_id_base_uom_id_fkey" FOREIGN KEY (tenant_id, base_uom_id) REFERENCES "UnitOfMeasure"(tenant_id, id) ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE ONLY "ProductVariant"
    ADD CONSTRAINT "ProductVariant_tenant_id_product_id_fkey" FOREIGN KEY (tenant_id, product_id) REFERENCES "Product"(tenant_id, id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY "ProductVariant"
    ADD CONSTRAINT "ProductVariant_tenant_id_tax_category_id_fkey" FOREIGN KEY (tenant_id, tax_category_id) REFERENCES "TaxCategory"(tenant_id, id) ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE ONLY "Product"
    ADD CONSTRAINT "Product_tenant_id_brand_id_fkey" FOREIGN KEY (tenant_id, brand_id) REFERENCES "Brand"(tenant_id, id) ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE ONLY "Product"
    ADD CONSTRAINT "Product_tenant_id_category_id_fkey" FOREIGN KEY (tenant_id, category_id) REFERENCES "Category"(tenant_id, id) ON UPDATE CASCADE ON DELETE SET NULL (category_id);

ALTER TABLE ONLY "Product"
    ADD CONSTRAINT "Product_tenant_id_tax_category_id_fkey" FOREIGN KEY (tenant_id, tax_category_id) REFERENCES "TaxCategory"(tenant_id, id) ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE ONLY "PurchaseInvoiceItem"
    ADD CONSTRAINT "PurchaseInvoiceItem_tenant_id_purchase_invoice_id_fkey" FOREIGN KEY (tenant_id, purchase_invoice_id) REFERENCES "PurchaseInvoice"(tenant_id, id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY "PurchaseInvoiceItem"
    ADD CONSTRAINT "PurchaseInvoiceItem_tenant_id_variant_id_fkey" FOREIGN KEY (tenant_id, variant_id) REFERENCES "ProductVariant"(tenant_id, id) ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE ONLY "PurchaseInvoice"
    ADD CONSTRAINT "PurchaseInvoice_created_by_fkey" FOREIGN KEY (created_by) REFERENCES "User"(id) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE ONLY "PurchaseInvoice"
    ADD CONSTRAINT "PurchaseInvoice_reversed_by_fkey" FOREIGN KEY (reversed_by) REFERENCES "User"(id) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE ONLY "PurchaseInvoice"
    ADD CONSTRAINT "PurchaseInvoice_tenant_id_branch_id_fkey" FOREIGN KEY (tenant_id, branch_id) REFERENCES "Branch"(tenant_id, id) ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE ONLY "PurchaseInvoice"
    ADD CONSTRAINT "PurchaseInvoice_tenant_id_supplier_id_fkey" FOREIGN KEY (tenant_id, supplier_id) REFERENCES "Supplier"(tenant_id, id) ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE ONLY "RefreshToken"
    ADD CONSTRAINT "RefreshToken_user_id_fkey" FOREIGN KEY (user_id) REFERENCES "User"(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY "ReturnItem"
    ADD CONSTRAINT "ReturnItem_tenant_id_return_id_fkey" FOREIGN KEY (tenant_id, return_id) REFERENCES "Return"(tenant_id, id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY "ReturnItem"
    ADD CONSTRAINT "ReturnItem_tenant_id_sales_invoice_item_id_fkey" FOREIGN KEY (tenant_id, sales_invoice_item_id) REFERENCES "SalesInvoiceItem"(tenant_id, id) ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE ONLY "ReturnItem"
    ADD CONSTRAINT "ReturnItem_tenant_id_variant_id_fkey" FOREIGN KEY (tenant_id, variant_id) REFERENCES "ProductVariant"(tenant_id, id) ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE ONLY "Return"
    ADD CONSTRAINT "Return_created_by_fkey" FOREIGN KEY (created_by) REFERENCES "User"(id) ON UPDATE CASCADE ON DELETE SET NULL;

ALTER TABLE ONLY "Return"
    ADD CONSTRAINT "Return_tenant_id_branch_id_fkey" FOREIGN KEY (tenant_id, branch_id) REFERENCES "Branch"(tenant_id, id) ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE ONLY "Return"
    ADD CONSTRAINT "Return_tenant_id_new_invoice_id_fkey" FOREIGN KEY (tenant_id, new_invoice_id) REFERENCES "SalesInvoice"(tenant_id, id) ON UPDATE CASCADE ON DELETE SET NULL (new_invoice_id);

ALTER TABLE ONLY "Return"
    ADD CONSTRAINT "Return_tenant_id_original_invoice_id_fkey" FOREIGN KEY (tenant_id, original_invoice_id) REFERENCES "SalesInvoice"(tenant_id, id) ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE ONLY "Return"
    ADD CONSTRAINT "Return_tenant_id_shift_id_fkey" FOREIGN KEY (tenant_id, shift_id) REFERENCES "Shift"(tenant_id, id) ON UPDATE CASCADE ON DELETE SET NULL (shift_id);

ALTER TABLE ONLY "SalesInvoiceItem"
    ADD CONSTRAINT "SalesInvoiceItem_tenant_id_sales_invoice_id_fkey" FOREIGN KEY (tenant_id, sales_invoice_id) REFERENCES "SalesInvoice"(tenant_id, id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY "SalesInvoiceItem"
    ADD CONSTRAINT "SalesInvoiceItem_tenant_id_variant_id_fkey" FOREIGN KEY (tenant_id, variant_id) REFERENCES "ProductVariant"(tenant_id, id) ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE ONLY "SalesInvoice"
    ADD CONSTRAINT "SalesInvoice_cashier_id_fkey" FOREIGN KEY (cashier_id) REFERENCES "User"(id) ON UPDATE CASCADE ON DELETE SET NULL;

ALTER TABLE ONLY "SalesInvoice"
    ADD CONSTRAINT "SalesInvoice_received_by_fkey" FOREIGN KEY (received_by) REFERENCES "User"(id) ON UPDATE CASCADE ON DELETE SET NULL;

ALTER TABLE ONLY "SalesInvoice"
    ADD CONSTRAINT "SalesInvoice_seller_id_fkey" FOREIGN KEY (seller_id) REFERENCES "User"(id) ON UPDATE CASCADE ON DELETE SET NULL;

ALTER TABLE ONLY "SalesInvoice"
    ADD CONSTRAINT "SalesInvoice_tenant_id_branch_id_fkey" FOREIGN KEY (tenant_id, branch_id) REFERENCES "Branch"(tenant_id, id) ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE ONLY "SalesInvoice"
    ADD CONSTRAINT "SalesInvoice_tenant_id_customer_id_fkey" FOREIGN KEY (tenant_id, customer_id) REFERENCES "Customer"(tenant_id, id) ON UPDATE CASCADE ON DELETE SET NULL (customer_id);

ALTER TABLE ONLY "SalesInvoice"
    ADD CONSTRAINT "SalesInvoice_tenant_id_shift_id_fkey" FOREIGN KEY (tenant_id, shift_id) REFERENCES "Shift"(tenant_id, id) ON UPDATE CASCADE ON DELETE SET NULL (shift_id);

ALTER TABLE ONLY "SalesInvoice"
    ADD CONSTRAINT "SalesInvoice_tenant_id_terminal_id_fkey" FOREIGN KEY (tenant_id, terminal_id) REFERENCES "PosTerminal"(tenant_id, id) ON UPDATE CASCADE ON DELETE SET NULL (terminal_id);

ALTER TABLE ONLY "SalesTaxSnapshot"
    ADD CONSTRAINT "SalesTaxSnapshot_tenant_id_exemption_id_fkey" FOREIGN KEY (tenant_id, exemption_id) REFERENCES "TaxExemption"(tenant_id, id) ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE ONLY "SalesTaxSnapshot"
    ADD CONSTRAINT "SalesTaxSnapshot_tenant_id_sales_invoice_id_fkey" FOREIGN KEY (tenant_id, sales_invoice_id) REFERENCES "SalesInvoice"(tenant_id, id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY "SalesTaxSnapshot"
    ADD CONSTRAINT "SalesTaxSnapshot_tenant_id_sales_invoice_item_id_fkey" FOREIGN KEY (tenant_id, sales_invoice_item_id) REFERENCES "SalesInvoiceItem"(tenant_id, id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY "SalesTaxSnapshot"
    ADD CONSTRAINT "SalesTaxSnapshot_tenant_id_tax_code_id_fkey" FOREIGN KEY (tenant_id, tax_code_id) REFERENCES "TaxCode"(tenant_id, id) ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE ONLY "SellerCommissionOverride"
    ADD CONSTRAINT "SellerCommissionOverride_seller_id_fkey" FOREIGN KEY (seller_id) REFERENCES "User"(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY "SellerCommissionPeriodRow"
    ADD CONSTRAINT "SellerCommissionPeriodRow_seller_id_fkey" FOREIGN KEY (seller_id) REFERENCES "User"(id) ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE ONLY "SellerCommissionPeriodRow"
    ADD CONSTRAINT "SellerCommissionPeriodRow_tenant_id_period_id_fkey" FOREIGN KEY (tenant_id, period_id) REFERENCES "SellerCommissionPeriod"(tenant_id, id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY "SellerCommissionPeriod"
    ADD CONSTRAINT "SellerCommissionPeriod_closed_by_fkey" FOREIGN KEY (closed_by) REFERENCES "User"(id) ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE ONLY "Shift"
    ADD CONSTRAINT "Shift_closed_by_fkey" FOREIGN KEY (closed_by) REFERENCES "User"(id) ON UPDATE CASCADE ON DELETE SET NULL;

ALTER TABLE ONLY "Shift"
    ADD CONSTRAINT "Shift_opened_by_fkey" FOREIGN KEY (opened_by) REFERENCES "User"(id) ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE ONLY "Shift"
    ADD CONSTRAINT "Shift_tenant_id_branch_id_fkey" FOREIGN KEY (tenant_id, branch_id) REFERENCES "Branch"(tenant_id, id) ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE ONLY "SupplierReturnItem"
    ADD CONSTRAINT "SupplierReturnItem_tenant_id_purchase_invoice_item_id_fkey" FOREIGN KEY (tenant_id, purchase_invoice_item_id) REFERENCES "PurchaseInvoiceItem"(tenant_id, id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY "SupplierReturnItem"
    ADD CONSTRAINT "SupplierReturnItem_tenant_id_supplier_return_id_fkey" FOREIGN KEY (tenant_id, supplier_return_id) REFERENCES "SupplierReturn"(tenant_id, id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY "SupplierReturnItem"
    ADD CONSTRAINT "SupplierReturnItem_tenant_id_variant_id_fkey" FOREIGN KEY (tenant_id, variant_id) REFERENCES "ProductVariant"(tenant_id, id) ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE ONLY "SupplierReturn"
    ADD CONSTRAINT "SupplierReturn_created_by_fkey" FOREIGN KEY (created_by) REFERENCES "User"(id) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE ONLY "SupplierReturn"
    ADD CONSTRAINT "SupplierReturn_tenant_id_branch_id_fkey" FOREIGN KEY (tenant_id, branch_id) REFERENCES "Branch"(tenant_id, id) ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE ONLY "SupplierReturn"
    ADD CONSTRAINT "SupplierReturn_tenant_id_purchase_invoice_id_fkey" FOREIGN KEY (tenant_id, purchase_invoice_id) REFERENCES "PurchaseInvoice"(tenant_id, id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY "SupplierReturn"
    ADD CONSTRAINT "SupplierReturn_tenant_id_supplier_id_fkey" FOREIGN KEY (tenant_id, supplier_id) REFERENCES "Supplier"(tenant_id, id) ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE ONLY "SupportAccessGrant"
    ADD CONSTRAINT "SupportAccessGrant_tenant_id_fkey" FOREIGN KEY (tenant_id) REFERENCES "Tenant"(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY "TaxCode"
    ADD CONSTRAINT "TaxCode_tenant_id_supersedes_id_fkey" FOREIGN KEY (tenant_id, supersedes_id) REFERENCES "TaxCode"(tenant_id, id) ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE ONLY "TaxCode"
    ADD CONSTRAINT "TaxCode_tenant_id_tax_category_id_fkey" FOREIGN KEY (tenant_id, tax_category_id) REFERENCES "TaxCategory"(tenant_id, id) ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE ONLY "TaxExemption"
    ADD CONSTRAINT "TaxExemption_tenant_id_customer_id_fkey" FOREIGN KEY (tenant_id, customer_id) REFERENCES "Customer"(tenant_id, id) ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE ONLY "TaxExemption"
    ADD CONSTRAINT "TaxExemption_tenant_id_tax_category_id_fkey" FOREIGN KEY (tenant_id, tax_category_id) REFERENCES "TaxCategory"(tenant_id, id) ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE ONLY "TransferCommand"
    ADD CONSTRAINT "TransferCommand_created_by_fkey" FOREIGN KEY (created_by) REFERENCES "User"(id) ON UPDATE CASCADE ON DELETE SET NULL;

ALTER TABLE ONLY "TransferCommand"
    ADD CONSTRAINT "TransferCommand_tenant_id_transfer_id_fkey" FOREIGN KEY (tenant_id, transfer_id) REFERENCES "Transfer"(tenant_id, id) ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE ONLY "TransferItem"
    ADD CONSTRAINT "TransferItem_tenant_id_transfer_id_fkey" FOREIGN KEY (tenant_id, transfer_id) REFERENCES "Transfer"(tenant_id, id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY "TransferItem"
    ADD CONSTRAINT "TransferItem_tenant_id_variant_id_fkey" FOREIGN KEY (tenant_id, variant_id) REFERENCES "ProductVariant"(tenant_id, id) ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE ONLY "TransferTransitMovement"
    ADD CONSTRAINT "TransferTransitMovement_created_by_fkey" FOREIGN KEY (created_by) REFERENCES "User"(id) ON UPDATE CASCADE ON DELETE SET NULL;

ALTER TABLE ONLY "TransferTransitMovement"
    ADD CONSTRAINT "TransferTransitMovement_tenant_id_transfer_id_fkey" FOREIGN KEY (tenant_id, transfer_id) REFERENCES "Transfer"(tenant_id, id) ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE ONLY "TransferTransitMovement"
    ADD CONSTRAINT "TransferTransitMovement_tenant_id_transfer_item_id_fkey" FOREIGN KEY (tenant_id, transfer_item_id) REFERENCES "TransferItem"(tenant_id, id) ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE ONLY "TransferTransitMovement"
    ADD CONSTRAINT "TransferTransitMovement_tenant_id_variant_id_fkey" FOREIGN KEY (tenant_id, variant_id) REFERENCES "ProductVariant"(tenant_id, id) ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE ONLY "Transfer"
    ADD CONSTRAINT "Transfer_cancelled_by_fkey" FOREIGN KEY (cancelled_by) REFERENCES "User"(id) ON UPDATE CASCADE ON DELETE SET NULL;

ALTER TABLE ONLY "Transfer"
    ADD CONSTRAINT "Transfer_created_by_fkey" FOREIGN KEY (created_by) REFERENCES "User"(id) ON UPDATE CASCADE ON DELETE SET NULL;

ALTER TABLE ONLY "Transfer"
    ADD CONSTRAINT "Transfer_received_by_fkey" FOREIGN KEY (received_by) REFERENCES "User"(id) ON UPDATE CASCADE ON DELETE SET NULL;

ALTER TABLE ONLY "Transfer"
    ADD CONSTRAINT "Transfer_shipped_by_fkey" FOREIGN KEY (shipped_by) REFERENCES "User"(id) ON UPDATE CASCADE ON DELETE SET NULL;

ALTER TABLE ONLY "Transfer"
    ADD CONSTRAINT "Transfer_tenant_id_from_branch_id_fkey" FOREIGN KEY (tenant_id, from_branch_id) REFERENCES "Branch"(tenant_id, id) ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE ONLY "Transfer"
    ADD CONSTRAINT "Transfer_tenant_id_to_branch_id_fkey" FOREIGN KEY (tenant_id, to_branch_id) REFERENCES "Branch"(tenant_id, id) ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE ONLY "UomConversion"
    ADD CONSTRAINT "UomConversion_tenant_id_from_uom_id_fkey" FOREIGN KEY (tenant_id, from_uom_id) REFERENCES "UnitOfMeasure"(tenant_id, id) ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE ONLY "UomConversion"
    ADD CONSTRAINT "UomConversion_tenant_id_to_uom_id_fkey" FOREIGN KEY (tenant_id, to_uom_id) REFERENCES "UnitOfMeasure"(tenant_id, id) ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE ONLY "User"
    ADD CONSTRAINT "User_branch_id_fkey" FOREIGN KEY (branch_id) REFERENCES "Branch"(id) ON UPDATE CASCADE ON DELETE SET NULL;

ALTER TABLE ONLY "Warehouse"
    ADD CONSTRAINT "Warehouse_location_id_fkey" FOREIGN KEY (location_id) REFERENCES "Location"(id) ON UPDATE CASCADE ON DELETE SET NULL;

ALTER TABLE ONLY "Warehouse"
    ADD CONSTRAINT "Warehouse_tenant_id_fkey" FOREIGN KEY (tenant_id) REFERENCES "Tenant"(id) ON UPDATE CASCADE ON DELETE RESTRICT;

-- ======================================================================
-- Functions
-- ======================================================================

CREATE FUNCTION athr_sales_tax_snapshot_immutable() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  RAISE EXCEPTION
    'SalesTaxSnapshot is append-only (BR-TAX-203): updating snapshot % would rewrite the tax a completed document already reported. Issue a corrective document instead.',
    OLD."id"
    USING ERRCODE = 'restrict_violation';
END;
$$;

CREATE FUNCTION bold_emit_inventory_sync_change() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  target_branch uuid;
  target_variant uuid;
  target_tenant uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    target_branch := OLD."branch_id";
    target_variant := OLD."variant_id";
    target_tenant := OLD."tenant_id";
  ELSE
    target_branch := NEW."branch_id";
    target_variant := NEW."variant_id";
    target_tenant := NEW."tenant_id";
  END IF;

  INSERT INTO "SyncChange" ("kind", "branch_id", "entity_key", "created_at", "tenant_id")
  VALUES ('inventory', target_branch, target_variant::text, CURRENT_TIMESTAMP, target_tenant);
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION bold_emit_pricing_sync_change() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  entity_id uuid;
  entity_tenant uuid;
BEGIN
  entity_id := CASE WHEN TG_OP = 'DELETE' THEN OLD."id" ELSE NEW."id" END;
  entity_tenant := CASE WHEN TG_OP = 'DELETE' THEN OLD."tenant_id" ELSE NEW."tenant_id" END;
  INSERT INTO "SyncChange" ("kind", "branch_id", "entity_key", "created_at", "tenant_id")
  VALUES ('pricing', NULL, entity_id::text, CURRENT_TIMESTAMP, entity_tenant);
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION bold_emit_product_sync_change() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  entity_id uuid;
  entity_tenant uuid;
BEGIN
  entity_id := CASE WHEN TG_OP = 'DELETE' THEN OLD."id" ELSE NEW."id" END;
  entity_tenant := CASE WHEN TG_OP = 'DELETE' THEN OLD."tenant_id" ELSE NEW."tenant_id" END;
  INSERT INTO "SyncChange" ("kind", "branch_id", "entity_key", "created_at", "tenant_id")
  VALUES ('product', NULL, entity_id::text, CURRENT_TIMESTAMP, entity_tenant);
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION bold_emit_variant_sync_change() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  entity_id uuid;
  entity_tenant uuid;
BEGIN
  entity_id := CASE WHEN TG_OP = 'DELETE' THEN OLD."id" ELSE NEW."id" END;
  entity_tenant := CASE WHEN TG_OP = 'DELETE' THEN OLD."tenant_id" ELSE NEW."tenant_id" END;
  INSERT INTO "SyncChange" ("kind", "branch_id", "entity_key", "created_at", "tenant_id")
  VALUES ('variant', NULL, entity_id::text, CURRENT_TIMESTAMP, entity_tenant);
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION protect_inventory_cost_movement() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF current_setting('bold.inventory_cost_ledger_maintenance', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'InventoryCostMovement is append-only';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END
$$;

CREATE FUNCTION protect_inventory_movement_append_only() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF current_setting('bold.inventory_ledger_maintenance', true) = 'on' THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'InventoryMovement is append-only; create a reversal movement instead';
END
$$;

CREATE FUNCTION protect_product_variant_cost() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF NEW."cost_price" IS DISTINCT FROM OLD."cost_price"
     AND current_setting(
       'bold.inventory_cost_materialization_write',
       true
     ) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION
      'ProductVariant.cost_price is maintained by the inventory cost ledger';
  END IF;

  RETURN NEW;
END
$$;

CREATE FUNCTION protect_purchase_accounting_document() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF current_setting(
       'bold.purchase_accounting_maintenance',
       true
     ) = 'on' THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE'
     AND current_setting(
       'bold.purchase_accounting_document_write',
       true
     ) = 'on' THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION
    '% is an immutable posted accounting document',
    TG_TABLE_NAME;
END
$$;

CREATE FUNCTION protect_transfer_append_only_record() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF current_setting('bold.transfer_maintenance', true) = 'on' THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;
  RAISE EXCEPTION
    '% is append-only; create a new transfer command or correction movement',
    TG_TABLE_NAME;
END
$$;

CREATE FUNCTION protect_transfer_posted_documents() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  item_count BIGINT;
  incomplete_shipment_count BIGINT;
  resolved_quantity BIGINT;
  outstanding_quantity BIGINT;
BEGIN
  IF current_setting('bold.transfer_maintenance', true) = 'on' THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;

  IF current_setting('bold.transfer_command', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION
      'Transfer documents are immutable outside the transfer command service';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION
      'Transfer documents cannot be deleted by a transfer command';
  END IF;

  IF TG_TABLE_NAME = 'Transfer' THEN
    IF OLD."from_branch_id" IS DISTINCT FROM NEW."from_branch_id"
       OR OLD."to_branch_id" IS DISTINCT FROM NEW."to_branch_id"
       OR OLD."transfer_number" IS DISTINCT FROM NEW."transfer_number"
       OR OLD."idempotency_key" IS DISTINCT FROM NEW."idempotency_key"
       OR OLD."command_fingerprint" IS DISTINCT FROM NEW."command_fingerprint"
       OR OLD."created_by" IS DISTINCT FROM NEW."created_by"
       OR OLD."created_at" IS DISTINCT FROM NEW."created_at" THEN
      RAISE EXCEPTION 'Transfer identity fields are immutable';
    END IF;

    IF OLD."status"::text IS DISTINCT FROM NEW."status"::text
       AND NOT (
         (
           OLD."status"::text = 'pending'
           AND NEW."status"::text IN ('shipped', 'cancelled')
         )
         OR
         (
           OLD."status"::text = 'shipped'
           AND NEW."status"::text IN ('partially_received', 'received')
         )
         OR
         (
           OLD."status"::text = 'partially_received'
           AND NEW."status"::text = 'received'
         )
       ) THEN
      RAISE EXCEPTION
        'Invalid transfer state transition from % to %',
        OLD."status"::text,
        NEW."status"::text;
    END IF;

    SELECT
      COUNT(*),
      COUNT(*) FILTER (WHERE item."shipped_qty" <> item."qty"),
      COALESCE(SUM(
        item."received_qty" + item."damaged_qty" + item."missing_qty"
      ), 0),
      COALESCE(SUM(
        item."shipped_qty" - item."received_qty" -
        item."damaged_qty" - item."missing_qty"
      ), 0)
    INTO
      item_count,
      incomplete_shipment_count,
      resolved_quantity,
      outstanding_quantity
    FROM "TransferItem" item
    WHERE item."transfer_id" = NEW."id";

    IF item_count = 0 THEN
      RAISE EXCEPTION 'Transfer must contain at least one item';
    END IF;

    IF NEW."status"::text IN (
         'pending',
         'cancelled'
       )
       AND (resolved_quantity <> 0 OR outstanding_quantity <> 0) THEN
      RAISE EXCEPTION
        'Pending or cancelled transfers cannot contain materialized custody quantities';
    ELSIF NEW."status"::text = 'shipped'
       AND (
         incomplete_shipment_count <> 0
         OR resolved_quantity <> 0
         OR outstanding_quantity <= 0
       ) THEN
      RAISE EXCEPTION
        'Shipped transfer items must be fully shipped and unresolved';
    ELSIF NEW."status"::text = 'partially_received'
       AND (
         incomplete_shipment_count <> 0
         OR resolved_quantity <= 0
         OR outstanding_quantity <= 0
       ) THEN
      RAISE EXCEPTION
        'Partially received transfer must have resolved and outstanding units';
    ELSIF NEW."status"::text = 'received'
       AND (
         incomplete_shipment_count <> 0
         OR outstanding_quantity <> 0
       ) THEN
      RAISE EXCEPTION
        'Received transfer must resolve every shipped unit';
    END IF;
  ELSIF TG_TABLE_NAME = 'TransferItem' THEN
    IF OLD."transfer_id" IS DISTINCT FROM NEW."transfer_id"
       OR OLD."variant_id" IS DISTINCT FROM NEW."variant_id"
       OR OLD."qty" IS DISTINCT FROM NEW."qty" THEN
      RAISE EXCEPTION 'Transfer item identity and requested quantity are immutable';
    END IF;

    IF NEW."shipped_qty" < OLD."shipped_qty"
       OR NEW."received_qty" < OLD."received_qty"
       OR NEW."damaged_qty" < OLD."damaged_qty"
       OR NEW."missing_qty" < OLD."missing_qty" THEN
      RAISE EXCEPTION 'Transfer item cumulative quantities cannot decrease';
    END IF;
  END IF;

  RETURN NEW;
END
$$;

CREATE FUNCTION record_customer_return_cost_movements() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  return_record "Return"%ROWTYPE;
  item RECORD;
BEGIN
  SELECT *
  INTO return_record
  FROM "Return"
  WHERE "id" = NEW."return_id";

  IF NOT FOUND OR return_record."status" <> 'completed' THEN
    RETURN NEW;
  END IF;

  -- A deferred row trigger fires once per line. The first invocation posts the
  -- complete return in deterministic variant order; later invocations become
  -- idempotent no-ops.
  IF EXISTS (
    SELECT 1
    FROM "InventoryCostMovement" movement
    WHERE movement."movement_type" = 'customer_return'
      AND movement."reference_type" = 'Return'
      AND movement."reference_id" = return_record."id"::text
  ) THEN
    RETURN NEW;
  END IF;

  FOR item IN
    SELECT
      line."variant_id",
      SUM(line."qty")::integer AS "qty",
      ROUND(
        SUM(line."unit_cost" * line."qty"),
        2
      )::numeric(18, 2) AS "movement_value"
    FROM "ReturnItem" line
    WHERE line."return_id" = return_record."id"
    GROUP BY line."variant_id"
    ORDER BY line."variant_id"
  LOOP
    PERFORM "record_inventory_cost_movement"(
      item."variant_id",
      return_record."branch_id",
      'customer_return'::"InventoryCostMovementType",
      item."qty",
      item."movement_value",
      'Return',
      return_record."id"::text,
      item."variant_id"::text,
      NULL,
      NULL,
      NULL,
      NULL,
      'customer-return-cost:'
        || return_record."id"::text
        || ':'
        || item."variant_id"::text,
      return_record."created_at",
      return_record."created_by",
      NULL,
      jsonb_build_object(
        'original_invoice_id',
        return_record."original_invoice_id",
        'return_invoice_number',
        return_record."return_invoice_number"
      )
    );
  END LOOP;

  RETURN NEW;
END
$$;

CREATE FUNCTION record_inventory_cost_movement(p_variant_id uuid, p_branch_id uuid, p_movement_type "InventoryCostMovementType", p_quantity_delta integer, p_movement_value numeric, p_reference_type text, p_reference_id text, p_reference_line_id text, p_purchase_invoice_id uuid, p_purchase_invoice_item_id uuid, p_supplier_return_id uuid, p_supplier_return_item_id uuid, p_idempotency_key text, p_occurred_at timestamp without time zone, p_created_by uuid, p_restore_cost numeric, p_metadata jsonb DEFAULT NULL::jsonb) RETURNS uuid
    LANGUAGE plpgsql
    AS $$
DECLARE
  existing "InventoryCostMovement"%ROWTYPE;
  existing_found BOOLEAN := false;
  latest "InventoryCostMovement"%ROWTYPE;
  current_cost NUMERIC(12, 2);
  v_tenant_id UUID;
  current_quantity_big BIGINT;
  current_quantity INTEGER;
  previous_quantity BIGINT;
  calculated_cost NUMERIC;
  next_cost NUMERIC(12, 2);
  value_before NUMERIC(18, 2);
  value_after NUMERIC(18, 2);
  rounding_delta NUMERIC(18, 2);
  movement_id UUID;
BEGIN
  IF p_quantity_delta = 0 THEN
    RAISE EXCEPTION 'Inventory cost movement quantity delta cannot be zero';
  END IF;

  SELECT variant."cost_price", variant."tenant_id"
  INTO current_cost, v_tenant_id
  FROM "ProductVariant" variant
  WHERE variant."id" = p_variant_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ProductVariant % does not exist', p_variant_id;
  END IF;

  SELECT *
  INTO existing
  FROM "InventoryCostMovement"
  WHERE "idempotency_key" = p_idempotency_key;
  existing_found := FOUND;

  IF existing_found THEN
    IF existing."variant_id" <> p_variant_id
       OR existing."branch_id" IS DISTINCT FROM p_branch_id
       OR existing."movement_type" <> p_movement_type
       OR existing."quantity_delta" <> p_quantity_delta
       OR existing."movement_value" <> p_movement_value
       OR existing."reference_type" <> p_reference_type
       OR existing."reference_id" <> p_reference_id
       OR existing."reference_line_id" IS DISTINCT FROM p_reference_line_id
       OR existing."purchase_invoice_id" IS DISTINCT FROM p_purchase_invoice_id
       OR existing."purchase_invoice_item_id" IS DISTINCT FROM p_purchase_invoice_item_id
       OR existing."supplier_return_id" IS DISTINCT FROM p_supplier_return_id
       OR existing."supplier_return_item_id" IS DISTINCT FROM p_supplier_return_item_id
       OR (
         p_movement_type = 'purchase_reversal'
         AND existing."cost_after" IS DISTINCT FROM p_restore_cost
       ) THEN
      RAISE EXCEPTION
        'Inventory cost movement idempotency key belongs to a different command: %',
        p_idempotency_key;
    END IF;
  END IF;

  SELECT
    COALESCE((
      SELECT SUM(stock."qty_on_hand")
      FROM "InventoryStock" stock
      WHERE stock."variant_id" = p_variant_id
    ), 0)
    +
    COALESCE((
      SELECT SUM(
        item."shipped_qty" - item."received_qty" -
        item."damaged_qty" - item."missing_qty"
      )
      FROM "TransferItem" item
      WHERE item."variant_id" = p_variant_id
    ), 0)
  INTO current_quantity_big;

  IF current_quantity_big < -2147483648
     OR current_quantity_big > 2147483647 THEN
    RAISE EXCEPTION
      'Invalid global inventory quantity for variant %: %',
      p_variant_id,
      current_quantity_big;
  END IF;

  current_quantity := current_quantity_big::integer;

  SELECT *
  INTO latest
  FROM "InventoryCostMovement"
  WHERE "variant_id" = p_variant_id
  ORDER BY "sequence" DESC
  LIMIT 1;

  IF existing_found THEN
    IF latest."id" IS NULL
       OR latest."cost_after" <> current_cost THEN
      RAISE EXCEPTION
        'Inventory cost ledger mismatch after idempotent replay for variant %: ledger cost %, materialized cost %',
        p_variant_id,
        latest."cost_after",
        current_cost;
    END IF;

    RETURN existing."id";
  END IF;

  previous_quantity := current_quantity_big - p_quantity_delta::bigint;

  IF previous_quantity < -2147483648
     OR previous_quantity > 2147483647 THEN
    RAISE EXCEPTION
      'Invalid global inventory quantity transition for variant %: previous %, delta %, current %',
      p_variant_id,
      previous_quantity,
      p_quantity_delta,
      current_quantity_big;
  END IF;

  IF latest."id" IS NULL AND previous_quantity > 0 THEN
    INSERT INTO "InventoryCostMovement" (
      "variant_id",
      "movement_type",
      "quantity_delta",
      "global_quantity_before",
      "global_quantity_after",
      "unit_cost",
      "cost_before",
      "cost_after",
      "inventory_value_before",
      "movement_value",
      "inventory_value_after",
      "rounding_adjustment",
      "reference_type",
      "reference_id",
      "idempotency_key",
      "occurred_at",
      "metadata",
      "tenant_id"
    ) VALUES (
      p_variant_id,
      'opening_balance',
      previous_quantity::integer,
      0,
      previous_quantity::integer,
      current_cost::numeric(18, 6),
      0,
      current_cost,
      0,
      ROUND(previous_quantity * current_cost, 2),
      ROUND(previous_quantity * current_cost, 2),
      0,
      'InventoryStock',
      p_variant_id::text,
      'cost-auto-opening:' || p_variant_id::text,
      p_occurred_at,
      jsonb_build_object(
        'reason', 'first post-cost-ledger receipt on an uninitialized variant'
      ),
      v_tenant_id
    )
    ON CONFLICT ("idempotency_key") DO NOTHING;

    SELECT *
    INTO latest
    FROM "InventoryCostMovement"
    WHERE "variant_id" = p_variant_id
    ORDER BY "sequence" DESC
    LIMIT 1;
  END IF;

  IF latest."id" IS NOT NULL
     AND latest."cost_after" <> current_cost THEN
    RAISE EXCEPTION
      'Inventory cost ledger mismatch for variant %: ledger cost %, materialized cost %',
      p_variant_id,
      latest."cost_after",
      current_cost;
  END IF;

  IF p_movement_type IN ('purchase_receipt', 'customer_return') THEN
    IF p_quantity_delta <= 0 OR p_movement_value < 0 THEN
      RAISE EXCEPTION 'Invalid incoming inventory cost movement';
    END IF;

    IF current_quantity <= 0 THEN
      calculated_cost := current_cost;
    ELSIF previous_quantity < 0 THEN
      calculated_cost := p_movement_value / p_quantity_delta;
    ELSE
      calculated_cost :=
        (
          (current_cost * previous_quantity) + p_movement_value
        ) / current_quantity;
    END IF;
    IF calculated_cost < 0 OR calculated_cost > 9999999999.99 THEN
      RAISE EXCEPTION
        'Calculated moving-average cost is outside DECIMAL(12,2) range for variant %',
        p_variant_id;
    END IF;
    next_cost := ROUND(calculated_cost, 2);
  ELSIF p_movement_type = 'purchase_reversal' THEN
    IF p_quantity_delta >= 0 OR p_movement_value > 0 OR p_restore_cost IS NULL THEN
      RAISE EXCEPTION 'Invalid purchase reversal cost movement';
    END IF;

    next_cost := p_restore_cost;
  ELSIF p_movement_type = 'supplier_return' THEN
    IF p_quantity_delta >= 0
       OR p_movement_value > 0
       OR p_restore_cost IS NOT NULL
       OR p_movement_value <> ROUND(p_quantity_delta * current_cost, 2) THEN
      RAISE EXCEPTION
        'Supplier return must remove inventory at the current moving-average cost';
    END IF;

    next_cost := current_cost;
  ELSE
    RAISE EXCEPTION
      'Unsupported inventory cost movement type for posting function: %',
      p_movement_type;
  END IF;

  IF p_quantity_delta < 0 AND current_quantity < 0 THEN
    RAISE EXCEPTION
      'Outgoing cost movement cannot deepen a negative inventory deficit';
  END IF;

  IF next_cost < 0 THEN
    RAISE EXCEPTION 'Inventory cost cannot become negative';
  END IF;

  IF previous_quantity < 0
     AND p_movement_type IN ('purchase_receipt', 'customer_return') THEN
    p_metadata :=
      COALESCE(p_metadata, '{}'::jsonb) ||
      jsonb_build_object(
        'negative_inventory_units_covered',
        LEAST(p_quantity_delta::bigint, ABS(previous_quantity))
      );
  END IF;

  IF previous_quantity * current_cost > 9999999999999999.99
     OR current_quantity_big * next_cost > 9999999999999999.99
     OR ABS(p_movement_value) > 9999999999999999.99 THEN
    RAISE EXCEPTION
      'Inventory value is outside DECIMAL(18,2) range for variant %',
      p_variant_id;
  END IF;

  value_before := ROUND(GREATEST(previous_quantity, 0) * current_cost, 2);
  value_after := ROUND(GREATEST(current_quantity_big, 0) * next_cost, 2);
  rounding_delta := value_after - (value_before + p_movement_value);

  INSERT INTO "InventoryCostMovement" (
    "variant_id",
    "branch_id",
    "movement_type",
    "quantity_delta",
    "global_quantity_before",
    "global_quantity_after",
    "unit_cost",
    "cost_before",
    "cost_after",
    "inventory_value_before",
    "movement_value",
    "inventory_value_after",
    "rounding_adjustment",
    "reference_type",
    "reference_id",
    "reference_line_id",
    "purchase_invoice_id",
    "purchase_invoice_item_id",
    "supplier_return_id",
    "supplier_return_item_id",
    "idempotency_key",
    "occurred_at",
    "created_by",
    "metadata",
    "tenant_id"
  ) VALUES (
    p_variant_id,
    p_branch_id,
    p_movement_type,
    p_quantity_delta,
    previous_quantity::integer,
    current_quantity,
    CASE
      WHEN p_quantity_delta = 0 THEN 0
      ELSE ABS(p_movement_value / p_quantity_delta)::numeric(18, 6)
    END,
    current_cost,
    next_cost,
    value_before,
    p_movement_value,
    value_after,
    rounding_delta,
    p_reference_type,
    p_reference_id,
    p_reference_line_id,
    p_purchase_invoice_id,
    p_purchase_invoice_item_id,
    p_supplier_return_id,
    p_supplier_return_item_id,
    p_idempotency_key,
    p_occurred_at,
    p_created_by,
    p_metadata,
    v_tenant_id
  )
  RETURNING "id" INTO movement_id;

  IF p_movement_type = 'purchase_receipt' THEN
    IF p_purchase_invoice_id IS NULL
       OR p_purchase_invoice_item_id IS NULL THEN
      RAISE EXCEPTION
        'Purchase receipt cost movements require invoice and line references';
    END IF;

    PERFORM set_config(
      'bold.purchase_accounting_document_write',
      'on',
      true
    );
    UPDATE "PurchaseInvoiceItem"
    SET
      "global_qty_before" = previous_quantity::integer,
      "global_qty_after" = current_quantity,
      "cost_before" = current_cost,
      "cost_after" = next_cost
    WHERE "id" = p_purchase_invoice_item_id
      AND "purchase_invoice_id" = p_purchase_invoice_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION
        'PurchaseInvoiceItem % does not belong to PurchaseInvoice %',
        p_purchase_invoice_item_id,
        p_purchase_invoice_id;
    END IF;

    PERFORM set_config(
      'bold.purchase_accounting_document_write',
      'off',
      true
    );
  END IF;

  PERFORM set_config(
    'bold.inventory_cost_materialization_write',
    'on',
    true
  );
  UPDATE "ProductVariant"
  SET "cost_price" = next_cost
  WHERE "id" = p_variant_id;
  PERFORM set_config(
    'bold.inventory_cost_materialization_write',
    'off',
    true
  );

  RETURN movement_id;
END
$$;

CREATE FUNCTION record_inventory_movement(p_branch_id uuid, p_variant_id uuid, p_movement_type "InventoryMovementType", p_on_hand_delta integer, p_reserved_delta integer, p_reference_type text, p_reference_id text, p_reference_line_id text, p_idempotency_key text, p_occurred_at timestamp without time zone, p_created_by uuid, p_metadata jsonb DEFAULT NULL::jsonb) RETURNS uuid
    LANGUAGE plpgsql
    AS $$
DECLARE
  existing "InventoryMovement"%ROWTYPE;
  existing_found BOOLEAN := false;
  current_on_hand INTEGER;
  current_reserved INTEGER;
  v_tenant_id UUID;
  movement_count BIGINT;
  ledger_on_hand BIGINT;
  ledger_reserved BIGINT;
  previous_on_hand BIGINT;
  previous_reserved BIGINT;
  movement_id UUID;
BEGIN
  IF p_on_hand_delta = 0 AND p_reserved_delta = 0 THEN
    RAISE EXCEPTION 'Inventory movement must change on-hand or reserved quantity';
  END IF;

  SELECT *
  INTO existing
  FROM "InventoryMovement"
  WHERE "idempotency_key" = p_idempotency_key;
  existing_found := FOUND;

  SELECT stock."qty_on_hand", stock."qty_reserved", stock."tenant_id"
  INTO current_on_hand, current_reserved, v_tenant_id
  FROM "InventoryStock" stock
  WHERE stock."branch_id" = p_branch_id
    AND stock."variant_id" = p_variant_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'InventoryStock row does not exist for branch % and variant %', p_branch_id, p_variant_id;
  END IF;

  SELECT
    COUNT(*),
    COALESCE(SUM(movement."on_hand_delta"), 0),
    COALESCE(SUM(movement."reserved_delta"), 0)
  INTO movement_count, ledger_on_hand, ledger_reserved
  FROM "InventoryMovement" movement
  WHERE movement."branch_id" = p_branch_id
    AND movement."variant_id" = p_variant_id;

  IF existing_found THEN
    IF existing."branch_id" <> p_branch_id
       OR existing."variant_id" <> p_variant_id
       OR existing."movement_type" <> p_movement_type
       OR existing."on_hand_delta" <> p_on_hand_delta
       OR existing."reserved_delta" <> p_reserved_delta
       OR existing."reference_type" <> p_reference_type
       OR existing."reference_id" <> p_reference_id
       OR existing."reference_line_id" IS DISTINCT FROM p_reference_line_id THEN
      RAISE EXCEPTION 'Inventory movement idempotency key belongs to a different command: %', p_idempotency_key;
    END IF;

    IF ledger_on_hand <> current_on_hand OR ledger_reserved <> current_reserved THEN
      RAISE EXCEPTION
        'Inventory ledger mismatch after idempotent replay for branch % variant %: ledger=(%,%), stock=(%,%)',
        p_branch_id,
        p_variant_id,
        ledger_on_hand,
        ledger_reserved,
        current_on_hand,
        current_reserved;
    END IF;
    RETURN existing."id";
  END IF;

  IF movement_count = 0 THEN
    previous_on_hand := current_on_hand::BIGINT - p_on_hand_delta::BIGINT;
    previous_reserved := current_reserved::BIGINT - p_reserved_delta::BIGINT;

    IF previous_on_hand < 0
       OR previous_reserved < 0
       OR previous_reserved > previous_on_hand
       OR previous_on_hand > 2147483647
       OR previous_reserved > 2147483647 THEN
      RAISE EXCEPTION 'Cannot infer a valid opening inventory balance for branch % and variant %', p_branch_id, p_variant_id;
    END IF;

    IF previous_on_hand <> 0 OR previous_reserved <> 0 THEN
      INSERT INTO "InventoryMovement" (
        "branch_id",
        "variant_id",
        "movement_type",
        "on_hand_delta",
        "reserved_delta",
        "on_hand_after",
        "reserved_after",
        "reference_type",
        "reference_id",
        "idempotency_key",
        "occurred_at",
        "metadata",
        "tenant_id"
      ) VALUES (
        p_branch_id,
        p_variant_id,
        'opening_balance',
        previous_on_hand::INTEGER,
        previous_reserved::INTEGER,
        previous_on_hand::INTEGER,
        previous_reserved::INTEGER,
        'InventoryStock',
        p_branch_id::text || ':' || p_variant_id::text,
        'auto-opening:' || p_branch_id::text || ':' || p_variant_id::text,
        p_occurred_at,
        jsonb_build_object(
          'reason', 'first post-ledger movement on an uninitialized stock row'
        ),
        v_tenant_id
      )
      ON CONFLICT ("idempotency_key") DO NOTHING;
    END IF;

    ledger_on_hand := previous_on_hand;
    ledger_reserved := previous_reserved;
  END IF;

  IF ledger_on_hand + p_on_hand_delta <> current_on_hand
     OR ledger_reserved + p_reserved_delta <> current_reserved THEN
    RAISE EXCEPTION
      'Inventory ledger mismatch for branch % variant %: ledger=(%,%), delta=(%,%), stock=(%,%)',
      p_branch_id,
      p_variant_id,
      ledger_on_hand,
      ledger_reserved,
      p_on_hand_delta,
      p_reserved_delta,
      current_on_hand,
      current_reserved;
  END IF;

  INSERT INTO "InventoryMovement" (
    "branch_id",
    "variant_id",
    "movement_type",
    "on_hand_delta",
    "reserved_delta",
    "on_hand_after",
    "reserved_after",
    "reference_type",
    "reference_id",
    "reference_line_id",
    "idempotency_key",
    "occurred_at",
    "created_by",
    "metadata",
    "tenant_id"
  ) VALUES (
    p_branch_id,
    p_variant_id,
    p_movement_type,
    p_on_hand_delta,
    p_reserved_delta,
    current_on_hand,
    current_reserved,
    p_reference_type,
    p_reference_id,
    p_reference_line_id,
    p_idempotency_key,
    p_occurred_at,
    p_created_by,
    p_metadata,
    v_tenant_id
  )
  RETURNING "id" INTO movement_id;

  RETURN movement_id;
END
$$;

CREATE FUNCTION record_return_inventory_movement() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  return_branch_id UUID;
  return_number TEXT;
  return_status "ReturnStatus";
  return_created_at TIMESTAMP(3);
  return_created_by UUID;
  original_invoice_id UUID;
BEGIN
  SELECT
    return_record."branch_id",
    return_record."return_invoice_number",
    return_record."status",
    return_record."created_at",
    return_record."created_by",
    return_record."original_invoice_id"
  INTO
    return_branch_id,
    return_number,
    return_status,
    return_created_at,
    return_created_by,
    original_invoice_id
  FROM "Return" return_record
  WHERE return_record."id" = NEW."return_id";

  IF return_status <> 'completed'::"ReturnStatus" THEN
    RETURN NEW;
  END IF;

  PERFORM "record_inventory_movement"(
    return_branch_id::uuid,
    NEW."variant_id"::uuid,
    'return'::"InventoryMovementType",
    NEW."qty"::integer,
    0::integer,
    'Return'::text,
    NEW."return_id"::text,
    NEW."id"::text,
    ('return:' || NEW."id"::text)::text,
    return_created_at::timestamp(3),
    return_created_by::uuid,
    jsonb_build_object(
      'return_invoice_number', return_number,
      'original_invoice_id', original_invoice_id
    )::jsonb
  );

  RETURN NEW;
END
$$;

CREATE FUNCTION record_transfer_item_movements() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  transfer_record "Transfer"%ROWTYPE;
  shipped_delta INTEGER;
  received_delta INTEGER;
  damaged_delta INTEGER;
  missing_delta INTEGER;
  transit_cursor INTEGER;
  final_transit INTEGER;
BEGIN
  SELECT * INTO transfer_record
  FROM "Transfer"
  WHERE "id" = NEW."transfer_id";

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Transfer % does not exist', NEW."transfer_id";
  END IF;

  shipped_delta := NEW."shipped_qty" - OLD."shipped_qty";
  received_delta := NEW."received_qty" - OLD."received_qty";
  damaged_delta := NEW."damaged_qty" - OLD."damaged_qty";
  missing_delta := NEW."missing_qty" - OLD."missing_qty";

  IF shipped_delta < 0
     OR received_delta < 0
     OR damaged_delta < 0
     OR missing_delta < 0 THEN
    RAISE EXCEPTION
      'Transfer item cumulative quantities cannot decrease outside a correction workflow';
  END IF;

  IF shipped_delta > 0
     AND transfer_record."status"::text NOT IN (
       'shipped',
       'partially_received',
       'received'
     ) THEN
    RAISE EXCEPTION
      'Transfer item shipment requires a shipped transfer state';
  END IF;

  IF (received_delta > 0 OR damaged_delta > 0 OR missing_delta > 0)
     AND transfer_record."status"::text NOT IN (
       'partially_received',
       'received'
     ) THEN
    RAISE EXCEPTION
      'Transfer item resolution requires a receiving transfer state';
  END IF;

  transit_cursor :=
    OLD."shipped_qty" - OLD."received_qty" -
    OLD."damaged_qty" - OLD."missing_qty";
  final_transit :=
    NEW."shipped_qty" - NEW."received_qty" -
    NEW."damaged_qty" - NEW."missing_qty";

  IF shipped_delta > 0 THEN
    transit_cursor := transit_cursor + shipped_delta;

    PERFORM "record_inventory_movement"(
      transfer_record."from_branch_id"::uuid,
      NEW."variant_id"::uuid,
      'transfer_out'::"InventoryMovementType",
      (-shipped_delta)::integer,
      0::integer,
      'Transfer'::text,
      NEW."transfer_id"::text,
      NEW."id"::text,
      (
        'transfer-out:' || NEW."id"::text || ':' ||
        NEW."shipped_qty"::text
      )::text,
      COALESCE(
        transfer_record."shipped_at",
        CURRENT_TIMESTAMP::timestamp(3)
      )::timestamp(3),
      transfer_record."shipped_by"::uuid,
      jsonb_build_object(
        'transfer_number', transfer_record."transfer_number"
      )::jsonb
    );

    INSERT INTO "TransferTransitMovement" (
      "transfer_id", "transfer_item_id", "variant_id", "movement_type",
      "quantity_delta", "in_transit_after", "idempotency_key",
      "occurred_at", "created_by", "metadata", "tenant_id"
    ) VALUES (
      NEW."transfer_id",
      NEW."id",
      NEW."variant_id",
      'shipped'::"TransferTransitMovementType",
      shipped_delta,
      transit_cursor,
      'transit-shipped:' || NEW."id"::text || ':' || NEW."shipped_qty"::text,
      COALESCE(
        transfer_record."shipped_at",
        CURRENT_TIMESTAMP::timestamp(3)
      )::timestamp(3),
      transfer_record."shipped_by",
      jsonb_build_object(
        'transfer_number', transfer_record."transfer_number"
      ),
      transfer_record."tenant_id"
    );
  END IF;

  IF received_delta > 0 THEN
    transit_cursor := transit_cursor - received_delta;

    PERFORM "record_inventory_movement"(
      transfer_record."to_branch_id"::uuid,
      NEW."variant_id"::uuid,
      'transfer_in'::"InventoryMovementType",
      received_delta::integer,
      0::integer,
      'Transfer'::text,
      NEW."transfer_id"::text,
      NEW."id"::text,
      (
        'transfer-in:' || NEW."id"::text || ':' ||
        NEW."received_qty"::text
      )::text,
      CURRENT_TIMESTAMP::timestamp(3),
      transfer_record."received_by"::uuid,
      jsonb_build_object(
        'transfer_number', transfer_record."transfer_number"
      )::jsonb
    );

    INSERT INTO "TransferTransitMovement" (
      "transfer_id", "transfer_item_id", "variant_id", "movement_type",
      "quantity_delta", "in_transit_after", "idempotency_key",
      "occurred_at", "created_by", "tenant_id"
    ) VALUES (
      NEW."transfer_id",
      NEW."id",
      NEW."variant_id",
      'received'::"TransferTransitMovementType",
      -received_delta,
      transit_cursor,
      'transit-received:' || NEW."id"::text || ':' || NEW."received_qty"::text,
      CURRENT_TIMESTAMP::timestamp(3),
      transfer_record."received_by",
      transfer_record."tenant_id"
    );
  END IF;

  IF damaged_delta > 0 THEN
    transit_cursor := transit_cursor - damaged_delta;

    INSERT INTO "TransferTransitMovement" (
      "transfer_id", "transfer_item_id", "variant_id", "movement_type",
      "quantity_delta", "in_transit_after", "idempotency_key",
      "occurred_at", "created_by", "tenant_id"
    ) VALUES (
      NEW."transfer_id",
      NEW."id",
      NEW."variant_id",
      'damaged'::"TransferTransitMovementType",
      -damaged_delta,
      transit_cursor,
      'transit-damaged:' || NEW."id"::text || ':' || NEW."damaged_qty"::text,
      CURRENT_TIMESTAMP::timestamp(3),
      transfer_record."received_by",
      transfer_record."tenant_id"
    );
  END IF;

  IF missing_delta > 0 THEN
    transit_cursor := transit_cursor - missing_delta;

    INSERT INTO "TransferTransitMovement" (
      "transfer_id", "transfer_item_id", "variant_id", "movement_type",
      "quantity_delta", "in_transit_after", "idempotency_key",
      "occurred_at", "created_by", "tenant_id"
    ) VALUES (
      NEW."transfer_id",
      NEW."id",
      NEW."variant_id",
      'missing'::"TransferTransitMovementType",
      -missing_delta,
      transit_cursor,
      'transit-missing:' || NEW."id"::text || ':' || NEW."missing_qty"::text,
      CURRENT_TIMESTAMP::timestamp(3),
      transfer_record."received_by",
      transfer_record."tenant_id"
    );
  END IF;

  IF transit_cursor <> final_transit THEN
    RAISE EXCEPTION
      'Transfer transit balance mismatch for item %: calculated %, materialized %',
      NEW."id",
      transit_cursor,
      final_transit;
  END IF;

  RETURN NEW;
END
$$;

SET default_tablespace = '';

SET default_table_access_method = heap;

-- ======================================================================
-- Triggers
-- ======================================================================

CREATE TRIGGER "InventoryCostMovement_append_only" BEFORE DELETE OR UPDATE ON "InventoryCostMovement" FOR EACH ROW EXECUTE FUNCTION protect_inventory_cost_movement();

CREATE TRIGGER "InventoryMovement_append_only" BEFORE DELETE OR UPDATE ON "InventoryMovement" FOR EACH ROW EXECUTE FUNCTION protect_inventory_movement_append_only();

CREATE TRIGGER "ProductVariant_cost_ledger_guard" BEFORE UPDATE OF cost_price ON "ProductVariant" FOR EACH ROW EXECUTE FUNCTION protect_product_variant_cost();

CREATE TRIGGER "PurchaseInvoiceItem_immutable" BEFORE DELETE OR UPDATE ON "PurchaseInvoiceItem" FOR EACH ROW EXECUTE FUNCTION protect_purchase_accounting_document();

CREATE TRIGGER "PurchaseInvoice_immutable" BEFORE DELETE OR UPDATE ON "PurchaseInvoice" FOR EACH ROW EXECUTE FUNCTION protect_purchase_accounting_document();

CREATE CONSTRAINT TRIGGER "ReturnItem_cost_movement" AFTER INSERT ON "ReturnItem" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION record_customer_return_cost_movements();

CREATE CONSTRAINT TRIGGER "ReturnItem_inventory_movement" AFTER INSERT ON "ReturnItem" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION record_return_inventory_movement();

CREATE TRIGGER "SupplierReturnItem_immutable" BEFORE DELETE OR UPDATE ON "SupplierReturnItem" FOR EACH ROW EXECUTE FUNCTION protect_purchase_accounting_document();

CREATE TRIGGER "SupplierReturn_immutable" BEFORE DELETE OR UPDATE ON "SupplierReturn" FOR EACH ROW EXECUTE FUNCTION protect_purchase_accounting_document();

CREATE TRIGGER "TransferCommand_append_only" BEFORE DELETE OR UPDATE ON "TransferCommand" FOR EACH ROW EXECUTE FUNCTION protect_transfer_append_only_record();

CREATE CONSTRAINT TRIGGER "TransferItem_inventory_and_transit_movements" AFTER UPDATE OF shipped_qty, received_qty, damaged_qty, missing_qty ON "TransferItem" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION record_transfer_item_movements();

CREATE TRIGGER "TransferItem_protect_posted_document" BEFORE DELETE OR UPDATE ON "TransferItem" FOR EACH ROW EXECUTE FUNCTION protect_transfer_posted_documents();

CREATE TRIGGER "TransferTransitMovement_append_only" BEFORE DELETE OR UPDATE ON "TransferTransitMovement" FOR EACH ROW EXECUTE FUNCTION protect_transfer_append_only_record();

CREATE TRIGGER "Transfer_protect_posted_document" BEFORE DELETE OR UPDATE ON "Transfer" FOR EACH ROW EXECUTE FUNCTION protect_transfer_posted_documents();

CREATE TRIGGER athr_sales_tax_snapshot_no_update BEFORE UPDATE ON "SalesTaxSnapshot" FOR EACH ROW EXECUTE FUNCTION athr_sales_tax_snapshot_immutable();

CREATE TRIGGER bold_inventory_sync_change AFTER INSERT OR DELETE OR UPDATE ON "InventoryStock" FOR EACH ROW EXECUTE FUNCTION bold_emit_inventory_sync_change();

CREATE TRIGGER bold_price_book_entry_sync_change AFTER INSERT OR DELETE OR UPDATE ON "PriceBookEntry" FOR EACH ROW EXECUTE FUNCTION bold_emit_pricing_sync_change();

CREATE TRIGGER bold_price_book_sync_change AFTER UPDATE ON "PriceBook" FOR EACH ROW WHEN (((old.status IS DISTINCT FROM new.status) OR (old.is_default IS DISTINCT FROM new.is_default))) EXECUTE FUNCTION bold_emit_pricing_sync_change();

CREATE TRIGGER bold_pricing_rule_sync_change AFTER INSERT OR DELETE OR UPDATE ON "PricingRule" FOR EACH ROW EXECUTE FUNCTION bold_emit_pricing_sync_change();

CREATE TRIGGER bold_product_sync_change AFTER INSERT OR DELETE OR UPDATE ON "Product" FOR EACH ROW EXECUTE FUNCTION bold_emit_product_sync_change();

CREATE TRIGGER bold_product_tax_category_sync_change AFTER UPDATE ON "Product" FOR EACH ROW WHEN ((old.tax_category_id IS DISTINCT FROM new.tax_category_id)) EXECUTE FUNCTION bold_emit_pricing_sync_change();

CREATE TRIGGER bold_tax_code_sync_change AFTER UPDATE ON "TaxCode" FOR EACH ROW WHEN ((old.status IS DISTINCT FROM new.status)) EXECUTE FUNCTION bold_emit_pricing_sync_change();

CREATE TRIGGER bold_variant_sync_change AFTER INSERT OR DELETE OR UPDATE ON "ProductVariant" FOR EACH ROW EXECUTE FUNCTION bold_emit_variant_sync_change();

CREATE TRIGGER bold_variant_tax_category_sync_change AFTER UPDATE ON "ProductVariant" FOR EACH ROW WHEN ((old.tax_category_id IS DISTINCT FROM new.tax_category_id)) EXECUTE FUNCTION bold_emit_pricing_sync_change();

-- ======================================================================
-- Comments
-- ======================================================================

COMMENT ON FUNCTION record_inventory_movement(p_branch_id uuid, p_variant_id uuid, p_movement_type "InventoryMovementType", p_on_hand_delta integer, p_reserved_delta integer, p_reference_type text, p_reference_id text, p_reference_line_id text, p_idempotency_key text, p_occurred_at timestamp without time zone, p_created_by uuid, p_metadata jsonb) IS 'Audits an inventory balance already mutated inside the owning business transaction. Sales are written explicitly by SalesService; returns and transfers retain their semantic database triggers.';

COMMENT ON CONSTRAINT "InventoryCostMovement_quantity_consistency" ON "InventoryCostMovement" IS 'Global cost quantities may cross a negative offline-sales deficit; every movement must remain nonzero and arithmetically exact.';

COMMENT ON CONSTRAINT "InventoryMovement_reserved_not_above_available_on_hand" ON "InventoryMovement" IS 'The ledger may record negative on-hand from accepted offline sales; reservations remain bounded by positive available stock.';

COMMENT ON CONSTRAINT "InventoryStock_reserved_not_above_available_on_hand" ON "InventoryStock" IS 'Reserved stock remains nonnegative and cannot exceed positive on-hand stock; offline sales may make on-hand negative.';
