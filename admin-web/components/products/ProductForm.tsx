'use client'
import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { apiDelete, apiPatch, apiPost } from '@/lib/api'
import Field from '@/components/ui/Field'
import { axisAttributes, emptyVariantRow, productLevelAttributes, type ProductFormState } from '@/lib/catalog/form-model'
import { buildCreatePayload } from '@/lib/catalog/product-payload'
import { planProductEdit, stateFromProduct, type ProductDetail } from '@/lib/catalog/product-plan'
import { applyPlan } from '@/lib/catalog/product-save'
import { fillSkus, generateMatrix } from '@/lib/catalog/variant-matrix'
import AxisPicker from './AxisPicker'
import TypeAttributeFields from './TypeAttributeFields'
import VariantMatrix from './VariantMatrix'
import { useCatalogRefs } from './useCatalogRefs'

const api = { post: apiPost, patch: apiPatch, del: apiDelete }
const blank = (): ProductFormState => ({
  name_en: '', name_ar: '', product_type_id: '', base_uom_id: '', productAttributes: {}, axisValues: {},
  variants: [emptyVariantRow()],
})

/** Create (no `product`) or edit a product with its variants. */
export default function ProductForm({ product, onSaved }: { product?: ProductDetail; onSaved?: () => void }) {
  const router = useRouter()
  const { types, uoms, loading, error: refsError } = useCatalogRefs()
  const [state, setState] = useState<ProductFormState>(() => (product ? stateFromProduct(product) : blank()))
  const [skuBase, setSkuBase] = useState('')
  const [errors, setErrors] = useState<string[]>([])
  const [saving, setSaving] = useState(false)

  const type = product ? product.product_type : types.find(item => item.id === state.product_type_id) ?? null
  const definitions = useMemo(() => type?.attributes ?? [], [type])
  const axes = axisAttributes(definitions)
  const uom = uoms.find(item => item.id === state.base_uom_id) ?? null

  const regenerate = (axisValues: Record<string, string[]>) =>
    setState(current => ({ ...current, axisValues, variants: generateMatrix(definitions, axisValues, current.variants, skuBase).rows }))

  const chooseType = (id: string) => {
    const next = types.find(item => item.id === id) ?? null
    setState(current => ({
      ...current, product_type_id: id, productAttributes: {}, axisValues: {},
      variants: generateMatrix(next?.attributes ?? [], {}, [], skuBase).rows,
    }))
  }

  const save = async () => {
    setErrors([])
    setSaving(true)
    try {
      if (!product) {
        const built = buildCreatePayload(state, type, uom)
        if ('errors' in built) return setErrors(built.errors)
        await apiPost('/products', built.value)
        toast.success('تم إنشاء المنتج')
        router.push('/products')
        return
      }
      const plan = planProductEdit(product, state, uom)
      if ('errors' in plan) return setErrors(plan.errors)
      if (!plan.value.length) return toast.info('لا توجد تغييرات للحفظ')
      const result = await applyPlan(api, product.id, plan.value)
      if (result.error) {
        setErrors([`تم تنفيذ ${result.done} من ${result.total} تغيير قبل الخطأ: ${result.error}`])
        onSaved?.()
        return
      }
      toast.success('تم حفظ التغييرات')
      onSaved?.()
    } catch (e: any) {
      setErrors([e.message || 'تعذر حفظ المنتج'])
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <div className="card text-gray-500">جارٍ التحميل…</div>
  const activeTypes = types.filter(item => item.is_active)

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
      <div className="space-y-4">
        <section className="card space-y-3">
          <h2 className="font-semibold text-gray-900">بيانات المنتج</h2>
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="الاسم بالعربية"><input className="input" value={state.name_ar} onChange={e => setState({ ...state, name_ar: e.target.value })} /></Field>
            <Field label="الاسم بالإنجليزية" required><input className="input" dir="ltr" value={state.name_en} onChange={e => setState({ ...state, name_en: e.target.value })} /></Field>
          </div>
          {!!productLevelAttributes(definitions).length && (
            <TypeAttributeFields attributes={productLevelAttributes(definitions)} values={state.productAttributes}
              onChange={(key, value) => setState(current => ({ ...current, productAttributes: { ...current.productAttributes, [key]: value } }))} />
          )}
        </section>

        {!!axes.length && (
          <section className="card space-y-3">
            <div>
              <h2 className="font-semibold text-gray-900">الأصناف المتاحة</h2>
              <p className="text-sm text-gray-500">اختر قيم كل محور، وتتولّد تركيباتها تلقائيًا في الجدول أدناه.</p>
            </div>
            <AxisPicker axes={axes} values={state.axisValues} onChange={(key, values) => regenerate({ ...state.axisValues, [key]: values })} />
          </section>
        )}

        <section className="card space-y-3">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <h2 className="font-semibold text-gray-900">
              {axes.length ? `الأصناف (${state.variants.filter(row => row.active).length})` : 'الصنف'}
            </h2>
            {!product && !!axes.length && (
              <label className="flex items-center gap-2 text-xs text-gray-600">
                بادئة SKU
                <input className="input-sm w-32 font-mono" dir="ltr" value={skuBase}
                  onChange={e => { setSkuBase(e.target.value); setState(c => ({ ...c, variants: fillSkus(c.variants, e.target.value, definitions) })) }} />
              </label>
            )}
          </div>
          {axes.length && !state.variants.length
            ? <div className="rounded-xl border border-dashed border-gray-300 py-8 text-center text-sm text-gray-500">اختر قيمة واحدة على الأقل لكل محور لتظهر الأصناف.</div>
            : <VariantMatrix rows={state.variants} definitions={definitions} precision={uom?.precision}
                onChange={variants => setState({ ...state, variants })} />}
        </section>
      </div>

      <aside className="space-y-3 lg:sticky lg:top-4 lg:self-start">
        <div className="card space-y-3">
          <Field label="نوع المنتج" hint={product ? 'لا يمكن تغيير النوع بعد الإنشاء.' : 'اتركه فارغًا لمنتج بسيط بصنف واحد.'}>
            <select className="select" value={state.product_type_id} disabled={!!product} onChange={e => chooseType(e.target.value)}>
              <option value="">منتج بسيط (بدون نوع)</option>
              {(product && type ? [type] : activeTypes).map(item => <option key={item.id} value={item.id}>{item.name_ar}</option>)}
            </select>
          </Field>
          {!!uoms.length && (
            <Field label="وحدة القياس" hint={uom ? `كميات العبوة حتى ${uom.precision} منازل عشرية` : 'تُطبّق على كل الأصناف'}>
              <select className="select" value={state.base_uom_id} onChange={e => setState({ ...state, base_uom_id: e.target.value })}>
                <option value="">— بدون —</option>
                {uoms.map(item => <option key={item.id} value={item.id}>{item.name_ar || item.name_en} ({item.code})</option>)}
              </select>
            </Field>
          )}
          {refsError && <p className="text-xs text-red-700">{refsError}</p>}
          {!!errors.length && (
            <ul className="space-y-1 rounded-lg bg-red-50 p-2 text-xs text-red-800" role="alert">
              {errors.map(message => <li key={message}>{message}</li>)}
            </ul>
          )}
          <button className="btn w-full" disabled={saving} onClick={save}>{saving ? 'جارٍ الحفظ…' : product ? 'حفظ التغييرات' : 'إنشاء المنتج'}</button>
          <button className="btn-secondary w-full" onClick={() => router.push('/products')}>رجوع للمنتجات</button>
        </div>
      </aside>
    </div>
  )
}
