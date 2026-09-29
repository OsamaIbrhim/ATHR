import type { ReactNode } from 'react'

export default function EmptyState({ title, hint, action }: { title: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 py-12 text-center">
      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gray-100 text-gray-400" aria-hidden>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
          <path d="M3 7l9-4 9 4-9 4-9-4zM3 7v10l9 4 9-4V7" strokeLinejoin="round" />
        </svg>
      </div>
      <div className="font-medium text-gray-800">{title}</div>
      {hint && <div className="max-w-sm text-sm text-gray-500">{hint}</div>}
      {action}
    </div>
  )
}
