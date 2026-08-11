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
  created_at: Date;
}

export function aProduct(overrides: FixtureOverrides<ProductRow> = {}): BuiltRow<ProductRow> {
  return withOverrides<ProductRow>(
    {
      id: randomUUID(),
      tenant_id: TENANT_A,
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
  created_at: Date;
}

export function aProductVariant(
  overrides: FixtureOverrides<ProductVariantRow> = {},
): BuiltRow<ProductVariantRow> {
  return withOverrides<ProductVariantRow>(
    {
      id: randomUUID(),
      tenant_id: TENANT_A,
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
