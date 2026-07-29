import { describe, expect, it } from 'vitest'
import { migrateLegacyLocalStorage } from './local-storage-migration'

function memoryStorage(initial: Record<string, string>) {
  const values = new Map(Object.entries(initial))
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value)
    },
    removeItem: (key: string) => {
      values.delete(key)
    },
  }
}

describe('ATHR localStorage compatibility', () => {
  it('moves the active shift to the ATHR key without changing its value', () => {
    const storage = memoryStorage({
      bold_current_shift: '{"id":"shift-1","status":"open"}',
    })
    migrateLegacyLocalStorage(storage)
    expect(storage.getItem('athr_current_shift')).toBe(
      '{"id":"shift-1","status":"open"}',
    )
    expect(storage.getItem('bold_current_shift')).toBeNull()
  })

  it('never overwrites an existing ATHR value', () => {
    const storage = memoryStorage({
      bold_current_shift: 'legacy',
      athr_current_shift: 'current',
    })
    migrateLegacyLocalStorage(storage)
    expect(storage.getItem('athr_current_shift')).toBe('current')
  })
})
