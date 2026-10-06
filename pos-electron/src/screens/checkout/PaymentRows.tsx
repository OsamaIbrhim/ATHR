import { PAYMENT_LABELS, type PaymentMethod } from '../../../electron/payment-methods'
import { addRow, removeRow, type SplitRow, type SplitState } from '../../payment-split'
import { money } from '../../utils'

/** The tenders of the sale: one row each, with the methods still available to add. */
export function PaymentRows({
  rows,
  state,
  enabled,
  onChange,
  onFocusReceived,
}: {
  rows: SplitRow[]
  state: SplitState
  enabled: readonly PaymentMethod[]
  onChange: (rows: SplitRow[]) => void
  /** The cash row whose "received" field the keypad types into. */
  onFocusReceived: (index: number) => void
}) {
  const update = (index: number, patch: Partial<SplitRow>) =>
    onChange(rows.map((row, position) => (position === index ? { ...row, ...patch } : row)))
  const unused = enabled.filter((method) => !rows.some((row) => row.method === method))

  return (
    <div className="pay-rows">
      {rows.map((row, index) => (
        <div className="pay-row" key={row.method}>
          <div className="pay-row-head">
            <b>{PAYMENT_LABELS[row.method]}</b>
            {rows.length > 1 && (
              <button type="button" className="pay-remove" aria-label="حذف طريقة الدفع" onClick={() => onChange(removeRow(rows, index))}>
                ×
              </button>
            )}
          </div>
          <label className="pay-field">
            <span>{index === 0 ? 'المبلغ (الباقي تلقائيًا)' : 'المبلغ'}</span>
            <input
              dir="ltr"
              inputMode="decimal"
              value={row.amount}
              placeholder={index === 0 ? money(state.applied[index]! / 100) : '0.00'}
              onChange={(event) => update(index, { amount: event.target.value })}
              autoFocus={index === rows.length - 1 && rows.length > 1}
            />
          </label>
          {row.method === 'cash' && (
            <label className="pay-field">
              <span>المبلغ المستلم</span>
              <input
                dir="ltr"
                inputMode="decimal"
                value={row.received}
                placeholder={money(state.applied[index]! / 100)}
                onFocus={() => onFocusReceived(index)}
                onChange={(event) => update(index, { received: event.target.value })}
                autoFocus={rows.length === 1}
              />
            </label>
          )}
        </div>
      ))}
      {unused.length > 0 && (
        <div className="pay-add">
          <span>إضافة طريقة دفع (دفع مقسّم)</span>
          <div>
            {unused.map((method) => (
              <button type="button" key={method} onClick={() => onChange(addRow(rows, method))}>
                + {PAYMENT_LABELS[method]}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
