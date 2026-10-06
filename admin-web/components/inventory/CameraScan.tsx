'use client'
import { useEffect, useRef, useState } from 'react'

/**
 * Camera scanning as progressive enhancement: rendered only where the browser has
 * `BarcodeDetector` and a camera (not iPhone Safari). Typing and Bluetooth scanners
 * always work without it.
 */
export function cameraScanSupported(): boolean {
  return typeof window !== 'undefined' && 'BarcodeDetector' in window && !!navigator.mediaDevices?.getUserMedia
}

export default function CameraScan({ onCode, disabled }: { onCode: (code: string) => void; disabled?: boolean }) {
  const [supported, setSupported] = useState(false)
  const [open, setOpen] = useState(false)
  const [error, setError] = useState('')
  const video = useRef<HTMLVideoElement>(null)
  useEffect(() => { setSupported(cameraScanSupported()) }, [])

  useEffect(() => {
    if (!open) return
    let stream: MediaStream | null = null
    let timer: ReturnType<typeof setInterval> | undefined
    let last = ''
    let lastAt = 0
    ;(async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false })
        if (video.current) { video.current.srcObject = stream; await video.current.play() }
        const Detector = (window as any).BarcodeDetector
        const detector = new Detector({ formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'itf'] })
        timer = setInterval(async () => {
          if (!video.current) return
          const found = await detector.detect(video.current).catch(() => [])
          const code = found[0]?.rawValue as string | undefined
          // Same code again within 2 seconds is the same scan.
          if (code && (code !== last || Date.now() - lastAt > 2000)) { last = code; lastAt = Date.now(); navigator.vibrate?.(40); onCode(code) }
        }, 350)
      } catch { setError('تعذر فتح الكاميرا. تأكد من السماح بالوصول إليها.') }
    })()
    return () => { if (timer) clearInterval(timer); stream?.getTracks().forEach(t => t.stop()) }
  }, [open, onCode])

  if (!supported) return null
  return (
    <>
      <button type="button" className="btn-icon h-12 w-12" aria-label="مسح بالكاميرا" disabled={disabled} onClick={() => { setError(''); setOpen(true) }}>
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden><path d="M4 8h3l2-3h6l2 3h3v11H4z" strokeLinejoin="round" /><circle cx="12" cy="13" r="3.5" /></svg>
      </button>
      {open && (
        <div role="dialog" aria-modal="true" aria-label="مسح بالكاميرا" className="fixed inset-0 z-50 flex flex-col bg-black">
          <video ref={video} className="min-h-0 flex-1 object-cover" playsInline muted />
          {error && <p role="alert" className="bg-red-700 p-3 text-center text-white">{error}</p>}
          <button type="button" className="btn-secondary m-4 min-h-14" onClick={() => setOpen(false)}>إغلاق الكاميرا</button>
        </div>
      )}
    </>
  )
}
