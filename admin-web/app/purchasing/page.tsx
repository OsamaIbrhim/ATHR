'use client'

import { useEffect, useMemo, useState } from 'react'
import { apiGet, apiPost, getStoredUser } from '@/lib/api'
import { businessDate } from '@/lib/business-time'
import { hasCapability } from '@/lib/permissions'

type PurchaseLine = { variant_id: string; qty: string; unit_cost: string }

const emptyLine = (): PurchaseLine => ({ variant_id: '', qty: '1', unit_cost: '' })

export default function Purchasing() {
  const user = getStoredUser()
  const canManage = hasCapability(user, 'purchasing.manage')
  const [invoices, setInvoices] = useState<any[]>([])
  const [suppliers, setSuppliers] = useState<any[]>([])
  const [branches, setBranches] = useState<any[]>([])
  const [products, setProducts] = useState<any[]>([])
  const [returns, setReturns] = useState<any[]>([])
  const [costMovements, setCostMovements] = useState<any[]>([])
  const [reconciliation, setReconciliation] = useState<any[]>([])
  const [supplier, setSupplier] = useState('')
  const [branch, setBranch] = useState(user?.branch_id || '')
  const [invoiceNumber, setInvoiceNumber] = useState('')
  const [invoiceDate, setInvoiceDate] = useState(businessDate())
  const [receivedAt, setReceivedAt] = useState('')
  const [discountType, setDiscountType] = useState<'none'|'amount'|'percent'>('none')
  const [discount, setDiscount] = useState('')
  const [lines, setLines] = useState<PurchaseLine[]>([emptyLine()])
  const [ocrUrl, setOcrUrl] = useState('')
  const [ocrMessage, setOcrMessage] = useState('')
  const [tab, setTab] = useState<'invoices'|'returns'|'cost'|'reconciliation'>('invoices')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const load = async () => {
    setLoading(true)
    setError('')
    try {
      const [invoiceRows, supplierRows, branchRows, productRows, returnRows] = await Promise.all([
        apiGet('/purchasing/invoices'),
        apiGet('/suppliers'),
        apiGet('/branches'),
        apiGet('/products?page=1&page_size=200'),
        apiGet('/purchasing/supplier-returns'),
      ])
      setInvoices(invoiceRows || [])
      setSuppliers(supplierRows || [])
      setBranches(branchRows || [])
      setProducts(productRows.items || [])
      setReturns(returnRows || [])
    } catch (loadError: any) {
      setError(loadError.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void load() }, [])

  const subtotal = useMemo(() => lines.reduce(
    (sum, line) => sum + (Number(line.qty) || 0) * (Number(line.unit_cost) || 0),
    0,
  ), [lines])

  const updateLine = (index: number, patch: Partial<PurchaseLine>) => {
    setLines(current => current.map((line, lineIndex) => (
      lineIndex === index ? { ...line, ...patch } : line
    )))
  }

  const receive = async () => {
    setSaving(true)
    setError('')
    try {
      await apiPost('/purchasing/receive', {
        command_id: crypto.randomUUID(),
        supplier_id: supplier,
        branch_id: branch,
        invoice_number: invoiceNumber.trim() || undefined,
        invoice_date: invoiceDate || undefined,
        received_at: receivedAt ? new Date(receivedAt).toISOString() : undefined,
        ...(discountType === 'amount' ? { discount_amount: Number(discount) } : {}),
        ...(discountType === 'percent' ? { discount_percent: Number(discount) } : {}),
        ocr_source_file: ocrUrl || undefined,
        items: lines.map(line => ({
          variant_id: line.variant_id,
          qty: Number(line.qty),
          unit_cost: Number(line.unit_cost),
        })),
      })
      setInvoiceNumber('')
      setLines([emptyLine()])
      setDiscount('')
      setDiscountType('none')
      setOcrUrl('')
      setOcrMessage('')
      await load()
    } catch (saveError: any) {
      setError(saveError.message)
    } finally {
      setSaving(false)
    }
  }

  const previewOcr = async () => {
    setSaving(true)
    setError('')
    try {
      const draft = await apiPost('/purchasing/ocr-import', { fileUrl: ocrUrl })
      setOcrMessage(draft.message || 'تم إنشاء مسودة للمراجعة.')
      if (Array.isArray(draft.items) && draft.items.length) setLines(draft.items)
    } catch (ocrError: any) {
      setError(ocrError.message)
    } finally {
      setSaving(false)
    }
  }

  const loadCost = async () => {
    setTab('cost')
    setError('')
    try {
      setCostMovements(await apiGet(`/purchasing/cost-movements${branch ? `?branch_id=${branch}` : ''}`))
    } catch (costError: any) { setError(costError.message) }
  }

  const loadReconciliation = async () => {
    setTab('reconciliation')
    setError('')
    try {
      setReconciliation(await apiGet('/purchasing/cost-reconciliation'))
    } catch (reconcileError: any) { setError(reconcileError.message) }
  }

  const validLines = lines.length > 0 && lines.every(line => (
    line.variant_id && Number.isInteger(Number(line.qty)) &&
    Number(line.qty) > 0 && line.unit_cost !== '' && Number(line.unit_cost) >= 0
  ))

  return <div className="space-y-4">
    <h1 className="text-2xl font-bold">المشتريات واستلام البضاعة</h1>

    {canManage && <div className="card space-y-4">
      <h2 className="font-bold">فاتورة مشتريات جديدة</h2>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
        <label>المورد<select className="select mt-1" value={supplier} onChange={event=>setSupplier(event.target.value)}><option value="">اختر المورد</option>{suppliers.map(row=><option key={row.id} value={row.id}>{row.name}</option>)}</select></label>
        <label>الفرع<select className="select mt-1" value={branch} onChange={event=>setBranch(event.target.value)}><option value="">اختر الفرع</option>{branches.map(row=><option key={row.id} value={row.id}>{row.name_ar}</option>)}</select></label>
        <label>رقم فاتورة المورد<input className="input mt-1" value={invoiceNumber} onChange={event=>setInvoiceNumber(event.target.value)}/></label>
        <label>تاريخ الفاتورة<input className="input mt-1" type="date" value={invoiceDate} onChange={event=>setInvoiceDate(event.target.value)}/></label>
        <label>وقت الاستلام<input className="input mt-1" type="datetime-local" value={receivedAt} onChange={event=>setReceivedAt(event.target.value)}/></label>
        <label>نوع الخصم<select className="select mt-1" value={discountType} onChange={event=>{setDiscountType(event.target.value as any);setDiscount('')}}><option value="none">بدون خصم</option><option value="amount">مبلغ ثابت</option><option value="percent">نسبة مئوية</option></select></label>
        {discountType !== 'none' && <label>قيمة الخصم<input className="input mt-1" type="number" min="0" max={discountType==='percent'?100:undefined} step="0.01" value={discount} onChange={event=>setDiscount(event.target.value)}/></label>}
      </div>

      <div className="space-y-2">
        {lines.map((line, index) => <div key={index} className="grid grid-cols-1 md:grid-cols-[1fr_120px_160px_auto] gap-2">
          <select className="select" value={line.variant_id} onChange={event=>updateLine(index,{variant_id:event.target.value})}><option value="">اختر المنتج</option>{products.map(row=><option key={row.id} value={row.id}>{row.sku} – {row.product?.name_ar||row.product?.name_en}</option>)}</select>
          <input className="input" type="number" min="1" step="1" value={line.qty} onChange={event=>updateLine(index,{qty:event.target.value})} aria-label={`كمية السطر ${index+1}`}/>
          <input className="input" type="number" min="0" step="0.01" placeholder="تكلفة الوحدة" value={line.unit_cost} onChange={event=>updateLine(index,{unit_cost:event.target.value})}/>
          <button className="btn-secondary" disabled={lines.length===1} onClick={()=>setLines(current=>current.filter((_,lineIndex)=>lineIndex!==index))}>حذف</button>
        </div>)}
        <button className="btn" onClick={()=>setLines(current=>[...current,emptyLine()])}>+ إضافة صنف</button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-2 border-t pt-3">
        <div><label>رابط/مرجع صورة الفاتورة للـOCR<input className="input mt-1" value={ocrUrl} onChange={event=>setOcrUrl(event.target.value)} placeholder="https://..."/></label>{ocrMessage&&<p className="text-sm text-amber-700 mt-1">{ocrMessage} راجع كل القيم قبل الحفظ.</p>}</div>
        <button className="btn self-end" disabled={!ocrUrl||saving} onClick={previewOcr}>إنشاء مسودة OCR</button>
      </div>

      <div className="flex justify-between items-center border-t pt-3">
        <span>الإجمالي قبل الخصم: <b>{subtotal.toFixed(2)} ج</b></span>
        <button className="btn-accent" disabled={saving||!supplier||!branch||!validLines||(discountType!=='none'&&discount==='')} onClick={receive}>{saving?'جارٍ الحفظ…':'ترحيل الفاتورة وتحديث المخزون'}</button>
      </div>
    </div>}

    {error&&<div className="card border border-red-200 bg-red-50 text-red-800" role="alert">{error}</div>}

    <div className="flex flex-wrap gap-2">
      <button className={tab==='invoices'?'btn-accent':'btn'} onClick={()=>setTab('invoices')}>الفواتير</button>
      <button className={tab==='returns'?'btn-accent':'btn'} onClick={()=>setTab('returns')}>مرتجعات الموردين</button>
      <button className={tab==='cost'?'btn-accent':'btn'} onClick={loadCost}>حركة التكلفة</button>
      <button className={tab==='reconciliation'?'btn-accent':'btn'} onClick={loadReconciliation}>مطابقة التكلفة</button>
    </div>

    {tab==='invoices'&&<div className="card overflow-auto"><table><thead><tr><th>الرقم</th><th>المورد</th><th>الفرع</th><th>الحالة</th><th>الأسطر</th><th>الخصم</th><th>الإجمالي</th><th>الاستلام</th><th></th></tr></thead><tbody>{invoices.map(row=><tr key={row.id}><td>{row.invoice_number||row.id.slice(0,8)}</td><td>{row.supplier?.name}</td><td>{row.branch?.name_ar}</td><td>{row.status==='posted'?'مرحّلة':'معكوسة'}</td><td>{row.items?.length||0}</td><td>{Number(row.discount_amount).toFixed(2)}</td><td>{Number(row.total).toFixed(2)} ج</td><td>{new Date(row.received_at).toLocaleString('ar-EG')}</td><td><a className="underline" href={`/purchasing/${row.id}`}>التفاصيل</a></td></tr>)}{!loading&&!invoices.length&&<tr><td colSpan={9} className="text-center py-8 text-gray-500">لا توجد فواتير مشتريات</td></tr>}</tbody></table></div>}

    {tab==='returns'&&<div className="card overflow-auto"><table><thead><tr><th>رقم المرتجع</th><th>فاتورة الشراء</th><th>المورد</th><th>السبب</th><th>الرصيد الدائن</th><th>فرق السعر</th><th>التاريخ</th></tr></thead><tbody>{returns.map(row=><tr key={row.id}><td>{row.return_number}</td><td><a className="underline" href={`/purchasing/${row.purchase_invoice_id}`}>{row.purchase_invoice?.invoice_number||row.purchase_invoice_id.slice(0,8)}</a></td><td>{row.supplier?.name}</td><td>{row.reason}</td><td>{Number(row.credit_total).toFixed(2)}</td><td>{Number(row.purchase_price_variance).toFixed(2)}</td><td>{new Date(row.occurred_at).toLocaleString('ar-EG')}</td></tr>)}{!returns.length&&<tr><td colSpan={7} className="text-center py-8 text-gray-500">لا توجد مرتجعات موردين</td></tr>}</tbody></table></div>}

    {tab==='cost'&&<div className="card overflow-auto"><table><thead><tr><th>التسلسل</th><th>المنتج</th><th>النوع</th><th>الكمية</th><th>التكلفة قبل</th><th>التكلفة بعد</th><th>قيمة الحركة</th><th>التاريخ</th></tr></thead><tbody>{costMovements.map(row=><tr key={row.id}><td>{String(row.sequence)}</td><td>{row.variant?.sku} – {row.variant?.product?.name_ar||row.variant?.product?.name_en}</td><td>{row.movement_type}</td><td>{row.quantity_delta}</td><td>{Number(row.cost_before).toFixed(2)}</td><td>{Number(row.cost_after).toFixed(2)}</td><td>{Number(row.movement_value).toFixed(2)}</td><td>{new Date(row.occurred_at).toLocaleString('ar-EG')}</td></tr>)}</tbody></table></div>}

    {tab==='reconciliation'&&<div className="card overflow-auto"><table><thead><tr><th>SKU</th><th>المنتج</th><th>الكمية العالمية</th><th>التكلفة الحالية</th><th>تكلفة السجل</th><th>الحالة</th></tr></thead><tbody>{reconciliation.map(row=><tr key={row.variant_id}><td>{row.sku}</td><td>{row.product_name}</td><td>{String(row.current_global_qty)}</td><td>{Number(row.materialized_cost).toFixed(2)}</td><td>{row.ledger_cost===null?'—':Number(row.ledger_cost).toFixed(2)}</td><td className={row.reconciled?'text-green-700':'text-red-700'}>{row.reconciled?'متطابق':'يحتاج مراجعة'}</td></tr>)}</tbody></table></div>}
  </div>
}
