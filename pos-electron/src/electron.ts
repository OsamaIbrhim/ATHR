import {
  Customer,
  HeldSale,
  OfflineAccountingContext,
  Product,
  Seller,
  SyncState,
} from './types'

export type LocalSale = {
  sync_id: string
  invoice_number: string
  local_invoice_number?: string
  server_invoice_id?: string | null
  server_invoice_number?: string | null
  synced_at?: string | null
  total: number
  created_at: string
  occurred_at?: string
  shift_id?: string | null
  cashier_id?: string | null
  seller_id?: string | null
  offline_session_id?: string | null
  terminal_sequence?: string | null
  sync_status: string
  payment_method?: string
  customer_phone?: string | null
  attempt_count?: number
  last_attempt_at?: string | null
  last_error?: string | null
  sync_result?: string | null
  warning_codes?: string | string[] | null
  voided_at?: string | null
  void_reason?: string | null
}

export type PosDiagnostics = {
  schema_version: number
  generated_at: string
  application: {
    name: string
    version: string
    protocol_version: number
    api_base: string
    packaged: boolean
  }
  runtime: {
    platform: string
    architecture: string
    os_release: string
    electron_version: string | null
    node_version: string
  }
  paths: {
    user_data: string
    database: string
    database_size_bytes: number
  }
  terminal: {
    enrolled: boolean
    device_id?: string | null
    terminal_id?: string | null
    terminal_code?: string | null
    branch_id?: string | null
  }
  sync: {
    status: string
    last_sync_at: string | null
    last_error: string | null
    pending_count: number
  }
  outbox: {
    counts: Record<string, number>
    unresolved: Array<{
      id: string
      type: string
      status: string
      created_at: string | null
      attempt_count: number
      last_attempt_at: string | null
      next_attempt_at: string | null
      terminal_sequence: string | null
      last_error: string | null
      error_details: {
        code: string | null
        http_status: number | null
        request_id: string | null
      }
      updated_at: string | null
      warning_codes?: string | null
    }>
  }
}

export type FactoryResetStatus = {
  manager: boolean
  enrolled: boolean
  in_progress: boolean
  terminal_code: string | null
  pending_count: number
  held_count: number
  sync_status: string
  blockers: string[]
  can_reset: boolean
}

export type AthrBridge = {
  search(query: string): Promise<Product[]>
  stock(variantId: string): Promise<number>
  sellers(): Promise<Seller[]>

  sale(payload: unknown): Promise<{
    sync_id: string
    invoice_number: string
    terminal_sequence: string
    occurred_at: string
    ok: boolean
    replayed?: boolean
  }>

  print(
    invoice: unknown,
    lang: 'ar' | 'en',
  ): Promise<{
    ok: boolean
    printed?: boolean
    reason?: string
  }>

  local_sales(): Promise<LocalSale[]>
  held_sales(): Promise<HeldSale[]>
  hold_sale(payload: {
    items: Array<{
      variant_id: string
      qty: number
    }>
    customer: Customer | null
  }): Promise<HeldSale>
  resume_held_sale(id: string): Promise<HeldSale>
  delete_held_sale(id: string): Promise<{ ok: boolean }>

  sync_get_outbox(): Promise<any[]>
  sync_mark_sending(id: string): Promise<{ ok: boolean }>
  sync_mark_sent(result: {
    id: string
    server_document_id?: string | null
    server_document_number?: string | null
    warning_codes?: string[]
  }): Promise<{ ok: boolean }>
  sync_mark_failed(result: {
    id: string
    error: string
    retryable: boolean
  }): Promise<{ ok: boolean }>
  sync_apply_pull(data: unknown): Promise<{ ok: boolean }>
  sync_get_status(): Promise<SyncState>
  sync_set_status(
    status: Partial<SyncState>,
  ): Promise<{ ok: boolean }>
  diagnostics_get(): Promise<PosDiagnostics>
  diagnostics_copy(rendererState: unknown): Promise<{ ok: boolean; bytes: number }>
  diagnostics_export(rendererState: unknown): Promise<{
    ok: boolean
    canceled: boolean
    filename?: string
  }>

  api_bootstrap(): Promise<IpcEnvelope<any>>
  api_get_config(): Promise<IpcEnvelope<ApiConfiguration>>
  api_set_base_url(value: string): Promise<IpcEnvelope<ApiConfiguration>>
  api_enroll(code: string, terminal: unknown): Promise<IpcEnvelope<any>>
  api_login(phone: string, password: string): Promise<IpcEnvelope<any>>
  api_logout(): Promise<IpcEnvelope<any>>
  api_request(request: {
    path: string
    method?: string
    body?: unknown
  }): Promise<IpcEnvelope<any>>
  api_clear_session(): Promise<IpcEnvelope<any>>
  api_clear_device(): Promise<IpcEnvelope<any>>
  api_factory_reset_status(): Promise<IpcEnvelope<FactoryResetStatus>>
  api_factory_reset(terminalCode: string): Promise<IpcEnvelope<{
    restarting: boolean
  }>>
  api_issue_accounting(shiftId: string): Promise<IpcEnvelope<any>>
  api_clear_accounting(): Promise<IpcEnvelope<any>>
}

export type ApiConfiguration = {
  configured: boolean
  api_base_url: string
  source: 'environment' | 'device' | 'development' | 'none'
  locked: boolean
  error?: string
}

export type IpcEnvelope<T> =
  | { ok: true; data: T }
  | {
      ok: false
      error: {
        message: string
        code: string
        field?: string
        request_id?: string
        status?: number
        retry_after_ms?: number
        details?: string[]
      }
    }

function resolveBridge(): AthrBridge {
  const runtimeWindow = (
    globalThis as typeof globalThis & {
      window?: {
        athr?: AthrBridge
      }
    }
  ).window

  if (!runtimeWindow?.athr) {
    throw new Error(
      'Electron preload bridge is unavailable',
    )
  }

  return runtimeWindow.athr
}

export const athr = new Proxy({} as AthrBridge, {
  get(_target, property: string | symbol) {
    const bridge = resolveBridge()
    const value = Reflect.get(
      bridge as unknown as object,
      property,
    )

    return typeof value === 'function'
      ? value.bind(bridge)
      : value
  },
})
