import { Prisma } from '@prisma/client';
import { apiJsonReplacer } from './json-serialization';

describe('API JSON serialization', () => {
  it('serializes BigInt database cursors as decimal strings without a global prototype patch', () => {
    expect(JSON.stringify({ cursor: 42n, nested: { sequence: 43n } }, apiJsonReplacer))
      .toBe('{"cursor":"42","nested":{"sequence":"43"}}');
  });

  it('does not alter ordinary values', () => {
    expect(JSON.stringify({ count: 42, ok: true, value: null }, apiJsonReplacer))
      .toBe('{"count":42,"ok":true,"value":null}');
  });

  it('exposes Decimal quantities as numbers and leaves money Decimals as strings', () => {
    const body = { qty: new Prisma.Decimal('1.250'), qty_on_hand: new Prisma.Decimal(8), unit_price: new Prisma.Decimal('12.50') };
    expect(JSON.stringify({ items: [body] }, apiJsonReplacer)).toBe(
      '{"items":[{"qty":1.25,"qty_on_hand":8,"unit_price":"12.5"}]}',
    );
  });
});
