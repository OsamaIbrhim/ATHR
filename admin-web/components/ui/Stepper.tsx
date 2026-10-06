export interface StepperStep { key: string; label: string; meta?: string }

/** Read-only progress indicator. Done steps say "تم", the current one is bold and bordered. */
export default function Stepper({ steps, current, ariaLabel = 'مراحل العملية' }: {
  steps: StepperStep[]
  current: number
  ariaLabel?: string
}) {
  return (
    <ol aria-label={ariaLabel} className="flex flex-wrap gap-2 md:flex-nowrap">
      {steps.map((step, index) => {
        const done = index < current
        const active = index === current
        return (
          <li
            key={step.key}
            aria-current={active ? 'step' : undefined}
            className={`flex min-w-0 flex-1 basis-40 items-center gap-2 rounded-xl border px-3 py-2 text-sm ${active ? 'border-gray-900 bg-white font-bold text-gray-900' : done ? 'border-green-200 bg-green-50 text-green-800' : 'border-gray-200 bg-white text-gray-600'}`}
          >
            <span aria-hidden className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs ${done ? 'bg-green-700 text-white' : active ? 'bg-athr text-white' : 'bg-gray-200 text-gray-700'}`}>
              {done ? '✓' : index + 1}
            </span>
            <span className="min-w-0">
              <span className="block truncate">{step.label}{done && <span className="sr-only"> (تم)</span>}</span>
              {step.meta && <span className="block truncate text-xs font-normal">{step.meta}</span>}
            </span>
          </li>
        )
      })}
    </ol>
  )
}
