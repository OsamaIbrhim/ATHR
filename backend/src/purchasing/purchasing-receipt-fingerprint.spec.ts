import { preparePurchaseReceipt } from './purchasing-accounting';

// A receipt without tracking data hashes exactly as it did before tracking
// existed (the hex was computed by that code): replaying a stored command must
// keep matching. Tracking data joins the fingerprint only when present.
const GOLDEN = '4b0472ceb3a5b5b82d5b935c00b17d39eb14e21e5a87493224560eafed04c04a';

const receipt = {
  command_id: '99999999-9999-4999-8999-999999999999',
  supplier_id: '11111111-1111-4111-8111-111111111111',
  branch_id: '22222222-2222-4222-8222-222222222222',
  invoice_number: 'INV-1',
  discount_amount: 10,
  items: [
    { variant_id: '33333333-3333-4333-8333-333333333333', qty: 4, unit_cost: 25.5 },
    { variant_id: '44444444-4444-4444-8444-444444444444', qty: 1.5, unit_cost: 80 },
  ],
} as any;

describe('purchase receipt fingerprint', () => {
  it('is unchanged for a receipt without tracking data', () => {
    expect(preparePurchaseReceipt(receipt).commandFingerprint).toBe(GOLDEN);
  });
});
