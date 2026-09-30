'use client'
import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { apiDelete, apiGet } from '@/lib/api'
import { useSessionUser } from '@/components/AuthGate'
import BarcodeChips from '@/components/products/BarcodeChips'
import DataTable, { type Column } from '@/components/ui/DataTable'
import PageHeader from '@/components/ui/PageHeader'
import { hasPermission } from '@/lib/permissions'

type ProductResponse = { items: any[]; page: number; page_size: number; total: number; total_pages: number; suggestions?: { value: string; label: string }[] }

export default function ProductsPage() {
  const user = useSessionUser()
  const canCreate = hasPermission(user, 'catalog.product.create')
  const canEdit = hasPermission(user, 'catalog.product.update')
  const canArchive = hasPermission(user, 'catalog.product.archive')
  const [query, setQuery] = useState('')
  const [appliedQuery, setAppliedQuery] = useState('')
  const [page, setPage] = useState(1)
  const [data, setData] = useState<ProductResponse>({ items: [], page: 1, page_size: 20, total: 0, total_pages: 1 })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try { setData(await apiGet(`/products?q=${encodeURIComponent(appliedQuery)}&page=${page}&page_size=20`)) }
    catch (e: any) { setError(e.message || 'تعذر تحميل المنتجات') }
    finally { setLoading(false) }
  }, [appliedQuery, page])
  useEffect(() => { load() }, [load])

  const deactivate = async (id: string) => {
    if (!confirm('تعطيل هذا الصنف؟ لن يظهر في البيع.')) return
    try { await apiDelete(`/products/variants/${id}`); toast.success('تم تعطيل الصنف'); load() }
    catch (e: any) { toast.error('فشل التعطيل: ' + e.message) }
  }
  const search = () => { setPage(1); setAppliedQuery(query.trim()) }
  const applySuggestion = (value: string) => { setQuery(value); setAppliedQuery(value); setPage(1) }

  const columns: Column<any>[] = [
    { header: 'SKU', cell: row => <span className="font-mono text-xs" dir="ltr">{row.sku}</span> },
    {
      header: 'المنتج',
      cell: row => (
        <Link href={`/products/${row.product_id}`} className="font-medium text-gray-900 hover:text-blue-700">
          {row.product?.name_ar || row.product?.name_en}
        </Link>
      ),
    },
    { header: 'الصنف', cell: row => row.label ? <span className="badge bg-gray-100 text-gray-800 text-sm">{row.label}</span> : <span className="text-gray-400">—</span> },
    { header: 'الباركود', cell: row => <BarcodeChips barcodes={row.barcodes} /> },
    { header: 'التكلفة', cell: row => row.cost_price !== undefined ? `${Number(row.cost_price)} ج` : '—' },
    { header: 'المخزون', cell: row => (row.stock_by_branch || []).reduce((sum: number, x: any) => sum + Number(x.qty_on_hand), 0) },
    {
      header: '',
      cell: row => (
        <div className="flex justify-end gap-3 text-sm">
          {canEdit && <Link href={`/products/${row.product_id}`} className="text-blue-700 hover:underline">تعديل</Link>}
          {canArchive && <button className="text-red-600" onClick={() => deactivate(row.id)}>تعطيل</button>}
        </div>
      ),
    },
  ]

  return (
    <div className="space-y-4">
      <PageHeader
        title="المنتجات"
        subtitle={`${data.total} صنف`}
        actions={canCreate && <Link href="/products/new" className="btn">+ منتج جديد</Link>}
      />
      <div className="card">
        <form className="flex gap-2" onSubmit={e => { e.preventDefault(); search() }}>
          <input className="input" placeholder="ابحث بالباركود / SKU / الاسم، أو اتركه فارغاً لعرض الكل" value={query} onChange={e => setQuery(e.target.value)} />
          <button className="btn">بحث</button>
          <button type="button" className="btn-secondary" onClick={() => { setQuery(''); setAppliedQuery(''); setPage(1) }}>الكل</button>
        </form>
      </div>
      <div className="card p-2">
        {error && <div className="p-3 text-red-700">{error} <button className="underline" onClick={load}>إعادة المحاولة</button></div>}
        <DataTable
          columns={columns} rows={data.items} rowKey={row => row.id} loading={loading}
          empty={{
            title: 'لا توجد منتجات مطابقة',
            hint: 'راجع الاسم أو SKU أو الباركود.',
            action: data.suggestions?.length ? (
              <div className="text-sm">هل تقصد: {data.suggestions.map(item => (
                <button key={item.value} className="mx-1 text-blue-700 underline" onClick={() => applySuggestion(item.value)}>{item.label}</button>
              ))}</div>
            ) : undefined,
          }}
        />
        <div className="mt-3 flex items-center justify-center gap-3 pb-2 text-sm">
          <button className="btn-secondary" disabled={page <= 1 || loading} onClick={() => setPage(p => p - 1)}>السابق</button>
          <span>صفحة {data.page} من {data.total_pages}</span>
          <button className="btn-secondary" disabled={page >= data.total_pages || loading} onClick={() => setPage(p => p + 1)}>التالي</button>
        </div>
      </div>
    </div>
  )
}
