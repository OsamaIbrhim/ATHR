import React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import Reports from './page'

const { apiGet, apiPost } = vi.hoisted(() => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
}))

vi.mock('@/lib/api', () => ({ apiGet, apiPost }))

describe('Reports delivery', () => {
  beforeEach(() => {
    apiGet.mockImplementation((path: string) => {
      if (path === '/branches') return Promise.resolve([])
      return Promise.resolve({})
    })
  })

  it('shows sent:false as a visible failure rather than success', async () => {
    apiPost.mockResolvedValue({
      email: { sent: false, reason: 'SMTP not configured' },
    })
    render(<Reports />)

    fireEvent.click(screen.getByRole('button', { name: 'Email' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'لم يتم إرسال التقرير عبر البريد الإلكتروني: SMTP not configured',
    )
    expect(screen.queryByText('تم الإرسال ✓')).not.toBeInTheDocument()
  })
})
