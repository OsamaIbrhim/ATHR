'use client'
import { useCallback, useEffect, useState } from 'react'
import { apiGet } from '@/lib/api'
import { useSessionUser } from '@/components/AuthGate'
import { loadDashboardData } from '@/lib/dashboard'
import { hasPermission, type Permission } from '@/lib/permissions'
import { businessDate } from '@/lib/business-time'
import GetStartedChecklist from '@/components/ui/GetStartedChecklist'
import StatCard from '@/components/ui/StatCard'
import { useChecklist } from '@/lib/use-checklist'
import { ADMIN_APP_NAME, BRAND_NAME } from '@/lib/brand'

export default function Dashboard(){
  const user = useSessionUser()
  const quickLinks: { href: string; label: string; permission: Permission; className: string }[] = [
    { href: '/products', label: 'المنتجات', permission: 'catalog.product.view', className: 'btn' },
    { href: '/sales', label: 'المبيعات', permission: 'sales.sale.view', className: 'btn' },
    { href: '/reports', label: 'التقارير', permission: 'reports.sales.view', className: 'btn-accent' },
    { href: '/offers', label: 'العروض المقترحة', permission: 'promotion.view', className: 'btn' },
  ]
  const checklist = useChecklist(user)
  const [stats, setStats] = useState({ total_sales:0, profit:0, count:0 })
  const [productCount, setProductCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    const today = businessDate()
    try {
      const data = await loadDashboardData(apiGet, today)
      setStats(data.stats)
      setProductCount(data.productCount)
    } catch (loadError: any) {
      setError(loadError.message || 'تعذر تحميل بيانات لوحة التحكم')
    } finally {
      setLoading(false)
    }
  }, [])
  useEffect(() => { void load() }, [load])
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">لوحة تحكم {ADMIN_APP_NAME}</h1>
      {error && (
        <div className="card border border-red-200 bg-red-50 text-red-800" role="alert">
          {error}{' '}
          <button className="underline" onClick={load}>إعادة المحاولة</button>
        </div>
      )}
      {!checklist.hidden && (checklist.loading || checklist.steps) && (
        <GetStartedChecklist steps={checklist.steps ?? []} user={user} loading={checklist.loading} onHide={checklist.hide} />
      )}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <StatCard label="مبيعات اليوم" value={loading || error ? '—' : `${stats.total_sales} ج`} />
        <StatCard label="الربح" value={loading || error ? '—' : `${stats.profit} ج`} />
        <StatCard label="عدد الفواتير" value={loading || error ? '—' : stats.count} />
        <StatCard label="منتجات الكتالوج" value={loading || error ? '—' : productCount} />
      </div>
      <div className="card">
        <h2 className="font-bold mb-3">روابط سريعة</h2>
        <div className="flex gap-3 flex-wrap">
          {quickLinks
            .filter(({ permission }) => hasPermission(user, permission))
            .map(({ href, label, className }) => <a key={href} href={href} className={className}>{label}</a>)}
        </div>
      </div>
      <div className="text-sm text-gray-500">{BRAND_NAME} API: متصل عبر بوابة الخادم الآمنة</div>
    </div>
  )
}
