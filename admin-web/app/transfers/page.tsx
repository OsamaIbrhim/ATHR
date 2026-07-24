'use client'

import { useEffect, useState } from 'react'
import { apiGet, apiPost, getStoredUser } from '@/lib/api'

type DraftLine = { variant_id: string; qty: string }
const newLine = (): DraftLine => ({ variant_id: '', qty: '1' })
const statusLabel: Record<string,string> = {
  pending: 'بانتظار الشحن',
  shipped: 'في الطريق',
  partially_received: 'استلام جزئي',
  received: 'مستلم',
  cancelled: 'ملغي',
}

export default function Transfers() {
  const user = getStoredUser()
  const [rows,setRows] = useState<any[]>([])
  const [branches,setBranches] = useState<any[]>([])
  const [products,setProducts] = useState<any[]>([])
  const [from,setFrom] = useState(user?.branch_id||'')
  const [to,setTo] = useState('')
  const [lines,setLines] = useState<DraftLine[]>([newLine()])
  const [reconciliation,setReconciliation] = useState<any|null>(null)
  const [tab,setTab] = useState<'transfers'|'reconciliation'>('transfers')
  const [saving,setSaving] = useState(false)
  const [error,setError] = useState('')

  const load = async () => {
    setError('')
    try {
      const [transferRows,branchRows,productRows] = await Promise.all([
        apiGet('/transfers'),
        apiGet('/branches'),
        apiGet('/products?page=1&page_size=200'),
      ])
      setRows(transferRows||[])
      setBranches(branchRows||[])
      setProducts(productRows.items||[])
    } catch(loadError:any) { setError(loadError.message) }
  }
  useEffect(()=>{void load()},[])

  const create = async () => {
    setSaving(true);setError('')
    try {
      await apiPost('/transfers',{
        command_id: crypto.randomUUID(),
        from_branch_id:from,
        to_branch_id:to,
        items:lines.map(line=>({variant_id:line.variant_id,qty:Number(line.qty)})),
      })
      setLines([newLine()]);setTo('');await load()
    } catch(createError:any) { setError(createError.message) }
    finally { setSaving(false) }
  }

  const reconcile = async () => {
    setTab('reconciliation');setError('')
    try { setReconciliation(await apiGet('/transfers/reconciliation/in-transit')) }
    catch(reconcileError:any) { setError(reconcileError.message) }
  }

  const valid = from && to && from!==to && lines.length>0 && lines.every(
    line=>line.variant_id&&Number.isInteger(Number(line.qty))&&Number(line.qty)>0,
  )

  return <div className="space-y-4">
    <h1 className="text-2xl font-bold">التحويلات بين الفروع</h1>
    <div className="card space-y-3">
      <h2 className="font-bold">تحويل جديد متعدد الأصناف</h2>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        <label>من فرع<select className="select mt-1" value={from} onChange={event=>{setFrom(event.target.value);if(event.target.value===to)setTo('')}}><option value="">اختر فرع المصدر</option>{branches.map(row=><option key={row.id} value={row.id}>{row.name_ar}</option>)}</select></label>
        <label>إلى فرع<select className="select mt-1" value={to} onChange={event=>setTo(event.target.value)}><option value="">اختر فرع الوجهة</option>{branches.filter(row=>row.id!==from).map(row=><option key={row.id} value={row.id}>{row.name_ar}</option>)}</select></label>
      </div>
      <div className="space-y-2">{lines.map((line,index)=><div key={index} className="grid grid-cols-[1fr_120px_auto] gap-2"><select className="select" value={line.variant_id} onChange={event=>setLines(current=>current.map((row,rowIndex)=>rowIndex===index?{...row,variant_id:event.target.value}:row))}><option value="">اختر المنتج</option>{products.map(row=><option key={row.id} value={row.id}>{row.sku} – {row.product?.name_ar||row.product?.name_en}</option>)}</select><input className="input" type="number" min="1" step="1" value={line.qty} onChange={event=>setLines(current=>current.map((row,rowIndex)=>rowIndex===index?{...row,qty:event.target.value}:row))}/><button className="btn-secondary" disabled={lines.length===1} onClick={()=>setLines(current=>current.filter((_,rowIndex)=>rowIndex!==index))}>حذف</button></div>)}</div>
      <div className="flex justify-between"><button className="btn" onClick={()=>setLines(current=>[...current,newLine()])}>+ إضافة صنف</button><button className="btn-accent" disabled={saving||!valid} onClick={create}>{saving?'جارٍ الإنشاء…':'إنشاء التحويل'}</button></div>
    </div>

    {error&&<div className="card border border-red-200 bg-red-50 text-red-800" role="alert">{error}</div>}
    <div className="flex gap-2"><button className={tab==='transfers'?'btn-accent':'btn'} onClick={()=>setTab('transfers')}>التحويلات</button>{['owner','warehouse_manager'].includes(user?.role||'')&&<button className={tab==='reconciliation'?'btn-accent':'btn'} onClick={reconcile}>مطابقة البضاعة في الطريق</button>}</div>

    {tab==='transfers'&&<div className="card overflow-auto"><table><thead><tr><th>الرقم</th><th>من</th><th>إلى</th><th>الأسطر</th><th>المطلوب</th><th>المستلم</th><th>تالف/فاقد</th><th>في الطريق</th><th>الحالة</th><th></th></tr></thead><tbody>{rows.map(row=>{const requested=(row.items||[]).reduce((sum:number,item:any)=>sum+item.qty,0);const received=(row.items||[]).reduce((sum:number,item:any)=>sum+item.received_qty,0);const exceptions=(row.items||[]).reduce((sum:number,item:any)=>sum+item.damaged_qty+item.missing_qty,0);const transit=(row.items||[]).reduce((sum:number,item:any)=>sum+item.shipped_qty-item.received_qty-item.damaged_qty-item.missing_qty,0);return <tr key={row.id}><td>{row.transfer_number}</td><td>{row.from_branch?.name_ar}</td><td>{row.to_branch?.name_ar}</td><td>{row.items?.length||0}</td><td>{requested}</td><td>{received}</td><td>{exceptions}</td><td>{transit}</td><td>{statusLabel[row.status]||row.status}</td><td><a className="underline" href={`/transfers/${row.id}`}>التفاصيل والإجراء</a></td></tr>})}{!rows.length&&<tr><td colSpan={10} className="text-center py-8 text-gray-500">لا توجد تحويلات</td></tr>}</tbody></table></div>}

    {tab==='reconciliation'&&reconciliation&&<div className="card space-y-3"><div className={reconciliation.ok?'text-green-700':'text-red-700'}>{reconciliation.ok?'كل أرصدة البضاعة في الطريق متطابقة.':`يوجد ${reconciliation.mismatch_count} اختلاف يحتاج مراجعة.`}</div>{!reconciliation.ok&&<div className="overflow-auto"><table><thead><tr><th>التحويل</th><th>سطر التحويل</th><th>المتوقع</th><th>السجل</th></tr></thead><tbody>{reconciliation.mismatches.map((row:any)=><tr key={row.transfer_item_id}><td><a className="underline" href={`/transfers/${row.transfer_id}`}>{row.transfer_id.slice(0,8)}</a></td><td>{row.transfer_item_id.slice(0,8)}</td><td>{row.expected_in_transit}</td><td>{row.ledger_in_transit}</td></tr>)}</tbody></table></div>}</div>}
  </div>
}
