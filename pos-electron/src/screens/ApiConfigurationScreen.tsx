import React, { useState } from 'react'
import { api, ApiError } from '../api'
import { ApiConfiguration } from '../electron'
import { FieldError } from '../components/ui'

export function ApiConfigurationScreen({
  initialValue,
  onConfigured,
}: {
  initialValue?: string
  onConfigured: (value: ApiConfiguration) => void
}) {
  const [apiBaseUrl, setApiBaseUrl] = useState(initialValue || '')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setLoading(true)
    setError('')
    try {
      onConfigured(await api.configureApi(apiBaseUrl))
    } catch (value) {
      setError((value as ApiError).message || (value as Error).message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="auth-shell">
      <section className="auth-card enrollment-card">
        <div className="brand-mark">A</div>
        <span className="eyebrow">إعداد التشغيل</span>
        <h1>ربط ATHR POS بالخادم</h1>
        <p className="muted">
          أدخل عنوان API المعتمد للمنشأة. لن تُحذف بيانات الجهاز أو العمليات
          المحلية عند تغيير عنوان الخادم.
        </p>
        <form onSubmit={submit} className="auth-form">
          <label htmlFor="athr-api-base">عنوان خادم ATHR</label>
          <input
            id="athr-api-base"
            dir="ltr"
            value={apiBaseUrl}
            onChange={(event) => setApiBaseUrl(event.target.value)}
            placeholder="https://api.example.com/api/v1"
            autoComplete="url"
            autoFocus
          />
          <FieldError>{error}</FieldError>
          <button className="button primary large" disabled={loading}>
            {loading ? 'جارٍ التحقق…' : 'حفظ عنوان الخادم'}
          </button>
        </form>
      </section>
    </main>
  )
}
