import { describe, expect, it } from 'vitest'
import { errorsFileRows } from './download'
import type { RowResult } from './runner'

const res = (row_ref: number, status: RowResult['status'], message_ar = ''): RowResult => ({
  row_ref, sku: '', name: '', status, errors: message_ar ? [{ code: 'X', message_ar }] : [], warnings: [],
})

describe('errorsFileRows', () => {
  const table = [['اسم', 'سعر'], ['شاي', '85'], ['', '10'], ['سكر', 'abc']]
  it('keeps the original columns of problem rows and adds row number and reason', () => {
    const rows = errorsFileRows(table, true, [res(2, 'ready'), res(3, 'failed', 'اسم المنتج فارغ.'), res(4, 'failed', 'السعر غير صالح.')])
    expect(rows).toEqual([
      ['اسم', 'سعر', 'رقم الصف', 'سبب الخطأ'],
      ['', '10', '3', 'اسم المنتج فارغ.'],
      ['سكر', 'abc', '4', 'السعر غير صالح.'],
    ])
  })
  it('includes skipped and out-of-plan rows, and invents headers when the file has none', () => {
    const rows = errorsFileRows([['a', '1'], ['b', '2']], false, [res(1, 'skipped', 'SKU موجود بالفعل — لن يتغير.'), res(2, 'out_of_plan')])
    expect(rows[0]).toEqual(['عمود 1', 'عمود 2', 'رقم الصف', 'سبب الخطأ'])
    expect(rows[1]).toEqual(['a', '1', '1', 'SKU موجود بالفعل — لن يتغير.'])
    expect(rows[2]).toEqual(['b', '2', '2', 'تجاوز حد الباقة.'])
  })
})
