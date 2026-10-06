import { BRAND_INITIAL, POS_APP_NAME } from '../../electron/brand'
import React, {
  useEffect,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
} from 'react'
import { api, ApiError } from '../api'
import { athr, LocalSale } from '../electron'
import {
  DeviceCredential,
  Invoice,
  InvoiceItem,
  ReturnRecord,
  Session,
  Shift,
  SyncState,
} from '../types'
import { FieldError, Modal } from '../components/ui'
import {
  fromCents,
  lineCents,
  money,
  paymentLabel,
  toCents,
} from '../utils'
import { OPERATIONS_PAGE_SIZE, pageWindow } from '../operations'
import { PAYMENT_METHODS } from '../../electron/payment-methods'
import { InvoiceModal } from './operations/InvoiceModal'
import { ReturnModal } from './operations/ReturnModal'
import { localSalePaysWith, paymentsLabel, type Notify, type ReturnableInvoice } from './operations/shared'
import type { ExchangeStart } from '../exchange'
import {
  addQuantity,
  isValidQuantity,
  milliToQuantity,
  subtractQuantity,
  sumQuantities,
} from '../../electron/quantity'

type OperationsTab = 'sales' | 'returns'

type LocalSaleView = LocalSale & {
  local_invoice_number?: string
  server_invoice_id?: string | null
  server_invoice_number?: string | null
  synced_at?: string | null
  payment_method?: string
  payments_json?: string | null
  customer_phone?: string | null
  attempt_count?: number
  last_attempt_at?: string | null
  last_error?: string | null
  sync_result?: string | null
  warning_codes?: string | string[] | null
  voided_at?: string | null
  void_reason?: string | null
}

function localSyncLabel(status: string) {
  switch (status) {
    case 'pending':
      return 'معلّقة محليًا'
    case 'sending':
      return 'جارٍ الإرسال'
    case 'sent':
      return 'تمت المزامنة'
    case 'sent_with_warning':
      return 'تمت المزامنة مع تنبيه'
    case 'quarantined':
      return 'معزولة بسبب تعارض أو بيانات تالفة'
    default:
      return status || 'محلية'
  }
}

function localSyncBadgeStyle(status: string): React.CSSProperties {
  if (status === 'quarantined') {
    return {
      display: 'inline-flex',
      width: 'fit-content',
      marginTop: 4,
      padding: '3px 8px',
      borderRadius: 20,
      background: '#fee2e2',
      color: '#b42318',
      fontWeight: 800,
    }
  }

  if (status === 'sent_with_warning') {
    return {
      display: 'inline-flex',
      width: 'fit-content',
      marginTop: 4,
      padding: '3px 8px',
      borderRadius: 20,
      background: '#fef3c7',
      color: '#92400e',
      fontWeight: 800,
    }
  }

  if (status === 'sending') {
    return {
      display: 'inline-flex',
      width: 'fit-content',
      marginTop: 4,
      padding: '3px 8px',
      borderRadius: 20,
      background: '#e0f2fe',
      color: '#075985',
      fontWeight: 800,
    }
  }

  return {
    display: 'inline-flex',
    width: 'fit-content',
    marginTop: 4,
    padding: '3px 8px',
    borderRadius: 20,
    background: '#fef3c7',
    color: '#92400e',
    fontWeight: 800,
  }
}

export function SalesScreen({
  session,
  device,
  shift,
  syncState,
  onRegister,
  onSync,
  onCloseShift,
  onLogout,
  onExchange,
  notify,
}: {
  session: Session
  device: DeviceCredential
  shift: Shift
  syncState: SyncState
  onRegister: () => void
  onSync: () => void
  onCloseShift: () => void
  onLogout: () => void
  onExchange: (start: ExchangeStart) => void
  notify: Notify
}) {
  const [query, setQuery] = useState('')
  const [method, setMethod] = useState('')
  const [activeTab, setActiveTab] = useState<OperationsTab>('sales')

  const [serverSales, setServerSales] = useState<Invoice[]>([])
  const [salesPage, setSalesPage] = useState(1)
  const [salesTotal, setSalesTotal] = useState(0)
  const [salesTotalPages, setSalesTotalPages] = useState(1)
  const [salesLoading, setSalesLoading] = useState(true)
  const [salesError, setSalesError] = useState('')

  const [serverReturns, setServerReturns] = useState<ReturnRecord[]>([])
  const [returnsPage, setReturnsPage] = useState(1)
  const [returnsTotal, setReturnsTotal] = useState(0)
  const [returnsTotalPages, setReturnsTotalPages] = useState(1)
  const [returnsLoading, setReturnsLoading] = useState(true)
  const [returnsError, setReturnsError] = useState('')

  const [localSales, setLocalSales] = useState<LocalSaleView[]>([])
  const [selected, setSelected] = useState<Invoice | null>(null)
  const [returnInvoice, setReturnInvoice] =
    useState<ReturnableInvoice | null>(null)

  const loadLocalSales = async () => {
    try {
      setLocalSales(await athr.local_sales())
    } catch {
      setLocalSales([])
    }
  }

  const loadSales = async (page = salesPage) => {
    setSalesLoading(true)
    setSalesError('')

    try {
      const result = await api.listSales({
        branch_id: device.branch_id,
        q: query,
        payment_method: method || undefined,
        page,
        page_size: OPERATIONS_PAGE_SIZE,
      })

      setServerSales(result.items || [])
      setSalesPage(page)
      setSalesTotal(Number(result.total || 0))
      setSalesTotalPages(Math.max(1, Number(result.total_pages || 1)))
    } catch (error) {
      setSalesError(
        error instanceof Error
          ? error.message
          : 'تعذر تحميل الفواتير.',
      )
    } finally {
      setSalesLoading(false)
    }
  }

  const loadReturns = async (page = returnsPage) => {
    setReturnsLoading(true)
    setReturnsError('')

    try {
      const result = await api.listReturns({
        branch_id: device.branch_id,
        q: query,
        page,
        page_size: OPERATIONS_PAGE_SIZE,
      })

      setServerReturns(result.items || [])
      setReturnsPage(page)
      setReturnsTotal(Number(result.total || 0))
      setReturnsTotalPages(Math.max(1, Number(result.total_pages || 1)))
    } catch (error) {
      setReturnsError(
        error instanceof Error
          ? error.message
          : 'تعذر تحميل المرتجعات.',
      )
    } finally {
      setReturnsLoading(false)
    }
  }

  const refreshAll = async (
    requestedSalesPage = salesPage,
    requestedReturnsPage = returnsPage,
  ) => {
    await Promise.allSettled([
      loadSales(requestedSalesPage),
      loadReturns(requestedReturnsPage),
      loadLocalSales(),
    ])
  }

  useEffect(() => {
    void refreshAll(1, 1)
  }, [])

  useEffect(() => {
    void loadLocalSales()
  }, [syncState.sync_status, syncState.pending_count])

  const runSearch = async () => {
    setSalesPage(1)
    setReturnsPage(1)

    await Promise.allSettled([
      loadSales(1),
      loadReturns(1),
      loadLocalSales(),
    ])
  }

  const openInvoiceById = async (id: string) => {
    try {
      setSelected(await api.getSale(id))
    } catch (error) {
      notify(
        error instanceof Error
          ? error.message
          : 'تعذر فتح الفاتورة.',
        'error',
      )
    }
  }

  const openInvoice = async (invoice: Invoice) => {
    await openInvoiceById(invoice.id)
  }

  const beginReturn = async (invoice: Invoice) => {
    try {
      const result = await api.invoiceLookup(invoice.invoice_number)
      // The lookup does not say who bought; the list row does (a refund to the account needs a customer).
      setReturnInvoice({ ...(result as ReturnableInvoice), customer: invoice.customer })
    } catch (error) {
      notify(
        error instanceof Error
          ? error.message
          : 'تعذر تحميل بيانات المرتجع.',
        'error',
      )
    }
  }

  const pendingLocalCount = localSales.filter(
    (sale) => ['pending', 'sending'].includes(sale.sync_status),
  ).length

  const visibleLocalSales = localSales.filter((sale) => {
    if (['sent', 'sent_with_warning'].includes(sale.sync_status)) return false

    const normalizedQuery = query.trim().toLowerCase()
    const invoiceNumber = String(
      sale.server_invoice_number ||
        sale.invoice_number ||
        sale.local_invoice_number ||
        sale.sync_id,
    ).toLowerCase()
    const customerPhone = String(sale.customer_phone || '').toLowerCase()
    const matchesQuery =
      !normalizedQuery ||
      invoiceNumber.includes(normalizedQuery) ||
      customerPhone.includes(normalizedQuery)
    const matchesMethod =
      !method || localSalePaysWith(sale, method)

    return matchesQuery && matchesMethod
  })

  const activeError =
    activeTab === 'sales'
      ? salesError
      : returnsError

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="header-brand">
          <div className="brand-mark small">{BRAND_INITIAL}</div>
          <div>
            <b>{POS_APP_NAME}</b>
            <span>{device.terminal_code}</span>
          </div>
        </div>

        <nav className="main-nav">
          <button onClick={onRegister}>نقطة البيع</button>
          <button className="active">الفواتير والمرتجعات</button>
        </nav>

        <div className="header-status">
          <button
            className={`sync-pill ${syncState.sync_status}`}
            onClick={onSync}
          >
            <span />
            <b>
              {syncState.sync_status === 'success'
                ? 'متصل'
                : syncState.sync_status === 'syncing'
                  ? 'مزامنة…'
                  : syncState.sync_status === 'offline'
                    ? 'غير متصل'
                    : 'تنبيه'}
            </b>
            <small>{syncState.pending_count} معلّق</small>
          </button>

          <div className="cashier-chip">
            <b>{session.user.name}</b>
            <span>
              وردية منذ{' '}
              {new Date(shift.opened_at).toLocaleTimeString('ar-EG', {
                hour: '2-digit',
                minute: '2-digit',
              })}
            </span>
          </div>

          <button
            className="button secondary compact"
            onClick={onLogout}
          >
            تسجيل الخروج
          </button>

          <button
            className="button secondary compact"
            onClick={onCloseShift}
          >
            إغلاق الوردية
          </button>
        </div>
      </header>

      <main className="sales-page">
        <section className="page-heading">
          <div>
            <span className="eyebrow">عمليات الفرع</span>
            <h1>الفواتير والمرتجعات</h1>
          </div>

          <button
            className="button secondary"
            onClick={() => void refreshAll()}
            disabled={salesLoading || returnsLoading}
          >
            تحديث
          </button>
        </section>

        <div className="sales-tabs">
          <button
            type="button"
            className={activeTab === 'sales' ? 'active' : ''}
            onClick={() => setActiveTab('sales')}
          >
            الفواتير
            <span>{salesTotal + pendingLocalCount}</span>
          </button>

          <button
            type="button"
            className={activeTab === 'returns' ? 'active' : ''}
            onClick={() => setActiveTab('returns')}
          >
            المرتجعات
            <span>{returnsTotal}</span>
          </button>
        </div>

        <div
          className={`sales-filters ${
            activeTab === 'returns' ? 'returns' : ''
          }`}
        >
          <input
            value={query}
            onChange={(event: ChangeEvent<HTMLInputElement>) => setQuery(event.target.value)}
            onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                void runSearch()
              }
            }}
            placeholder={
              activeTab === 'sales'
                ? 'رقم الفاتورة أو اسم العميل أو هاتفه'
                : 'رقم المرتجع أو الفاتورة الأصلية أو هاتف العميل'
            }
          />

          {activeTab === 'sales' && (
            <select
              value={method}
              onChange={(event: ChangeEvent<HTMLSelectElement>) => setMethod(event.target.value)}
            >
              <option value="">كل طرق الدفع</option>
              {PAYMENT_METHODS.map((value) => (
                <option key={value} value={value}>{paymentLabel(value)}</option>
              ))}
            </select>
          )}

          <button
            className="button primary"
            onClick={() => void runSearch()}
            disabled={
              activeTab === 'sales'
                ? salesLoading
                : returnsLoading
            }
          >
            بحث
          </button>
        </div>

        <FieldError>{activeError}</FieldError>

        {!!pendingLocalCount && (
          <section className="pending-banner">
            <div>
              <b>عمليات محفوظة محليًا</b>
              <span>
                العمليات الفاشلة تُرسل تلقائيًا إلى مدير الفرع من خلال لوحة الإدارة، فلا تعِد إدخالها.
              </span>
            </div>
            <strong>{pendingLocalCount}</strong>
            <button className="button secondary" onClick={onSync}>
              مزامنة الآن
            </button>
          </section>
        )}

        {activeTab === 'sales' && (
          <section className="data-card">
            <table className="sales-table">
              <thead>
                <tr>
                  <th>رقم الفاتورة</th>
                  <th>الوقت</th>
                  <th>العميل</th>
                  <th>طريقة الدفع</th>
                  <th>الإجمالي</th>
                  <th>الجهاز</th>
                  <th></th>
                </tr>
              </thead>

              <tbody>
                {visibleLocalSales.map((sale) => {
                  const displayNumber =
                    sale.server_invoice_number ||
                    sale.invoice_number ||
                    sale.local_invoice_number ||
                    sale.sync_id

                  return (
                    <tr
                      key={`local-${sale.sync_id}`}
                      style={{ background: '#fffbeb' }}
                    >
                      <td>
                        <b>{displayNumber}</b>
                        <small style={localSyncBadgeStyle(sale.sync_status)}>
                          {localSyncLabel(sale.sync_status)}
                        </small>
                        {!!sale.attempt_count && (
                          <small>
                            عدد المحاولات: {sale.attempt_count}
                          </small>
                        )}
                      </td>

                      <td>
                        {new Date(sale.occurred_at || sale.created_at).toLocaleString('ar-EG')}
                      </td>

                      <td>{sale.customer_phone || 'بدون عميل'}</td>

                      <td>
                        {sale.payment_method
                          ? paymentLabel(sale.payment_method)
                          : '—'}
                      </td>

                      <td>
                        <b>{money(sale.total)} ج</b>
                      </td>

                      <td>{device.terminal_code}</td>

                      <td>
                        <div className="row-actions">
                          {sale.sync_status === 'pending' && (
                            <button type="button" onClick={onSync}>
                              مزامنة
                            </button>
                          )}

                          {sale.sync_status === 'sending' && (
                            <small>جارٍ الإرسال…</small>
                          )}

                          {sale.sync_status === 'quarantined' && (
                            <>
                              <small
                                title={sale.last_error || undefined}
                                style={{ color: '#b42318', fontWeight: 800 }}
                              >
                                العملية معزولة ولا تعطل باقي المزامنة
                              </small>
                            </>
                          )}

                          {sale.sync_status === 'sent_with_warning' && (
                            <small
                              title={String(sale.warning_codes || '')}
                              style={{ color: '#92400e', fontWeight: 800 }}
                            >
                              تم تسجيل الفاتورة على Cloud وتحتاج متابعة تشغيلية
                            </small>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })}

                {salesLoading && !visibleLocalSales.length && (
                  <tr>
                    <td colSpan={7}>
                      <div className="table-loading">
                        جارٍ تحميل الفواتير…
                      </div>
                    </td>
                  </tr>
                )}

                {!salesLoading &&
                  serverSales.map((invoice) => (
                    <tr key={invoice.id}>
                      <td>
                        <b>{invoice.invoice_number}</b>
                        <small>{invoice.status}</small>
                        {!!invoice.warning_codes?.length && (
                          <small
                            style={{ color: '#92400e', fontWeight: 800 }}
                            title={invoice.warning_codes.join(', ')}
                          >
                            مسجلة مع {invoice.warning_codes.length} تنبيه تشغيلي
                          </small>
                        )}

                        {!!invoice._count?.original_returns && (
                          <small className="return-badge">
                            {invoice._count.original_returns} مرتجع
                          </small>
                        )}
                      </td>

                      <td>
                        {new Date(invoice.occurred_at || invoice.created_at).toLocaleString(
                          'ar-EG',
                        )}
                      </td>

                      <td>
                        {invoice.customer?.name ||
                          invoice.customer?.phone ||
                          'بدون عميل'}
                      </td>

                      <td>{paymentsLabel(invoice)}</td>

                      <td>
                        <b>{money(invoice.total)} ج</b>
                      </td>

                      <td>
                        {invoice.terminal?.terminal_code || '—'}
                      </td>

                      <td>
                        <div className="row-actions">
                          <button
                            type="button"
                            onClick={() => void openInvoice(invoice)}
                          >
                            تفاصيل
                          </button>

                          <button
                            type="button"
                            onClick={() => void beginReturn(invoice)}
                          >
                            مرتجع
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}

                {!salesLoading &&
                  !serverSales.length &&
                  !visibleLocalSales.length && (
                  <tr>
                    <td colSpan={7}>
                      <div className="empty-state">
                        <b>لا توجد فواتير مطابقة</b>
                        <span>
                          جرّب تغيير البحث أو طريقة الدفع.
                        </span>
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>

            {!salesLoading && salesTotal > 0 && (
              <OperationsPagination
                page={salesPage}
                totalPages={salesTotalPages}
                total={salesTotal}
                onChange={(page) => {
                  setSalesPage(page)
                  void loadSales(page)
                }}
              />
            )}
          </section>
        )}

        {activeTab === 'returns' && (
          <section className="data-card">
            <table className="sales-table">
              <thead>
                <tr>
                  <th>رقم المرتجع</th>
                  <th>الفاتورة الأصلية</th>
                  <th>التاريخ</th>
                  <th>العميل</th>
                  <th>النوع</th>
                  <th>عدد الأصناف</th>
                  <th>المبلغ المسترد</th>
                  <th>السبب</th>
                  <th></th>
                </tr>
              </thead>

              <tbody>
                {returnsLoading && (
                  <tr>
                    <td colSpan={9}>
                      <div className="table-loading">
                        جارٍ تحميل المرتجعات…
                      </div>
                    </td>
                  </tr>
                )}

                {!returnsLoading &&
                  serverReturns.map((record) => (
                    <tr key={record.id}>
                      <td>
                        <b>{record.return_invoice_number}</b>
                        <small>
                          {record.status === 'completed'
                            ? 'مكتمل'
                            : 'ملغي'}
                        </small>
                      </td>

                      <td>
                        <b>
                          {record.original_invoice?.invoice_number ||
                            '—'}
                        </b>
                      </td>

                      <td>
                        {new Date(record.created_at).toLocaleString(
                          'ar-EG',
                        )}
                      </td>

                      <td>
                        {record.original_invoice?.customer?.name ||
                          record.original_invoice?.customer?.phone ||
                          'بدون عميل'}
                      </td>

                      <td>
                        {record.is_partial
                          ? 'مرتجع جزئي'
                          : 'مرتجع كامل'}
                      </td>

                      <td>{record._count?.items || 0}</td>

                      <td>
                        <b>{money(record.refund_total)} ج</b>
                      </td>

                      <td>{record.reason || '—'}</td>

                      <td>
                        <div className="row-actions">
                          <button
                            type="button"
                            onClick={() =>
                              void openInvoiceById(
                                record.original_invoice?.id ||
                                  record.original_invoice_id,
                              )
                            }
                          >
                            عرض الفاتورة
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}

                {!returnsLoading && !serverReturns.length && (
                  <tr>
                    <td colSpan={9}>
                      <div className="empty-state">
                        <b>لا توجد مرتجعات مطابقة</b>
                        <span>جرّب تغيير عبارة البحث.</span>
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>

            {!returnsLoading && returnsTotal > 0 && (
              <OperationsPagination
                page={returnsPage}
                totalPages={returnsTotalPages}
                total={returnsTotal}
                onChange={(page) => {
                  setReturnsPage(page)
                  void loadReturns(page)
                }}
              />
            )}
          </section>
        )}
      </main>

      <InvoiceModal
        invoice={selected}
        onClose={() => setSelected(null)}
        onReturn={(invoice) => {
          setSelected(null)
          void beginReturn(invoice)
        }}
        notify={notify}
      />

      <ReturnModal
        invoice={returnInvoice}
        onClose={() => setReturnInvoice(null)}
        onExchange={(start) => {
          setReturnInvoice(null)
          onExchange(start)
        }}
        onCompleted={async () => {
          setReturnInvoice(null)
          setReturnsPage(1)
          setActiveTab('returns')

          await Promise.allSettled([
            loadSales(salesPage),
            loadReturns(1),
            loadLocalSales(),
          ])
        }}
        notify={notify}
      />
    </div>
  )
}

function OperationsPagination({
  page,
  totalPages,
  total,
  onChange,
}: {
  page: number
  totalPages: number
  total: number
  onChange: (page: number) => void
}) {
  const range = pageWindow(
    page,
    total,
    OPERATIONS_PAGE_SIZE,
  )

  return (
    <footer className="table-pagination">
      <span>
        عرض {range.from}–{range.to} من {total}
      </span>

      <div className="table-pagination-actions">
        <button
          type="button"
          disabled={page <= 1}
          onClick={() => onChange(page - 1)}
        >
          السابق
        </button>

        <strong>
          {page} / {totalPages}
        </strong>

        <button
          type="button"
          disabled={page >= totalPages}
          onClick={() => onChange(page + 1)}
        >
          التالي
        </button>
      </div>
    </footer>
  )
}
