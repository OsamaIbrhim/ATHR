import { SalesService } from './sales.service';

// A POS 1.6.0 payload has no tracking fields. Its fingerprint is stored on
// every accepted invoice, so a replay of an old outbox item after an upgrade
// must hash to the same value. The hex below was computed by the code as it
// was before tracking existed; it must never change.
const GOLDEN = '83995f860bbe2b7136a4d14990dd09f37f769e221c8d3eef37b8a96d5fa8fd27';

const dto = {
  event_version: 2,
  sync_id: '66666666-6666-4666-8666-666666666666',
  branch_id: '11111111-1111-4111-8111-111111111111',
  shift_id: '33333333-3333-4333-8333-333333333333',
  origin_cashier_id: '88888888-8888-4888-8888-888888888888',
  cashier_name_snapshot: 'Cashier One',
  seller_id: '77777777-7777-4777-8777-777777777777',
  seller_name_snapshot: 'Seller One',
  offline_session_id: '44444444-4444-4444-8444-444444444444',
  terminal_sequence: '1',
  occurred_at: '2026-07-22T10:00:00.000Z',
  items: [
    {
      variant_id: '55555555-5555-4555-8555-555555555555',
      qty: 2,
      unit_price: 150,
      unit_tax: 21,
      sku_snapshot: 'SKU-1',
      name_ar_snapshot: 'قميص',
      name_en_snapshot: 'Shirt',
      variant_label_snapshot: 'M · Blue',
    },
  ],
  payment_method: 'cash',
  language: 'ar',
  local_total: 342,
} as any;

function fingerprintOf(payload: any) {
  const service = new SalesService(null as any, null as any, null as any, null as any, null as any) as any;
  return service.saleCommandFingerprint(
    payload,
    '22222222-2222-4222-8222-222222222222',
    new Date(payload.occurred_at),
    service.normalizeLines(payload.items),
  ) as string;
}

describe('sale command fingerprint', () => {
  it('keeps the exact fingerprint of a POS 1.6.0 payload (no tracking fields)', () => {
    expect(fingerprintOf(dto)).toBe(GOLDEN);
  });
});
