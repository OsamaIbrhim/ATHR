'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { apiGet, apiPost, getStoredUser } from '@/lib/api'
import { hasCapability } from '@/lib/permissions'

export default function PurchaseDetail() {
  const { id } = useParams<{ id: string }>()
  const canManage = hasCapability(getStoredUser(), 'purchasing.manage')
  const [invoice, setInvoice] = useState<any|null>(null)
  const [returnQty, setReturnQty] = useState<Record<string,string>>({})
  const [returnReason, setReturnReason] = useState('')
  const [reverseReason, setReverseReason] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  const load = async () => {
    setError('')
    try { setInvoice(await apiGet(`/purchasing/invoices/${id}`)) }
    catch (loadError: any) { setError(loadError.message) }
  }
  useEffect(()=>{void load()},[id])

  const supplierReturn = async () => {
    const items = Object.entries(returnQty)
      .filter(([,qty])=>Number(qty)>0)
      .map(([purchase_invoice_item_id,qty])=>({purchase_invoice_item_id,qty:Number(qty)}))
    setSaving(true);setError('')
    try {
      await apiPost(`/purchasing/invoices/${id}/supplier-returns`, {
        command_id: crypto.randomUUID(),
        reason: returnReason,
        items,
      })
      setReturnQty({});setReturnReason('');await load()
    } catch (actionError:any) { setError(actionError.message) }
    finally { setSaving(false) }
  }

  const reverse = async () => {
    if (!confirm('هل تريد عكس الفاتورة بالكامل؟ لا ينجح العكس إذا وُجدت حركات مخزون لاحقة.')) return
    setSaving(true);setError('')
    try {
      await apiPost(`/purchasing/invoices/${id}/reverse`, {
        command_id: crypto.randomUUID(),
        reason: reverseReason,
      })
      setReverseReason('');await load()
    } catch (actionError:any) { setError(actionError.message) }
    finally { setSaving(false) }
  }

  if (!invoice) return <div className="space-y-4"><a href="/purchasing" className="underline">العودة للمشتريات</a>{error?<div className="card text-red-700">{error}</div>:<div className="card">جارٍ التحميل…</div>}</div>

  const returnedByItem = new Map<string,number>()
  for (const record of invoice.supplier_returns||[]) {
    for (const item of record.items||[]) {
      returnedByItem.set(item.purchase_invoice_item_id,(returnedByItem.get(item.purchase_invoice_item_id)||0)+item.qty)
    }
  }
  const selectedReturnCount = Object.values(returnQty).filter(qty=>Number(qty)>0).length

  return <div className="space-y-4">
    <div className="flex justify-between items-center"><div><a href="/purchasing" className="underline text-sm">العودة للمشتريات</a><h1 className="text-2xl font-bold mt-1">فاتورة شراء {invoice.invoice_number||invoice.id.slice(0,8)}</h1></div><span className={invoice.status==='posted'?'text-green-700':'text-red-700'}>{invoice.status==='posted'?'مرحّلة':'معكوسة'}</span></div>
    {error&&<div className="card border border-red-200 bg-red-50 text-red-800" role="alert">{error}</div>}
    <div className="card grid grid-cols-2 md:grid-cols-4 gap-3"><div>المورد<br/><b>{invoice.supplier?.name}</b></div><div>الفرع<br/><b>{invoice.branch?.name_ar}</b></div><div>تاريخ الفاتورة<br/><b>{invoice.invoice_date?new Date(invoice.invoice_date).toLocaleDateString('ar-EG'):'—'}</b></div><div>وقت الاستلام<br/><b>{new Date(invoice.received_at).toLocaleString('ar-EG')}</b></div><div>الإجمالي الفرعي<br/><b>{Number(invoice.subtotal).toFixed(2)}</b></div><div>الخصم<br/><b>{Number(invoice.discount_amount).toFixed(2)}</b></div><div>الإجمالي<br/><b>{Number(invoice.total).toFixed(2)}</b></div><div>سجلها<br/><b>{invoice.creator?.name||'—'}</b></div></div>

    <div className="card overflow-auto"><h2 className="font-bold mb-2">أصناف الفاتورة</h2><table><thead><tr><th>SKU</th><th>الصنف</th><th>الكمية</th><th>تكلفة الوحدة</th><th>خصم موزع</th><th>الصافي</th>{canManage&&invoice.status==='posted'&&<th>إرجاع للمورد</th>}</tr></thead><tbody>{invoice.items.map((item:any)=>{const already=returnedByItem.get(item.id)||0;const available=item.qty-already;return <tr key={item.id}><td>{item.variant?.sku}</td><td>{item.variant?.product?.name_ar||item.variant?.product?.name_en}</td><td>{item.qty}</td><td>{Number(item.unit_cost).toFixed(2)}</td><td>{Number(item.allocated_discount||0).toFixed(2)}</td><td>{Number(item.net_line_total||0).toFixed(2)}</td>{canManage&&invoice.status==='posted'&&<td><input className="input w-24" type="number" min="0" max={available} step="1" value={returnQty[item.id]||''} placeholder={`متاح ${available}`} onChange={event=>setReturnQty(current=>({...current,[item.id]:event.target.value}))}/></td>}</tr>})}</tbody></table></div>

    {canManage&&invoice.status==='posted'&&<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <div className="card"><h2 className="font-bold mb-2">مرتجع مورد</h2><textarea className="input min-h-24" placeholder="سبب المرتجع" value={returnReason} onChange={event=>setReturnReason(event.target.value)}/><button className="btn-accent mt-2" disabled={saving||!returnReason.trim()||selectedReturnCount===0} onClick={supplierReturn}>ترحيل المرتجع المحدد</button></div>
      <div className="card border border-red-200"><h2 className="font-bold mb-2 text-red-800">عكس الفاتورة بالكامل</h2><textarea className="input min-h-24" placeholder="سبب العكس الإلزامي" value={reverseReason} onChange={event=>setReverseReason(event.target.value)}/><button className="btn mt-2" disabled={saving||!reverseReason.trim()} onClick={reverse}>عكس الفاتورة</button></div>
    </div>}

    <div className="card overflow-auto"><h2 className="font-bold mb-2">مرتجعات هذه الفاتورة</h2><table><thead><tr><th>الرقم</th><th>السبب</th><th>الرصيد الدائن</th><th>قيمة المخزون</th><th>فرق السعر</th><th>التاريخ</th></tr></thead><tbody>{(invoice.supplier_returns||[]).map((row:any)=><tr key={row.id}><td>{row.return_number}</td><td>{row.reason}</td><td>{Number(row.credit_total).toFixed(2)}</td><td>{Number(row.inventory_value_removed).toFixed(2)}</td><td>{Number(row.purchase_price_variance).toFixed(2)}</td><td>{new Date(row.occurred_at).toLocaleString('ar-EG')}</td></tr>)}{!invoice.supplier_returns?.length&&<tr><td colSpan={6} className="text-center py-6 text-gray-500">لا توجد مرتجعات</td></tr>}</tbody></table></div>

    <div className="card overflow-auto"><h2 className="font-bold mb-2">حركات التكلفة المرتبطة</h2><table><thead><tr><th>التسلسل</th><th>النوع</th><th>الكمية</th><th>التكلفة قبل</th><th>التكلفة بعد</th><th>قيمة الحركة</th><th>التاريخ</th></tr></thead><tbody>{(invoice.cost_movements||[]).map((row:any)=><tr key={row.id}><td>{String(row.sequence)}</td><td>{row.movement_type}</td><td>{row.quantity_delta}</td><td>{Number(row.cost_before).toFixed(2)}</td><td>{Number(row.cost_after).toFixed(2)}</td><td>{Number(row.movement_value).toFixed(2)}</td><td>{new Date(row.occurred_at).toLocaleString('ar-EG')}</td></tr>)}</tbody></table></div>
  </div>
}
