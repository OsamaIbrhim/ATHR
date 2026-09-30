'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'
import { apiLogout, getStoredUser } from '@/lib/api'
import { activeNavHref, NAV } from '@/lib/permissions'
import { ADMIN_PRODUCT_LINE, BRAND_NAME } from '@/lib/brand'

function useStoredPermissions() {
  const [permissions, setPermissions] = useState<string[]>([])
  const [userName, setUserName] = useState('')
  useEffect(() => {
    const update = () => {
      const user = getStoredUser()
      setPermissions(user?.permissions || [])
      setUserName(user?.name || '')
    }
    update()
    window.addEventListener('athr-user-updated', update)
    return () => window.removeEventListener('athr-user-updated', update)
  }, [])
  return { permissions, userName }
}

export function Brand() {
  return <div className="text-2xl font-bold">{BRAND_NAME} <span className="text-accent">{ADMIN_PRODUCT_LINE}</span></div>
}

/** The menu itself, shared by the static sidebar and the phone drawer. */
export function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname()
  const { permissions, userName } = useStoredPermissions()
  const visible = NAV.filter(({ permission }) => permissions.includes(permission))
  const active = activeNavHref(pathname)
  return (
    <div className="on-dark">
      <nav aria-label="القائمة الرئيسية" className="space-y-1">
        {visible.map(({ href, label, group }, index) => {
          const isActive = href === active
          const heading = group && group !== visible[index - 1]?.group
          return (
            <div key={href}>
              {heading && <div className="mb-1 mt-4 px-3 text-xs font-semibold text-white/60">{group}</div>}
              <Link
                href={href}
                onClick={onNavigate}
                aria-current={isActive ? 'page' : undefined}
                className={`block rounded-xl border-s-4 px-3 py-2.5 md:py-2 ${isActive ? 'border-accent bg-white/15 font-semibold' : 'border-transparent hover:bg-white/10'}`}
              >
                {label}
              </Link>
            </div>
          )
        })}
        {!visible.length && <div className="rounded-lg bg-white/10 p-3 text-sm text-white/80">لم تُحمّل صلاحيات القائمة. تحقق من اتصال الخادم ثم أعد تسجيل الدخول.</div>}
      </nav>
      {userName && <div className="mt-8 text-sm text-white/70">{userName}</div>}
      <button className="mt-2 min-h-11 text-sm text-white/70 hover:text-white md:min-h-0" onClick={async () => { await apiLogout(); location.href = '/login' }}>تسجيل الخروج</button>
    </div>
  )
}

/** Static sidebar, desktop only. The phone gets the top bar + drawer in AppShell. */
export default function Sidebar() {
  const pathname = usePathname()
  if (pathname === '/login') return null
  return (
    <aside className="sticky top-0 hidden h-screen w-64 shrink-0 overflow-y-auto bg-athr p-4 text-white md:block">
      <div className="mb-6"><Brand /></div>
      <SidebarNav />
    </aside>
  )
}
