import { useEffect, useMemo, useRef, useState } from 'react'
import { offlineAccountingSummaryMatches } from '../../../electron/offline-accounting'
import { receiptFromCart } from '../../../electron/receipt-data'
import type { Discount } from '../../../electron/sale-math'
import type { PosSettings } from '../../../electron/sale-settings'
import { athr } from '../../electron'
import { resolveSplit, type SplitRow } from '../../payment-split'
import type { CartItem, Customer, DeviceCredential, OfflineAccountingContext, Session, Shift } from '../../types'
import { FieldError, Modal, NumericKeypad } from '../../components/ui'
import { cartTotals, isValidEgyptianPhone, money, normalizeEgyptianPhone, toCents } from '../../utils'
import { PaymentRows } from './PaymentRows'
import './checkout.css'

type Notify = (message: string, tone?: 'success' | 'error' | 'info') => void

const CASH_PRESETS = [50, 100, 200, 500, 1000]

/** What the register shows after a sale is saved (the success dialog). */
export interface CompletedSale {
  sync_id: string
  invoice_number: string
  total: number
  change: number
  printed: boolean
  print_error?: string
}

export function CheckoutModal({
  open,
  items,
  invoiceDiscount,
  customer,
  sellerId,
  session,
  device,
  shift,
  accountingContext,
  settings,
  totals,
  onSaleSaved,
  onClose,
  onCompleted,
  notify,
}: {
  open: boolean
  items: CartItem[]
  invoiceDiscount: Discount | null
  customer: Customer | null
  sellerId: string
  session: Session
  device: DeviceCredential
  shift: Shift
  accountingContext: OfflineAccountingContext | null
  settings: PosSettings
  totals: ReturnType<typeof cartTotals>
  onSaleSaved: () => void
  onClose: () => void
  onCompleted: (value: CompletedSale) => void
  notify: Notify
}) {
  const enabled = settings.sales.payment_methods
  const firstMethod = enabled.includes('cash') ? 'cash' : enabled[0]!
  const [rows, setRows] = useState<SplitRow[]>([])
  const [keypadRow, setKeypadRow] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const paymentLock = useRef(false)

  useEffect(() => {
    if (!open) return
    paymentLock.current = false
    setRows([{ method: firstMethod, amount: '', received: '' }])
    setKeypadRow(0)
    setBusy(false)
    setError('')
  }, [open, firstMethod])

  const totalCents = toCents(totals.total)
  const hasCustomer = !!customer?.phone
  const split = useMemo(() => resolveSplit(rows, totalCents, hasCustomer), [rows, totalCents, hasCustomer])
  const cashIndex = rows.findIndex((row) => row.method === 'cash')
  const typingRow = rows[keypadRow]?.method === 'cash' ? keypadRow : cashIndex

  const setReceived = (value: string) =>
    setRows((current) => current.map((row, index) => (index === typingRow ? { ...row, received: value } : row)))

  const confirm = async () => {
    if (paymentLock.current || busy) return
    if (!offlineAccountingSummaryMatches(accountingContext, { session, device, shift })) {
      setError('انتهى أو تغير تفويض الكاشير والوردية. أغلق شاشة الدفع وشغّل الإنترنت لتجديده.')
      return
    }
    if (split.problem) {
      setError(split.problem)
      return
    }
    const phone = customer?.phone ? normalizeEgyptianPhone(customer.phone) : ''
    if (phone && !isValidEgyptianPhone(phone)) {
      setError('رقم العميل غير صحيح. صححه أو أزل العميل من الفاتورة.')
      return
    }
    paymentLock.current = true
    setBusy(true)
    setError('')
    const payload = {
      sync_id: crypto.randomUUID(),
      branch_id: device.branch_id,
      seller_id: sellerId,
      customer_phone: phone || undefined,
      items: items.map((item) => ({
        variant_id: item.variant_id,
        qty: item.qty,
        unit_price: item.unit_price,
        unit_tax: item.unit_tax,
        tax_rate: item.tax_rate ?? undefined,
        tax_mode: item.tax_mode ?? undefined,
        discount: item.discount ?? undefined,
        sku: item.sku,
        name_ar: item.name_ar || item.name,
        name_en: item.name_en || '',
        label: item.label || undefined,
      })),
      discount: invoiceDiscount ?? undefined,
      payments: split.payments,
      language: 'ar',
      local_total: totals.total,
    }
    try {
      const saved = await athr.sale(payload)
      onSaleSaved()
      const receipt = receiptFromCart({
        invoiceNumber: saved.invoice_number,
        occurredAt: saved.occurred_at,
        lines: items,
        invoiceDiscount,
        payments: split.payments,
        customer: customer?.name || customer?.phone || null,
      })
      const printResult = await athr.print(receipt, 'ar').catch((printError) => ({ ok: false, reason: (printError as Error).message }))
      onCompleted({
        sync_id: saved.sync_id,
        invoice_number: saved.invoice_number,
        total: receipt.total,
        change: receipt.change ?? 0,
        printed: !!printResult?.ok,
        print_error: (printResult as { reason?: string })?.reason,
      })
      notify('تم حفظ البيع محليًا بأمان', 'success')
    } catch (err) {
      paymentLock.current = false
      setError((err as Error).message || 'تعذر حفظ البيع محليًا')
      setBusy(false)
    }
  }

  const onEnter = (event: React.KeyboardEvent) => {
    if (event.key === 'Enter' && !busy && !split.problem) void confirm()
  }

  return (
    <Modal open={open} title="إتمام الدفع" onClose={() => { if (!busy) onClose() }} width="980px">
      <div className="checkout-layout" onKeyDown={onEnter}>
        <section>
          <div className="checkout-total">
            <span>المبلغ المطلوب</span>
            <b>{money(totals.total)} ج</b>
            <small>
              {totals.lines} صنف · ضريبة {money(totals.tax)} ج
              {totals.discount > 0 && ` · خصم ${money(totals.discount)} ج`}
            </small>
          </div>
          <PaymentRows rows={rows} state={split} enabled={enabled} onChange={setRows} onFocusReceived={setKeypadRow} />
          {cashIndex >= 0 && (
            <div className="cash-presets">
              <button type="button" onClick={() => setReceived('')}>المبلغ بالضبط</button>
              {CASH_PRESETS.filter((value) => value * 100 >= split.applied[cashIndex]!).slice(0, 4).map((value) => (
                <button type="button" key={value} onClick={() => setReceived(String(value))}>{value}</button>
              ))}
            </div>
          )}
          <div className="pay-summary">
            <div><span>المدفوع</span><b>{money((totalCents - split.remaining) / 100)} ج</b></div>
            <div className={split.remaining === 0 ? 'ok' : 'warn'}><span>المتبقي</span><b>{money(Math.abs(split.remaining) / 100)} ج{split.remaining < 0 ? ' (زيادة)' : ''}</b></div>
            <div className="change-row"><span>الباقي للعميل</span><b>{money(split.change / 100)} ج</b></div>
          </div>
          <FieldError>{error || (split.remaining !== totalCents ? split.problem : '')}</FieldError>
        </section>
        {typingRow >= 0 && <NumericKeypad value={rows[typingRow]?.received ?? ''} onChange={setReceived} />}
      </div>
      <div className="dialog-actions">
        <button className="button secondary" disabled={busy} onClick={onClose}>رجوع</button>
        <button className="button primary xl" disabled={busy || !!split.problem} onClick={confirm}>
          {busy ? 'جارٍ حفظ البيع…' : rows.length > 1 ? 'تأكيد الدفع المقسّم' : `تأكيد ${rows[0] ? paymentName(rows[0].method) : ''}`}
        </button>
      </div>
    </Modal>
  )
}

function paymentName(method: string) {
  return method === 'credit' ? 'البيع الآجل' : method === 'cash' ? 'الدفع نقدًا' : 'الدفع'
}
