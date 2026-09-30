'use client'
import { createContext, useContext, useEffect, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { AdminUser, ApiError, apiGet, apiLogout } from '@/lib/api'
import { canAccessPath, firstAccessiblePath } from '@/lib/permissions'

const SessionUserContext = createContext<AdminUser | null>(null)

export function useSessionUser() {
  return useContext(SessionUserContext)
}

export default function AuthGate({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()
  const isLogin = pathname === '/login'
  const [user, setUser] = useState<AdminUser | null>(null)
  const [networkError, setNetworkError] = useState(false)
  const [attempt, setAttempt] = useState(0)

  // The session loads once (and on retry); page navigation does not refetch it.
  // A 401 from any API call is handled in lib/api.ts, which redirects to /login.
  useEffect(() => {
    if (isLogin) return
    setNetworkError(false)
    apiGet('/auth/me').then((me: AdminUser) => {
      localStorage.setItem('user', JSON.stringify(me))
      window.dispatchEvent(new Event('athr-user-updated'))
      setUser(me)
    }).catch((error) => {
      if (error instanceof ApiError && error.code === 'NETWORK_ERROR') {
        setNetworkError(true)
        return
      }
      setUser(null)
      router.replace(`/login?next=${encodeURIComponent(location.pathname)}`)
    })
  }, [isLogin, attempt, router])

  const allowed = !!user && canAccessPath(user, pathname)
  useEffect(() => {
    if (user && !allowed && !isLogin) router.replace(firstAccessiblePath(user))
  }, [user, allowed, isLogin, router])

  if (isLogin) return children
  if (networkError) return <div className="card max-w-lg mx-auto mt-20 text-center space-y-3">
    <h1 className="text-xl font-bold">تعذر التحقق من الجلسة</h1>
    <p className="text-gray-600">الاتصال بالخادم غير متاح. لم نعرض بيانات جلسة قديمة باعتبارها صالحة.</p>
    <div className="flex justify-center gap-2">
      <button className="btn-accent" onClick={()=>setAttempt(value=>value+1)}>إعادة المحاولة</button>
      <button className="btn" onClick={async()=>{await apiLogout();router.replace('/login')}}>تسجيل الخروج</button>
    </div>
  </div>
  return allowed
    ? <SessionUserContext.Provider value={user}>{children}</SessionUserContext.Provider>
    : <div className="card max-w-sm mx-auto mt-20 text-center">جارٍ التحقق من الجلسة…</div>
}
