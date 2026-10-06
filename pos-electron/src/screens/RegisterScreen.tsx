import { BRAND_INITIAL, POS_APP_NAME } from '../../electron/brand'
import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api, ApiError } from '../api'
import { athr } from '../electron'
import { CartItem, Customer, DeviceCredential, HeldSale, OfflineAccountingContext, Product, Seller, Session, Shift, SyncState } from '../types'
import { DEFAULT_POS_SETTINGS, type PosSettings } from '../../electron/sale-settings'
import { discountLimitFor, exceedsDiscountLimit, priceCart, type Discount } from '../../electron/sale-math'
import type { DiscountTarget } from '../discount'
import type { ExchangeStart } from '../exchange'
import { CheckoutModal, type CompletedSale } from './checkout/CheckoutModal'
import { CartLine } from './register/CartLine'
import { DiscountModal } from './register/DiscountModal'
import { offlineAccountingSummaryMatches } from '../../electron/offline-accounting'
import { ConfirmDialog, FieldError, Modal } from '../components/ui'
import { addProductToCart, setLineQty } from '../cart'
import { formatQuantity } from '../../electron/quantity'
import { cartTotals, isValidEgyptianPhone, money, normalizeEgyptianPhone } from '../utils'

function displayName(product: Product) { return product.name_ar || product.name_en || product.sku }

export function RegisterScreen({
  session, device, shift, accountingContext, syncState, exchange, onExchangeEnd, onSync, onSales, onCloseShift, onLogout, notify,
}:{
  exchange:ExchangeStart|null, onExchangeEnd:()=>void,
  session:Session, device:DeviceCredential, shift:Shift,
  accountingContext:OfflineAccountingContext|null, syncState:SyncState,
  onSync:()=>void, onSales:()=>void, onCloseShift:()=>void, onLogout:()=>void,
  notify:(message:string,tone?:'success'|'error'|'info')=>void,
}) {
  const [cart,setCartState]=useState<CartItem[]>([])
  // Always-latest cart so rapid scans merge against current state, not a stale closure.
  const cartRef=useRef<CartItem[]>([])
  const setCart=useCallback((update:CartItem[]|((prev:CartItem[])=>CartItem[]))=>{
    const next=typeof update==='function'?update(cartRef.current):update
    cartRef.current=next
    setCartState(next)
  },[])
  const [query,setQuery]=useState('')
  const [results,setResults]=useState<Product[]>([])
  const [searching,setSearching]=useState(false)
  const [customer,setCustomer]=useState<Customer|null>(null)
  const [customerOpen,setCustomerOpen]=useState(false)
  const [sellers,setSellers]=useState<Seller[]>([])
  const [sellerId,setSellerId]=useState('')
  const [checkoutOpen,setCheckoutOpen]=useState(false)
  const [heldOpen,setHeldOpen]=useState(false)
  const [heldSales,setHeldSales]=useState<HeldSale[]>([])
  const [heldLoading,setHeldLoading]=useState(false)
  const [confirmClear,setConfirmClear]=useState(false)
  const [completed,setCompleted]=useState<CompletedSale|null>(null)
  const [invoiceDiscount,setInvoiceDiscount]=useState<Discount|null>(null)
  const [discountTarget,setDiscountTarget]=useState<DiscountTarget|null>(null)
  const [settings,setSettings]=useState<PosSettings>(DEFAULT_POS_SETTINGS)
  const searchRef=useRef<HTMLInputElement | null>(null)
  const totals=useMemo(()=>cartTotals(cart,invoiceDiscount),[cart,invoiceDiscount])
  const isManager=session.user.role==='branch_manager'
  const discountLimit=discountLimitFor(session.user.role,settings.sales.max_discount_percent)
  const accountingReady=offlineAccountingSummaryMatches(
    accountingContext,
    {session,device,shift},
  )

  const loadHeldSales=useCallback(async()=>{
    if(!accountingReady){setHeldSales([]);return}
    setHeldLoading(true)
    try{setHeldSales(await athr.held_sales())}
    catch(error){notify((error as Error).message,'error')}
    finally{setHeldLoading(false)}
  },[accountingReady,notify])

  useEffect(()=>{
    void loadHeldSales()
  },[loadHeldSales])

  // An exchange arrives with its customer: the new goods are sold to the same person.
  useEffect(()=>{
    if(exchange)setCustomer(exchange.customer)
  },[exchange])

  useEffect(()=>{
    athr.settings().then(setSettings).catch(()=>setSettings(DEFAULT_POS_SETTINGS))
  },[syncState.last_sync_at])

  useEffect(()=>{
    athr.sellers().then((rows)=>{
      setSellers(rows)
      setSellerId((current)=>rows.some((seller)=>seller.id===current)?current:'')
    }).catch(()=>setSellers([]))
  },[syncState.last_sync_at])

  const runSearch=async(value=query)=>{
    const term=value.trim(); if(!term)return
    // Clear immediately so characters typed while the IPC search is pending survive.
    setQuery('')
    setSearching(true)
    try{
      const found=await athr.scan(term)
      const products=found.products as Product[]
      // A barcode, SKU or scale label names one product and how much of it to add.
      if(found.kind!=='search'&&products.length===1){await addProduct(products[0],found.qty);setResults([])}
      else setResults(products)
      if(!products.length) notify('لا توجد نتائج مطابقة في بيانات الجهاز','info')
    }catch{notify('تعذر البحث في كتالوج الجهاز','error')}
    finally{setSearching(false);setTimeout(()=>searchRef.current?.focus(),0)}
  }

  const addProduct=async(product:Product,addQty=1)=>{
    // Barcode search already returns the synchronized local stock quantity.
    // Only use a second IPC read as a compatibility fallback for older rows.
    const cachedAvailable=Number(product.qty)
    const available=Number.isFinite(cachedAvailable)
      ? cachedAvailable
      : Number(await athr.stock(product.id))

    // The synchronized SQLite catalog is the register pricing snapshot.
    // Adding/scanning an item must never wait for the network. Existing cart
    // lines keep their original snapshot for the lifetime of the sale.
    const price=Number(product.selling_price||0)
    const tax=Number(product.unit_tax||0)

    if(!Number.isFinite(price) || price<=0){
      notify('لا يوجد سعر بيع محلي معتمد لهذا الصنف. نفّذ مزامنة الكتالوج أولًا.','error')
      return
    }
    if(!Number.isFinite(tax) || tax<0){
      notify('بيانات ضريبة الصنف المحلية غير صالحة. نفّذ مزامنة الكتالوج أولًا.','error')
      return
    }

    const result=addProductToCart(cartRef.current,product,available,price,tax,displayName(product),addQty)
    if(result.status==='no_more'){notify('لا توجد كمية إضافية متاحة من هذا الصنف','error');return}
    if(result.status==='unavailable'){notify('هذا الصنف غير متوفر في مخزون الفرع','error');return}
    if(result.status==='invalid_qty'){notify('الكمية تحتوي على كسور أكثر مما تسمح به وحدة القياس','error');return}
    setCart(result.cart)
    notify(`تمت إضافة ${displayName(product)}`,'success')
  }

  const changeQty=useCallback((variantId:string,next:number)=>{
    const result=setLineQty(cartRef.current,variantId,next)
    if(result.limited){notify(`المتاح من ${result.limited.name}: ${formatQuantity(result.limited.available_qty)}`,'error');return}
    if(result.invalid){notify(`الكمية تحتوي على كسور أكثر مما تسمح به وحدة ${result.invalid.name}`,'error');return}
    setCart(result.cart)
  },[notify,setCart])

  const holdSale=async()=>{
    if(!cart.length){notify('السلة فارغة','info');return}
    if(!accountingReady){notify('لا يمكن تعليق الفاتورة قبل تجهيز هوية الكاشير والوردية على هذا الجهاز.','error');return}
    try{
      await athr.hold_sale({
        items:cart.map((item)=>({variant_id:item.variant_id,qty:item.qty})),
        customer,
      })
      setCart([]);setCustomer(null);setInvoiceDiscount(null)
      await loadHeldSales()
      notify('تم تعليق الفاتورة داخل وردية هذا الكاشير','success')
    }catch(error){notify((error as Error).message,'error')}
  }

  const resumeHeldSale=async(sale:HeldSale)=>{
    if(cart.length){notify('أكمل أو علّق الفاتورة الحالية قبل استعادة مسودة أخرى.','error');return}
    try{
      const resumed=await athr.resume_held_sale(sale.id)
      setCart(resumed.items)
      setCustomer(resumed.customer)
      setHeldOpen(false)
      await loadHeldSales()
      notify('تمت استعادة الفاتورة بأسعار ومخزون الكتالوج الحالي.','success')
    }catch(error){
      notify((error as Error).message,'error')
      await loadHeldSales()
    }
  }

  const deleteHeldSale=async(sale:HeldSale)=>{
    try{
      await athr.delete_held_sale(sale.id)
      await loadHeldSales()
      notify('تم حذف الفاتورة المعلقة.','success')
    }catch(error){notify((error as Error).message,'error')}
  }

  const openCheckout=()=>{
    if(!cart.length)return
    if(!sellerId){
      notify('اختر البائع المسؤول عن الفاتورة قبل الدفع.','error')
      return
    }
    if(!accountingReady){
      notify('تفويض الكاشير والوردية للبيع دون اتصال غير متاح أو منتهي. شغّل الإنترنت حتى يكتمل التجهيز المحاسبي.','error')
      return
    }
    if(exceedsDiscountLimit(priceCart(cart,invoiceDiscount),discountLimit)){
      notify('الخصم أعلى من الحد المسموح للكاشير. عدّل الخصم أو اطلب مديرًا.','error')
      return
    }
    setCheckoutOpen(true)
  }

  const applyDiscount=(discount:Discount|null)=>{
    const target=discountTarget
    if(!target)return
    if(target.kind==='invoice')setInvoiceDiscount(discount)
    else setCart((current)=>current.map((item)=>item.variant_id===target.variantId?{...item,discount}:item))
    setDiscountTarget(null)
  }

  // Stable listener reading the latest handlers through a ref.
  const shortcutsRef=useRef({openCheckout,holdSale,onSync})
  shortcutsRef.current={openCheckout,holdSale,onSync}
  useEffect(()=>{
    const handler=(event:KeyboardEvent)=>{
      const latest=shortcutsRef.current
      if(event.key==='F2'){event.preventDefault();searchRef.current?.focus()}
      if(event.key==='F3'){event.preventDefault();setCustomerOpen(true)}
      if(event.key==='F4'){event.preventDefault();void latest.holdSale()}
      if(event.key==='F8'){event.preventDefault();latest.onSync()}
      if(event.key==='F10'){event.preventDefault();latest.openCheckout()}
    }
    window.addEventListener('keydown',handler);return()=>window.removeEventListener('keydown',handler)
  },[])

  return <div className="app-shell">
    <header className="app-header">
      <div className="header-brand"><div className="brand-mark small">{BRAND_INITIAL}</div><div><b>{POS_APP_NAME}</b><span>{device.terminal_code}</span></div></div>
      <nav className="main-nav"><button className="active">نقطة البيع</button><button onClick={onSales}>الفواتير والمرتجعات</button></nav>
      <div className="header-status"><button className={`sync-pill ${syncState.sync_status}`} onClick={onSync}><span/><b>{syncState.sync_status==='success'?'متصل':syncState.sync_status==='syncing'?'مزامنة…':syncState.sync_status==='offline'?'غير متصل':'تنبيه'}</b><small>{syncState.pending_count} معلّق</small></button><div className="cashier-chip"><b>{session.user.name}</b><span>وردية منذ {new Date(shift.opened_at).toLocaleTimeString('ar-EG',{hour:'2-digit',minute:'2-digit'})}</span></div><button className="button secondary compact" onClick={onLogout}>تسجيل الخروج</button><button className="button secondary compact" onClick={onCloseShift}>إغلاق الوردية</button></div>
    </header>

    <main className="register-layout">
      <section className="catalog-panel">
        <div className="search-bar"><input ref={searchRef} value={query} onChange={(event)=>setQuery(event.target.value)} onKeyDown={(event)=>{if(event.key==='Enter')runSearch()}} placeholder="امسح الباركود أو ابحث بالـ SKU…" autoFocus/><button className="button primary" onClick={()=>runSearch()} disabled={searching}>{searching?'بحث…':'بحث'}</button></div>
        <div className="quick-actions"><label className="seller-picker">البائع <select value={sellerId} onChange={(event)=>setSellerId(event.target.value)}><option value="">اختر البائع *</option>{sellers.map((seller)=><option key={seller.id} value={seller.id}>{seller.name}</option>)}</select></label><button onClick={()=>setCustomerOpen(true)}>F3 · العميل <b>{customer?.name||customer?.phone||'بدون عميل'}</b></button><button onClick={()=>void holdSale()}>F4 · تعليق الفاتورة</button><button onClick={()=>{setHeldOpen(true);void loadHeldSales()}}>الفواتير المعلقة <b>{heldSales.length}</b></button></div>
        <div className="product-results">
          {results.map((product)=><button className="product-card" key={product.id} onClick={()=>addProduct(product)}><div><b>{displayName(product)}</b><span>{product.sku}</span></div><div className="variant-meta"><span>{product.label||'—'}</span>{product.uom_name_ar&&<span>{product.uom_name_ar}</span>}</div><strong>{money(product.selling_price)} ج</strong></button>)}
          {!results.length&&<div className="catalog-empty"><div>⌁</div><h2>جاهز للمسح</h2><p>امسح باركود الصنف أو اكتب SKU ثم اضغط Enter.</p><span>F2 للعودة السريعة إلى البحث</span></div>}
        </div>
      </section>

      <aside className="cart-panel">
        {exchange&&<div className="exchange-banner"><div><b>استبدال فاتورة {exchange.invoice_number}</b><span>أضف الأصناف الجديدة ثم ادفع قيمتها. يُرد للعميل {money(exchange.refund_total)} ج عن المرتجع.</span></div><button className="text-button danger-text" onClick={onExchangeEnd}>إلغاء الاستبدال</button></div>}
        <div className="cart-heading"><div><span className="eyebrow">الفاتورة الحالية</span><h2>{totals.lines} صنف</h2></div>{cart.length>0&&<button className="text-button danger-text" onClick={()=>setConfirmClear(true)}>تفريغ</button>}</div>
        <div className="cart-items">
          {cart.map((item)=><CartLine key={item.variant_id} item={item} onQty={changeQty} onDiscount={(variantId)=>setDiscountTarget({kind:'line',variantId})}/>)}
          {!cart.length&&<div className="cart-empty"><div>🛍</div><b>السلة فارغة</b><span>أضف أول صنف لبدء الفاتورة.</span></div>}
        </div>
        <div className="cart-summary"><div><span>المجموع الفرعي</span><b>{money(totals.subtotal)} ج</b></div>{totals.discount>0&&<div className="discount-row"><span>الخصم</span><b>-{money(totals.discount)} ج</b></div>}{cart.length>0&&<button className={`invoice-discount${invoiceDiscount?' applied':''}`} onClick={()=>setDiscountTarget({kind:'invoice'})}>{invoiceDiscount?(invoiceDiscount.type==='percent'?`خصم الفاتورة ${invoiceDiscount.value}%`:`خصم الفاتورة ${money(invoiceDiscount.value)} ج`):'+ خصم على الفاتورة'}</button>}<div><span>الضريبة</span><b>{money(totals.tax)} ج</b></div><div className="grand-total"><span>الإجمالي</span><b>{money(totals.total)} ج</b></div>{!accountingReady&&<FieldError>الدفع متوقف حتى يتم تجهيز هوية الكاشير والجهاز والوردية.</FieldError>}<button className="checkout-button" disabled={!cart.length||!accountingReady} onClick={openCheckout}><span>F10 · الدفع</span><b>{money(totals.total)} ج</b></button></div>
      </aside>
    </main>

    <CustomerModal open={customerOpen} value={customer} onSelect={(value)=>{setCustomer(value);setCustomerOpen(false)}} onClose={()=>setCustomerOpen(false)} notify={notify}/>
    <CheckoutModal open={checkoutOpen} items={cart} invoiceDiscount={invoiceDiscount} customer={customer} sellerId={sellerId} session={session} device={device} shift={shift} accountingContext={accountingContext} settings={settings} totals={totals} exchange={exchange} onSaleSaved={onSync} onClose={()=>setCheckoutOpen(false)} onCompleted={(value)=>{setCheckoutOpen(false);setCart([]);setCustomer(null);setInvoiceDiscount(null);setCompleted(value);if(exchange)onExchangeEnd()}} notify={notify}/>
    <DiscountModal target={discountTarget} title={discountTarget?.kind==='invoice'?'خصم على الفاتورة':'خصم على الصنف'} items={cart} invoiceDiscount={invoiceDiscount} limitPercent={discountLimit} isManager={isManager} onApply={applyDiscount} onClose={()=>setDiscountTarget(null)}/>
    <HeldSalesModal open={heldOpen} sales={heldSales} loading={heldLoading} onClose={()=>setHeldOpen(false)} onResume={(sale)=>void resumeHeldSale(sale)} onDelete={(sale)=>void deleteHeldSale(sale)}/>
    <SaleSuccessModal value={completed} onClose={()=>{setCompleted(null);searchRef.current?.focus()}}/>
    <ConfirmDialog open={confirmClear} title="تفريغ السلة؟" message="سيتم حذف جميع الأصناف من الفاتورة الحالية." confirmLabel="تفريغ السلة" danger onClose={()=>setConfirmClear(false)} onConfirm={()=>{setCart([]);setInvoiceDiscount(null);setConfirmClear(false)}}/>
  </div>
}

function CustomerModal({open,value,onSelect,onClose,notify}:{open:boolean,value:Customer|null,onSelect:(value:Customer|null)=>void,onClose:()=>void,notify:(message:string,tone?:'success'|'error'|'info')=>void}){
  const [phone,setPhone]=useState(value?.phone||'')
  const [name,setName]=useState(value?.name||'')
  const [found,setFound]=useState<Customer|null>(value)
  const [loading,setLoading]=useState(false)
  const [error,setError]=useState('')
  useEffect(()=>{if(open){setPhone(value?.phone||'');setName(value?.name||'');setFound(value);setError('')}},[open,value])
  const lookup=async()=>{const normalized=normalizeEgyptianPhone(phone);if(!isValidEgyptianPhone(normalized)){setError('أدخل رقمًا مصريًا صحيحًا مثل 01012345678.');return}setLoading(true);setError('');try{const result=await api.customerLookup(normalized);const customer=Array.isArray(result)?result[0]:result;setFound(customer||null);if(customer)setName(customer.name||'')}catch{setFound(null)}finally{setLoading(false)}}
  const create=async()=>{const normalized=normalizeEgyptianPhone(phone);if(!isValidEgyptianPhone(normalized)){setError('رقم الهاتف غير صحيح.');return}setLoading(true);try{const customer=await api.createCustomer({phone:normalized,name:name.trim()||undefined,whatsapp:normalized});notify('تم إنشاء العميل','success');onSelect(customer)}catch(err){setError((err as Error).message)}finally{setLoading(false)}}
  return <Modal open={open} title="العميل" onClose={onClose} width="560px"><div className="customer-form"><label>رقم الهاتف</label><div className="inline-field"><input dir="ltr" value={phone} onChange={(event)=>setPhone(event.target.value)} placeholder="01012345678" autoFocus/><button className="button secondary" onClick={lookup} disabled={loading}>بحث</button></div><FieldError>{error}</FieldError>{found?<div className="customer-card"><div><b>{found.name||'عميل بدون اسم'}</b><span dir="ltr">{found.phone}</span></div><div><span>{found.total_invoices||0} فاتورة</span><span>{money(found.total_spent)} ج مشتريات</span>{found.is_vip&&<strong>VIP</strong>}</div><button className="button primary" onClick={()=>onSelect(found)}>اختيار العميل</button></div>:<div className="new-customer"><label>اسم العميل الجديد (اختياري)</label><input value={name} onChange={(event)=>setName(event.target.value)} placeholder="اسم العميل"/><button className="button primary" onClick={create} disabled={loading}>إنشاء واختيار العميل</button></div>}<button className="button ghost full" onClick={()=>onSelect(null)}>إكمال البيع بدون عميل</button></div></Modal>
}

function HeldSalesModal({open,sales,loading,onClose,onResume,onDelete}:{open:boolean,sales:HeldSale[],loading:boolean,onClose:()=>void,onResume:(sale:HeldSale)=>void,onDelete:(sale:HeldSale)=>void}){
  return <Modal open={open} title="الفواتير المعلقة لهذه الوردية" onClose={onClose} width="760px"><div className="held-list">{loading&&<div className="empty-state"><b>جارٍ فحص المسودات…</b></div>}{!loading&&sales.map((sale)=><article key={sale.id}><div><b>{sale.customer?.name||sale.customer?.phone||'بدون عميل'}</b><span>{new Date(sale.created_at).toLocaleString('ar-EG')}</span>{sale.resume_error&&<small className="danger-text">{sale.resume_error}</small>}</div><div><b>{sale.item_count} صنف</b><span>{sale.resume_error?'تحتاج مراجعة':`${money(sale.total)} ج`}</span></div><button className="button primary" disabled={!!sale.resume_error} onClick={()=>onResume(sale)}>استكمال</button><button className="icon-button" aria-label="حذف الفاتورة المعلقة" onClick={()=>onDelete(sale)}>×</button></article>)}{!loading&&!sales.length&&<div className="empty-state"><b>لا توجد فواتير معلقة</b><span>استخدم F4 لتعليق الفاتورة الحالية داخل نفس الوردية.</span></div>}</div></Modal>
}

function SaleSuccessModal({value,onClose}:{value:CompletedSale|null,onClose:()=>void}){
  return <Modal open={!!value} title="تمت العملية" onClose={onClose} width="540px">{value&&<div className="success-state"><div className="success-icon">✓</div><h2>تم حفظ البيع</h2><b className="success-total">{money(value.total)} ج</b><div className="receipt-meta"><span>رقم الفاتورة</span><code>{value.invoice_number}</code><span>الطباعة</span><b className={value.printed?'ok':'warn'}>{value.printed?'تمت الطباعة':'لم تتم الطباعة'}</b>{value.change>0&&<><span>الباقي</span><b>{money(value.change)} ج</b></>}</div>{!value.printed&&<FieldError>{value.print_error||'يمكن إعادة الطباعة من سجل الفواتير بعد المزامنة.'}</FieldError>}<button className="button primary xl full" onClick={onClose}>بيع جديد</button></div>}</Modal>
}
