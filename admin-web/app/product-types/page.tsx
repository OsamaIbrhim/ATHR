'use client'
import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { apiGet, apiPatch } from '@/lib/api'
import { useSessionUser } from '@/components/AuthGate'
import DataTable, { type Column } from '@/components/ui/DataTable'
import PageHeader from '@/components/ui/PageHeader'
import { hasPermission } from '@/lib/permissions'
import { ATTRIBUTE_KIND_LABELS, type ProductType } from '@/lib/catalog/types'

export default function ProductTypesPage() {
  const canManage = hasPermission(useSessionUser(), 'catalog.product-type.manage')
  const [types, setTypes] = useState<ProductType[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try { setTypes(await apiGet('/product-types')) }
    catch (e: any) { setError(e.message || 'تعذر تحميل أنواع المنتجات') }
    finally { setLoading(false) }
  }, [])
  useEffect(() => { load() }, [load])

  const setActive = async (type: ProductType, is_active: boolean) => {
    try {
      await apiPatch(`/product-types/${type.id}`, { is_active })
      toast.success(is_active ? 'تمت استعادة النوع' : 'تمت أرشفة النوع')
      load()
    } catch (e: any) { toast.error(e.message) }
  }

  const columns: Column<ProductType>[] = [
    {
      header: 'النوع',
      cell: type => (
        <div>
          <div className="font-semibold text-gray-900">{type.name_ar}</div>
          <div className="text-xs text-gray-500" dir="ltr">{type.name_en}</div>
        </div>
      ),
    },
    {
      header: 'الخصائص',
      cell: type => (
        <div className="flex flex-wrap gap-1.5">
          {type.attributes.map(attribute => (
            <span key={attribute.key} className={`badge ${attribute.axis ? 'bg-amber-100 text-amber-900' : 'bg-gray-100 text-gray-700'}`}
              title={`${attribute.key} · ${ATTRIBUTE_KIND_LABELS[attribute.kind]}`}>
              {attribute.label_ar}{attribute.axis ? ' · محور' : ''}
            </span>
          ))}
          {!type.attributes.length && <span className="text-xs text-gray-400">بلا خصائص</span>}
        </div>
      ),
    },
    {
      header: 'الحالة',
      cell: type => (
        <span className={`badge ${type.is_active ? 'bg-emerald-100 text-emerald-800' : 'bg-gray-200 text-gray-600'}`}>
          {type.is_active ? 'نشط' : 'مؤرشف'}
        </span>
      ),
    },
    {
      header: '',
      className: 'text-left whitespace-nowrap',
      cell: type => canManage && (
        <div className="flex justify-end gap-3 text-sm">
          <Link href={`/product-types/${type.id}`} className="text-blue-700 hover:underline">تعديل</Link>
          <button className={type.is_active ? 'text-red-600' : 'text-emerald-700'} onClick={() => setActive(type, !type.is_active)}>
            {type.is_active ? 'أرشفة' : 'استعادة'}
          </button>
        </div>
      ),
    },
  ]

  return (
    <div className="space-y-4">
      <PageHeader
        title="أنواع المنتجات"
        subtitle="عرّف خصائص كل نوع تجارة (مقاس، لون، عبوة…) لتُبنى عليها نماذج المنتجات والمتغيرات."
        actions={canManage && <Link href="/product-types/new" className="btn">+ نوع جديد</Link>}
      />
      {error && <div className="card text-red-700">{error} <button className="underline" onClick={load}>إعادة المحاولة</button></div>}
      <div className="card p-2">
        <DataTable
          columns={columns} rows={types} rowKey={type => type.id} loading={loading}
          empty={{ title: 'لا توجد أنواع منتجات بعد', hint: 'أنشئ نوعًا لتحديد الخصائص التي تميّز أصناف منتجاتك.' }}
        />
      </div>
    </div>
  )
}
