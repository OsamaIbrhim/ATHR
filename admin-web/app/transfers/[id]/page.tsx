'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { apiGet, apiPost } from '@/lib/api'

type Receipt = { received_qty: string; damaged_qty: string; missing_qty: string }
const statusLabel: Record<string,string> = {
  pending:'بانتظار الشحن',shipped:'في الطريق',
  partially_received:'استلام جزئي',received:'مستلم',cancelled:'ملغي',
}

export default function TransferDetail() {
  const {id}=useParams<{id:string}>()
  const [transfer,setTransfer]=useState<any|null>(null)
  const [receipt,setReceipt]=useState<Record<string,Receipt>>({})
  const [cancelReason,setCancelReason]=useState('')
  const [saving,setSaving]=useState(false)
  const [error,setError]=useState('')

  const load=async()=>{
    setError('')
    try {
      const result=await apiGet(`/transfers/${id}`)
      setTransfer(result)
      setReceipt(Object.fromEntries((result.items||[]).map((item:any)=>[
        item.id,{received_qty:'',damaged_qty:'',missing_qty:''},
      ])))
    } catch(loadError:any){setError(loadError.message)}
  }
  useEffect(()=>{void load()},[id])

  const action=async(name:'ship'|'receive'|'cancel')=>{
    setSaving(true);setError('')
    try {
      const body:any={command_id:crypto.randomUUID()}
      if(name==='receive') body.items=transfer.items.map((item:any)=>{
        const values=receipt[item.id]||{received_qty:'',damaged_qty:'',missing_qty:''}
        return {
          transfer_item_id:item.id,
          received_qty:Number(values.received_qty)||0,
          damaged_qty:Number(values.damaged_qty)||0,
          missing_qty:Number(values.missing_qty)||0,
        }
      }).filter((item:any)=>item.received_qty+item.damaged_qty+item.missing_qty>0)
      if(name==='cancel') body.reason=cancelReason
      await apiPost(`/transfers/${id}/${name}`,body)
      setCancelReason('');await load()
    } catch(actionError:any){setError(actionError.message)}
    finally{setSaving(false)}
  }

  if(!transfer)return <div className="space-y-3"><a className="underline" href="/transfers">العودة للتحويلات</a>{error?<div className="card text-red-700">{error}</div>:<div className="card">جارٍ التحميل…</div>}</div>
  const receivable=['shipped','partially_received'].includes(transfer.status)
  const receiptTotal=Object.values(receipt).reduce((sum,row)=>sum+(Number(row.received_qty)||0)+(Number(row.damaged_qty)||0)+(Number(row.missing_qty)||0),0)

  return <div className="space-y-4">
    <div className="flex justify-between"><div><a className="underline text-sm" href="/transfers">العودة للتحويلات</a><h1 className="text-2xl font-bold mt-1">تحويل {transfer.transfer_number}</h1></div><span>{statusLabel[transfer.status]||transfer.status}</span></div>
    {error&&<div className="card border border-red-200 bg-red-50 text-red-800" role="alert">{error}</div>}
    <div className="card grid grid-cols-2 md:grid-cols-4 gap-3"><div>من<br/><b>{transfer.from_branch?.name_ar}</b></div><div>إلى<br/><b>{transfer.to_branch?.name_ar}</b></div><div>تاريخ الإنشاء<br/><b>{new Date(transfer.created_at).toLocaleString('ar-EG')}</b></div><div>آخر تحديث<br/><b>{new Date(transfer.updated_at).toLocaleString('ar-EG')}</b></div>{transfer.cancellation_reason&&<div className="col-span-full text-red-700">سبب الإلغاء: {transfer.cancellation_reason}</div>}</div>

    <div className="card overflow-auto"><table><thead><tr><th>SKU</th><th>الصنف</th><th>المطلوب</th><th>المشحون</th><th>المستلم</th><th>التالف</th><th>الفاقد</th><th>المتبقي بالطريق</th>{receivable&&<><th>استلام الآن</th><th>تالف الآن</th><th>فاقد الآن</th></>}</tr></thead><tbody>{transfer.items.map((item:any)=>{const outstanding=item.shipped_qty-item.received_qty-item.damaged_qty-item.missing_qty;const values=receipt[item.id]||{received_qty:'',damaged_qty:'',missing_qty:''};return <tr key={item.id}><td>{item.variant?.sku}</td><td>{item.variant?.product?.name_ar||item.variant?.product?.name_en}</td><td>{item.qty}</td><td>{item.shipped_qty}</td><td>{item.received_qty}</td><td>{item.damaged_qty}</td><td>{item.missing_qty}</td><td>{outstanding}</td>{receivable&&(['received_qty','damaged_qty','missing_qty'] as const).map(field=><td key={field}><input className="input w-20" type="number" min="0" max={outstanding} step="1" value={values[field]} onChange={event=>setReceipt(current=>({...current,[item.id]:{...values,[field]:event.target.value}}))}/></td>)}</tr>})}</tbody></table></div>

    {transfer.status==='pending'&&<div className="grid grid-cols-1 md:grid-cols-2 gap-4"><div className="card"><h2 className="font-bold mb-2">شحن التحويل</h2><p className="text-sm text-gray-600 mb-3">سيتم خصم الكميات من فرع المصدر ونقلها إلى رصيد «في الطريق».</p><button className="btn-accent" disabled={saving} onClick={()=>action('ship')}>تأكيد الشحن</button></div><div className="card border border-red-200"><h2 className="font-bold mb-2">إلغاء التحويل</h2><textarea className="input min-h-20" placeholder="سبب الإلغاء" value={cancelReason} onChange={event=>setCancelReason(event.target.value)}/><button className="btn mt-2" disabled={saving||!cancelReason.trim()} onClick={()=>action('cancel')}>إلغاء بسبب</button></div></div>}
    {receivable&&<div className="card"><h2 className="font-bold mb-2">تسجيل دفعة استلام</h2><p className="text-sm text-gray-600 mb-3">يمكن توزيع الكمية المتبقية بين مستلم وتالف وفاقد، وترك الباقي في الطريق لدفعة لاحقة.</p><button className="btn-accent" disabled={saving||receiptTotal<=0} onClick={()=>action('receive')}>ترحيل الدفعة</button></div>}
  </div>
}
