'use client'

import { useEffect, useMemo, useState } from 'react'
import { apiGet, apiPost } from '@/lib/api'

type Review = {
  id: string
  sync_id: string
  local_invoice_number: string
  local_total: number | string
  terminal_sequence: string | number
  error_code: string
  error_message: string
  ticket_key_id?: string | null
  attempt_count: number
  status: 'pending' | 'processing' | 'approved' | 'rejected' | 'linked'
  review_reason?: string | null
  resolution_error?: string | null
  created_at: string
  updated_at: string
  command: any
  branch?: { code: string; name_ar: string }
  terminal?: { terminal_code: string; name: string }
  origin_cashier?: { name: string }
  seller?: { name: string }
  shift?: {
    id: string
    status: string
    opened_at: string
    closed_at?: string | null
  }
  reviewer?: { name: string } | null
  linked_invoice?: {
    id: string
    invoice_number: string
    total: number | string
  } | null
}

const statusLabels: Record<string, string> = {
  pending: 'بانتظار المراجعة',
  processing: 'جارٍ التنفيذ',
  approved: 'تم الاعتماد',
  rejected: 'مرفوضة ومعكوسة محليًا',
  linked: 'مرتبطة بفاتورة موجودة',
}

export default function SaleReviewsPage() {
  const [items, setItems] = useState<Review[]>([])
  const [selectedId, setSelectedId] = useState('')
  const [status, setStatus] = useState('pending')
  const [reason, setReason] = useState('')
  const [confirmReference, setConfirmReference] = useState('')
  const [financialConfirmed, setFinancialConfirmed] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const selected = useMemo(
    () => items.find((item) => item.id === selectedId) || items[0] || null,
    [items, selectedId],
  )

  const load = async () => {
    setLoading(true)
    setError('')
    try {
      const query = status ? `?status=${encodeURIComponent(status)}` : ''
      const result = await apiGet(`/sale-reviews${query}`)
      const rows = result.items || []
      setItems(rows)
      setSelectedId((current) =>
        rows.some((item: Review) => item.id === current)
          ? current
          : rows[0]?.id || '',
      )
    } catch (loadError: any) {
      setError(loadError.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
    const timer = window.setInterval(() => void load(), 30_000)
    return () => window.clearInterval(timer)
  }, [status])

  useEffect(() => {
    setReason('')
    setConfirmReference('')
    setFinancialConfirmed(false)
  }, [selectedId])

  const decide = async (decision: 'approve' | 'reject') => {
    if (!selected || reason.trim().length < 5) {
      setError('اكتب سببًا واضحًا لا يقل عن 5 أحرف قبل تنفيذ القرار.')
      return
    }
    if (
      decision === 'reject' &&
      (confirmReference.trim() !== selected.local_invoice_number ||
        !financialConfirmed)
    ) {
      setError('للرفض: اكتب رقم الفاتورة المحلي كاملًا وأكد تسوية المبلغ مع العميل.')
      return
    }
    setSaving(true)
    setError('')
    try {
      await apiPost(`/sale-reviews/${selected.id}/${decision}`, {
        reason: reason.trim(),
        ...(decision === 'reject'
          ? {
              confirmation_reference: confirmReference.trim(),
              confirm_financial_settlement: financialConfirmed,
            }
          : {}),
      })
      setReason('')
      setConfirmReference('')
      setFinancialConfirmed(false)
      await load()
    } catch (decisionError: any) {
      setError(decisionError.message)
    } finally {
      setSaving(false)
    }
  }

  const commandItems = Array.isArray(selected?.command?.items)
    ? selected!.command.items
    : []

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">مراجعة عمليات POS</h1>
          <p className="text-sm text-gray-600 mt-1">
            قرارات مركزية ومدققة للعمليات المحلية التي لم يقبلها الخادم.
          </p>
        </div>
        <div className="flex gap-2">
          <select className="select" value={status} onChange={(event) => setStatus(event.target.value)}>
            <option value="pending">بانتظار المراجعة</option>
            <option value="processing">جارٍ التنفيذ</option>
            <option value="approved">تم الاعتماد</option>
            <option value="linked">مرتبطة</option>
            <option value="rejected">مرفوضة</option>
            <option value="">كل الحالات</option>
          </select>
          <button className="btn" onClick={() => void load()} disabled={loading}>
            تحديث
          </button>
        </div>
      </div>

      {error && (
        <div className="card border border-red-200 bg-red-50 text-red-800" role="alert">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-[420px_1fr] gap-4">
        <div className="card overflow-auto max-h-[75vh]">
          <table>
            <thead>
              <tr>
                <th>العملية</th>
                <th>الجهاز</th>
                <th>الإجمالي</th>
                <th>الحالة</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr
                  key={item.id}
                  className={`cursor-pointer ${selected?.id === item.id ? 'bg-amber-50' : ''}`}
                  onClick={() => setSelectedId(item.id)}
                >
                  <td>
                    <b>{item.local_invoice_number}</b>
                    <div className="text-xs text-gray-500">{new Date(item.created_at).toLocaleString('ar-EG')}</div>
                  </td>
                  <td>{item.terminal?.terminal_code || '—'}</td>
                  <td>{Number(item.local_total).toFixed(2)} ج</td>
                  <td>{statusLabels[item.status] || item.status}</td>
                </tr>
              ))}
              {!loading && !items.length && (
                <tr>
                  <td colSpan={4} className="text-center py-8 text-gray-500">
                    لا توجد عمليات بهذه الحالة.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {selected ? (
          <div className="space-y-4">
            <div className="card">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="text-xl font-bold">{selected.local_invoice_number}</h2>
                  <p className="text-sm text-gray-500" dir="ltr">{selected.sync_id}</p>
                </div>
                <span className="rounded-full bg-amber-100 text-amber-900 px-3 py-1 text-sm font-bold">
                  {statusLabels[selected.status] || selected.status}
                </span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-4 text-sm">
                <div><span className="text-gray-500">الفرع</span><b className="block">{selected.branch?.name_ar || '—'}</b></div>
                <div><span className="text-gray-500">الجهاز</span><b className="block">{selected.terminal?.terminal_code || '—'}</b></div>
                <div><span className="text-gray-500">الكاشير الأصلي</span><b className="block">{selected.origin_cashier?.name || '—'}</b></div>
                <div><span className="text-gray-500">البائع</span><b className="block">{selected.seller?.name || '—'}</b></div>
                <div><span className="text-gray-500">الوردية</span><b className="block">{selected.shift?.status || '—'}</b></div>
                <div><span className="text-gray-500">ترتيب الجهاز</span><b className="block">{String(selected.terminal_sequence)}</b></div>
                <div><span className="text-gray-500">طريقة الدفع</span><b className="block">{selected.command?.payment_method || '—'}</b></div>
                <div><span className="text-gray-500">وقت البيع</span><b className="block">{new Date(selected.command?.occurred_at).toLocaleString('ar-EG')}</b></div>
                <div><span className="text-gray-500">الإجمالي</span><b className="block">{Number(selected.local_total).toFixed(2)} ج</b></div>
              </div>
            </div>

            <div className="card">
              <h3 className="font-bold mb-2">سبب التوقف</h3>
              <div className="rounded-lg bg-red-50 text-red-800 p-3">
                <b dir="ltr">{selected.error_code}</b>
                <p className="mt-1">{selected.error_message}</p>
                <small>عدد المحاولات: {selected.attempt_count}</small>
                {selected.ticket_key_id && (
                  <small className="block mt-1" dir="ltr">Ticket key: {selected.ticket_key_id}</small>
                )}
              </div>
              {selected.resolution_error && (
                <div className="rounded-lg bg-amber-50 text-amber-900 p-3 mt-2">
                  آخر محاولة اعتماد: {selected.resolution_error}
                </div>
              )}
            </div>

            <div className="card overflow-auto">
              <h3 className="font-bold mb-2">الأصناف الأصلية غير القابلة للتعديل</h3>
              <table>
                <thead>
                  <tr><th>Variant</th><th>الكمية</th><th>السعر</th><th>الضريبة</th></tr>
                </thead>
                <tbody>
                  {commandItems.map((item: any) => (
                    <tr key={item.variant_id}>
                      <td dir="ltr">{item.variant_id}</td>
                      <td>{item.qty}</td>
                      <td>{Number(item.unit_price || 0).toFixed(2)} ج</td>
                      <td>{Number(item.unit_tax || 0).toFixed(2)} ج</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {selected.status === 'pending' && (
              <div className="card border border-amber-200">
                <h3 className="font-bold">قرار المدير</h3>
                <p className="text-sm text-gray-600 mt-1">
                  الاعتماد يعيد إصدار تفويض لهذه العملية فقط مع الحفاظ على الكاشير والجهاز والوردية والوقت والمبلغ الأصلي.
                  الرفض يعني أن المدير أكد عدم اعتماد البيع، وسيعكس جهاز POS المخزون المحلي دون إنشاء فاتورة مركزية.
                </p>
                <textarea
                  className="input mt-3 min-h-24"
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  placeholder="سبب القرار بالتفصيل…"
                />
                <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 space-y-2">
                  <p className="text-sm text-red-800">
                    الرفض مسموح فقط بعد التأكد أن الدفع لم يُحصّل أو تم رد المبلغ للعميل.
                  </p>
                  <input
                    className="input"
                    value={confirmReference}
                    onChange={(event) => setConfirmReference(event.target.value)}
                    placeholder={`اكتب للتأكيد: ${selected.local_invoice_number}`}
                    dir="ltr"
                  />
                  <label className="flex items-center gap-2 text-sm font-bold text-red-800">
                    <input
                      type="checkbox"
                      checked={financialConfirmed}
                      onChange={(event) => setFinancialConfirmed(event.target.checked)}
                    />
                    أؤكد أن الدفع لم يُحصّل أو تم رد المبلغ وتوثيق ذلك.
                  </label>
                </div>
                <div className="flex flex-wrap gap-2 mt-3">
                  <button className="btn-accent" disabled={saving} onClick={() => void decide('approve')}>
                    اعتماد وإنشاء الفاتورة
                  </button>
                  <button
                    className="btn border border-red-300 text-red-700"
                    disabled={saving || confirmReference.trim() !== selected.local_invoice_number || !financialConfirmed}
                    onClick={() => void decide('reject')}
                  >
                    رفض وعكس العملية محليًا
                  </button>
                </div>
              </div>
            )}

            {selected.linked_invoice && (
              <div className="card border border-green-200 bg-green-50">
                الفاتورة المركزية: <b>{selected.linked_invoice.invoice_number}</b>
              </div>
            )}
          </div>
        ) : (
          <div className="card text-center text-gray-500 py-12">
            اختر عملية لعرض تفاصيلها.
          </div>
        )}
      </div>
    </div>
  )
}
