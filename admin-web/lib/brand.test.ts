import { describe, expect, it } from 'vitest'
import { ADMIN_APP_NAME, ADMIN_PRODUCT_LINE, BRAND_NAME } from './brand'

describe('product name', () => {
  it('derives the admin app name from the one brand constant', () => {
    expect(ADMIN_APP_NAME).toBe(`${BRAND_NAME} ${ADMIN_PRODUCT_LINE}`)
  })
})
