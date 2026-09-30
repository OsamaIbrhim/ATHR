import { parseScaleBarcodeConfig, readTenantSettings } from './tenant-settings';

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
