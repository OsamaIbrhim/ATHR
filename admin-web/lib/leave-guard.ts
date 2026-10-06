/** Lets a page with unfinished work intercept in-app navigation (sidebar links). */
type Guard = (href: string) => void
let guard: Guard | null = null

export function setLeaveGuard(next: Guard | null) { guard = next }

/** Returns true when navigation was intercepted and must be cancelled. */
export function interceptLeave(href: string): boolean {
  if (!guard) return false
  guard(href)
  return true
}
