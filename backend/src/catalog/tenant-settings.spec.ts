import { applySalesSettingsUpdate, parseScaleBarcodeConfig, readTenantSettings } from './tenant-settings';

describe('tenant settings: scale barcode', () => {
  it('defaults price labels to tax-inclusive for settings stored before the option existed', () => {
    const stored = { scale_barcode: { enabled: true, value: 'price', decimals: 2 } };
    expect(readTenantSettings(stored).scale_barcode).toMatchObject({
      enabled: true,
      value: 'price',
      price_includes_tax: true,
    });
  });

  it('lets a tenant choose labels printed before tax', () => {
    expect(parseScaleBarcodeConfig({ enabled: true, value: 'price', price_includes_tax: false })).toMatchObject({
      price_includes_tax: false,
    });
  });

  it('rejects a non-boolean price_includes_tax', () => {
    expect(() => parseScaleBarcodeConfig({ price_includes_tax: 'yes' })).toThrow(/price_includes_tax/);
  });
});

describe('tenant settings: sales and receipt', () => {
  it('has defaults for a tenant that never set anything, with the tenant name on the receipt', () => {
    const settings = readTenantSettings({}, { name: 'Bold Store' });
    expect(settings.sales).toEqual({ payment_methods: ['cash', 'card', 'wallet', 'credit'], return_window_days: 14, max_discount_percent: 10 });
    expect(settings.receipt).toEqual({ store_name: 'Bold Store', footer: null, show_tax_breakdown: true });
  });

  it('keeps 0 days (no returns) and 0% (no discount without override) as real values, not defaults', () => {
    const settings = readTenantSettings({ sales: { return_window_days: 0, max_discount_percent: 0 } });
    expect(settings.sales.return_window_days).toBe(0);
    expect(settings.sales.max_discount_percent).toBe(0);
  });

  it('falls back to the defaults for unusable stored values', () => {
    const settings = readTenantSettings({ sales: { payment_methods: ['cheque'], return_window_days: -3, max_discount_percent: 'lots' } });
    expect(settings.sales).toEqual({ payment_methods: ['cash', 'card', 'wallet', 'credit'], return_window_days: 14, max_discount_percent: 10 });
  });

  it('merges a partial update and leaves the rest alone', () => {
    const stored = { scale_barcode: {}, sales: { return_window_days: 30 }, receipt: { footer: 'Thanks' } };
    const next = applySalesSettingsUpdate(stored, { sales: { payment_methods: ['cash', 'cash', 'wallet'], max_discount_percent: 15.5 }, receipt: { store_name: ' My Shop ' } });
    expect(next.sales).toEqual({ payment_methods: ['cash', 'wallet'], return_window_days: 30, max_discount_percent: 15.5 });
    expect(next.receipt).toEqual({ store_name: 'My Shop', footer: 'Thanks', show_tax_breakdown: true });
  });

  it('clears a store name or footer sent empty or null', () => {
    const next = applySalesSettingsUpdate({ receipt: { store_name: 'Old', footer: 'Old' } }, { receipt: { store_name: '  ', footer: null } });
    expect(next.receipt).toMatchObject({ store_name: null, footer: null });
  });

  it.each([
    [{ sales: { payment_methods: [] } }, /payment_methods/],
    [{ sales: { payment_methods: ['cheque'] } }, /payment_methods/],
    [{ sales: { return_window_days: 1.5 } }, /return_window_days/],
    [{ sales: { return_window_days: -1 } }, /return_window_days/],
    [{ sales: { max_discount_percent: 101 } }, /max_discount_percent/],
    [{ sales: { max_discount_percent: '10' } }, /max_discount_percent/],
    [{ receipt: { show_tax_breakdown: 'yes' } }, /show_tax_breakdown/],
    [{ receipt: { footer: 'x'.repeat(301) } }, /footer/],
  ])('rejects %j', (body, message) => {
    expect(() => applySalesSettingsUpdate({}, body)).toThrow(message);
  });
});
