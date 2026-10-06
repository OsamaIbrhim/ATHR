'use client'
import { useEffect, useState } from 'react'

/** True from the `md` breakpoint up. Used where only one of the table/cards layouts may exist (inputs with refs). */
export function useIsDesktop(): boolean {
  const [desktop, setDesktop] = useState(true)
  useEffect(() => {
    const query = window.matchMedia('(min-width: 768px)')
    const update = () => setDesktop(query.matches)
    update()
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [])
  return desktop
}
