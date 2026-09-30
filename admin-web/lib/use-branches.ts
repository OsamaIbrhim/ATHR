'use client'
import { useEffect, useState } from 'react'
import { apiGet, type AdminUser } from './api'
import { hasPermission } from './permissions'

export interface BranchOption { id: string; name: string }

/**
 * Branches the user can pick. `GET /branches` needs `location.view`; without it the
 * user's own branch is offered (by id, unnamed) so a branch manager can still work.
 */
export function useBranches(user: AdminUser | null) {
  const [branches, setBranches] = useState<BranchOption[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (!user) return
    let cancelled = false
    setLoading(true); setError('')
    const load = async () => {
      if (!hasPermission(user, 'location.view')) {
        return user.branch_id ? [{ id: user.branch_id, name: 'فرعي' }] : []
      }
      const response = await apiGet('/branches')
      const list: any[] = Array.isArray(response) ? response : response?.items ?? []
      const all = list.map(b => ({ id: String(b.id), name: b.name_ar || b.name_en || b.name || 'فرع' }))
      return user.branch_id ? all.filter(b => b.id === user.branch_id) : all
    }
    load()
      .then(list => { if (!cancelled) setBranches(list) })
      .catch((e: any) => { if (!cancelled) setError(e.message || 'تعذر تحميل الفروع') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [user, attempt])

  return { branches, loading, error, retry: () => setAttempt(n => n + 1) }
}
