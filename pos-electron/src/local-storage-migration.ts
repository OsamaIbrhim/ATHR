type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

const KEY_MIGRATIONS = [
  ['bold_current_shift', 'athr_current_shift'],
] as const

export function migrateLegacyLocalStorage(storage: StorageLike) {
  for (const [legacyKey, currentKey] of KEY_MIGRATIONS) {
    if (storage.getItem(currentKey) !== null) continue
    const value = storage.getItem(legacyKey)
    if (value === null) continue
    storage.setItem(currentKey, value)
    if (storage.getItem(currentKey) === value) storage.removeItem(legacyKey)
  }
}
