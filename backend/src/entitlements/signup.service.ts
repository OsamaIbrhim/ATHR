import { ConflictException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { parseTenantId } from '@athr/domain-core';
import { AuthService } from '../auth/auth.service';
import { BranchesRepository } from '../branches/branches.repository';
import { AthrDomainError } from '../common/http/athr-exception.filter';
import { applyPreset, presetKeyFor } from '../catalog/presets';
import { PrismaService } from '../prisma/prisma.service';
import { SignupDto } from './signup.dto';
import { SignupRateLimiter } from './signup-rate-limiter';

const DAY_MS = 24 * 60 * 60 * 1000;

/** The plan a new tenant's free trial runs on, and how long the trial lasts. */
function trialSettings() {
  const days = Number(process.env.TRIAL_DAYS ?? 14);
  return {
    planCode: process.env.TRIAL_PLAN_CODE || 'pro',
    days: Number.isFinite(days) && days > 0 ? days : 14,
  };
}

/**
 * Public self-service signup: everything a new business needs to start
 * working, created in ONE transaction so a failure leaves nothing behind.
 */
@Injectable()
export class SignupService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly branches: BranchesRepository,
    private readonly auth: AuthService,
    private readonly rateLimiter: SignupRateLimiter,
  ) {}

  async signup(dto: SignupDto, clientAddress: string) {
    this.rateLimiter.check(clientAddress);
    const password_hash = await bcrypt.hash(dto.password, 12);
    const trial = trialSettings();

    let tenantId: string;
    try {
      tenantId = await this.prisma.$transaction(async (tx) => {
        const plan = await tx.plan.findFirst({ where: { code: trial.planCode, is_active: true } });
        if (!plan) throw new AthrDomainError('INTERNAL_ERROR', `Trial plan "${trial.planCode}" is not configured.`);

        const tenant = await tx.tenant.create({
          data: {
            name: dto.tenant_name,
            organization_profile: { create: { display_name: dto.tenant_name, business_type: dto.business_type } },
            legal_entities: { create: { legal_name: dto.tenant_name, is_primary: true } },
          },
        });
        // The trade's product types, units and settings, chosen from the business type (unknown = general).
        await applyPreset(tx, tenant.id, presetKeyFor(dto.business_type));
        // The existing branch create path, so it picks up whatever a branch needs (e.g. its warehouse).
        await this.branches.save(
          { tenantId: parseTenantId(tenant.id) },
          { code: 'MAIN', name_ar: 'الفرع الرئيسي', name_en: 'Main Branch' },
          tx,
        );
        const owner = await tx.user.create({
          data: { name: dto.owner_name, phone: dto.phone, email: dto.email, password_hash, is_active: true },
        });
        await tx.membership.create({
          data: {
            tenant_id: tenant.id,
            user_id: owner.id,
            role: 'tenant_owner',
            status: 'active',
            access_scope_assignments: { create: { scope_type: 'tenant_wide', grant_source: 'signup' } },
          },
        });
        const trialEndsAt = new Date(Date.now() + trial.days * DAY_MS);
        await tx.subscription.create({
          data: { tenant_id: tenant.id, plan_id: plan.id, status: 'trial', trial_ends_at: trialEndsAt },
        });
        await tx.subscriptionEvent.create({
          data: {
            tenant_id: tenant.id,
            action: 'signup',
            to_plan_code: plan.code,
            to_status: 'trial',
            to_period_end: trialEndsAt,
            actor_user_id: owner.id,
          },
        });
        return tenant.id;
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('This phone number or email is already registered.');
      }
      throw error;
    }

    // Same session the login endpoint returns, so the new owner lands signed in.
    const session = await this.auth.login(dto.phone, dto.password, tenantId);
    return { tenant_id: tenantId, ...session };
  }
}
