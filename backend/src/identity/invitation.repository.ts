import { Injectable } from '@nestjs/common';
import type { AccessScopeType, Invitation, InvitationStatus, MembershipRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AthrDomainError } from '../common/http/athr-exception.filter';
import { TenantScope } from './tenant-context.type';

export interface CreateInvitationInput {
  readonly email: string;
  readonly role: MembershipRole;
  readonly scopeType: AccessScopeType;
  readonly scopeRefId: string | null;
  readonly tokenHash: string;
  readonly invitedById: string | null;
  readonly purpose: string | null;
  readonly expiresAt: Date;
}

export interface InvitationFilters {
  readonly status?: InvitationStatus;
}

/** Tenant-scoped per Multi-tenancy Blueprint §29 — every method takes `TenantContext` explicitly. */
@Injectable()
export class InvitationRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findById(context: TenantScope, id: string): Promise<Invitation | null> {
    return this.prisma.invitation.findFirst({ where: { id, tenant_id: context.tenantId } });
  }

  async list(context: TenantScope, filters: InvitationFilters = {}): Promise<Invitation[]> {
    return this.prisma.invitation.findMany({
      where: { tenant_id: context.tenantId, ...(filters.status ? { status: filters.status } : {}) },
      orderBy: { created_at: 'asc' },
    });
  }

  /**
   * Not tenant-scoped by design: an accept-invitation request arrives with
   * only a bearer token — the Tenant is *derived* from the invitation row
   * itself, not asserted by the caller, so this is a token lookup, not a
   * cross-tenant read.
   */
  async findByTokenHash(tokenHash: string): Promise<Invitation | null> {
    return this.prisma.invitation.findUnique({ where: { token_hash: tokenHash } });
  }

  /** BR-INVIT-102: re-inviting an already-invited email reuses the same pending row instead of duplicating it. */
  async findPendingByEmail(context: TenantScope, email: string): Promise<Invitation | null> {
    return this.prisma.invitation.findFirst({
      where: { tenant_id: context.tenantId, email, status: 'pending' },
    });
  }

  async save(context: TenantScope, input: CreateInvitationInput): Promise<Invitation> {
    return this.prisma.invitation.create({
      data: {
        tenant_id: context.tenantId,
        email: input.email,
        role: input.role,
        scope_type: input.scopeType,
        scope_ref_id: input.scopeRefId,
        token_hash: input.tokenHash,
        invited_by_id: input.invitedById,
        purpose: input.purpose,
        expires_at: input.expiresAt,
      },
    });
  }

  async markAccepted(id: string, acceptedMembershipId: string): Promise<Invitation> {
    return this.prisma.invitation.update({
      where: { id },
      data: { status: 'accepted', accepted_at: new Date(), accepted_membership_id: acceptedMembershipId },
    });
  }

  async markExpired(id: string): Promise<Invitation> {
    return this.prisma.invitation.update({ where: { id }, data: { status: 'expired' } });
  }

  async markRevoked(context: TenantScope, id: string): Promise<Invitation> {
    const existing = await this.findById(context, id);
    if (!existing) {
      throw new AthrDomainError('INVITATION_NOT_FOUND', `Invitation ${id} not found in this Tenant.`);
    }
    return this.prisma.invitation.update({ where: { id }, data: { status: 'revoked', revoked_at: new Date() } });
  }
}
