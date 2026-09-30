import { parseAttributeDefinitions, parseVariantAttributes, variantLabel } from './product-type-schema';

const definitions = parseAttributeDefinitions([
  { key: 'size', label_ar: 'المقاس', label_en: 'Size', kind: 'select', options: ['S', 'M', 'L'], axis: true },
  { key: 'color', label_ar: 'اللون', label_en: 'Color', kind: 'text', axis: true },
  { key: 'warranty', label_ar: 'الضمان', label_en: 'Warranty', kind: 'number', axis: false },
]);

describe('product type attribute schema', () => {
  it('rejects malformed definitions', () => {
    const base = { key: 'a', label_ar: 'أ', label_en: 'A', kind: 'text', axis: false };
    expect(() => parseAttributeDefinitions('x')).toThrow();
    expect(() => parseAttributeDefinitions([{ ...base, key: 'Bad Key' }])).toThrow(/key/);
    expect(() => parseAttributeDefinitions([base, base])).toThrow(/duplicated/);
    expect(() => parseAttributeDefinitions([{ ...base, kind: 'date' }])).toThrow(/kind/);
    expect(() => parseAttributeDefinitions([{ ...base, kind: 'select' }])).toThrow(/options/);
    expect(() => parseAttributeDefinitions([{ ...base, options: ['x'] }])).toThrow(/options/);
    expect(() => parseAttributeDefinitions([{ ...base, axis: 'yes' }])).toThrow(/axis/);
  });

  it('validates variant values against the type', () => {
    expect(parseVariantAttributes(definitions, { size: 'M', color: ' Black ', warranty: 12 })).toEqual({
      size: 'M',
      color: 'Black',
      warranty: 12,
    });
    expect(() => parseVariantAttributes(definitions, { size: 'XL', color: 'x' })).toThrow(/size/);
    expect(() => parseVariantAttributes(definitions, { size: 'M' })).toThrow(/color/);
    expect(() => parseVariantAttributes(definitions, { size: 'M', color: 'x', warranty: '12' })).toThrow(/number/);
    expect(() => parseVariantAttributes(definitions, { size: 'M', color: 'x', extra: 1 })).toThrow(/extra/);
  });

  it('a simple product (no type) has no attributes and an empty label', () => {
    expect(parseVariantAttributes([], undefined)).toEqual({});
    expect(() => parseVariantAttributes([], { size: 'M' })).toThrow(/size/);
    expect(variantLabel([], {})).toBe('');
  });

  it('builds the label from the axis attributes in the type order', () => {
    expect(variantLabel(definitions, { color: 'أسود', size: 'L', warranty: 12 })).toBe('L · أسود');
  });
});
