import { randomUUID } from 'crypto';
import { Prisma } from '@prisma/client';
import { TENANT_A } from './cross-tenant-harness';

/**
 * Schema-faithful row builders for the `*.cross-tenant.spec.ts` fixtures.
 *
 * ## The contract
 *
 * When a new mandatory column lands in `prisma/schema.prisma`, it gets a
 * default **here, once** — not in every spec that happens to seed that
 * entity. A spec asks for `aProductVariant({ tenant_id: TENANT_B })` and
 * receives a row carrying every column the schema requires; the fields a
 * given test actually reasons about are the ones it passes as overrides, so
 * the test reads as the assertion it is making rather than as a schema dump.
 *
 * Two rules keep that contract honest:
 *
 * 1. **Defaults are schema-valid.** Every column that is required and has no
 *    database default is present here with a value of the right type. Where
 *    the schema says `Decimal`, the default is a `Prisma.Decimal` — the same
 *    type the real client returns. A fixture that hands production a bare
 *    `number` where the database would hand it a `Decimal` lets a test pass
 *    over arithmetic that would throw or silently mis-round in production
 *    (`src/common/money-contract.spec.ts` is the standing guard on that in
 *    the other direction). Overrides are applied verbatim and are *not*
 *    coerced: a caller that overrides a money column is responsible for
 *    passing a `Prisma.Decimal` too.
 *
 * 2. **Defaults carry columns only, never relations.** No builder pre-hydrates
 *    a nested `product: { ... }` / `branch: { ... }` object. Those stubs exist
 *    in some specs to work around the fake's missing `include` support, which
 *    is tracked separately; baking them into a default would hide that gap
 *    behind fixtures that no longer resemble a row. Pass them as an override
 *    where a test genuinely needs one.
 *
 * Overrides are `Partial<Row>` widened with an index signature, so a caller is
 * never locked out of setting a field the builder does not know about — an
 * unusual case stays possible, it just does not get to be the default.
 *
 * Builders exist for the entities seeded by more than one spec file. An entity
 * seeded in exactly one place is deliberately absent: a builder there would be
 * indirection with nothing to deduplicate. Adding one when a second caller
 * appears is a copy of any block below.
 *
 * ## Two limits of the fake these defaults run into
 *
 * `FakeTable.sort` compares with `>`, which coerces a `Prisma.Decimal` through
 * `valueOf()` to a *string* — so `orderBy` and `aggregate`'s `_max`/`_min` sort
 * a money column lexicographically, not numerically (`'9' > '100'`). No spec
 * depends on that today; a test that needs numeric ordering of a money column
 * has to arrange it explicitly rather than assume the fake provides it.
 *
 * These defaults apply to *seed* rows only. `FakeTable.create` builds a row as
 * `{ id, created_at, ...data }`, so a row a spec creates through the service
 * under test still carries only what production passed. A new mandatory column
 * is a one-file change for seeds; the create paths are unaffected either way.
 */

/**
 * A caller may override any column, and may also attach a key the builder does
 * not model (a relation stub, or a column added to the schema before a default
 * is added here).
 */
export type FixtureOverrides<TRow> = Partial<TRow> & Record<string, unknown>;

type BuiltRow<TRow> = TRow & Record<string, unknown>;

function withOverrides<TRow extends object>(
  defaults: TRow,
  overrides: FixtureOverrides<TRow>,
): BuiltRow<TRow> {
  return { ...defaults, ...overrides } as BuiltRow<TRow>;
}

/**
 * Distinguishes the human-readable defaults (`code`, `sku`, `invoice_number`)
 * of two rows built in the same run. Those columns are unique per tenant in
 * the schema, so two builder calls must not silently produce the same value.
 */
let sequence = 0;
const nextSequence = (): number => (sequence += 1);

const zero = (): Prisma.Decimal => new Prisma.Decimal(0);

/**
 * WP-008 Phase C. A stable, per-tenant `TaxCategory` id.
 *
 * `Product.tax_category_id` is NOT NULL (BR-TAX-201), so every product fixture
 * needs one. Deriving it from the tenant id rather than calling `randomUUID()`
 * per builder call means a spec that seeds a product, a variant override and a
 * `TaxCategory`/`TaxCode` all land on the same category without threading an
 * id through — while two different tenants still get different ids, so a
 * cross-tenant test cannot pass by accident on a shared constant.
 *
 * The last block of the tenant UUID is replaced rather than hashed so the
 * relationship stays legible in a failure dump: tenant `...0001` owns category
 * `...7a01`.
 */
export function taxCategoryIdFor(tenantId: string): string {
  return `${tenantId.slice(0, 24)}7a${tenantId.slice(26)}`;
}

/** The `Prisma.Decimal` 14% every pre-Phase-C fixture was implicitly priced at. */
const standardRate = (): Prisma.Decimal => new Prisma.Decimal('14.0000');

export interface BranchRow {
  id: string;
  tenant_id: string;
  code: string;
  name_ar: string;
  name_en: string | null;
  address: string | null;
  phone: string | null;
  cash_drawer_enabled: boolean;
  is_active: boolean;
  created_at: Date;
}

export function aBranch(overrides: FixtureOverrides<BranchRow> = {}): BuiltRow<BranchRow> {
  const ordinal = nextSequence();
  return withOverrides<BranchRow>(
    {
      id: randomUUID(),
      tenant_id: TENANT_A,
      code: `BR-${ordinal}`,
      name_ar: `Branch ${ordinal}`,
      name_en: null,
      address: null,
      phone: null,
      cash_drawer_enabled: false,
      is_active: true,
      created_at: new Date(),
    },
    overrides,
  );
}

export interface BrandRow {
  id: string;
  tenant_id: string;
  name: string;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

export function aBrand(overrides: FixtureOverrides<BrandRow> = {}): BuiltRow<BrandRow> {
  return withOverrides<BrandRow>(
    {
      id: randomUUID(),
      tenant_id: TENANT_A,
      name: `Brand ${nextSequence()}`,
      is_active: true,
      created_at: new Date(),
      updated_at: new Date(),
    },
    overrides,
  );
}

export interface ProductRow {
  id: string;
  tenant_id: string;
  sku_base: string | null;
  name_en: string;
  name_ar: string | null;
  category_id: string | null;
  /** Legacy free-text brand, deprecated by `brand_id` but still a column. */
  brand: string | null;
  brand_id: string | null;
  image_url: string | null;
  is_active: boolean;
  has_variants: boolean;
  /**
   * WP-008 Phase C (BR-TAX-201): NOT NULL in the schema, so the default is
   * here rather than repeated across specs. It is a per-tenant constant
   * (`taxCategoryIdFor`) so a product and its tenant's `TaxCategory` line up
   * without every spec having to seed and thread an id.
   */
  tax_category_id: string;
  created_at: Date;
}

export function aProduct(overrides: FixtureOverrides<ProductRow> = {}): BuiltRow<ProductRow> {
  const tenantId = (overrides.tenant_id as string | undefined) ?? TENANT_A;
  return withOverrides<ProductRow>(
    {
      id: randomUUID(),
      tenant_id: tenantId,
      tax_category_id: taxCategoryIdFor(tenantId),
      sku_base: null,
      name_en: `Product ${nextSequence()}`,
      name_ar: null,
      category_id: null,
      brand: null,
      brand_id: null,
      image_url: null,
      is_active: true,
      has_variants: true,
      created_at: new Date(),
    },
    overrides,
  );
}

export interface ProductVariantRow {
  id: string;
  tenant_id: string;
  product_id: string;
  sku: string;
  barcode_ean13: string | null;
  barcode_internal: string | null;
  size: string | null;
  color: string | null;
  style: string | null;
  cost_price: Prisma.Decimal;
  return_count: number;
  qa_flag: boolean;
  is_active: boolean;
  item_type: string;
  base_uom_id: string | null;
  /**
   * WP-008 Phase C (OD-CAT-014): the variant-level tax OVERRIDE. Defaults to
   * `null`, which is the schema default and means "inherit the product's
   * category" — a fixture that defaulted this to a real id would make every
   * variant look like a deliberate override and quietly bypass the inheritance
   * path this phase's resolution rests on.
   */
  tax_category_id: string | null;
  created_at: Date;
}

export function aProductVariant(
  overrides: FixtureOverrides<ProductVariantRow> = {},
): BuiltRow<ProductVariantRow> {
  return withOverrides<ProductVariantRow>(
    {
      id: randomUUID(),
      tenant_id: TENANT_A,
      tax_category_id: null,
      product_id: randomUUID(),
      sku: `SKU-${nextSequence()}`,
      barcode_ean13: null,
      barcode_internal: null,
      size: null,
      color: null,
      style: null,
      cost_price: zero(),
      return_count: 0,
      qa_flag: false,
      is_active: true,
      item_type: 'stocked',
      base_uom_id: null,
      created_at: new Date(),
    },
    overrides,
  );
}

export interface CustomerRow {
  id: string;
  tenant_id: string;
  name: string | null;
  phone: string | null;
  whatsapp: string | null;
  email: string | null;
  is_vip: boolean;
  vip_price_tier: string;
  total_invoices: number;
  total_spent: Prisma.Decimal;
  created_at: Date;
}

export function aCustomer(overrides: FixtureOverrides<CustomerRow> = {}): BuiltRow<CustomerRow> {
  return withOverrides<CustomerRow>(
    {
      id: randomUUID(),
      tenant_id: TENANT_A,
      name: null,
      phone: null,
      whatsapp: null,
      email: null,
      is_vip: false,
      vip_price_tier: 'cost_plus_overhead',
      total_invoices: 0,
      total_spent: zero(),
      created_at: new Date(),
    },
    overrides,
  );
}

export interface SupplierRow {
  id: string;
  tenant_id: string;
  name: string;
  company_name: string | null;
  phone: string | null;
  alias_names: string[];
  created_at: Date;
}

export function aSupplier(overrides: FixtureOverrides<SupplierRow> = {}): BuiltRow<SupplierRow> {
  return withOverrides<SupplierRow>(
    {
      id: randomUUID(),
      tenant_id: TENANT_A,
      name: `Supplier ${nextSequence()}`,
      company_name: null,
      phone: null,
      alias_names: [],
      created_at: new Date(),
    },
    overrides,
  );
}

/** `InventoryStock` is keyed on `@@id([branch_id, variant_id])` — it has no `id`. */
export interface InventoryStockRow {
  tenant_id: string;
  branch_id: string;
  variant_id: string;
  qty_on_hand: number;
  qty_reserved: number;
  last_sold_at: Date | null;
}

export function anInventoryStock(
  overrides: FixtureOverrides<InventoryStockRow> = {},
): BuiltRow<InventoryStockRow> {
  return withOverrides<InventoryStockRow>(
    {
      tenant_id: TENANT_A,
      branch_id: randomUUID(),
      variant_id: randomUUID(),
      qty_on_hand: 0,
      qty_reserved: 0,
      last_sold_at: null,
    },
    overrides,
  );
}

export interface SalesInvoiceRow {
  id: string;
  tenant_id: string;
  invoice_number: string;
  branch_id: string;
  customer_id: string | null;
  cashier_id: string | null;
  seller_id: string | null;
  received_by: string | null;
  terminal_id: string | null;
  shift_id: string | null;
  offline_session_id: string | null;
  terminal_sequence: bigint | null;
  command_fingerprint: string | null;
  event_version: number;
  warning_codes: string[];
  cashier_name_snapshot: string | null;
  seller_name_snapshot: string | null;
  status: string;
  subtotal: Prisma.Decimal;
  discount_amount: Prisma.Decimal;
  tax_amount: Prisma.Decimal;
  total: Prisma.Decimal;
  payment_method: string;
  language: string;
  sync_id: string | null;
  occurred_at: Date;
  received_at: Date;
  created_at: Date;
}

export function aSalesInvoice(
  overrides: FixtureOverrides<SalesInvoiceRow> = {},
): BuiltRow<SalesInvoiceRow> {
  const now = new Date();
  return withOverrides<SalesInvoiceRow>(
    {
      id: randomUUID(),
      tenant_id: TENANT_A,
      invoice_number: `INV-${nextSequence()}`,
      branch_id: randomUUID(),
      customer_id: null,
      cashier_id: null,
      seller_id: null,
      received_by: null,
      terminal_id: null,
      shift_id: null,
      offline_session_id: null,
      terminal_sequence: null,
      command_fingerprint: null,
      event_version: 1,
      warning_codes: [],
      cashier_name_snapshot: null,
      seller_name_snapshot: null,
      status: 'completed',
      subtotal: zero(),
      discount_amount: zero(),
      tax_amount: zero(),
      total: zero(),
      payment_method: 'cash',
      language: 'ar',
      sync_id: null,
      occurred_at: now,
      received_at: now,
      created_at: now,
    },
    overrides,
  );
}

/**
 * WP-008 Phase C. `TaxCategory` and `TaxCode` are seeded by every spec that
 * prices anything, since `PricingService` now resolves the rate through them
 * — that is the "seeded in more than one file" bar this file's contract sets.
 *
 * (`priceBook`/`priceBookEntry` still have no builders despite being seeded in
 * several files. Adding them is a separate change, not something to slip into
 * a feature PR — flagged in the Phase C PR description rather than done here.)
 */
export interface TaxCategoryRow {
  id: string;
  tenant_id: string;
  code: string;
  name_en: string;
  name_ar: string | null;
  description: string | null;
  is_active: boolean;
  created_by: string | null;
  created_at: Date;
  updated_at: Date;
}

export function aTaxCategory(
  overrides: FixtureOverrides<TaxCategoryRow> = {},
): BuiltRow<TaxCategoryRow> {
  const tenantId = (overrides.tenant_id as string | undefined) ?? TENANT_A;
  const now = new Date();
  return withOverrides<TaxCategoryRow>(
    {
      // Matches `aProduct`'s default so a product and its category line up
      // without the spec having to wire them together.
      id: taxCategoryIdFor(tenantId),
      tenant_id: tenantId,
      code: 'STANDARD',
      name_en: 'Standard rate',
      name_ar: null,
      description: null,
      is_active: true,
      created_by: null,
      created_at: now,
      updated_at: now,
    },
    overrides,
  );
}

export interface TaxCodeRow {
  id: string;
  tenant_id: string;
  tax_category_id: string;
  code: string;
  name_en: string;
  name_ar: string | null;
  jurisdiction: string;
  calculation_method: string;
  /** Decimal, never a bare number — see rule 1 in this file's header. */
  rate: Prisma.Decimal;
  tax_mode: string;
  rounding_policy: string;
  exemption_allowed: boolean;
  effective_from: Date | null;
  effective_to: Date | null;
  version: number;
  status: string;
  supersedes_id: string | null;
  superseded_at: Date | null;
  superseded_by_id: string | null;
  created_by: string | null;
  submitted_by: string | null;
  submitted_at: Date | null;
  approved_by: string | null;
  approved_at: Date | null;
  scheduled_by: string | null;
  scheduled_at: Date | null;
  activated_by: string | null;
  activated_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export function aTaxCode(overrides: FixtureOverrides<TaxCodeRow> = {}): BuiltRow<TaxCodeRow> {
  const tenantId = (overrides.tenant_id as string | undefined) ?? TENANT_A;
  const now = new Date();
  return withOverrides<TaxCodeRow>(
    {
      id: randomUUID(),
      tenant_id: tenantId,
      tax_category_id: taxCategoryIdFor(tenantId),
      code: 'STANDARD',
      name_en: 'Standard rate v1',
      name_ar: null,
      jurisdiction: 'EG',
      calculation_method: 'percentage',
      rate: standardRate(),
      // BR-TAX-204: the pre-Phase-C engine treated every stored price as
      // tax-exclusive, so this default keeps existing specs' arithmetic.
      tax_mode: 'exclusive',
      rounding_policy: 'line',
      exemption_allowed: false,
      effective_from: null,
      effective_to: null,
      version: 1,
      // `active` by default: a draft code prices nothing, and a spec that
      // wants a lifecycle state says so explicitly.
      status: 'active',
      supersedes_id: null,
      superseded_at: null,
      superseded_by_id: null,
      created_by: null,
      submitted_by: null,
      submitted_at: null,
      approved_by: null,
      approved_at: null,
      scheduled_by: null,
      scheduled_at: null,
      activated_by: null,
      activated_at: null,
      created_at: now,
      updated_at: now,
    },
    overrides,
  );
}
