import React, { useEffect, useMemo, useState } from 'react'
import { bold, PosDiagnostics } from '../electron'
import {
  DeviceCredential,
  Session,
  Shift,
  SyncState,
} from '../types'
import { FieldError, Modal } from './ui'

function display(value: unknown) {
  if (value === null || value === undefined || value === '') return '—'
  if (typeof value === 'boolean') return value ? 'نعم' : 'لا'
  return String(value)
}

function localDate(value: unknown) {
  const timestamp = Date.parse(String(value || ''))
  return Number.isFinite(timestamp)
    ? new Date(timestamp).toLocaleString('ar-EG')
    : '—'
}

export function DiagnosticsConsole({
  device,
  session,
  shift,
  syncState,
}: {
  device: DeviceCredential
  session: Session
  shift: Shift
  syncState: SyncState
}) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [data, setData] = useState<PosDiagnostics | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const rendererState = useMemo(() => ({
    device: {
      device_id: device.device_id,
      terminal_id: device.terminal_id,
      terminal_code: device.terminal_code,
      branch_id: device.branch_id,
    },
    cashier: {
      user_id: session.user.id,
      role: session.user.role,
      branch_id: session.user.branch_id,
    },
    shift: {
      id: shift.id,
      branch_id: shift.branch_id,
      status: shift.status,
      opened_at: shift.opened_at,
    },
    sync: syncState,
  }), [device, session, shift, syncState])

  const load = async () => {
    setLoading(true)
    setError('')
    try {
      setData(await bold.diagnostics_get())
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : 'تعذر تحميل بيانات التشخيص.',
      )
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (open) void load()
  }, [open])

  const copy = async () => {
    setNotice('')
    try {
      await bold.diagnostics_copy(rendererState)
      setNotice('تم نسخ تقرير تشخيص منقح بدون كلمات مرور أو رموز دخول.')
    } catch (caught) {
      setError((caught as Error).message)
    }
  }

  const exportReport = async () => {
    setNotice('')
    try {
      const result = await bold.diagnostics_export(rendererState)
      setNotice(
        result.canceled
          ? 'تم إلغاء التصدير.'
          : `تم حفظ التقرير: ${result.filename || 'diagnostics.json'}`,
      )
    } catch (caught) {
      setError((caught as Error).message)
    }
  }

  const unresolved = data?.outbox.unresolved || []

  return (
    <>
      <button
        type="button"
        className="diagnostics-trigger"
        onClick={() => setOpen(true)}
        title="تشخيص الاتصال والمزامنة"
      >
        تشخيص
      </button>

      <Modal
        open={open}
        title="تشخيص نقطة البيع"
        onClose={() => setOpen(false)}
        width="980px"
      >
        <div className="diagnostics-toolbar">
          <p>
            التقرير لا يحتوي على كلمات مرور أو access tokens أو device tokens.
          </p>
          <div>
            <button className="button secondary" onClick={() => void load()} disabled={loading}>
              {loading ? 'تحديث…' : 'تحديث'}
            </button>
            <button className="button secondary" onClick={() => void copy()} disabled={!data}>
              نسخ التقرير
            </button>
            <button className="button primary" onClick={() => void exportReport()} disabled={!data}>
              تصدير JSON
            </button>
          </div>
        </div>

        <FieldError>{error}</FieldError>
        {notice && <div className="diagnostics-notice">{notice}</div>}

        {data && (
          <div className="diagnostics-content">
            <section className="diagnostics-summary">
              <article><span>إصدار POS</span><b>{data.application.version}</b></article>
              <article><span>إصدار Backend</span><b>{display(syncState.backend_version)}</b></article>
              <article><span>البروتوكول</span><b>{display(syncState.api_protocol || data.application.protocol_version)}</b></article>
              <article><span>عمليات غير محسومة</span><b>{syncState.pending_count}</b></article>
            </section>

            <section className="diagnostics-grid">
              <article>
                <h3>الاتصال والمزامنة</h3>
                <dl>
                  <dt>الحالة</dt><dd>{syncState.sync_status}</dd>
                  <dt>آخر مزامنة</dt><dd>{localDate(syncState.last_sync_at)}</dd>
                  <dt>المحاولة التالية</dt><dd>{localDate(syncState.next_sync_at)}</dd>
                  <dt>سبب الإيقاف</dt><dd>{display(syncState.blocked_reason)}</dd>
                  <dt>آخر خطأ</dt><dd>{display(syncState.last_error)}</dd>
                  <dt>Deployment SHA</dt><dd className="mono">{display(syncState.backend_deployment_sha)}</dd>
                </dl>
              </article>

              <article>
                <h3>الجهاز والتشغيل</h3>
                <dl>
                  <dt>Terminal</dt><dd>{display(data.terminal.terminal_code)}</dd>
                  <dt>Terminal ID</dt><dd className="mono">{display(data.terminal.terminal_id)}</dd>
                  <dt>API</dt><dd className="mono">{data.application.api_base}</dd>
                  <dt>النظام</dt><dd>{data.runtime.platform} / {data.runtime.architecture}</dd>
                  <dt>قاعدة البيانات</dt><dd className="mono">{data.paths.database}</dd>
                  <dt>حجم القاعدة</dt><dd>{data.paths.database_size_bytes.toLocaleString('en-US')} bytes</dd>
                </dl>
              </article>
            </section>

            <section className="diagnostics-outbox">
              <h3>العمليات المحلية غير المحسومة</h3>
              {!unresolved.length ? (
                <p className="muted">لا توجد عمليات معلقة أو فاشلة.</p>
              ) : (
                <table>
                  <thead>
                    <tr>
                      <th>العملية</th>
                      <th>الحالة</th>
                      <th>المحاولات</th>
                      <th>آخر محاولة</th>
                      <th>HTTP / Code / Request</th>
                    </tr>
                  </thead>
                  <tbody>
                    {unresolved.map((item) => (
                      <tr key={item.id}>
                        <td className="mono">{item.id}</td>
                        <td>{item.status}</td>
                        <td>{item.attempt_count}</td>
                        <td>{localDate(item.last_attempt_at)}</td>
                        <td className="mono">
                          {display(item.error_details.http_status)} /{' '}
                          {display(item.error_details.code)} /{' '}
                          {display(item.error_details.request_id)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>
          </div>
        )}
      </Modal>
    </>
  )
}
