import { PAYMENT_LABELS, REFUND_METHODS, type PaymentMethod, type RefundMethod } from '../../../electron/payment-methods'

/**
 * How the money goes back. Cash is always possible; card, wallet and other follow
 * the methods the store accepts; "on the customer's account" needs a customer on the invoice.
 */
export function refundMethodsFor(enabled: readonly PaymentMethod[], hasCustomer: boolean): RefundMethod[] {
  return REFUND_METHODS.filter((method) => {
    if (method === 'cash') return true
    if (method === 'credit') return hasCustomer
    return enabled.includes(method)
  })
}

export function RefundMethodPicker({
  value,
  methods,
  disabled,
  onChange,
}: {
  value: RefundMethod
  methods: readonly RefundMethod[]
  disabled?: boolean
  onChange: (method: RefundMethod) => void
}) {
  return (
    <div className="refund-methods">
      <label>طريقة رد المبلغ</label>
      <div className="payment-methods">
        {methods.map((method) => (
          <button type="button" key={method} disabled={disabled} className={value === method ? 'active' : ''} onClick={() => onChange(method)}>
            {method === 'credit' ? 'على حساب العميل' : PAYMENT_LABELS[method]}
          </button>
        ))}
      </div>
    </div>
  )
}
