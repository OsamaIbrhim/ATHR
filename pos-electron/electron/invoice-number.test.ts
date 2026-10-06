import { describe, expect, it } from 'vitest'
import { invoiceNumberFor } from './invoice-number'
import { nextTerminalSequence } from './offline-accounting'

describe('invoiceNumberFor', () => {
  it('is the terminal code and the sequence in six digits', () => {
    expect(invoiceNumberFor('POS1', '123')).toBe('POS1-000123')
    expect(invoiceNumberFor('POS12', '1')).toBe('POS12-000001')
  })

  it('keeps growing past six digits', () => {
    expect(invoiceNumberFor('POS1', '1234567')).toBe('POS1-1234567')
  })

  it('matches what the server derives and continues after the enrolled sequence', () => {
    // The server's last accepted sale for this terminal was 41: the next one the till prints is 42.
    expect(invoiceNumberFor('POS1', nextTerminalSequence('0', '41'))).toBe('POS1-000042')
  })

  it('never produces characters the server would drop', () => {
    expect(invoiceNumberFor('P O/S1', '5')).toBe('POS1-000005')
  })
})
