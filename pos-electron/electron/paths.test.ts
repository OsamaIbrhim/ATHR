import * as path from 'path'
import { describe, expect, it, vi } from 'vitest'

const setPath = vi.fn()
vi.mock('electron', () => ({
  app: {
    getPath: (name: string) => (name === 'appData' ? '/appdata' : '/appdata/athr-pos'),
    setPath: (...args: unknown[]) => setPath(...args),
  },
}))

import { BRAND_NAME, POS_APP_NAME } from './brand'
import { DATA_DIRECTORY_NAME, pinDataDirectory } from './paths'

describe('local data folder', () => {
  it('is pinned to a fixed name that does not follow the brand', () => {
    pinDataDirectory()
    expect(setPath).toHaveBeenCalledWith('userData', path.join('/appdata', DATA_DIRECTORY_NAME))
    expect(DATA_DIRECTORY_NAME).toBe('athr-pos')
    expect(DATA_DIRECTORY_NAME).not.toContain(BRAND_NAME)
    expect(DATA_DIRECTORY_NAME).not.toBe(POS_APP_NAME)
  })
})
