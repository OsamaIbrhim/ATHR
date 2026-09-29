'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { apiPatch, apiPost } from '@/lib/api'
import Field from '@/components/ui/Field'
import { normalizeAttributeDefinitions, validateProductType } from '@/lib/catalog/attribute-schema'
import type { AttributeDefinition, ProductType } from '@/lib/catalog/types'
import AttributeEditor from './AttributeEditor'

/** Create (no `initial`) or edit a product type. */
export default function ProductTypeForm({ initial }: { initial?: ProductType }) {
  const router = useRouter()
  const [nameAr, setNameAr] = useState(initial?.name_ar ?? '')
  const [nameEn, setNameEn] = useState(initial?.name_en ?? '')
  const [attributes, setAttributes] = useState<AttributeDefinition[]>(initial?.attributes ?? [])
  const [errors, setErrors] = useState<string[]>([])
  const [saving, setSaving] = useState(false)

  const save = async () => {
    const body = { name_ar: nameAr.trim(), name_en: nameEn.trim(), attributes: normalizeAttributeDefinitions(attributes) }
    const problems = validateProductType(body)
    setErrors(problems)
    if (problems.length) return
    setSaving(true)
    try {
      if (initial) await apiPatch(`/product-types/${initial.id}`, body)
      else await apiPost('/product-types', body)
      toast.success('تم حفظ نوع المنتج')
      router.push('/product-types')
    } catch (error: any) {
      setErrors([error.message || 'تعذر حفظ نوع المنتج'])
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="space-y-4">
        <section className="card space-y-3">
          <h2 className="font-semibold text-gray-900">بيانات النوع</h2>
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="الاسم بالعربية" required>
              <input className="input" placeholder="ملابس" value={nameAr} onChange={event => setNameAr(event.target.value)} />
            </Field>
            <Field label="الاسم بالإنجليزية" required>
              <input className="input" dir="ltr" placeholder="Clothing" value={nameEn} onChange={event => setNameEn(event.target.value)} />
            </Field>
          </div>
        </section>
        <section className="card space-y-3">
          <div>
            <h2 className="font-semibold text-gray-900">الخصائص</h2>
            <p className="text-sm text-gray-500">الخصائص التي تحمل علامة المحور هي التي تُنتج المتغيرات؛ الباقي خصائص عامة للمنتج.</p>
          </div>
          <AttributeEditor attributes={attributes} onChange={setAttributes} />
        </section>
      </div>
      <aside className="space-y-3 lg:sticky lg:top-4 lg:self-start">
        <div className="card space-y-3">
          {initial && (
            <p className="rounded-lg bg-amber-50 p-2 text-xs text-amber-900">
              إن كانت منتجات تستخدم هذا النوع فيُسمح بإضافة خصائص فقط؛ لا يمكن حذف خاصية أو تغيير نوعها أو كونها محورًا.
            </p>
          )}
          {!!errors.length && (
            <ul className="space-y-1 rounded-lg bg-red-50 p-2 text-xs text-red-800" role="alert">
              {errors.map(message => <li key={message}>{message}</li>)}
            </ul>
          )}
          <button className="btn w-full" disabled={saving} onClick={save}>{saving ? 'جارٍ الحفظ…' : 'حفظ النوع'}</button>
          <button className="btn-secondary w-full" onClick={() => router.push('/product-types')}>إلغاء</button>
        </div>
      </aside>
    </div>
  )
}
