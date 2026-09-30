'use client'
import { useSessionUser } from '@/components/AuthGate'
import PageHeader from '@/components/ui/PageHeader'
import ProductTypeForm from '@/components/product-types/ProductTypeForm'
import { hasPermission } from '@/lib/permissions'

export default function NewProductTypePage() {
  const canManage = hasPermission(useSessionUser(), 'catalog.product-type.manage')
  return (
    <div className="space-y-4">
      <PageHeader title="نوع منتج جديد" back={{ href: '/product-types', label: 'أنواع المنتجات' }} />
      {canManage ? <ProductTypeForm /> : <div className="card text-gray-600">ليست لديك صلاحية إدارة أنواع المنتجات.</div>}
    </div>
  )
}
