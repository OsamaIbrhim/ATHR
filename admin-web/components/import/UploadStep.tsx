'use client'
import { formatBytes } from '@/lib/format'
import { downloadTemplate } from '@/lib/import/download'
import { ACCEPT, MAX_FILE_BYTES, MAX_FILE_ROWS, type ParsedFile } from '@/lib/import/read-file'
import { TEMPLATE_HEADERS, TEMPLATE_SAMPLE } from '@/lib/import/rows'
import FileDropzone from '@/components/ui/FileDropzone'
import Field from '@/components/ui/Field'

const MEANING = ['اسم المنتج كما يظهر للكاشير', 'كود الصنف (اختياري إن وُجد باركود)', 'باركود واحد أو أكثر', 'سعر البيع بالجنيه', 'سعر الشراء (التكلفة)', 'الكمية الافتتاحية', 'قطعة، كجم، …', 'التصنيف (يُنشأ تلقائيًا)']

export default function UploadStep({ file, parsed, error, reading, hasHeader, sheet, onFile, onRemove, onHeader, onSheet, onRead }: {
  file: File | null
  parsed: ParsedFile | null
  error: string
  reading: boolean
  hasHeader: boolean
  sheet: number
  onFile: (file: File) => void
  onRemove: () => void
  onHeader: (value: boolean) => void
  onSheet: (index: number) => void
  onRead: () => void
}) {
  return (
    <div className="grid gap-4 md:grid-cols-3">
      <div className="space-y-4 md:col-span-2">
        <FileDropzone accept={ACCEPT} maxBytes={MAX_FILE_BYTES} onFile={onFile} error={error} disabled={reading}
          hint={`الصيغ المسموحة: xlsx و csv · الحد الأقصى ${MAX_FILE_BYTES / 1024 / 1024} ميجا و${MAX_FILE_ROWS.toLocaleString('en-US')} صف`} />
        <p className="text-xs text-gray-600">إذا ظهر العربي بحروف غريبة احفظ الملف بترميز UTF-8.</p>
        {file && (
          <div className="card space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div><span className="font-medium">{file.name}</span> <span className="text-sm text-gray-600">({formatBytes(file.size)})</span></div>
              <button type="button" className="btn-danger-link" onClick={onRemove}>إزالة</button>
            </div>
            <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={hasHeader} onChange={e => onHeader(e.target.checked)} />الصف الأول يحتوي عناوين الأعمدة</label>
            {parsed && parsed.sheets.length > 1 && (
              <Field label="الورقة"><select className="select" value={sheet} onChange={e => onSheet(Number(e.target.value))}>{parsed.sheets.map((s, i) => <option key={i} value={i}>{s.name}</option>)}</select></Field>
            )}
          </div>
        )}
        {reading && (
          <div aria-busy="true" role="status">
            <p className="mb-2 text-sm text-gray-700">جارٍ قراءة الملف…</p>
            {[0, 1, 2, 3].map(i => <div key={i} className="mb-2 h-10 animate-pulse rounded-xl bg-gray-100 motion-reduce:animate-none" />)}
          </div>
        )}
        <div className="flex flex-col gap-1">
          <div><button type="button" className="btn btn-lg" disabled={!file || reading} onClick={onRead}>قراءة الملف</button></div>
          {!file && <span className="text-xs text-gray-600">اختر ملفًا أولًا</span>}
        </div>
      </div>
      <aside className="card space-y-3 text-sm">
        <h3 className="font-bold">لا تعرف الشكل المطلوب؟</h3>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn-secondary btn-sm" onClick={() => downloadTemplate('xlsx')}>تنزيل قالب Excel</button>
          <button type="button" className="btn-secondary btn-sm" onClick={() => downloadTemplate('csv')}>تنزيل قالب CSV</button>
        </div>
        <dl className="space-y-1.5">
          {TEMPLATE_HEADERS.map((h, i) => (
            <div key={h}><dt className="font-medium">{h} <bdi dir="ltr" className="font-mono text-xs text-gray-600">{TEMPLATE_SAMPLE[i]}</bdi></dt><dd className="text-xs text-gray-600">{MEANING[i]}</dd></div>
          ))}
        </dl>
        <p className="text-xs text-gray-600">لا يلزم استخدام القالب؛ في الخطوة التالية تربط أعمدة ملفك بنفسك.</p>
      </aside>
    </div>
  )
}
