import { Injectable } from '@nestjs/common';
import type { Membership, MembershipRole, MembershipStatus } from '@prisma/client';
import { DomainFailure, Result, fail, ok } from '@athr/domain-core';
import { MembershipFilters, MembershipRepository } from './membership.repository';
import { TenantContext } from './tenant-context.type';

/**
 * BR-MEM-101 lifecycle, verbatim from the Business Rules document (not the
 * WP doc's own paraphrase — the ADR/BR text wins per this WP's pre-flight
 * item 4): `invited → pending_verification → active ⇄ suspended`, with a
 * terminal `deactivated` and a renewable `expired` (fixed-term) state.
 */
const VALID_TRANSITIONS: Readonly<Record<MembershipStatus, readonly MembershipStatus[]>> = {
  invited: ['pending_verification', 'active', 'deactivated'],
  pending_verification: ['active', 'deactivated'],
  active: ['suspended', 'deactivated', 'expired'],
  suspended: ['active', 'deactivated'],
  expired: ['active'],
  deactivated: [],
};

@Injectable()
export class MembershipService {
  constructor(private readonly repository: MembershipRepository) {}

  async findById(context: TenantContext, id: string): Promise<Membership | null> {
    return this.repository.findById(context, id);
  }

  async list(context: TenantContext, filters: MembershipFilters = {}): Promise<Membership[]> {
    return this.repository.list(context, filters);
  }

  async transition(
    context: TenantContext,
    membershipId: string,
    targetStatus: MembershipStatus,
  ): Promise<Result<Membership, DomainFailure>> {
    const membership = await this.repository.findById(context, membershipId);
    if (!membership) {
      return fail({ code: 'MEMBERSHIP_NOT_FOUND', message: `Membership ${membershipId} not found in this Tenant.` });
    }

    const allowedTargets = VALID_TRANSITIONS[membership.status];
    if (!allowedTargets.includes(targetStatus)) {
      return fail({
        code: 'MEMBERSHIP_INVALID_STATE_TRANSITION',
        message: `Membership status transition not allowed: "${membership.status}" -> "${targetStatus}".`,
      });
    }

    const lastOwnerCheck = await this.checkLastOwnerSafeguard(context, membership, targetStatus === 'active' ? membership.role : undefined);
    if (lastOwnerCheck.ok === false) return lastOwnerCheck;

    const updated = await this.repository.updateStatus(context, membershipId, targetStatus);
    return ok(updated);
  }

  suspend(context: TenantContext, membershipId: string) {
    return this.transition(context, membershipId, 'suspended');
  }

  reinstate(context: TenantContext, membershipId: string) {
    return this.transition(context, membershipId, 'active');
  }

  deactivate(context: TenantContext, membershipId: string) {
    return this.transition(context, membershipId, 'deactivated');
  }

  expire(context: TenantContext, membershipId: string) {
    return this.transition(context, membershipId, 'expired');
  }

  /** BR-OWN-100: role changes away from `tenant_owner` are also guarded. */
  async changeRole(
    context: TenantContext,
    membershipId: string,
    newRole: MembershipRole,
  ): Promise<Result<Membership, DomainFailure>> {
    const membership = await this.repository.findById(context, membershipId);
    if (!membership) {
      return fail({ code: 'MEMBERSHIP_NOT_FOUND', message: `Membership ${membershipId} not found in this Tenant.` });
    }

    const lastOwnerCheck = await this.checkLastOwnerSafeguard(context, membership, newRole);
    if (lastOwnerCheck.ok === false) return lastOwnerCheck;

    const updated = await this.repository.updateRole(context, membershipId, newRole);
    return ok(updated);
  }

  /**
   * BR-OWN-100 / ADR-0003 item 4: block any operation (status transition or
   * role change) that would leave the Tenant with zero active Owners.
   * `resultingRoleIfStillActive` is the role the Membership will hold if it
   * remains `active` after the operation — `undefined` means the operation
   * moves the Membership away from `active` entirely.
   */
  private async checkLastOwnerSafeguard(
    context: TenantContext,
    membership: Membership,
    resultingRoleIfStillActive: MembershipRole | undefined,
  ): Promise<Result<true, DomainFailure>> {
    const wasActiveOwner = membership.role === 'tenant_owner' && membership.status === 'active';
    const staysActiveOwner = resultingRoleIfStillActive === 'tenant_owner';

    if (!wasActiveOwner || staysActiveOwner) return ok(true);

    const activeOwnerCount = await this.repository.countActiveByRole(context, 'tenant_owner');
    if (activeOwnerCount <= 1) {
      return fail({
        code: 'LAST_OWNER_SAFEGUARD_VIOLATION',
        message: 'This Tenant must retain at least one active Tenant Owner Membership.',
      });
    }
    return ok(true);
  }
}
