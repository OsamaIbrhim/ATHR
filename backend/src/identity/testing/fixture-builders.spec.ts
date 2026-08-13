import { Prisma } from '@prisma/client';
import { TENANT_A, TENANT_B } from './cross-tenant-harness';
import {
  aBranch,
  aBrand,
  aCustomer,
  aProduct,
  aProductVariant,
  aSalesInvoice,
  aSupplier,
  anInventoryStock,
} from './fixture-builders';

/**
 * Tests for the fixture builders themselves.
 *
 * Every migrated `*.cross-tenant.spec.ts` now trusts these defaults, so a
 * regression here is invisible at the call sites and silently weakens fifteen
 * isolation suites at once — the same reasoning that put
 * `cross-tenant-harness.spec.ts` next to the harness. These cases pin the
 * three properties the builders exist to guarantee: money columns are
 * `Prisma.Decimal`, required columns are never `undefined`, and a caller can
 * still set anything.
 */
describe('fixture builders', () => {
  const allBuilders = {
    aBranch,
    aBrand,
    aProduct,
    aProductVariant,
    aCustomer,
    aSupplier,
    anInventoryStock,
    aSalesInvoice,
  };

  describe('money columns default to Prisma.Decimal', () => {
    /**
     * A bare `number` here would let a test pass over arithmetic that the real
     * client's `Decimal` would route differently — the mismatch
     * `money-contract.spec.ts` guards from the production side.
     */
    const decimalColumns: [string, Record<string, unknown>][] = [
      ['productVariant.cost_price', { value: aProductVariant().cost_price }],
      ['customer.total_spent', { value: aCustomer().total_spent }],
      ['salesInvoice.subtotal', { value: aSalesInvoice().subtotal }],
      ['salesInvoice.discount_amount', { value: aSalesInvoice().discount_amount }],
      ['salesInvoice.tax_amount', { value: aSalesInvoice().tax_amount }],
      ['salesInvoice.total', { value: aSalesInvoice().total }],
    ];

    it.each(decimalColumns)('%s is a Prisma.Decimal', (_label, { value }) => {
      expect(value).toBeInstanceOf(Prisma.Decimal);
      expect(typeof value).not.toBe('number');
    });
  });

  describe('defaults are complete', () => {
    it.each(Object.entries(allBuilders))(
      '%s leaves no column undefined',
      (_name, builder) => {
        const row = builder();
        const undefinedKeys = Object.entries(row)
          .filter(([, value]) => value === undefined)
          .map(([key]) => key);
        expect(undefinedKeys).toEqual([]);
      },
    );

    it.each(Object.entries(allBuilders))('%s stamps a tenant', (_name, builder) => {
      expect(builder().tenant_id).toBe(TENANT_A);
    });

    /**
     * `code`, `sku` and `invoice_number` are unique per tenant in the schema,
     * so two rows built in one run must not collide on them.
     */
    it('gives each row its own human-readable identifier', () => {
      expect(aBranch().code).not.toBe(aBranch().code);
      expect(aProductVariant().sku).not.toBe(aProductVariant().sku);
      expect(aSalesInvoice().invoice_number).not.toBe(aSalesInvoice().invoice_number);
    });

    /**
     * Relation stubs are a workaround for the fake's missing `include`
     * support, tracked separately. Baking one into a default would hide that
     * gap behind a fixture that no longer resembles a row.
     */
    it('does not pre-hydrate relations', () => {
      expect(aProductVariant()).not.toHaveProperty('product');
      expect(anInventoryStock()).not.toHaveProperty('variant');
      expect(anInventoryStock()).not.toHaveProperty('branch');
      expect(aSalesInvoice()).not.toHaveProperty('items');
    });
  });

  describe('overrides', () => {
    it('wins over every default it names', () => {
      const variant = aProductVariant({
        tenant_id: TENANT_B,
        sku: 'SKU-EXPLICIT',
        cost_price: new Prisma.Decimal('12.50'),
        is_active: false,
        item_type: 'service',
      });

      expect(variant.tenant_id).toBe(TENANT_B);
      expect(variant.sku).toBe('SKU-EXPLICIT');
      expect(variant.cost_price.toFixed(2)).toBe('12.50');
      expect(variant.is_active).toBe(false);
      expect(variant.item_type).toBe('service');
    });

    it('leaves the untouched defaults in place', () => {
      const variant = aProductVariant({ tenant_id: TENANT_B });
      expect(variant.is_active).toBe(true);
      expect(variant.item_type).toBe('stocked');
      expect(variant.return_count).toBe(0);
    });

    /** The escape hatch: an unusual case must stay possible. */
    it('carries a key the builder does not model', () => {
      const invoice = aSalesInvoice({ items: [{ qty: 1 }], not_a_column: 'kept' });
      expect(invoice.items).toEqual([{ qty: 1 }]);
      expect(invoice.not_a_column).toBe('kept');
    });

    it('accepts an explicit null for a nullable column', () => {
      expect(aProduct({ name_ar: null }).name_ar).toBeNull();
      expect(aBranch({ name_en: null }).name_en).toBeNull();
    });
  });

  it('does not share mutable state between two rows', () => {
    const first = aSupplier();
    const second = aSupplier();
    first.alias_names.push('mutated');
    expect(second.alias_names).toEqual([]);
  });
});
