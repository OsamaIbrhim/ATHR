'use client'
import { useEffect, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { ApiError, apiGet, apiLogout } from '@/lib/api'
import { canAccessPath, firstAccessiblePath } from '@/lib/permissions'

export default function AuthGate({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()
  const [ready, setReady] = useState(pathname === '/login')
  const [networkError, setNetworkError] = useState(false)
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    if (pathname === '/login') { setReady(true); return }
    setReady(false)
    setNetworkError(false)
    apiGet('/auth/me').then((user) => {
      localStorage.setItem('user', JSON.stringify(user))
      window.dispatchEvent(new Event('athr-user-updated'))
      if (!canAccessPath(user, pathname)) {
        router.replace(firstAccessiblePath(user))
        setReady(false)
        return
      }
      setReady(true)
    }).catch((error) => {
      if (error instanceof ApiError && error.code === 'NETWORK_ERROR') {
        setNetworkError(true)
        return
      }
      router.replace(`/login?next=${encodeURIComponent(pathname)}`)
    })
  }, [pathname, router, attempt])
  if (networkError) return <div className="card max-w-lg mx-auto mt-20 text-center space-y-3">
    <h1 className="text-xl font-bold">تعذر التحقق من الجلسة</h1>
    <p className="text-gray-600">الاتصال بالخادم غير متاح. لم نعرض بيانات جلسة قديمة باعتبارها صالحة.</p>
    <div className="flex justify-center gap-2">
      <button className="btn-accent" onClick={()=>setAttempt(value=>value+1)}>إعادة المحاولة</button>
      <button className="btn" onClick={async()=>{await apiLogout();router.replace('/login')}}>تسجيل الخروج</button>
    </div>
  </div>
  return ready ? children : <div className="card max-w-sm mx-auto mt-20 text-center">جارٍ التحقق من الجلسة…</div>
}
