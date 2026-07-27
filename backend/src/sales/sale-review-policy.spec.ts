import {
  materializeSaleReviewCommand,
  parseStoredSaleReviewCommand,
  saleReviewCommandJson,
  saleReviewFingerprint,
  saleReviewRejectionConfirmed,
  sanitizeSaleReviewCommand,
  ticketKeyId,
} from './sale-review-policy';

const command: any = {
  sync_id: '11111111-1111-4111-8111-111111111111',
  branch_id: '22222222-2222-4222-8222-222222222222',
  shift_id: '33333333-3333-4333-8333-333333333333',
  origin_cashier_id: '44444444-4444-4444-8444-444444444444',
  seller_id: '55555555-5555-4555-8555-555555555555',
  offline_session_id: '66666666-6666-4666-8666-666666666666',
  terminal_sequence: '1',
  occurred_at: '2026-07-25T17:47:21.666Z',
  offline_accounting_token: 'old-key.payload.signature',
  items: [{
    variant_id: '77777777-7777-4777-8777-777777777777',
    qty: 1,
  }],
  payment_method: 'cash',
  local_total: 320.12,
};

describe('sale review policy', () => {
  it('never persists the original offline accounting token', () => {
    const safe = sanitizeSaleReviewCommand(command) as any;
    expect(safe.offline_accounting_token).toBeUndefined();
    expect(safe.offline_accounting_token_hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('persists a plain Prisma-compatible JSON command', () => {
    const json = saleReviewCommandJson(
      sanitizeSaleReviewCommand(command),
    );
    expect(JSON.parse(JSON.stringify(json))).toMatchObject({
      sync_id: command.sync_id,
      items: [{
        variant_id: command.items[0].variant_id,
        qty: 1,
      }],
    });
    expect(json).not.toHaveProperty('offline_accounting_token');
  });

  it('validates stored JSON before restoring an executable sale command', () => {
    const stored = parseStoredSaleReviewCommand(
      saleReviewCommandJson(sanitizeSaleReviewCommand(command)),
    );
    const restored = materializeSaleReviewCommand(
      stored,
      'new-key.payload.signature',
    );
    expect(restored).toMatchObject({
      sync_id: command.sync_id,
      branch_id: command.branch_id,
      offline_accounting_token: 'new-key.payload.signature',
      items: command.items,
    });
  });

  it('rejects malformed stored commands instead of casting them', () => {
    expect(() => parseStoredSaleReviewCommand({
      offline_accounting_token_hash: 'a'.repeat(64),
      sync_id: command.sync_id,
      items: [],
    })).toThrow('Stored sale review command failed validation');
  });

  it('uses a deterministic command and terminal fingerprint', () => {
    expect(saleReviewFingerprint(command, 'terminal-1')).toBe(
      saleReviewFingerprint({
        ...command,
        items: [...command.items],
      }, 'terminal-1'),
    );
    expect(saleReviewFingerprint(command, 'terminal-2')).not.toBe(
      saleReviewFingerprint(command, 'terminal-1'),
    );
  });

  it('extracts only the public ticket key id', () => {
    expect(ticketKeyId(command.offline_accounting_token)).toBe('old-key');
  });

  it('requires the exact local number and financial settlement before rejection', () => {
    expect(saleReviewRejectionConfirmed(
      'LOCAL-POS-1',
      'LOCAL-POS-1',
      true,
    )).toBe(true);
    expect(saleReviewRejectionConfirmed(
      'LOCAL-POS-1',
      'LOCAL-POS-2',
      true,
    )).toBe(false);
    expect(saleReviewRejectionConfirmed(
      'LOCAL-POS-1',
      'LOCAL-POS-1',
      false,
    )).toBe(false);
  });
});
