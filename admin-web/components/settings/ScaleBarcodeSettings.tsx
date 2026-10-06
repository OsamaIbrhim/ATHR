'use client'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { apiGet, apiPut } from '@/lib/api'
import Field from '@/components/ui/Field'
import TagInput from '@/components/ui/TagInput'
import { describeLabel, validateScaleBarcode, type ScaleBarcodeSettings as Settings } from '@/lib/catalog/scale-barcode'

/** Tenant settings for weighing-scale labels (what the POS reads when a scale barcode is scanned). */
export default function ScaleBarcodeSettings() {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [errors, setErrors] = useState<string[]>([])
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    apiGet('/tenant-settings')
      .then(data => setSettings(data.scale_barcode))
      .catch(error => setErrors([error.message || 'تعذر تحميل إعدادات باركود الميزان']))
  }, [])

  if (!settings) {
    return <div className="card text-sm text-gray-500">{errors[0] || 'جارٍ تحميل إعدادات باركود الميزان…'}</div>
  }
  const set = (patch: Partial<Settings>) => setSettings({ ...settings, ...patch })

  const save = async () => {
    const problems = validateScaleBarcode(settings)
    setErrors(problems)
    if (problems.length) return
    setSaving(true)
    try {
      const saved = await apiPut('/tenant-settings/scale-barcode', settings)
      setSettings(saved.scale_barcode)
      toast.success('تم حفظ إعدادات باركود الميزان')
    } catch (error: any) {
      setErrors([error.message || 'تعذر حفظ الإعدادات'])
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="card space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold">باركود الميزان</h2>
          <p className="text-sm text-gray-500">لملصقات الميزان (خضار، جبن، لحوم): كيف تقرأ نقطة البيع الوزن أو السعر من الباركود.</p>
        </div>
        <label className="flex items-center gap-2 text-sm font-medium">
          <input type="checkbox" checked={settings.enabled} onChange={e => set({ enabled: e.target.checked })} />
          مفعّل
        </label>
      </div>

      <fieldset disabled={!settings.enabled} className="space-y-4 disabled:opacity-50">
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="ما الذي يطبعه الميزان في الباركود؟">
            <select className="input" value={settings.value} onChange={e => set({ value: e.target.value as Settings['value'] })}>
              <option value="weight">الوزن</option>
              <option value="price">السعر الإجمالي للقطعة</option>
            </select>
          </Field>
          {settings.value === 'price' && (
            <Field label="السعر المطبوع على الملصق" hint="يحدد كيف تُحسب الكمية من السعر: السعر ÷ سعر الوحدة.">
              <select className="input" value={settings.price_includes_tax ? 'gross' : 'net'}
                onChange={e => set({ price_includes_tax: e.target.value === 'gross' })}>
                <option value="gross">شامل الضريبة (العميل يدفع المكتوب على الملصق)</option>
                <option value="net">قبل الضريبة (تُضاف الضريبة عند البيع)</option>
              </select>
            </Field>
          )}
          <Field label="بادئات ملصقات الميزان" hint="أول رقمين في الباركود، مثل 20 إلى 29.">
            <TagInput values={settings.prefixes} onChange={prefixes => set({ prefixes })} ariaLabel="بادئات ملصقات الميزان" inputMode="decimal" />
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="أرقام كود الصنف">
              <input className="input" type="number" min={1} max={8} value={settings.item_digits}
                onChange={e => set({ item_digits: Number(e.target.value) })} />
            </Field>
            <Field label="الخانات العشرية">
              <input className="input" type="number" min={0} max={4} value={settings.decimals}
                onChange={e => set({ decimals: Number(e.target.value) })} />
            </Field>
          </div>
        </div>
        <p className="rounded-xl bg-gray-50 px-3 py-2 text-xs text-gray-600">شكل الملصق: {describeLabel(settings)}</p>
      </fieldset>

      {errors.length > 0 && <ul className="list-inside list-disc text-sm text-red-700">{errors.map(error => <li key={error}>{error}</li>)}</ul>}
      <div><button className="btn" onClick={save} disabled={saving}>{saving ? 'جارٍ الحفظ…' : 'حفظ الإعدادات'}</button></div>
    </section>
  )
}
