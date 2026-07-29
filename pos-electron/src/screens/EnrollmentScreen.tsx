import React, { useEffect, useState } from 'react'
import { api, ApiError } from '../api'
import { athr } from '../electron'
import { DeviceCredential } from '../types'
import { FieldError } from '../components/ui'

export function EnrollmentScreen({
  onEnrolled,
}: {
  onEnrolled: (device: DeviceCredential) => void,
}) {
  const [code, setCode] = useState('')
  const [apiBaseUrl, setApiBaseUrl] = useState('')
  const [apiLocked, setApiLocked] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    api.apiConfiguration()
      .then((configuration) => {
        setApiBaseUrl(configuration.api_base_url)
        setApiLocked(configuration.locked)
      })
      .catch(() => undefined)
  }, [])

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setError('')

    if (code.trim().length !== 12) {
      setError('رمز التسجيل يجب أن يتكون من 12 حرفًا.')
      return
    }
    if (!apiBaseUrl.trim()) {
      setError('أدخل عنوان خادم ATHR قبل تسجيل الجهاز.')
      return
    }

    setLoading(true)

    try {
      await api.configureApi(apiBaseUrl)
      const terminal = await athr.sync_get_status()
      onEnrolled(await api.enroll(code, terminal))
    } catch (err) {
      const value = err as ApiError
      setError(
        `${value.message}${value.requestId
          ? ` — المرجع: ${value.requestId}`
          : ''
        }`,
      )
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="auth-shell">
      <section className="auth-card enrollment-card">
        <div className="brand-mark">A</div>
        <span className="eyebrow">إعداد الجهاز</span>
        <h1>تسجيل ATHR POS</h1>
        <p className="muted">
          أنشئ رمزًا مؤقتًا من صفحة أجهزة نقاط البيع في لوحة الإدارة، ثم أدخله
          هنا لربط الجهاز بالفرع.
        </p>
        <form onSubmit={submit} className="auth-form">
          <label htmlFor="api-base-url">عنوان خادم ATHR</label>
          <input
            id="api-base-url"
            dir="ltr"
            value={apiBaseUrl}
            disabled={apiLocked}
            onChange={(event) => setApiBaseUrl(event.target.value)}
            placeholder="https://api.example.com/api/v1"
            autoComplete="url"
          />
          <small className="muted">
            يُحفظ على هذا الجهاز ولا يحتوي على كلمة مرور أو مفتاح سري.
          </small>
          <label htmlFor="enrollment-code">رمز تسجيل الجهاز</label>
          <input
            id="enrollment-code"
            className="code-input"
            dir="ltr"
            value={code}
            onChange={(event) =>
              setCode(
                event.target.value
                  .toUpperCase()
                  .replace(/\s/g, '')
                  .slice(0, 12),
              )
            }
            placeholder="XXXXXXXXXXXX"
            autoFocus={Boolean(apiBaseUrl)}
          />
          <FieldError>{error}</FieldError>
          <button className="button primary large" disabled={loading}>
            {loading ? 'جارٍ تسجيل الجهاز…' : 'تسجيل الجهاز'}
          </button>
        </form>
        <div className="auth-note">
          <b>يتطلب إنترنت للمرة الأولى</b>
          <span>بعد التسجيل سيظل الجهاز مرتبطًا بنفس الفرع.</span>
        </div>
      </section>
    </main>
  )
}
