'use client'
import { useEffect, useState } from 'react'
import { apiGet, type AdminUser } from './api'
import { deriveChecklist, loadChecklistFacts, type ChecklistStep } from './checklist'
import { isChecklistHidden, setChecklistHidden } from './checklist-hidden'
import { hasPermission } from './permissions'

/** Steps of the dashboard card, derived from live data. A failed read hides the card (it is guidance, not data). */
export function useChecklist(user: AdminUser | null) {
  const [steps, setSteps] = useState<ChecklistStep[] | null>(null)
  const [hidden, setHidden] = useState(true)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!user) return
    const isHidden = isChecklistHidden(user.id)
    setHidden(isHidden)
    if (isHidden) { setLoading(false); return }
    let cancelled = false
    loadChecklistFacts(apiGet, permission => hasPermission(user, permission), user.branch_id)
      .then(facts => { if (!cancelled) setSteps(deriveChecklist(facts)) })
      .catch(() => { if (!cancelled) setSteps(null) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [user])

  const hide = () => { if (user) setChecklistHidden(user.id, true); setHidden(true) }
  return { steps, hidden, loading, hide }
}
