export type FactoryResetFacts = {
  role?: string | null
  terminalCode?: string | null
  pendingCount?: number
  heldCount?: number
  syncStatus?: string | null
  inProgress?: boolean
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

export class FactoryResetPolicyError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'FactoryResetPolicyError'
    this.code = code
  }
}

function count(value: unknown) {
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0
}

export function factoryResetStatus(
  facts: FactoryResetFacts,
): FactoryResetStatus {
  const manager = facts.role === 'branch_manager'
  const terminalCode = String(facts.terminalCode || '').trim().toUpperCase()
  const pendingCount = count(facts.pendingCount)
  const heldCount = count(facts.heldCount)
  const syncStatus = String(facts.syncStatus || 'never')
  const inProgress = facts.inProgress === true
  const blockers: string[] = []

  if (!manager) blockers.push('يتطلب مدير فرع')
  if (!terminalCode) blockers.push('الجهاز غير مسجل')
  if (pendingCount > 0) blockers.push('عمليات مزامنة غير محسومة')
  if (heldCount > 0) blockers.push('فواتير معلقة')
  if (syncStatus === 'syncing') blockers.push('المزامنة قيد التنفيذ')
  if (inProgress) blockers.push('إلغاء التسجيل قيد التنفيذ')

  return {
    manager,
    enrolled: !!terminalCode,
    in_progress: inProgress,
    terminal_code: terminalCode || null,
    pending_count: pendingCount,
    held_count: heldCount,
    sync_status: syncStatus,
    blockers,
    can_reset: blockers.length === 0,
  }
}

export function assertFactoryResetAllowed(
  facts: FactoryResetFacts,
  confirmation: unknown,
) {
  const status = factoryResetStatus(facts)
  if (status.in_progress) {
    throw new FactoryResetPolicyError(
      'FACTORY_RESET_IN_PROGRESS',
      'إلغاء تسجيل الجهاز قيد التنفيذ بالفعل.',
    )
  }
  if (!status.manager) {
    throw new FactoryResetPolicyError(
      'FACTORY_RESET_MANAGER_REQUIRED',
      'يجب تسجيل الدخول بحساب مدير فرع لإلغاء تسجيل الجهاز.',
    )
  }
  if (!status.enrolled) {
    throw new FactoryResetPolicyError(
      'FACTORY_RESET_DEVICE_REQUIRED',
      'هذا الجهاز غير مسجل كنقطة بيع.',
    )
  }
  if (status.pending_count > 0) {
    throw new FactoryResetPolicyError(
      'FACTORY_RESET_PENDING_OPERATIONS',
      'توجد عمليات بيع غير محسومة. أكمل المزامنة قبل إلغاء تسجيل الجهاز.',
    )
  }
  if (status.held_count > 0) {
    throw new FactoryResetPolicyError(
      'FACTORY_RESET_HELD_SALES',
      'توجد فواتير معلقة. استكملها أو احذفها قبل إلغاء تسجيل الجهاز.',
    )
  }
  if (status.sync_status === 'syncing') {
    throw new FactoryResetPolicyError(
      'FACTORY_RESET_SYNC_IN_PROGRESS',
      'انتظر حتى تنتهي المزامنة الحالية ثم حاول مرة أخرى.',
    )
  }

  const entered = String(confirmation || '').trim().toUpperCase()
  if (entered !== status.terminal_code) {
    throw new FactoryResetPolicyError(
      'FACTORY_RESET_CONFIRMATION_MISMATCH',
      'كود الجهاز المكتوب لا يطابق الجهاز الحالي.',
    )
  }
  return status
}
