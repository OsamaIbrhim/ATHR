/**
 * The product name users see, in one place. Rename the product here; the
 * package names (`@athr/*`, `athr-*`), env var prefixes and the installer
 * fields in package.json are code identifiers and stay as they are
 * (`brand.test.ts` fails if the installer name drifts from this file).
 */
export const BRAND_NAME = 'ATHR'

/** The POS app name: window title, dialogs, receipts' app name, diagnostics. */
export const POS_APP_NAME = `${BRAND_NAME} POS`

/** The letter in the round logo mark. */
export const BRAND_INITIAL = BRAND_NAME.charAt(0)
