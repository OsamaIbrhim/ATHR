import './globals.css'
import Sidebar from '@/components/ui/Sidebar'
import { Toaster } from 'sonner'
import AuthGate from '@/components/AuthGate'
export const metadata = { title: 'ATHR Operations', description: 'ATHR Operations workspace' }
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ar" dir="rtl">
      <body className="rtl bg-[#f6f6f7] text-gray-900">
        <AuthGate>
          <div className="flex">
            <Sidebar />
            <main className="flex-1 min-w-0 p-4 md:p-6">{children}</main>
          </div>
        </AuthGate>
        <Toaster richColors position="top-center" />
      </body>
    </html>
  )
}
