'use client'
import { useSessionUser } from '@/components/AuthGate'
import ProductForm from '@/components/products/ProductForm'
import PageHeader from '@/components/ui/PageHeader'
import { hasPermission } from '@/lib/permissions'

export default function NewProductPage() {
  const canCreate = hasPermission(useSessionUser(), 'catalog.product.create')
  return (
    <div className="space-y-4">
      <PageHeader title="منتج جديد" subtitle="اختر نوع المنتج لتظهر خصائصه ومصفوفة الأصناف." back={{ href: '/products', label: 'المنتجات' }} />
      {canCreate ? <ProductForm /> : <div className="card text-gray-600">ليست لديك صلاحية إنشاء المنتجات.</div>}
    </div>
  )
}
