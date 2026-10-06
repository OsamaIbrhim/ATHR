import { describe, expect, it } from 'vitest'
import { legacyPaymentMethod, upgradeLegacySaleCommand } from './legacy-sale-command'

const legacy = {
  event_version: 2,
  sync_id: 'a',
  items: [{ variant_id: 'v', qty: 1 }],
  payment_method: 'cash',
  language: 'ar',
  local_total: 114,
}

describe('upgradeLegacySaleCommand', () => {
  it('turns payment_method into one payment of the whole total and keeps the printed number', () => {
    const upgraded = JSON.parse(
      upgradeLegacySaleCommand({ payload: JSON.stringify(legacy), printedNumber: 'LOCAL-POS1-7' })!,
    )
    expect(upgraded.payments).toEqual([{ method: 'cash', amount: 114 }])
    expect(upgraded.invoice_number).toBe('LOCAL-POS1-7')
    expect(upgraded).not.toHaveProperty('payment_method')
    expect(upgraded.items).toEqual(legacy.items)
    expect(upgraded.local_total).toBe(114)
  })

  it('maps the retired methods and never invents credit', () => {
    expect(legacyPaymentMethod('instapay')).toBe('bank_transfer')
    expect(legacyPaymentMethod('vodafone_cash')).toBe('wallet')
    expect(legacyPaymentMethod('installment')).toBe('other')
    expect(legacyPaymentMethod('something-else')).toBe('other')
  })

  it('leaves a current payload and an unreadable one alone', () => {
    const current = JSON.stringify({ ...legacy, payment_method: undefined, payments: [{ method: 'cash', amount: 114 }] })
    expect(upgradeLegacySaleCommand({ payload: current, printedNumber: 'X' })).toBeNull()
    expect(upgradeLegacySaleCommand({ payload: '{not json', printedNumber: 'X' })).toBeNull()
  })

  it('does not overwrite a number the payload already has', () => {
    const upgraded = JSON.parse(
      upgradeLegacySaleCommand({ payload: JSON.stringify({ ...legacy, invoice_number: 'POS1-000001' }), printedNumber: 'L' })!,
    )
    expect(upgraded.invoice_number).toBe('POS1-000001')
  })
})
