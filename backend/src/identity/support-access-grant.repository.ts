import { Injectable } from '@nestjs/common';
import type { SupportAccessGrant, SupportAccessMode } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AthrDomainError } from '../common/http/athr-exception.filter';
import { TenantScope } from './tenant-context.type';

export interface CreateSupportAccessGrantInput {
  readonly operatorIdentityId: string;
  readonly mode: SupportAccessMode;
  readonly purpose: string;
  readonly scopes: readonly string[];
  readonly reason: string;
  readonly expiresAt: Date;
  readonly readOnly: boolean;
  readonly approvedByIdentityId: string | null;
  readonly consentObtained: boolean;
}

/** Tenant-scoped per Multi-tenancy Blueprint §29 — every method takes `TenantScope` explicitly. */
@Injectable()
export class SupportAccessGrantRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findById(context: TenantScope, id: string): Promise<SupportAccessGrant | null> {
    return this.prisma.supportAccessGrant.findFirst({ where: { id, tenant_id: context.tenantId } });
  }

  async list(context: TenantScope): Promise<SupportAccessGrant[]> {
    return this.prisma.supportAccessGrant.findMany({
      where: { tenant_id: context.tenantId },
      orderBy: { created_at: 'asc' },
    });
  }

  async save(context: TenantScope, input: CreateSupportAccessGrantInput): Promise<SupportAccessGrant> {
    return this.prisma.supportAccessGrant.create({
      data: {
        tenant_id: context.tenantId,
        operator_identity_id: input.operatorIdentityId,
        mode: input.mode,
        purpose: input.purpose,
        scopes: input.scopes,
        reason: input.reason,
        expires_at: input.expiresAt,
        read_only: input.readOnly,
        approved_by_identity_id: input.approvedByIdentityId,
        consent_obtained: input.consentObtained,
      },
    });
  }

  /** BR-SUPA-104: revocation is immediate and cascades to sessions issued under the grant. */
  async revoke(context: TenantScope, id: string, reason: string | null): Promise<SupportAccessGrant> {
    const existing = await this.findById(context, id);
    if (!existing) {
      throw new AthrDomainError('SUPPORT_ACCESS_GRANT_NOT_FOUND', `Support Access grant ${id} not found in this Tenant.`);
    }
    return this.prisma.supportAccessGrant.update({
      where: { id },
      data: { revoked_at: new Date(), revoked_reason: reason },
    });
  }
}
