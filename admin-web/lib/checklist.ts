import type { Permission } from './permissions'

/** What the dashboard learned from the API; `null` means "could not be read" (never counts as done). */
export interface ChecklistFacts {
  branches: number | null
  products: number | null
  /** Stocked items of the main branch that have no stock row yet. */
  noBalanceItems: number | null
  users: number | null
  terminals: number | null
  postedCounts: number | null
}

export interface ChecklistStep {
  key: 'branch' | 'products' | 'opening' | 'users' | 'terminal' | 'count'
  title: string
  hint: string
  href: string
  actionLabel: string
  done: boolean
  optional: boolean
  permission: Permission
  /** Extra state line while pending, e.g. "12 صنف بلا رصيد". */
  pendingNote?: string
  secondary?: { href: string; label: string }
}

const pos = (n: number | null) => n !== null && n > 0

export function deriveChecklist(facts: ChecklistFacts): ChecklistStep[] {
  const openingDone = pos(facts.products) && facts.noBalanceItems === 0
  return [
    {
      key: 'branch', title: 'أضف فرع المحل', hint: 'اسم الفرع وعنوانه يظهران على الفاتورة.',
      href: '/branches', actionLabel: 'الفروع', done: pos(facts.branches), optional: false, permission: 'location.create',
    },
    {
      key: 'products', title: 'أضف منتجاتك', hint: 'ارفع ملف Excel بمنتجاتك وأسعارها وباركوداتها، أو أضفها واحدًا واحدًا.',
      href: '/products/import', actionLabel: 'استيراد من Excel', done: pos(facts.products), optional: false, permission: 'catalog.product.create',
      secondary: { href: '/products/new', label: 'إضافة يدوية' },
    },
    {
      key: 'opening', title: 'سجّل كميات المخزون', hint: 'أدخل الكمية وتكلفة كل صنف لتبدأ المبيعات بأرقام صحيحة.',
      href: '/inventory/opening', actionLabel: 'الرصيد الافتتاحي', done: openingDone, optional: false, permission: 'inventory.adjustment.post',
      pendingNote: !openingDone && pos(facts.noBalanceItems) ? `${facts.noBalanceItems} صنف بلا رصيد` : undefined,
    },
    {
      key: 'users', title: 'أضف الكاشير وصلاحياتهم', hint: 'كل كاشير بحساب وصلاحيات خاصة به.',
      href: '/users', actionLabel: 'المستخدمون', done: facts.users !== null && facts.users >= 2, optional: true, permission: 'tenant.membership.view',
    },
    {
      key: 'terminal', title: 'اربط جهاز نقطة البيع', hint: 'فعّل جهاز الكاشير لبدء البيع.',
      href: '/terminals', actionLabel: 'أجهزة نقاط البيع', done: pos(facts.terminals), optional: false, permission: 'terminal.view',
    },
    {
      key: 'count', title: 'اعمل جرد للتأكد', hint: 'بعد أسبوع من التشغيل قارن المخزون الفعلي بالنظام.',
      href: '/inventory/counts', actionLabel: 'بدء جرد', done: pos(facts.postedCounts), optional: true, permission: 'inventory.adjustment.request',
    },
  ]
}

export interface ChecklistSummary {
  done: number
  total: number
  /** Steps 1, 2, 3 and 5 (the non-optional ones) are all done. */
  allRequiredDone: boolean
  firstPendingKey: ChecklistStep['key'] | null
}

export function summarizeChecklist(steps: ChecklistStep[]): ChecklistSummary {
  const pending = steps.find(step => !step.done)
  return {
    done: steps.filter(step => step.done).length,
    total: steps.length,
    allRequiredDone: steps.filter(step => !step.optional).every(step => step.done),
    firstPendingKey: pending?.key ?? null,
  }
}

type Get = (path: string) => Promise<any>
type Can = (permission: Permission) => boolean

const countOf = (response: any): number | null => {
  if (Array.isArray(response)) return response.length
  if (typeof response?.total === 'number') return response.total
  if (Array.isArray(response?.items)) return response.items.length
  return null
}

/** Reads each source only when the user may see it; a failed or forbidden read is `null`. */
export async function loadChecklistFacts(get: Get, can: Can, userBranchId: string | null): Promise<ChecklistFacts> {
  const safe = async <T,>(allowed: boolean, run: () => Promise<T>): Promise<T | null> => {
    if (!allowed) return null
    try { return await run() } catch { return null }
  }
  const branchList = await safe(can('location.view'), () => get('/branches'))
  const branches: any[] = Array.isArray(branchList) ? branchList : branchList?.items ?? []
  const mainBranch = userBranchId ?? branches[0]?.id ?? null
  const [products, low, users, terminals, counts] = await Promise.all([
    safe(can('catalog.product.view'), () => get('/products?page=1&page_size=1')),
    safe(can('inventory.position.view') && !!mainBranch, () => get(`/inventory/low-stock?status=no_stock_row&branch_id=${mainBranch}&page_size=1`)),
    safe(can('tenant.membership.view'), () => get('/users?page=1&page_size=1')),
    safe(can('terminal.view'), () => get('/terminals')),
    safe(can('inventory.adjustment.request'), () => get('/inventory/counts?status=posted&page_size=1')),
  ])
  return {
    branches: branchList === null ? null : branches.filter(b => (b.name_ar || b.name_en || b.name || '').trim()).length,
    products: countOf(products),
    noBalanceItems: typeof low?.counts?.no_stock_row === 'number' ? low.counts.no_stock_row : null,
    users: countOf(users),
    terminals: countOf(terminals),
    postedCounts: countOf(counts),
  }
}
