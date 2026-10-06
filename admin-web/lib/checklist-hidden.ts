/** Per-user "hide the get-started card" flag; a convenience kept in this browser only. */
const key = (userId: string) => `athr.checklist.hidden.${userId}`

export function isChecklistHidden(userId: string): boolean {
  try { return localStorage.getItem(key(userId)) === '1' } catch { return false }
}

export function setChecklistHidden(userId: string, hidden: boolean) {
  try {
    if (hidden) localStorage.setItem(key(userId), '1')
    else localStorage.removeItem(key(userId))
  } catch { /* storage unavailable: the card just reappears next time */ }
}
