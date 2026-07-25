const adminBase = process.env.ADMIN_BASE_URL || 'http://localhost:3001'
const phone = process.env.ADMIN_SMOKE_PHONE || '+200100000000'
const password = process.env.ADMIN_SMOKE_PASSWORD || 'Bold1234'

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

async function assertResponseOk(response, label) {
  if (response.ok) return

  const body = await response.text()
  const details = body ? ` ${body}` : ''
  throw new Error(`${label}: ${response.status}${details}`)
}

const login = await fetch(`${adminBase}/api/session/login`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ phone, password }),
})
await assertResponseOk(login, 'Admin BFF login failed')
const getSetCookie = login.headers.getSetCookie?.bind(login.headers)
const setCookies = getSetCookie ? getSetCookie() : [login.headers.get('set-cookie') || '']
const cookie = setCookies
  .flatMap(value => value.split(/,(?=\s*bold_admin_)/))
  .map(value => value.trim().split(';', 1)[0])
  .filter(Boolean)
  .join('; ')
assert(cookie.includes('bold_admin_access='), 'Access cookie was not issued')
assert(cookie.includes('bold_admin_refresh='), 'Refresh cookie was not issued')
assert(setCookies.every(value => /HttpOnly/i.test(value)), 'Session cookies must be HttpOnly')

const me = await fetch(`${adminBase}/api/backend/auth/me`, {
  headers: { cookie },
})
await assertResponseOk(me, 'Authenticated /auth/me failed')
const user = await me.json()
assert(Array.isArray(user.capabilities), 'Authenticated user has no capabilities')

const products = await fetch(`${adminBase}/api/backend/products?page=1&page_size=1`, {
  headers: { cookie },
})
await assertResponseOk(products, 'Seeded product smoke failed')
const catalog = await products.json()
assert(Array.isArray(catalog.items), 'Product response is not a paginated catalog')

process.stdout.write('Admin BFF seeded smoke passed\n')
