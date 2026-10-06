'use client'
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { usePathname } from 'next/navigation'
import Sidebar, { Brand, SidebarNav } from './Sidebar'

const FOCUSABLE = 'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])'

/** Below `md`: a 56px top bar with a menu button and a drawer. From `md`: the static sidebar. */
export default function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname()
  const [open, setOpen] = useState(false)
  const menuButton = useRef<HTMLButtonElement>(null)
  const drawer = useRef<HTMLDivElement>(null)
  const close = useCallback(() => {
    setOpen(false)
    menuButton.current?.focus()
  }, [])

  useEffect(() => setOpen(false), [pathname])

  useEffect(() => {
    if (!open) return
    drawer.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus()
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { close(); return }
      if (event.key !== 'Tab' || !drawer.current) return
      const items = [...drawer.current.querySelectorAll<HTMLElement>(FOCUSABLE)]
      if (!items.length) return
      const first = items[0]
      const last = items[items.length - 1]
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, close])

  if (pathname === '/login') return <>{children}</>
  return (
    <div className="md:flex">
      <header className="on-dark sticky top-0 z-30 flex h-14 items-center gap-3 bg-athr px-4 text-white md:hidden">
        <button
          ref={menuButton}
          type="button"
          aria-label="فتح القائمة"
          aria-expanded={open}
          aria-controls="mobile-drawer"
          className="-ms-2 inline-flex h-11 w-11 items-center justify-center rounded-xl hover:bg-white/10"
          onClick={() => setOpen(true)}
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden><path d="M4 7h16M4 12h16M4 17h16" /></svg>
        </button>
        <Brand />
      </header>
      {open && (
        <div className="fixed inset-0 z-40 md:hidden">
          <div className="absolute inset-0 bg-black/50" onClick={close} aria-hidden />
          <div
            ref={drawer}
            id="mobile-drawer"
            role="dialog"
            aria-modal="true"
            aria-label="القائمة"
            className="on-dark absolute inset-y-0 start-0 w-72 max-w-[85vw] overflow-y-auto bg-athr p-4 text-white shadow-xl"
          >
            <div className="mb-4 flex items-center justify-between">
              <Brand />
              <button type="button" aria-label="إغلاق القائمة" className="inline-flex h-11 w-11 items-center justify-center rounded-xl hover:bg-white/10" onClick={close}>
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden><path d="M6 6l12 12M18 6L6 18" /></svg>
              </button>
            </div>
            <SidebarNav onNavigate={() => setOpen(false)} />
          </div>
        </div>
      )}
      <Sidebar />
      <main className="min-w-0 flex-1 p-4 md:p-6">{children}</main>
    </div>
  )
}
