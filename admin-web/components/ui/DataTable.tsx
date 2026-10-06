import type { ReactNode } from 'react'
import EmptyState from './EmptyState'

export interface Column<Row> {
  header: string
  cell: (row: Row) => ReactNode
  /** Stable identity when two columns share a header (or the header is empty). */
  key?: string
  className?: string
  /** `end` right-aligns numbers (in RTL: the left edge); header and cells match. */
  align?: 'start' | 'end'
  hideBelow?: 'md'
}

const colKey = <Row,>(column: Column<Row>, index: number) => column.key ?? (column.header || `col-${index}`)
const cellClass = <Row,>(column: Column<Row>) =>
  [column.align === 'end' ? 'text-end' : '', column.hideBelow ? 'hidden md:table-cell' : '', column.className || ''].filter(Boolean).join(' ')

/**
 * A read-only table with skeleton loading, an error state with retry, an empty
 * state that replaces the table, and (below `md`) optional cards instead of a
 * sideways-scrolling table.
 */
export default function DataTable<Row>({
  columns, rows, rowKey, loading, empty, error, mobileCard, stickyHeader, rowClassName, caption, skeletonRows = 6,
}: {
  columns: Column<Row>[]
  rows: Row[]
  rowKey: (row: Row) => string
  loading?: boolean
  empty?: { title: string; hint?: string; action?: ReactNode }
  error?: { message: string; onRetry: () => void }
  mobileCard?: (row: Row) => ReactNode
  stickyHeader?: boolean
  rowClassName?: (row: Row) => string | undefined
  caption?: string
  skeletonRows?: number
}) {
  if (error) {
    return (
      <div role="alert" className="flex flex-col items-center gap-2 py-10 text-center">
        <div className="font-medium text-gray-800">تعذر تحميل البيانات</div>
        <div className="text-sm text-gray-600">{error.message || 'تحقق من الاتصال ثم أعد المحاولة.'}</div>
        <button type="button" className="btn-secondary" onClick={error.onRetry}>إعادة المحاولة</button>
      </div>
    )
  }
  if (loading) {
    return (
      <div aria-busy="true" aria-label="جارٍ التحميل">
        {mobileCard && (
          <ul className="space-y-3 p-2 md:hidden">
            {Array.from({ length: Math.min(skeletonRows, 4) }, (_, i) => <li key={i} className="h-20 animate-pulse rounded-xl bg-gray-100 motion-reduce:animate-none" />)}
          </ul>
        )}
        <div className={`overflow-auto ${mobileCard ? 'hidden md:block' : ''}`}>
          <table>
            <thead><tr>{columns.map((column, i) => <th key={colKey(column, i)} scope="col" className={cellClass(column)}>{column.header}</th>)}</tr></thead>
            <tbody>
              {Array.from({ length: skeletonRows }, (_, r) => (
                <tr key={r}>
                  {columns.map((column, i) => (
                    <td key={colKey(column, i)} className={cellClass(column)}><div className="h-4 w-full max-w-[8rem] animate-pulse rounded bg-gray-100 motion-reduce:animate-none" /></td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <span className="sr-only" role="status">جارٍ التحميل…</span>
      </div>
    )
  }
  if (!rows.length) {
    return <EmptyState title={empty?.title ?? 'لا توجد بيانات'} hint={empty?.hint} action={empty?.action} />
  }
  return (
    <>
      {mobileCard && (
        <ul className="space-y-3 p-2 md:hidden">
          {rows.map(row => <li key={rowKey(row)} className={`rounded-xl border border-gray-200 bg-white p-3 ${rowClassName?.(row) ?? ''}`}>{mobileCard(row)}</li>)}
        </ul>
      )}
      <div className={`${stickyHeader ? 'max-h-[70vh]' : ''} overflow-auto ${mobileCard ? 'hidden md:block' : ''}`}>
        <table>
          {caption && <caption className="sr-only">{caption}</caption>}
          <thead className={stickyHeader ? 'sticky top-0 z-10' : undefined}>
            <tr>{columns.map((column, i) => <th key={colKey(column, i)} scope="col" className={cellClass(column)}>{column.header}</th>)}</tr>
          </thead>
          <tbody>
            {rows.map(row => (
              <tr key={rowKey(row)} className={rowClassName?.(row)}>
                {columns.map((column, i) => <td key={colKey(column, i)} className={cellClass(column)}>{column.cell(row)}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}
