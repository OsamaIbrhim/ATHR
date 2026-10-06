import { describe, expect, it } from 'vitest'
import { addRow, removeRow, resolveSplit, type SplitRow } from './payment-split'

const cash = (over: Partial<SplitRow> = {}): SplitRow => ({ method: 'cash', amount: '', received: '', ...over })
const card = (amount = ''): SplitRow => ({ method: 'card', amount, received: '' })
const TOTAL = 11400

describe('resolveSplit', () => {
  it('pays the whole invoice in cash with no change when nothing was typed', () => {
    const state = resolveSplit([cash()], TOTAL, false)
    expect(state.problem).toBeNull()
    expect(state.payments).toEqual([{ method: 'cash', amount: 114 }])
    expect(state.change).toBe(0)
  })

  it('keeps the amount in the till and reports the change when more cash is handed over', () => {
    const state = resolveSplit([cash({ received: '200' })], TOTAL, false)
    expect(state.payments).toEqual([{ method: 'cash', amount: 114, tendered: 200 }])
    expect(state.change).toBe(8600)
  })

  it('refuses cash below what is owed', () => {
    expect(resolveSplit([cash({ received: '100' })], TOTAL, false).problem).toContain('المستلم')
  })

  it('splits: the card amount typed comes off the cash, which takes the rest', () => {
    const state = resolveSplit([cash({ received: '100' }), card('54')], TOTAL, false)
    expect(state.applied).toEqual([6000, 5400])
    expect(state.problem).toBeNull()
    expect(state.change).toBe(4000)
    expect(state.payments).toEqual([
      { method: 'cash', amount: 60, tendered: 100 },
      { method: 'card', amount: 54 },
    ])
  })

  it('shows what is still missing or over', () => {
    const short = resolveSplit([cash({ amount: '50' }), card('10')], TOTAL, false)
    expect(short.remaining).toBe(5400)
    expect(short.problem).toContain('أقل')
    const over = resolveSplit([cash({ amount: '150' })], TOTAL, false)
    expect(over.remaining).toBe(-3600)
    expect(over.problem).toContain('أكبر')
    // A second tender larger than the invoice leaves the main tender nothing.
    expect(resolveSplit([cash(), card('200')], TOTAL, false).problem).not.toBeNull()
  })

  it('needs a customer for credit', () => {
    const rows: SplitRow[] = [{ method: 'credit', amount: '', received: '' }]
    expect(resolveSplit(rows, TOTAL, false).problem).toContain('عميل')
    expect(resolveSplit(rows, TOTAL, true).problem).toBeNull()
  })

  it('rejects an empty list, a second tender with no amount, and malformed amounts', () => {
    expect(resolveSplit([], TOTAL, false).problem).not.toBeNull()
    expect(resolveSplit([cash(), card()], TOTAL, false).problem).not.toBeNull()
    expect(resolveSplit([cash({ amount: 'abc' })], TOTAL, false).problem).not.toBeNull()
  })
})

describe('addRow / removeRow', () => {
  it('adds an empty tender and hands the main tender the rest when it is removed', () => {
    const rows = addRow([cash()], 'card')
    expect(rows).toEqual([cash(), card()])
    expect(removeRow([cash({ amount: '60' }), card('54')], 0)).toEqual([card()])
    expect(removeRow([cash(), card('54')], 1)).toEqual([cash()])
    expect(removeRow([cash()], 0)).toEqual([])
  })
})
