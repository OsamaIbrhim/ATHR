import { PRESETS, applyPreset, assertValidPreset, presetKeyFor } from './index';

describe('catalog presets', () => {
  it.each(PRESETS.map((preset) => [preset.key, preset] as const))('%s is valid data', (_key, preset) => {
    expect(() => assertValidPreset(preset)).not.toThrow();
    expect(preset.uoms.length).toBeGreaterThan(0);
  });

  it('has unique keys and business types', () => {
    const keys = PRESETS.map((preset) => preset.key);
    expect(new Set(keys).size).toBe(keys.length);
    const businessTypes = PRESETS.flatMap((preset) => preset.business_types);
    expect(new Set(businessTypes).size).toBe(businessTypes.length);
  });

  it('maps a signup business type to a preset, unknown to general', () => {
    expect(presetKeyFor('fashion')).toBe('clothing');
    expect(presetKeyFor('Grocery')).toBe('grocery');
    expect(presetKeyFor('pharmacy')).toBe('pharmacy');
    expect(presetKeyFor('space-mining')).toBe('general');
    expect(presetKeyFor(undefined)).toBe('general');
  });

  it('applies types, units and scale settings for the tenant', async () => {
    const tx: any = {
      productType: { createMany: jest.fn() },
      unitOfMeasure: { createMany: jest.fn() },
      tenant: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({ settings: {} }),
        update: jest.fn(),
      },
    };
    await applyPreset(tx, 'tenant-1', 'grocery');

    expect(tx.unitOfMeasure.createMany.mock.calls[0][0].data.map((u: any) => [u.tenant_id, u.code, u.precision])).toEqual([
      ['tenant-1', 'pcs', 0],
      ['tenant-1', 'kg', 3],
      ['tenant-1', 'g', 0],
    ]);
    expect(tx.productType.createMany).toHaveBeenCalledWith(expect.objectContaining({ skipDuplicates: true }));
    expect(tx.tenant.update.mock.calls[0][0].data.settings.scale_barcode).toMatchObject({ enabled: true, item_digits: 5 });
  });
});
