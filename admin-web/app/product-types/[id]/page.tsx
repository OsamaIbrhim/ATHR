'use client'
import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { apiGet } from '@/lib/api'
import { useSessionUser } from '@/components/AuthGate'
import PageHeader from '@/components/ui/PageHeader'
import ProductTypeForm from '@/components/product-types/ProductTypeForm'
import { hasPermission } from '@/lib/permissions'
import type { ProductType } from '@/lib/catalog/types'

export default function EditProductTypePage() {
  const { id } = useParams<{ id: string }>()
  const canManage = hasPermission(useSessionUser(), 'catalog.product-type.manage')
  const [type, setType] = useState<ProductType | null>(null)
  const [error, setError] = useState('')

  // The API has no single-type endpoint; the list is small and tenant-scoped.
  useEffect(() => {
    apiGet('/product-types')
      .then((types: ProductType[]) => {
        const found = types.find(item => item.id === id)
        if (found) setType(found)
        else setError('نوع المنتج غير موجود.')
      })
      .catch((e: any) => setError(e.message || 'تعذر تحميل نوع المنتج'))
  }, [id])

  return (
    <div className="space-y-4">
      <PageHeader title={type ? `تعديل: ${type.name_ar}` : 'تعديل نوع المنتج'} back={{ href: '/product-types', label: 'أنواع المنتجات' }} />
      {error && <div className="card text-red-700">{error}</div>}
      {!canManage && <div className="card text-gray-600">ليست لديك صلاحية إدارة أنواع المنتجات.</div>}
      {canManage && type && <ProductTypeForm key={type.id} initial={type} />}
      {canManage && !type && !error && <div className="card text-gray-500">جارٍ التحميل…</div>}
    </div>
  )
}
