import React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import AuthGate from './AuthGate'

const { apiGet, apiLogout, replace, router } = vi.hoisted(() => {
  const replace = vi.fn()
  return {
  apiGet: vi.fn(),
  apiLogout: vi.fn(),
  replace,
  router: { replace },
  }
})

vi.mock('next/navigation', () => ({
  usePathname: () => '/reports',
  useRouter: () => router,
}))

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>()
  return { ...actual, apiGet, apiLogout }
})

describe('AuthGate', () => {
  it('does not render stale protected content during a network failure', async () => {
    const { ApiError } = await import('@/lib/api')
    apiGet.mockRejectedValue(new ApiError({
      code: 'NETWORK_ERROR',
      message_ar: 'offline',
    }))
    render(<AuthGate><div>بيانات مالية محمية</div></AuthGate>)

    expect(await screen.findByText('تعذر التحقق من الجلسة')).toBeInTheDocument()
    expect(screen.queryByText('بيانات مالية محمية')).not.toBeInTheDocument()
    expect(replace).not.toHaveBeenCalled()
  })

  it('allows retrying session validation', async () => {
    const { ApiError } = await import('@/lib/api')
    apiGet
      .mockRejectedValueOnce(new ApiError({ code: 'NETWORK_ERROR', message_ar: 'offline' }))
      .mockResolvedValueOnce({
        id: 'owner-1',
        capabilities: ['reports.read'],
      })
    render(<AuthGate><div>بيانات مالية محمية</div></AuthGate>)
    fireEvent.click(await screen.findByRole('button', { name: 'إعادة المحاولة' }))

    await waitFor(() => expect(screen.getByText('بيانات مالية محمية')).toBeInTheDocument())
  })
})
