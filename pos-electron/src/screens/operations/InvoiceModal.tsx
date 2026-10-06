import { athr } from '../../electron'
import { Modal } from '../../components/ui'
import type { Invoice } from '../../types'
import { fromCents, lineCents, money, toCents } from '../../utils'
import { subtractQuantity } from '../../../electron/quantity'
import { receiptFromInvoice } from '../../../electron/receipt-data'
import { itemName, paymentsLabel, returnedQty, type Notify } from './shared'

export function InvoiceModal({
  invoice,
  onClose,
  onReturn,
  notify,
}: {
  invoice: Invoice | null
  onClose: () => void
  onReturn: (invoice: Invoice) => void
  notify: Notify
}) {
  const reprint = async () => {
    if (!invoice) return

    // The same receipt as at the register: stored lines, discount and payments, printed with the store's receipt settings.
    const result = await athr.print(
      receiptFromInvoice({
        ...invoice,
        items: (invoice.items || []).map((item) => ({ ...item, name: itemName(item) })),
      }),
      'ar',
    )

    notify(
      result.ok
        ? 'تم إرسال الإيصال للطابعة'
        : result.reason || 'تعذرت الطباعة',
      result.ok ? 'success' : 'error',
    )
  }

  const hasReturnableItems = !!invoice?.items?.some(
    (item) => subtractQuantity(item.qty, returnedQty(item)) > 0,
  )

  return (
    <Modal
      open={!!invoice}
      title={
        invoice
          ? `فاتورة ${invoice.invoice_number}`
          : 'الفاتورة'
      }
      onClose={onClose}
      width="820px"
    >
      {invoice && (
        <div className="invoice-details">
          <div className="invoice-summary">
            <div>
              <span>التاريخ</span>
              <b>
                {new Date(invoice.occurred_at || invoice.created_at).toLocaleString(
                  'ar-EG',
                )}
              </b>
            </div>

            <div>
              <span>طريقة الدفع</span>
              <b>{paymentsLabel(invoice)}</b>
            </div>

            <div>
              <span>العميل</span>
              <b>
                {invoice.customer?.name ||
                  invoice.customer?.phone ||
                  'بدون عميل'}
              </b>
            </div>

            <div>
              <span>الإجمالي</span>
              <b>{money(invoice.total)} ج</b>
            </div>
          </div>

          <table className="line-table">
            <thead>
              <tr>
                <th>الصنف</th>
                <th>الكمية الأصلية</th>
                <th>تم إرجاعه</th>
                <th>المتبقي</th>
                <th>سعر الوحدة شامل الضريبة</th>
                <th>إجمالي السطر</th>
              </tr>
            </thead>

            <tbody>
              {(invoice.items || []).map((item) => {
                const returned = returnedQty(item)
                const remaining = Math.max(
                  0,
                  subtractQuantity(item.qty, returned),
                )
                const grossUnit = fromCents(
                  toCents(item.unit_price) +
                  toCents(item.unit_tax || 0),
                )

                return (
                  <tr key={item.id}>
                    <td>{itemName(item)}</td>
                    <td>{item.qty}</td>
                    <td>{returned}</td>
                    <td>
                      <b>{remaining}</b>
                    </td>
                    <td>{money(grossUnit)}</td>
                    <td>{money(fromCents(lineCents(grossUnit, item.qty)))}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>

          <section className="invoice-returns">
            <div className="section-heading">
              <h3>سجل المرتجعات</h3>
              <span>
                {invoice.original_returns?.length || 0} عملية
              </span>
            </div>

            {!invoice.original_returns?.length ? (
              <div className="empty-state compact">
                <b>لم يتم إجراء مرتجع لهذه الفاتورة</b>
              </div>
            ) : (
              <table className="line-table">
                <thead>
                  <tr>
                    <th>رقم المرتجع</th>
                    <th>التاريخ</th>
                    <th>النوع</th>
                    <th>السبب</th>
                    <th>المبلغ المسترد</th>
                  </tr>
                </thead>

                <tbody>
                  {invoice.original_returns.map((record) => (
                    <tr key={record.id}>
                      <td>
                        <b>{record.return_invoice_number}</b>
                      </td>

                      <td>
                        {new Date(
                          record.created_at,
                        ).toLocaleString('ar-EG')}
                      </td>

                      <td>
                        {record.is_partial
                          ? 'مرتجع جزئي'
                          : 'مرتجع كامل'}
                      </td>

                      <td>{record.reason || '—'}</td>

                      <td>
                        <b>{money(record.refund_total)} ج</b>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          <div className="dialog-actions">
            <button
              className="button secondary"
              onClick={() => void reprint()}
            >
              إعادة الطباعة
            </button>

            <button
              className="button danger"
              disabled={!hasReturnableItems}
              onClick={() => onReturn(invoice)}
            >
              {hasReturnableItems
                ? 'إنشاء مرتجع'
                : 'تم إرجاع كامل الفاتورة'}
            </button>
          </div>
        </div>
      )}
    </Modal>
  )
}
