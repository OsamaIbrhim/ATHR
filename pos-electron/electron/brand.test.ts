import { readFileSync } from 'fs'
import * as path from 'path'
import { describe, expect, it } from 'vitest'
import { BRAND_INITIAL, BRAND_NAME, POS_APP_NAME } from './brand'

const root = path.join(__dirname, '..')
const read = (file: string) => readFileSync(path.join(root, file), 'utf8')

describe('product name', () => {
  it('derives every shown name from the one brand constant', () => {
    expect(POS_APP_NAME).toBe(`${BRAND_NAME} POS`)
    expect(BRAND_INITIAL).toBe(BRAND_NAME[0])
  })

  it('keeps the installer product and shortcut name in step with the constant', () => {
    const { build } = JSON.parse(read('package.json'))
    expect(build.productName).toBe(POS_APP_NAME)
    expect(build.nsis.shortcutName).toBe(POS_APP_NAME)
  })

  it('takes the window title from the constant, not a literal in index.html', () => {
    expect(read('index.html')).toContain('<title>%POS_APP_NAME%</title>')
  })
})
