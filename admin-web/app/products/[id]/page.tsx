'use client'
import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { apiGet } from '@/lib/api'
import { useSessionUser } from '@/components/AuthGate'
import ProductForm from '@/components/products/ProductForm'
import PageHeader from '@/components/ui/PageHeader'
import { hasPermission } from '@/lib/permissions'
import type { ProductDetail } from '@/lib/catalog/product-plan'

export default function EditProductPage() {
  const { id } = useParams<{ id: string }>()
  const canEdit = hasPermission(useSessionUser(), 'catalog.product.update')
  const [product, setProduct] = useState<ProductDetail | null>(null)
  const [version, setVersion] = useState(0)
  const [error, setError] = useState('')

  const load = useCallback(() => {
    apiGet(`/products/${id}`)
      .then((data: ProductDetail) => { setProduct(data); setVersion(v => v + 1) })
      .catch((e: any) => setError(e.message || 'تعذر تحميل المنتج'))
  }, [id])
  useEffect(() => { load() }, [load])

  return (
    <div className="space-y-4">
      <PageHeader
        title={product ? product.name_ar || product.name_en : 'تعديل المنتج'}
        subtitle={product?.product_type ? `النوع: ${product.product_type.name_ar}` : 'منتج بسيط'}
        back={{ href: '/products', label: 'المنتجات' }}
      />
      {error && <div className="card text-red-700">{error}</div>}
      {product && (
        <fieldset disabled={!canEdit} className="contents">
          <ProductForm key={version} product={product} onSaved={load} />
        </fieldset>
      )}
      {product && !canEdit && <div className="text-sm text-gray-500">عرض فقط: ليست لديك صلاحية تعديل المنتجات.</div>}
      {!product && !error && <div className="card text-gray-500">جارٍ التحميل…</div>}
    </div>
  )
}
