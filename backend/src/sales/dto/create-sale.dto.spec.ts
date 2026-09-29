import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { CreateSaleItemDto } from './create-sale.dto';

const line = {
  variant_id: '11111111-1111-4111-8111-111111111111',
  qty: 1.25,
  unit_price: 10,
  unit_tax: 1.4,
  sku_snapshot: 'SKU',
  name_ar_snapshot: 'صنف',
};

describe('sale line label snapshot', () => {
  it('accepts the new label', () => {
    const dto = plainToInstance(CreateSaleItemDto, { ...line, variant_label_snapshot: 'L · أسود' });
    expect(validateSync(dto, { whitelist: true, forbidNonWhitelisted: true })).toEqual([]);
    expect(dto.variant_label_snapshot).toBe('L · أسود');
  });

  it('still accepts size/color queued by a POS <= 1.5 (ignored)', () => {
    const dto = plainToInstance(CreateSaleItemDto, { ...line, size_snapshot: 'M', color_snapshot: 'Blue' });
    expect(validateSync(dto, { whitelist: true, forbidNonWhitelisted: true })).toEqual([]);
    expect(dto.variant_label_snapshot).toBeUndefined();
  });

  it('leaves the label empty for a simple product', () => {
    const dto = plainToInstance(CreateSaleItemDto, line);
    expect(validateSync(dto, { whitelist: true, forbidNonWhitelisted: true })).toEqual([]);
    expect(dto.variant_label_snapshot).toBeFalsy();
  });
});
