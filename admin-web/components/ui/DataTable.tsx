import type { ReactNode } from 'react'
import EmptyState from './EmptyState'

export interface Column<Row> {
  header: string
  cell: (row: Row) => ReactNode
  className?: string
}

/** A small read-only table with loading and empty states. */
export default function DataTable<Row>({ columns, rows, rowKey, loading, empty }: {
  columns: Column<Row>[]
  rows: Row[]
  rowKey: (row: Row) => string
  loading?: boolean
  empty?: { title: string; hint?: string; action?: ReactNode }
}) {
  return (
    <div className="overflow-auto">
      <table>
        <thead>
          <tr>{columns.map(column => <th key={column.header} className={column.className}>{column.header}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map(row => (
            <tr key={rowKey(row)}>
              {columns.map(column => <td key={column.header} className={column.className}>{column.cell(row)}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
      {loading && <div className="py-10 text-center text-sm text-gray-500">جارٍ التحميل…</div>}
      {!loading && !rows.length && <EmptyState title={empty?.title ?? 'لا توجد بيانات'} hint={empty?.hint} action={empty?.action} />}
    </div>
  )
}
