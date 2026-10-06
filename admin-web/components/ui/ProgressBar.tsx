/** Determinate when `value` is given, indeterminate otherwise. */
export default function ProgressBar({ value, max = 100, label, className = '' }: {
  value?: number
  max?: number
  label: string
  className?: string
}) {
  const determinate = value !== undefined
  const percent = determinate ? Math.max(0, Math.min(100, max > 0 ? (value / max) * 100 : 0)) : 0
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={determinate ? value : undefined}
      className={`h-2 w-full overflow-hidden rounded-full bg-gray-200 ${className}`}
    >
      {determinate
        ? <div className="h-full rounded-full bg-athr transition-[width] motion-reduce:transition-none" style={{ width: `${percent}%` }} />
        : <div className="h-full w-1/3 animate-pulse rounded-full bg-athr motion-reduce:animate-none" />}
    </div>
  )
}
