import { useEffect, useState, type ChangeEvent } from 'react'
import { api, ApiError } from '../../api'
import { FieldError, Modal } from '../../components/ui'
import { fromCents, lineCents, money, toCents } from '../../utils'
import { addQuantity, isValidQuantity, milliToQuantity, subtractQuantity } from '../../../electron/quantity'
import { athr } from '../../electron'
import { DEFAULT_POS_SETTINGS, type PosSettings } from '../../../electron/sale-settings'
import { refundForLine } from '../../../electron/return-refund'
import type { RefundMethod } from '../../../electron/payment-methods'
import type { ExchangeStart } from '../../exchange'
import { RefundMethodPicker, refundMethodsFor } from './RefundMethodPicker'
import { itemName, type Notify, type ReturnableInvoice, type ReturnableInvoiceItem } from './shared'

export function ReturnModal({
  invoice,
  onClose,
  onCompleted,
  onExchange,
  notify,
}: {
  invoice: ReturnableInvoice | null
  onClose: () => void
  onCompleted: () => void | Promise<void>
  onExchange: (start: ExchangeStart) => void
  notify: Notify
}) {
  const [quantities, setQuantities] =
    useState<Record<string, number>>({})
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [refundMethod, setRefundMethod] = useState<RefundMethod>('cash')
  const [settings, setSettings] = useState<PosSettings>(DEFAULT_POS_SETTINGS)

  useEffect(() => {
    if (invoice) {
      athr.settings().then(setSettings).catch(() => setSettings(DEFAULT_POS_SETTINGS))
      setRefundMethod('cash')
      setQuantities({})
      setReason('')
      setError('')
      setBusy(false)
    }
  }, [invoice])

  const items = (invoice?.items || []) as ReturnableInvoiceItem[]

  const selectedItems = items.filter(
    (item) => Number(quantities[item.id] || 0) > 0,
  )

  // What the server will refund: the share of what was paid (after discount), line by line.
  const refundOf = (item: (typeof items)[number], qty: number) =>
    refundForLine(item, Number(item.returned_qty || 0), qty).gross
  const refundCents = selectedItems.reduce(
    (sum, item) => sum + toCents(refundOf(item, Number(quantities[item.id]))),
    0,
  )
  const refund = fromCents(refundCents)
  const refundMethods = refundMethodsFor(settings.sales.payment_methods, !!invoice?.customer)
  const returnsOff = settings.sales.return_window_days <= 0
  const soldAt = invoice?.occurred_at ? new Date(invoice.occurred_at).getTime() : null
  const pastWindow = soldAt !== null && Date.now() - soldAt > settings.sales.return_window_days * 86_400_000

  const validate = () => {
    if (!selectedItems.length) return 'اختر صنفًا واحدًا على الأقل.'
    const invalidItem = selectedItems.find((item) => {
      const qty = Number(quantities[item.id])
      return !isValidQuantity(qty) || qty > Number(item.returnable_qty || 0)
    })
    return invalidItem ? 'إحدى كميات المرتجع غير صحيحة.' : ''
  }

  const exchange = () => {
    const problem = validate()
    if (problem || !invoice) {
      setError(problem)
      return
    }
    onExchange({
      original_invoice_id: invoice.id,
      invoice_number: invoice.invoice_number,
      items: selectedItems.map((item) => ({ sales_invoice_item_id: item.id, qty: Number(quantities[item.id]) })),
      reason: reason.trim() || undefined,
      refund_method: refundMethod,
      refund_total: refund,
      customer: invoice.customer ? { id: invoice.customer.id, name: invoice.customer.name, phone: invoice.customer.phone } : null,
    })
  }

  const submit = async () => {
    if (busy || !invoice) return

    const problem = validate()
    if (problem) {
      setError(problem)
      return
    }

    setBusy(true)
    setError('')

    try {
      const result = await api.returnSale({
        original_invoice_id: invoice.id,
        items: selectedItems.map((item) => ({
          sales_invoice_item_id: item.id,
          qty: Number(quantities[item.id]),
        })),
        reason: reason.trim() || undefined,
        refund_method: refundMethod,
      })

      notify(
        `تم تسجيل المرتجع ${result.return_invoice_number}`,
        'success',
      )

      await onCompleted()
    } catch (error) {
      const value = error as ApiError

      setError(
        `${value.message}${
          value.requestId
            ? ` — المرجع: ${value.requestId}`
            : ''
        }`,
      )
    } finally {
      setBusy(false)
    }
  }

  const allReturned =
    items.length > 0 &&
    items.every(
      (item) => Number(item.returnable_qty || 0) === 0,
    )

  return (
    <Modal
      open={!!invoice}
      title={
        invoice
          ? `مرتجع ${invoice.invoice_number}`
          : 'مرتجع'
      }
      onClose={() => {
        if (!busy) onClose()
      }}
      width="900px"
    >
      {invoice && (
        <div className="return-flow">
          <p className="muted">
            يعرض النظام الكمية المباعة أصلًا، وما تم إرجاعه
            في عمليات سابقة، والكمية المتبقية التي لا يزال
            مسموحًا بإرجاعها.
          </p>

          {allReturned && (
            <div className="return-complete-notice">
              تم إرجاع كامل أصناف هذه الفاتورة، ولا توجد كمية
              متاحة لمرتجع جديد.
            </div>
          )}

          <table className="line-table">
            <thead>
              <tr>
                <th>الصنف</th>
                <th>الكمية الأصلية</th>
                <th>تم إرجاعه سابقًا</th>
                <th>المتبقي المسموح بإرجاعه</th>
                <th>كمية هذا المرتجع</th>
                <th>قيمة الاسترداد</th>
              </tr>
            </thead>

            <tbody>
              {items.map((item) => {
                const maximum = Number(
                  item.returnable_qty || 0,
                )

                return (
                  <tr key={item.id}>
                    <td>{itemName(item)}</td>
                    <td>{item.qty}</td>
                    <td>
                      {Number(item.returned_qty || 0)}
                    </td>
                    <td>
                      {maximum > 0 ? (
                        <b>{maximum}</b>
                      ) : (
                        <small className="return-complete-label">
                          تم إرجاع كامل الكمية
                        </small>
                      )}
                    </td>

                    <td>
                      <div className="qty-control">
                        <button
                          type="button"
                          disabled={busy || maximum === 0}
                          onClick={() =>
                            setQuantities((current) => ({
                              ...current,
                              [item.id]: Math.max(
                                0,
                                subtractQuantity(
                                  Number(current[item.id] || 0),
                                  1,
                                ),
                              ),
                            }))
                          }
                        >
                          −
                        </button>

                        <input
                          type="number"
                          min="0"
                          step="any"
                          max={maximum}
                          disabled={busy || maximum === 0}
                          value={quantities[item.id] || 0}
                          onChange={(event: ChangeEvent<HTMLInputElement>) => {
                            const raw = Number(
                              event.target.value || 0,
                            )
                            const next = Math.min(
                              maximum,
                              Math.max(
                                0,
                                milliToQuantity(
                                  Math.floor(
                                    (Number.isFinite(raw) ? raw : 0) * 1000,
                                  ),
                                ),
                              ),
                            )

                            setQuantities((current) => ({
                              ...current,
                              [item.id]: next,
                            }))
                          }}
                        />

                        <button
                          type="button"
                          disabled={busy || maximum === 0}
                          onClick={() =>
                            setQuantities((current) => ({
                              ...current,
                              [item.id]: Math.min(
                                maximum,
                                addQuantity(
                                  Number(current[item.id] || 0),
                                  1,
                                ),
                              ),
                            }))
                          }
                        >
                          +
                        </button>
                      </div>
                    </td>

                    <td>{money(refundOf(item, Number(quantities[item.id] || 0)))} ج</td>
                  </tr>
                )
              })}
            </tbody>
          </table>

          <label>سبب الإرجاع (اختياري)</label>
          <textarea
            value={reason}
            onChange={(event: ChangeEvent<HTMLTextAreaElement>) =>
              setReason(event.target.value)
            }
            rows={3}
            maxLength={500}
            placeholder="مثال: الصنف غير مناسب"
          />

          <RefundMethodPicker value={refundMethod} methods={refundMethods} disabled={busy} onChange={setRefundMethod} />

          {(returnsOff || pastWindow) && (
            <div className="return-complete-notice">
              {returnsOff
                ? 'المرتجعات غير مفعّلة في إعدادات المتجر.'
                : `انتهت مهلة المرتجع (${settings.sales.return_window_days} يومًا). سيرفض الخادم هذا المرتجع.`}
            </div>
          )}

          <div className="refund-total">
            <span>إجمالي الاسترداد</span>
            <b>{money(refund)} ج</b>
          </div>

          <FieldError>{error}</FieldError>

          <div className="dialog-actions">
            <button
              className="button secondary"
              disabled={busy}
              onClick={onClose}
            >
              إلغاء
            </button>

            <button
              className="button secondary"
              disabled={busy || !selectedItems.length || allReturned}
              onClick={exchange}
            >
              استبدال بأصناف أخرى
            </button>

            <button
              className="button danger xl"
              disabled={
                busy ||
                !selectedItems.length ||
                allReturned
              }
              onClick={() => void submit()}
            >
              {busy
                ? 'جارٍ تسجيل المرتجع…'
                : 'تأكيد المرتجع'}
            </button>
          </div>
        </div>
      )}
    </Modal>
  )
}
