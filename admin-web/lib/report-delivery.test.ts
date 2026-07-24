import { describe, expect, it } from 'vitest'
import { deliveryNotices } from './report-delivery'

describe('deliveryNotices', () => {
  it('does not report success when a configured channel returns sent false', () => {
    expect(deliveryNotices(['email'], {
      email: { sent: false, reason: 'SMTP not configured' },
    })).toEqual([{
      channel: 'email',
      sent: false,
      message: 'لم يتم إرسال التقرير عبر البريد الإلكتروني: SMTP not configured',
    }])
  })

  it('renders independent results for every requested channel', () => {
    expect(deliveryNotices(['email', 'whatsapp'], {
      email: { sent: true, provider: 'smtp' },
      whatsapp: { sent: false, error: { message: 'provider rejected request' } },
    })).toEqual([
      {
        channel: 'email',
        sent: true,
        message: 'تم إرسال التقرير عبر البريد الإلكتروني بنجاح.',
      },
      {
        channel: 'whatsapp',
        sent: false,
        message: 'لم يتم إرسال التقرير عبر واتساب: provider rejected request',
      },
    ])
  })

  it('treats a missing provider result as failed', () => {
    expect(deliveryNotices(['whatsapp'], {})).toEqual([{
      channel: 'whatsapp',
      sent: false,
      message: 'لم يتم إرسال التقرير عبر واتساب.',
    }])
  })
})
