import './globals.css'
import { Cairo } from 'next/font/google'
import AppShell from '@/components/ui/AppShell'
import { Toaster } from 'sonner'
import AuthGate from '@/components/AuthGate'
import { ADMIN_APP_NAME } from '@/lib/brand'

const cairo = Cairo({
  subsets: ['arabic', 'latin'],
  weight: ['400', '500', '700'],
  display: 'swap',
  variable: '--font-cairo',
})

export const metadata = { title: ADMIN_APP_NAME, description: `${ADMIN_APP_NAME} workspace` }
export const viewport = { width: 'device-width', initialScale: 1 }

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ar" dir="rtl" className={cairo.variable}>
      <body className="bg-surface font-sans text-gray-900">
        <AuthGate>
          <AppShell>{children}</AppShell>
        </AuthGate>
        <Toaster richColors position="top-center" offset={16} toastOptions={{ duration: 4000 }} />
      </body>
    </html>
  )
}
