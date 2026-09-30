'use client'
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { itemTitle, matchBarcode, searchItems, type PickedItem } from '@/lib/items'
import { toWesternDigits } from '@/lib/format'

export interface ItemPickerHandle { focus: () => void; setQuery: (text: string) => void }

export interface PickOptions { fromScan: boolean; packQty: number }

/**
 * One input for scan or search. A scanner's Enter with an exact barcode picks the
 * item with no dropdown; text of two or more characters runs a debounced server
 * search (name, SKU, barcode). Re-focuses itself after every pick.
 */
const ItemPicker = forwardRef<ItemPickerHandle, {
  branchId?: string
  onPick: (item: PickedItem, opts: PickOptions) => void
  onUnknownBarcode?: (code: string) => void
  disabledWhen?: (item: PickedItem) => string | undefined
  autoFocus?: boolean
  size?: 'md' | 'lg'
  placeholder?: string
  excludeTracked?: boolean
  disabled?: boolean
  /** Called on Enter before any search; return true when the text was handled (e.g. a scanner code counted directly). */
  onRawSubmit?: (text: string) => boolean
  /** Shown at the end of the field (e.g. a camera button). */
  endAdornment?: React.ReactNode
}>(function ItemPicker({
  branchId, onPick, onUnknownBarcode, disabledWhen, autoFocus, size = 'md', disabled,
  placeholder = 'امسح الباركود أو اكتب اسم الصنف أو SKU', excludeTracked, endAdornment, onRawSubmit,
}, ref) {
  const input = useRef<HTMLInputElement>(null)
  const [text, setText] = useState('')
  const [results, setResults] = useState<PickedItem[]>([])
  const [active, setActive] = useState(0)
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const latest = useRef(0)

  useImperativeHandle(ref, () => ({ focus: () => input.current?.focus(), setQuery: (value: string) => { setText(value); input.current?.focus() } }), [])
  useEffect(() => { if (autoFocus) input.current?.focus() }, [autoFocus])

  const reasonFor = (item: PickedItem) => {
    if (excludeTracked && item.tracked) return 'الأصناف المتتبَّعة بالسيريال أو الدفعة لا يُسجَّل لها رصيد من هنا.'
    return disabledWhen?.(item)
  }

  const run = async (query: string): Promise<PickedItem[]> => {
    const ticket = ++latest.current
    setBusy(true); setFailed(false)
    try {
      const found = await searchItems(query, branchId)
      if (ticket === latest.current) setResults(found)
      return found
    } catch {
      if (ticket === latest.current) { setFailed(true); setResults([]) }
      return []
    } finally {
      if (ticket === latest.current) setBusy(false)
    }
  }

  useEffect(() => {
    const query = text.trim()
    if (query.length < 2) { latest.current += 1; setResults([]); setFailed(false); setBusy(false); return }
    const timer = setTimeout(() => { setActive(0); void run(query) }, 150)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, branchId])

  const finish = (item: PickedItem, opts: PickOptions) => {
    onPick(item, opts)
    setText(''); setResults([]); setFailed(false)
    requestAnimationFrame(() => input.current?.focus())
  }

  const submit = async () => {
    const code = toWesternDigits(text).trim()
    if (!code) return
    if (onRawSubmit?.(code)) { setText(''); setResults([]); return }
    const found = await run(code)
    const exact = matchBarcode(found, code)
    if (exact) {
      const reason = reasonFor(exact.item)
      if (!reason) return finish(exact.item, { fromScan: true, packQty: exact.packQty })
      return
    }
    const highlighted = results[active] ?? found[active]
    if (found.length && highlighted && !/^\d{6,}$/.test(code)) {
      if (!reasonFor(highlighted)) finish(highlighted, { fromScan: false, packQty: 1 })
      return
    }
    if (!found.length && /^[\w-]{4,}$/.test(code) && onUnknownBarcode) { onUnknownBarcode(code); setText(''); setResults([]) }
  }

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') { event.preventDefault(); setActive(i => Math.min(i + 1, Math.max(0, results.length - 1))) }
    else if (event.key === 'ArrowUp') { event.preventDefault(); setActive(i => Math.max(0, i - 1)) }
    else if (event.key === 'Enter') { event.preventDefault(); void submit() }
    else if (event.key === 'Escape') { setText(''); setResults([]) }
  }

  return (
    <div className="relative">
      <div className="relative">
        <input
          ref={input}
          type="text"
          dir="auto"
          autoComplete="off"
          enterKeyHint="done"
          disabled={disabled}
          aria-label={placeholder}
          aria-expanded={results.length > 0}
          aria-controls="item-picker-results"
          role="combobox"
          aria-autocomplete="list"
          placeholder={placeholder}
          value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={onKeyDown}
          className={`input ${size === 'lg' ? 'min-h-14 text-lg' : ''} ${endAdornment ? 'pe-14' : ''}`}
        />
        {endAdornment && <div className="absolute inset-y-0 end-1 flex items-center">{endAdornment}</div>}
      </div>
      <div className="sr-only" role="status" aria-live="polite">{busy ? 'جارٍ البحث' : results.length ? `${results.length} نتيجة` : ''}</div>
      {failed && <p role="alert" className="mt-1 text-sm text-red-700">تعذر البحث. أعد المحاولة.</p>}
      {results.length > 0 && (
        <ul id="item-picker-results" role="listbox" className="absolute inset-x-0 top-full z-30 mt-1 max-h-72 overflow-auto rounded-xl border border-gray-200 bg-white shadow-lg">
          {results.map((item, index) => {
            const reason = reasonFor(item)
            return (
              <li key={item.id} role="option" aria-selected={index === active} aria-disabled={!!reason}>
                <button
                  type="button"
                  disabled={!!reason}
                  onMouseEnter={() => setActive(index)}
                  onClick={() => finish(item, { fromScan: false, packQty: 1 })}
                  className={`flex min-h-11 w-full flex-col items-start gap-0.5 px-3 py-2 text-start ${index === active ? 'bg-gray-50' : ''}`}
                >
                  <span className="font-medium text-gray-900">{itemTitle(item)}</span>
                  <span className="flex flex-wrap gap-x-3 text-xs text-gray-600">
                    <bdi dir="ltr" className="font-mono">{item.sku}</bdi>
                    {item.barcodes[0] && <bdi dir="ltr" className="font-mono">{item.barcodes[0].code}</bdi>}
                  </span>
                  {reason && <span className="text-xs text-amber-800">{reason}</span>}
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
})

export default ItemPicker
