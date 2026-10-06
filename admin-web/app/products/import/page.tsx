'use client'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useSessionUser } from '@/components/AuthGate'
import CheckStep from '@/components/import/CheckStep'
import MappingStep from '@/components/import/MappingStep'
import RunStep from '@/components/import/RunStep'
import UploadStep from '@/components/import/UploadStep'
import ConfirmDialog from '@/components/ui/ConfirmDialog'
import PageHeader from '@/components/ui/PageHeader'
import { NoPermission } from '@/components/ui/PageStates'
import Stepper from '@/components/ui/Stepper'
import { DuplicateRegistry } from '@/lib/import/chunking'
import { downloadErrorsFile } from '@/lib/import/download'
import { autoMap, emptyMapping, type FieldKey, type Mapping } from '@/lib/import/mapping'
import { firstFilledSheet, looksLikeHeader, MAX_FILE_BYTES, MAX_FILE_ROWS, readTableFile, ReadFileError, type ParsedFile } from '@/lib/import/read-file'
import { buildImportRows, type ImportRow } from '@/lib/import/rows'
import { useImportFlow } from '@/lib/import/use-import-flow'
import { hasPermission } from '@/lib/permissions'
import { useBranches } from '@/lib/use-branches'

const STEPS = [
  { key: 'upload', label: 'رفع الملف' },
  { key: 'map', label: 'ربط الأعمدة' },
  { key: 'check', label: 'فحص الملف' },
  { key: 'run', label: 'الاستيراد والنتيجة' },
]

const READ_ERRORS: Record<string, string> = {
  type: 'هذا النوع غير مدعوم. ارفع ملف xlsx أو csv.',
  size: `الملف أكبر من ${MAX_FILE_BYTES / 1024 / 1024} ميجا. قسّمه إلى ملفين.`,
  corrupt: 'تعذر فتح الملف. احفظه من Excel من جديد بصيغة xlsx وحاول مرة أخرى.',
  empty: 'لم نجد بيانات في الملف. تأكد أن المنتجات تبدأ بعد صف العناوين.',
}

export default function ImportPage() {
  const user = useSessionUser()
  const router = useRouter()
  const { branches } = useBranches(user)
  const [step, setStep] = useState(0)
  const [file, setFile] = useState<File | null>(null)
  const [parsed, setParsed] = useState<ParsedFile | null>(null)
  const [reading, setReading] = useState(false)
  const [readError, setReadError] = useState('')
  const [sheet, setSheet] = useState(0)
  const [hasHeader, setHasHeader] = useState(true)
  const [mapping, setMapping] = useState<Mapping>(emptyMapping())
  const [auto, setAuto] = useState<Mapping>(emptyMapping())
  const [taxMode, setTaxMode] = useState<'inclusive' | 'exclusive'>('inclusive')
  const [branchId, setBranchId] = useState('')
  const [rows, setRows] = useState<ImportRow[]>([])
  const [fileNo, setFileNo] = useState(1)
  const [leaving, setLeaving] = useState(false)
  const registry = useRef(new DuplicateRegistry())
  const checked = useRef(new DuplicateRegistry())
  const flow = useImportFlow(taxMode, mapping.qty !== null ? branchId : undefined)

  useEffect(() => { if (!branchId && branches.length) setBranchId(user?.branch_id && branches.some(b => b.id === user.branch_id) ? user.branch_id : branches[0].id) }, [branches, branchId, user])

  const table = useMemo(() => parsed?.sheets[sheet]?.rows ?? [], [parsed, sheet])
  const first = hasHeader ? 1 : 0
  const headers = hasHeader ? (table[0] ?? []).map(String) : null
  const dataRows = useMemo(() => table.slice(first).filter(r => r.some(c => String(c).trim())), [table, first])
  const busy = step >= 1 && step <= 3 && flow.phase !== 'done'

  useEffect(() => {
    if (!busy) return
    const guard = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', guard)
    return () => window.removeEventListener('beforeunload', guard)
  }, [busy])

  if (!hasPermission(user, 'catalog.product.create')) return <NoPermission />

  const reset = () => {
    flow.reset(); setStep(0); setFile(null); setParsed(null); setReadError(''); setRows([])
  }
  const pick = async (picked: File) => {
    setFile(picked); setParsed(null); setReadError(''); setReading(true)
    try {
      const result = await readTableFile(picked)
      const index = firstFilledSheet(result.sheets)
      setParsed(result); setSheet(index); setHasHeader(looksLikeHeader(result.sheets[index]?.rows[0]))
    } catch (e) {
      setReadError(READ_ERRORS[e instanceof ReadFileError ? e.reason : 'corrupt'])
    } finally { setReading(false) }
  }
  const toMapping = () => {
    if (!dataRows.length) { setReadError(READ_ERRORS.empty); return }
    if (dataRows.length > MAX_FILE_ROWS) { setReadError(`الملف يحتوي ${dataRows.length} صف والحد ${MAX_FILE_ROWS}. قسّمه إلى ملفين أو أكثر.`); return }
    const guess = autoMap(headers, dataRows)
    setAuto(guess); setMapping(guess); setReadError(''); setStep(1)
  }
  const toCheck = () => {
    const built = buildImportRows(table, mapping, first)
    setRows(built); setStep(2)
    checked.current = registry.current.clone()
    void flow.check(built, checked.current, fileNo > 1 ? `الملف ${fileNo}، ` : '')
  }
  const toRun = () => { registry.current = checked.current; setStep(3); void flow.run() }
  const another = () => { setFileNo(n => n + 1); reset() }

  const failed = [...flow.results.filter(r => r.status !== 'ready').map(r => flow.runResults.get(r.row_ref) ?? r), ...[...flow.runResults.values()].filter(r => r.status === 'failed')]
  const failedRows = [...new Map(failed.filter(r => r.status === 'failed').map(r => [r.row_ref, r])).values()].sort((a, b) => a.row_ref - b.row_ref)
  const withoutQty = rows.filter(r => !r.opening_qty && flow.runResults.get(r.row_ref)?.status === 'created').length
  const download = () => downloadErrorsFile(table, hasHeader, [...new Map([...flow.results, ...flow.runResults.values()].map(r => [r.row_ref, r])).values()])
  const setMap = (key: FieldKey, column: number | null) => setMapping(m => ({ ...m, [key]: column }))

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <PageHeader title="استيراد المنتجات من Excel" subtitle="ارفع ملفك، راجع الأخطاء، ثم استورد." />
      {busy
        ? <button type="button" className="btn-link min-h-11 md:min-h-0" onClick={() => setLeaving(true)}>→ المنتجات</button>
        : <Link href="/products" className="btn-link inline-flex min-h-11 items-center md:min-h-0">→ المنتجات</Link>}
      <Stepper steps={STEPS} current={step} />
      {step === 0 && (
        <UploadStep file={file} parsed={parsed} error={readError} reading={reading} hasHeader={hasHeader} sheet={sheet}
          onFile={pick} onRemove={reset} onHeader={setHasHeader} onSheet={setSheet} onRead={toMapping} />
      )}
      {step === 1 && (
        <MappingStep headers={headers} dataRows={dataRows} mapping={mapping} auto={auto} branches={branches} branchId={branchId} taxMode={taxMode}
          onMapping={setMap} onBranch={setBranchId} onTaxMode={setTaxMode} onBack={() => setStep(0)} onNext={toCheck} />
      )}
      {step === 2 && (
        <CheckStep checking={flow.phase === 'checking'} progress={flow.progress} error={flow.checkError} results={flow.results} planLimit={flow.planLimit}
          onImport={toRun} onDownload={download} onReupload={reset} onRetry={toCheck} onBack={() => { flow.reset(); setStep(1) }} />
      )}
      {step === 3 && (
        <RunStep running={flow.phase !== 'done'} progress={flow.progress} tally={flow.tally} startedAt={flow.startedAt} error={flow.runError} stopped={flow.stopped}
          failedRows={failedRows} branchName={branches.find(b => b.id === branchId)?.name ?? ''} withoutQty={withoutQty}
          onStop={flow.stop} onResume={() => void flow.resume()} onFinish={flow.finish} onDownload={download} onAnother={another} />
      )}
      <ConfirmDialog open={leaving} title="تغادر الصفحة؟" confirmLabel="مغادرة" cancelLabel="البقاء" tone="danger"
        onClose={() => setLeaving(false)} onConfirm={() => router.push('/products')}>
        {step === 3 ? 'الاستيراد لم ينتهِ؛ ما استُورد حتى الآن باقٍ ويمكنك إكمال الباقي لاحقًا.' : 'لم يُستورد شيء بعد.'}
      </ConfirmDialog>
    </div>
  )
}
