import { describe, expect, it, vi } from 'vitest'
import { deriveChecklist, loadChecklistFacts, summarizeChecklist, type ChecklistFacts } from './checklist'

const empty: ChecklistFacts = { branches: 1, products: 0, noBalanceItems: 0, users: 1, terminals: 0, postedCounts: 0 }
const byKey = (facts: ChecklistFacts) => Object.fromEntries(deriveChecklist(facts).map(s => [s.key, s]))

describe('deriveChecklist', () => {
  it('a new shop has only the branch done and products as the first pending step', () => {
    const steps = deriveChecklist(empty)
    const summary = summarizeChecklist(steps)
    expect(summary.done).toBe(1)
    expect(summary.firstPendingKey).toBe('products')
    expect(summary.allRequiredDone).toBe(false)
  })
  it('opening balance needs products and no item without a balance, and names the gap', () => {
    expect(byKey({ ...empty, products: 0, noBalanceItems: 0 }).opening.done).toBe(false)
    const pending = byKey({ ...empty, products: 10, noBalanceItems: 4 }).opening
    expect(pending.done).toBe(false)
    expect(pending.pendingNote).toBe('4 صنف بلا رصيد')
    expect(byKey({ ...empty, products: 10, noBalanceItems: 0 }).opening.done).toBe(true)
  })
  it('unreadable sources never count as done', () => {
    const steps = byKey({ branches: null, products: null, noBalanceItems: null, users: null, terminals: null, postedCounts: null })
    expect(Object.values(steps).some(s => s.done)).toBe(false)
  })
  it('users step needs two accounts; count step needs a posted count', () => {
    expect(byKey({ ...empty, users: 2 }).users.done).toBe(true)
    expect(byKey({ ...empty, postedCounts: 1 }).count.done).toBe(true)
  })
  it('all required done ignores the optional steps', () => {
    const facts: ChecklistFacts = { branches: 1, products: 5, noBalanceItems: 0, users: 1, terminals: 1, postedCounts: 0 }
    expect(summarizeChecklist(deriveChecklist(facts)).allRequiredDone).toBe(true)
  })
})

describe('loadChecklistFacts', () => {
  it('skips sources the user may not read and tolerates failures', async () => {
    const get = vi.fn(async (path: string) => {
      if (path.startsWith('/branches')) return [{ id: 'b1', name_ar: 'الفرع' }]
      if (path.startsWith('/products')) return { total: 7 }
      if (path.startsWith('/inventory/low-stock')) return { counts: { no_stock_row: 3 } }
      if (path.startsWith('/terminals')) throw new Error('boom')
      return { total: 0 }
    })
    const can = (p: string) => p !== 'tenant.membership.view'
    const facts = await loadChecklistFacts(get, can as any, null)
    expect(facts).toMatchObject({ branches: 1, products: 7, noBalanceItems: 3, users: null, terminals: null })
    expect(get).not.toHaveBeenCalledWith(expect.stringContaining('/users'))
    expect(get).toHaveBeenCalledWith(expect.stringContaining('branch_id=b1'))
  })
})
