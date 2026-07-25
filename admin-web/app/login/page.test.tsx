import React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import Login from './page'

describe('Login', () => {
  it('blocks a missing phone before sending credentials', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    render(<Login />)

    fireEvent.click(screen.getByRole('button', { name: 'دخول' }))

    expect(screen.getByRole('alert')).toHaveTextContent('أدخل رقم الهاتف المسجل للحساب.')
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('submits credentials only to the same-origin session endpoint', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({
        code: 'INVALID_CREDENTIALS',
        message_ar: 'بيانات الدخول غير صحيحة',
      }), { status: 401, headers: { 'content-type': 'application/json' } }),
    )
    render(<Login />)
    fireEvent.change(screen.getByLabelText('رقم الهاتف'), { target: { value: '01012345678' } })
    fireEvent.change(screen.getByLabelText('كلمة المرور'), { target: { value: 'Password1' } })
    fireEvent.click(screen.getByRole('button', { name: 'دخول' }))

    await screen.findByText('بيانات الدخول غير صحيحة')
    expect(fetchSpy).toHaveBeenCalledWith('/api/session/login', expect.objectContaining({
      method: 'POST',
    }))
    expect(localStorage.getItem('token')).toBeNull()
    expect(localStorage.getItem('refresh_token')).toBeNull()
  })
})
