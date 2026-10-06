'use client'
import { useEffect, useState } from 'react'
import { useSessionUser } from '@/components/AuthGate'
import { isChecklistHidden, setChecklistHidden } from '@/lib/checklist-hidden'

/** Brings the dashboard "ابدأ تشغيل محلك" card back after it was hidden. */
export default function ChecklistReset() {
  const user = useSessionUser()
  const [hidden, setHidden] = useState(false)
  useEffect(() => { if (user) setHidden(isChecklistHidden(user.id)) }, [user])
  if (!user) return null
  return (
    <div className="card flex flex-wrap items-center justify-between gap-3">
      <div>
        <h2 className="font-bold">ابدأ تشغيل محلك</h2>
        <p className="text-sm text-gray-600">خطوات تجهيز المحل تظهر في لوحة التحكم حتى تكتمل.</p>
      </div>
      {hidden
        ? <button type="button" className="btn-secondary" onClick={() => { setChecklistHidden(user.id, false); setHidden(false) }}>إظهار في لوحة التحكم</button>
        : <span className="text-sm text-gray-600">ظاهرة في لوحة التحكم</span>}
    </div>
  )
}
