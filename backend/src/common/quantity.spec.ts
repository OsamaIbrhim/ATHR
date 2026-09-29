import 'reflect-metadata';
import { UnprocessableEntityException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import {
  assertQuantityPrecision,
  IsNonNegativeQuantity,
  IsQuantity,
  quantity,
  quantityNumber,
  variantQuantityPrecision,
} from './quantity';

class LineDto {
  @IsQuantity()
  qty!: number;
}

class ReceiptDto {
  @IsNonNegativeQuantity()
  damaged_qty!: number;
}

const errorsFor = (qty: unknown) => validateSync(plainToInstance(LineDto, { qty }));

describe('quantity helper', () => {
  describe('precision by unit of measure', () => {
    it('accepts 1.250 for a 3-decimal unit and refuses it for pieces', () => {
      expect(() => assertQuantityPrecision(1.25, 3, 'KG-1')).not.toThrow();
      expect(() => assertQuantityPrecision('1.250', 3, 'KG-1')).not.toThrow();
      expect(() => assertQuantityPrecision(1.25, 0, 'PC-1')).toThrow(UnprocessableEntityException);
      expect(() => assertQuantityPrecision(3, 0, 'PC-1')).not.toThrow();
      expect(() => assertQuantityPrecision('3.000', 0, 'PC-1')).not.toThrow();
    });

    it('treats a variant without a unit as pieces (precision 0)', () => {
      expect(variantQuantityPrecision({ base_uom: null })).toBe(0);
      expect(variantQuantityPrecision({})).toBe(0);
      expect(variantQuantityPrecision({ base_uom: { precision: 3 } })).toBe(3);
    });

    it('reports a stable error code the clients can react to', () => {
      try {
        assertQuantityPrecision(0.5, 0, 'PC-1');
        fail('expected a precision error');
      } catch (error) {
        expect((error as UnprocessableEntityException).getResponse()).toMatchObject({
          code: 'QUANTITY_PRECISION_EXCEEDED',
          allowed_precision: 0,
        });
      }
    });
  });

  describe('storage scale', () => {
    it('parses up to 3 decimals exactly and refuses more', () => {
      expect(quantity('1.250').toString()).toBe('1.25');
      expect(quantity(0.001).toString()).toBe('0.001');
      expect(() => quantity('0.0001')).toThrow(TypeError);
      expect(() => quantity(Number.NaN)).toThrow();
    });

    it('exposes quantities as JSON numbers', () => {
      expect(quantityNumber('1.250')).toBe(1.25);
      expect(quantityNumber(8)).toBe(8);
    });
  });

  describe('DTO validation', () => {
    it('keeps the POS working: whole quantities are valid', () => {
      expect(errorsFor(1)).toHaveLength(0);
      expect(errorsFor(12)).toHaveLength(0);
    });

    it('accepts up to three decimals and refuses zero, negatives and more decimals', () => {
      expect(errorsFor(1.25)).toHaveLength(0);
      expect(errorsFor(0.001)).toHaveLength(0);
      expect(errorsFor(0)).not.toHaveLength(0);
      expect(errorsFor(-1)).not.toHaveLength(0);
      expect(errorsFor(1.2345)).not.toHaveLength(0);
      expect(errorsFor('2')).not.toHaveLength(0);
    });

    it('allows zero where a quantity is optional (damaged / missing units)', () => {
      expect(validateSync(plainToInstance(ReceiptDto, { damaged_qty: 0 }))).toHaveLength(0);
      expect(validateSync(plainToInstance(ReceiptDto, { damaged_qty: 0.5 }))).toHaveLength(0);
      expect(validateSync(plainToInstance(ReceiptDto, { damaged_qty: -0.5 }))).not.toHaveLength(0);
    });
  });
});
