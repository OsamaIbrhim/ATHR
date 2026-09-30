import { ForbiddenException } from '@nestjs/common'
import {
  assertBranchAccess,
  canAccessAllBranches,
  primaryBranchId,
  resolveBranchScope,
} from './branch-access'
import { actorFor } from './testing/actors'

describe('branch access from the membership access scope', () => {
  const cashier = actorFor('cashier', { branchId: 'branch-a' })
  const owner = actorFor('tenant_owner', { tenantWide: true })

  it('scopes a cashier list request to the cashier branch', () => {
    expect(resolveBranchScope(cashier)).toBe('branch-a')
    expect(resolveBranchScope(cashier, 'branch-a')).toBe('branch-a')
  })

  it('rejects a cashier request for another branch', () => {
    expect(() => resolveBranchScope(cashier, 'branch-b')).toThrow(ForbiddenException)
    expect(() => assertBranchAccess(cashier, 'branch-b')).toThrow(ForbiddenException)
  })

  it('allows a cashier to read records from the assigned branch', () => {
    expect(() => assertBranchAccess(cashier, 'branch-a')).not.toThrow()
  })

  it('rejects a user with no branch scope at all', () => {
    const unscoped = actorFor('cashier')
    expect(() => resolveBranchScope(unscoped)).toThrow(ForbiddenException)
    expect(primaryBranchId(unscoped)).toBeNull()
  })

  it('lets a tenant-wide scope see every branch or filter to a requested one', () => {
    expect(canAccessAllBranches(owner)).toBe(true)
    expect(resolveBranchScope(owner)).toBeUndefined()
    expect(resolveBranchScope(owner, 'branch-b')).toBe('branch-b')
    expect(() => assertBranchAccess(owner, 'branch-z')).not.toThrow()
  })

  it('allows any branch inside a multi-branch scope and defaults to the first', () => {
    const manager = { ...actorFor('location_manager'), scope_set: [
      { scope_type: 'location' as const, scope_ref_id: 'branch-a' },
      { scope_type: 'location' as const, scope_ref_id: 'branch-b' },
    ] }
    expect(resolveBranchScope(manager)).toBe('branch-a')
    expect(resolveBranchScope(manager, 'branch-b')).toBe('branch-b')
    expect(() => resolveBranchScope(manager, 'branch-c')).toThrow(ForbiddenException)
  })
})
