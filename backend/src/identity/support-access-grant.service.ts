import { Injectable } from '@nestjs/common';
import type { SupportAccessGrant, SupportAccessMode } from '@prisma/client';
import { DomainFailure, Result, fail, ok } from '@athr/domain-core';
import { SupportAccessGrantRepository } from './support-access-grant.repository';
import { TenantScope } from './tenant-context.type';

export interface CreateSupportAccessGrantInput {
  readonly operatorIdentityId: string;
  readonly mode: SupportAccessMode;
  readonly purpose: string;
  readonly scopes: readonly string[];
  readonly reason: string;
  readonly expiresAt: Date;
  readonly readOnly?: boolean;
  readonly approvedByIdentityId?: string | null;
  readonly consentObtained?: boolean;
}

/**
 * ADR-0006 / BR-SUPA-*: a minimal grant model — creation, time-boxing, and
 * audit fields only. Never a standing Membership (BR-PLT-100): there is no
 * path here that creates or reuses a Membership row for the operator.
 */
@Injectable()
export class SupportAccessGrantService {
  constructor(private readonly repository: SupportAccessGrantRepository) {}

  async create(
    context: TenantScope,
    input: CreateSupportAccessGrantInput,
  ): Promise<Result<SupportAccessGrant, DomainFailure>> {
    if (input.expiresAt <= new Date()) {
      return fail({
        code: 'SUPPORT_ACCESS_GRANT_EXPIRED',
        message: 'expires_at must be in the future — a grant cannot be created already expired.',
      });
    }

    // BR-SUPA-101/`OD-TEN-008`: customer consent is required by default for
    // any grant beyond metadata-only; break-glass is the sole, higher-audit
    // exception (item is still recorded via `reason`/`auditRequired` on the
    // underlying error code, not skipped silently).
    const consentRequired = input.mode !== 'metadata_only' && input.mode !== 'break_glass';
    if (consentRequired && !input.consentObtained) {
      return fail({
        code: 'SUPPORT_ACCESS_CONSENT_REQUIRED',
        message: `Support Access mode "${input.mode}" requires customer consent before it can be granted.`,
      });
    }

    const grant = await this.repository.save(context, {
      operatorIdentityId: input.operatorIdentityId,
      mode: input.mode,
      purpose: input.purpose,
      scopes: input.scopes,
      reason: input.reason,
      expiresAt: input.expiresAt,
      readOnly: input.readOnly ?? true,
      approvedByIdentityId: input.approvedByIdentityId ?? null,
      consentObtained: input.consentObtained ?? false,
    });
    return ok(grant);
  }

  async list(context: TenantScope): Promise<SupportAccessGrant[]> {
    return this.repository.list(context);
  }

  async findById(context: TenantScope, id: string): Promise<SupportAccessGrant | null> {
    return this.repository.findById(context, id);
  }

  /** BR-SUPA-100/104: a grant is usable only strictly within its window and never after revocation. */
  async checkActive(context: TenantScope, id: string): Promise<Result<SupportAccessGrant, DomainFailure>> {
    const grant = await this.repository.findById(context, id);
    if (!grant) {
      return fail({ code: 'SUPPORT_ACCESS_GRANT_NOT_FOUND', message: `Support Access grant ${id} not found in this Tenant.` });
    }
    const now = new Date();
    if (grant.revoked_at || grant.expires_at <= now || grant.starts_at > now) {
      return fail({ code: 'SUPPORT_ACCESS_GRANT_EXPIRED', message: 'This Support Access grant is not currently active.' });
    }
    return ok(grant);
  }

  async revoke(context: TenantScope, id: string, reason?: string): Promise<SupportAccessGrant> {
    return this.repository.revoke(context, id, reason ?? null);
  }
}
