import { Injectable } from '@nestjs/common';
import { createHash, randomBytes } from 'crypto';
import type { AccessScopeType, Invitation, Membership, MembershipRole } from '@prisma/client';
import { DomainFailure, Result, fail, ok } from '@athr/domain-core';
import { AccessScopeService } from './access-scope.service';
import { InvitationFilters, InvitationRepository } from './invitation.repository';
import { MembershipRepository } from './membership.repository';
import { TenantContext, TenantScope } from './tenant-context.type';

const DEFAULT_INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export interface CreateInvitationInput {
  readonly email: string;
  readonly role: MembershipRole;
  readonly scopeType: AccessScopeType | null | undefined;
  readonly scopeRefId: string | null | undefined;
  readonly purpose?: string;
  readonly invitedById?: string;
  readonly expiresInMs?: number;
}

export interface AcceptInvitationInput {
  readonly token: string;
  readonly acceptingIdentityId: string;
}

export interface CreatedInvitation {
  readonly invitation: Invitation;
  /** Raw single-use token (BR-INVIT-101) — returned once, only the hash is stored. */
  readonly token: string;
}

/**
 * Membership lifecycle per BR-INVIT-*: create → accept → active Membership,
 * plus expire/revoke. Every mutation here is idempotent per BR-TERR-101 /
 * BR-INVIT-102 — re-sending or re-expiring never creates a duplicate row.
 */
@Injectable()
export class InvitationService {
  constructor(
    private readonly repository: InvitationRepository,
    private readonly membershipRepository: MembershipRepository,
    private readonly accessScope: AccessScopeService,
  ) {}

  async findById(context: TenantContext, id: string): Promise<Invitation | null> {
    return this.repository.findById(context, id);
  }

  async list(context: TenantContext, filters: InvitationFilters = {}): Promise<Invitation[]> {
    return this.repository.list(context, filters);
  }

  async create(
    context: TenantContext,
    input: CreateInvitationInput,
  ): Promise<Result<CreatedInvitation, DomainFailure>> {
    if (!input.scopeType) {
      return fail({
        code: 'ACCESS_SCOPE_REQUIRED',
        message: 'An explicit scope_type is required — an absent/empty scope is never implicitly tenant-wide.',
      });
    }
    if (input.scopeType !== 'tenant_wide' && !input.scopeRefId) {
      return fail({
        code: 'ACCESS_SCOPE_REFERENCE_REQUIRED',
        message: `scope_ref_id is required for scope_type "${input.scopeType}".`,
      });
    }

    // BR-INVIT-102/103: re-inviting the same email revokes the stale pending
    // invitation (whatever roles/scopes it carried) and issues a fresh one —
    // the accepting identity only ever sees the version current at accept
    // time, and no duplicate pending invitation is left behind.
    const existingPending = await this.repository.findPendingByEmail(context, input.email);
    if (existingPending) {
      await this.repository.markRevoked(context, existingPending.id);
    }

    const token = randomBytes(32).toString('base64url');
    const tokenHash = this.hashToken(token);
    const expiresAt = new Date(Date.now() + (input.expiresInMs ?? DEFAULT_INVITATION_TTL_MS));

    const invitation = await this.repository.save(context, {
      email: input.email,
      role: input.role,
      scopeType: input.scopeType,
      scopeRefId: input.scopeType === 'tenant_wide' ? null : (input.scopeRefId as string),
      tokenHash,
      invitedById: input.invitedById ?? null,
      purpose: input.purpose ?? null,
      expiresAt,
    });

    return ok({ invitation, token });
  }

  async accept(input: AcceptInvitationInput): Promise<Result<Membership, DomainFailure>> {
    const tokenHash = this.hashToken(input.token);
    const invitation = await this.repository.findByTokenHash(tokenHash);
    if (!invitation) {
      return fail({ code: 'INVITATION_TOKEN_INVALID', message: 'This invitation token is invalid.' });
    }
    if (invitation.status === 'accepted') {
      return fail({ code: 'INVITATION_ALREADY_ACCEPTED', message: 'This invitation has already been accepted.' });
    }
    if (invitation.status === 'revoked') {
      return fail({ code: 'INVITATION_TOKEN_INVALID', message: 'This invitation has been revoked.' });
    }
    if (invitation.status === 'expired' || invitation.expires_at <= new Date()) {
      if (invitation.status !== 'expired') await this.repository.markExpired(invitation.id);
      return fail({ code: 'INVITATION_EXPIRED', message: 'This invitation has expired.' });
    }

    const tenantScope: TenantScope = { tenantId: invitation.tenant_id as TenantContext['tenantId'] };

    // BR-MEM-100: at most one active Membership per (Identity, Tenant) pair.
    const existingMembership = await this.membershipRepository.findByIdentity(tenantScope, input.acceptingIdentityId);
    if (existingMembership && existingMembership.status !== 'deactivated') {
      return fail({
        code: 'MEMBERSHIP_ALREADY_EXISTS',
        message: 'This Identity already has a Membership in this Tenant.',
      });
    }

    const membership = await this.membershipRepository.save(tenantScope, {
      identityId: input.acceptingIdentityId,
      role: invitation.role,
      status: 'active',
    });

    await this.accessScope.assign(tenantScope, {
      membershipId: membership.id,
      scopeType: invitation.scope_type,
      scopeRefId: invitation.scope_ref_id,
      grantSource: 'invitation',
    });

    await this.repository.markAccepted(invitation.id, membership.id);

    return ok(membership);
  }

  /** Idempotent: expiring an already-terminal invitation is a no-op, not an error. */
  async expire(context: TenantContext, id: string): Promise<Result<Invitation, DomainFailure>> {
    const invitation = await this.repository.findById(context, id);
    if (!invitation) {
      return fail({ code: 'INVITATION_NOT_FOUND', message: `Invitation ${id} not found in this Tenant.` });
    }
    if (invitation.status !== 'pending') return ok(invitation);
    return ok(await this.repository.markExpired(id));
  }

  /** Idempotent: revoking an already-terminal invitation is a no-op, not an error. */
  async revoke(context: TenantContext, id: string): Promise<Result<Invitation, DomainFailure>> {
    const invitation = await this.repository.findById(context, id);
    if (!invitation) {
      return fail({ code: 'INVITATION_NOT_FOUND', message: `Invitation ${id} not found in this Tenant.` });
    }
    if (invitation.status !== 'pending') return ok(invitation);
    return ok(await this.repository.markRevoked(context, id));
  }

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }
}
