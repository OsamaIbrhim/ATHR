'use client'
import { useEffect, useState } from 'react'
import { problemText, type RowResult } from '@/lib/import/runner'
import DataTable, { type Column } from '@/components/ui/DataTable'
import Num from '@/components/ui/Num'
import { Pager } from '@/components/ui/PageStates'
import StatusBadge from '@/components/ui/StatusBadge'

const PAGE_SIZE = 25

function Status({ row }: { row: RowResult }) {
  if (row.status === 'failed') return <StatusBadge tone="danger">خطأ</StatusBadge>
  if (row.status === 'out_of_plan') return <StatusBadge tone="warn">خارج الباقة</StatusBadge>
  if (row.status === 'skipped') return <StatusBadge tone="neutral">سيتم تخطيه</StatusBadge>
  if (row.status === 'created') return <StatusBadge tone="ok">تمت إضافته</StatusBadge>
  return row.warnings.length ? <StatusBadge tone="warn">تنبيه</StatusBadge> : <StatusBadge tone="ok">جاهز</StatusBadge>
}

const text = (row: RowResult) => problemText(row) || (row.status === 'skipped' ? 'SKU موجود بالفعل — لن يتغير.' : '')

const columns: Column<RowResult>[] = [
  { header: 'رقم الصف', cell: row => <Num value={row.row_ref} /> },
  { header: 'SKU', cell: row => <bdi dir="ltr" className="font-mono text-xs">{row.sku || '—'}</bdi>, hideBelow: 'md' },
  { header: 'المنتج', cell: row => row.name || '—' },
  { header: 'الحالة', cell: row => <Status row={row} /> },
  { header: 'المشكلة', cell: text },
]

/** Paged list of import rows (25 per page); the row number is the one in the Excel file. */
export default function ResultsTable({ rows, empty }: { rows: RowResult[]; empty: string }) {
  const [page, setPage] = useState(1)
  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE))
  useEffect(() => { setPage(1) }, [rows])
  const visible = rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)
  return (
    <div>
      <DataTable
        columns={columns} rows={visible} rowKey={row => String(row.row_ref)} caption="الصفوف التي فحصناها"
        empty={{ title: empty }}
        rowClassName={row => (row.status === 'failed' ? 'border-s-[3px] border-s-red-600' : undefined)}
        mobileCard={row => (
          <div className="space-y-1">
            <div className="flex items-center justify-between gap-2"><span className="text-sm">صف <Num value={row.row_ref} /></span><Status row={row} /></div>
            <div className="font-medium">{row.name || '—'}</div>
            {text(row) && <div className="text-sm text-gray-700">{text(row)}</div>}
          </div>
        )}
      />
      <Pager page={page} totalPages={totalPages} onPage={setPage} />
    </div>
  )
}
