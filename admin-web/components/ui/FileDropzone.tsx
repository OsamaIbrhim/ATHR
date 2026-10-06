'use client'
import { useRef, useState } from 'react'

/** The whole zone is one button: click, Enter/Space or drop a file. */
export default function FileDropzone({ accept, maxBytes, onFile, error, disabled, hint }: {
  accept: string
  maxBytes: number
  onFile: (file: File) => void
  error?: string
  disabled?: boolean
  hint?: string
}) {
  const input = useRef<HTMLInputElement>(null)
  const [over, setOver] = useState(false)
  const pick = (files: FileList | null) => { const file = files?.[0]; if (file) onFile(file) }
  return (
    <div>
      <button
        type="button"
        disabled={disabled}
        aria-describedby={error ? 'dropzone-error' : undefined}
        data-max-bytes={maxBytes}
        onClick={() => input.current?.click()}
        onDragOver={e => { e.preventDefault(); setOver(true) }}
        onDragLeave={() => setOver(false)}
        onDrop={e => { e.preventDefault(); setOver(false); if (!disabled) pick(e.dataTransfer.files) }}
        className={`flex min-h-40 w-full flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed p-6 text-center ${over ? 'border-gray-900 bg-gray-50' : 'border-gray-300 bg-white'} ${error ? 'border-red-600' : ''}`}
      >
        <span className="font-medium text-gray-900">اسحب ملف Excel أو CSV هنا</span>
        <span className="text-sm text-gray-600">أو</span>
        <span className="btn-secondary pointer-events-none">اختيار ملف</span>
        {hint && <span className="text-xs text-gray-600">{hint}</span>}
      </button>
      <input ref={input} type="file" accept={accept} className="sr-only" tabIndex={-1} aria-hidden onChange={e => { pick(e.target.files); e.target.value = '' }} />
      {error && <p id="dropzone-error" role="alert" className="mt-2 flex items-start gap-1 text-sm text-red-700"><span aria-hidden>⚠</span>{error}</p>}
    </div>
  )
}
