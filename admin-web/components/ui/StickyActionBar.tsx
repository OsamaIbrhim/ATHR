import type { ReactNode } from 'react'

/** Bottom bar for long forms; keeps the primary action in reach on phones. */
export default function StickyActionBar({ children }: { children: ReactNode }) {
  return (
    <div className="sticky bottom-0 z-20 -mx-4 mt-4 border-t border-gray-200 bg-white px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 md:mx-0 md:rounded-2xl md:border">
      <div className="flex flex-wrap items-center justify-between gap-3">{children}</div>
    </div>
  )
}
