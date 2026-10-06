import { describe, expect, it } from 'vitest'
import { assertPayments, parsePayments, paymentSummary } from './sale-payments'
import { PosSaleValidationError } from './sale-error'

const enabled = ['cash', 'card', 'wallet', 'credit'] as const
const codeOf = (run: () => unknown) => {
  try {
    run()
  } catch (error) {
    return (error as PosSaleValidationError).code
  }
  return 'none'
}

describe('parsePayments', () => {
  it('reads cash with the amount tendered and a split with a card', () => {
    expect(parsePayments([{ method: 'cash', amount: 60, tendered: 100 }, { method: 'card', amount: 54.5 }])).toEqual([
      { method: 'cash', amount: 60, tendered: 100 },
      { method: 'card', amount: 54.5 },
    ])
  })

  it('refuses nothing, too many, unknown methods and non-positive amounts', () => {
    expect(codeOf(() => parsePayments([]))).toBe('PAYMENTS_INVALID')
    expect(codeOf(() => parsePayments(undefined))).toBe('PAYMENTS_INVALID')
    expect(codeOf(() => parsePayments(Array.from({ length: 11 }, () => ({ method: 'cash', amount: 1 }))))).toBe('PAYMENTS_INVALID')
    expect(codeOf(() => parsePayments([{ method: 'bitcoin', amount: 5 }]))).toBe('PAYMENTS_INVALID')
    expect(codeOf(() => parsePayments([{ method: 'cash', amount: 0 }]))).toBe('PAYMENTS_INVALID')
    expect(codeOf(() => parsePayments([{ method: 'cash', amount: 'x' }]))).toBe('PAYMENTS_INVALID')
  })

  it('accepts a tendered amount only for cash and never below what is paid', () => {
    expect(codeOf(() => parsePayments([{ method: 'card', amount: 50, tendered: 60 }]))).toBe('PAYMENTS_INVALID')
    expect(codeOf(() => parsePayments([{ method: 'cash', amount: 50, tendered: 40 }]))).toBe('PAYMENTS_INVALID')
  })
})

describe('assertPayments', () => {
  const ok = { totalCents: 11400, enabled, customerPhone: undefined }

  it('needs the payments to equal the total to the piastre', () => {
    expect(() => assertPayments(parsePayments([{ method: 'cash', amount: 114 }]), ok)).not.toThrow()
    expect(codeOf(() => assertPayments(parsePayments([{ method: 'cash', amount: 113.99 }]), ok))).toBe('PAYMENT_TOTAL_MISMATCH')
    expect(() => assertPayments(parsePayments([{ method: 'cash', amount: 100 }, { method: 'card', amount: 14 }]), ok)).not.toThrow()
  })

  it('refuses a method the tenant switched off', () => {
    expect(codeOf(() => assertPayments(parsePayments([{ method: 'bank_transfer', amount: 114 }]), ok))).toBe('PAYMENT_METHOD_DISABLED')
  })

  it('needs a customer for credit', () => {
    const credit = parsePayments([{ method: 'credit', amount: 114 }])
    expect(codeOf(() => assertPayments(credit, ok))).toBe('CREDIT_NEEDS_CUSTOMER')
    expect(() => assertPayments(credit, { ...ok, customerPhone: '01012345678' })).not.toThrow()
  })
})

describe('paymentSummary', () => {
  it('is the method itself, or split', () => {
    expect(paymentSummary(parsePayments([{ method: 'card', amount: 5 }]))).toBe('card')
    expect(paymentSummary(parsePayments([{ method: 'cash', amount: 5 }, { method: 'cash', amount: 5 }]))).toBe('cash')
    expect(paymentSummary(parsePayments([{ method: 'cash', amount: 5 }, { method: 'card', amount: 5 }]))).toBe('split')
  })
})
