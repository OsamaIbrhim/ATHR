import { describe, expect, it } from 'vitest'
import {
  saleReviewSubmission,
  syncFailureMetadata,
  validateSaleReviewResolution,
} from './sale-review-policy'

describe('sale review policy', () => {
  it('extracts the stable backend error metadata', () => {
    expect(
      syncFailureMetadata(
        'مراجعة — code=OFFLINE_ACCOUNTING_TICKET_INVALID | http=422 | request=req-1',
      ),
    ).toEqual({
      code: 'OFFLINE_ACCOUNTING_TICKET_INVALID',
      requestId: 'req-1',
    })
  })

  it('submits the original immutable outbox command', () => {
    const submission = saleReviewSubmission({
      id: 'sync-1',
      payload: JSON.stringify({
        sync_id: 'sync-1',
        local_total: 320.12,
        items: [{ variant_id: 'v1', qty: 1 }],
      }),
      local_invoice_number: 'LOCAL-POS-1',
      local_total: 320.12,
      attempt_count: 624,
      last_error:
        'invalid — code=OFFLINE_ACCOUNTING_TICKET_INVALID | request=req-1',
    })

    expect(submission).toMatchObject({
      local_invoice_number: 'LOCAL-POS-1',
      local_total: 320.12,
      error_code: 'OFFLINE_ACCOUNTING_TICKET_INVALID',
      request_id: 'req-1',
      attempt_count: 624,
    })
    expect(submission.command.items).toHaveLength(1)
    expect(submission.command.local_total).toBe(320.12)
  })

  it('rejects a stored command attached to another sync id', () => {
    expect(() =>
      saleReviewSubmission({
        id: 'sync-1',
        payload: JSON.stringify({
          sync_id: 'sync-2',
          items: [{ variant_id: 'v1', qty: 1 }],
        }),
      }),
    ).toThrow(/does not match/)
  })

  it('rejects forged or inconsistent review decisions', () => {
    expect(() =>
      validateSaleReviewResolution(
        {
          id: 'r1',
          sync_id: 'other',
          status: 'approved',
          action: 'mark_sent',
          invoice: { id: 'i1', invoice_number: 'B-1' },
        },
        'sync-1',
      ),
    ).toThrow(/another sync operation/)

    expect(() =>
      validateSaleReviewResolution(
        {
          id: 'r1',
          sync_id: 'sync-1',
          status: 'pending',
          action: 'reverse_local',
        },
        'sync-1',
      ),
    ).toThrow(/status\/action/)
  })
})
