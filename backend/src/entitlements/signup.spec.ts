import { ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { SignupDto } from './signup.dto';
import { SignupRateLimiter } from './signup-rate-limiter';
import { SignupService } from './signup.service';

async function errorsFor(input: Record<string, unknown>) {
  const errors = await validate(plainToInstance(SignupDto, input), { whitelist: true, forbidNonWhitelisted: true });
  return errors.map((error) => error.property);
}

const valid = {
  tenant_name: 'Bold Fashion',
  owner_name: 'Osama',
  phone: '010 1234 5678',
  password: 'correct horse',
};

describe('SignupDto', () => {
  it('accepts a minimal valid signup, normalising the phone', async () => {
    expect(await errorsFor(valid)).toEqual([]);
    expect(plainToInstance(SignupDto, valid).phone).toBe('01012345678');
  });

  it('accepts optional email and business type', async () => {
    expect(await errorsFor({ ...valid, email: 'a@b.eg', business_type: 'fashion' })).toEqual([]);
  });

  it.each([
    ['tenant_name too short', { tenant_name: 'x' }, 'tenant_name'],
    ['owner_name missing', { owner_name: undefined }, 'owner_name'],
    ['non-Egyptian phone', { phone: '12345' }, 'phone'],
    ['short password', { password: 'short' }, 'password'],
    ['password over bcrypt\'s 72 bytes', { password: 'x'.repeat(73) }, 'password'],
    ['bad email', { email: 'nope' }, 'email'],
    ['business_type not a slug', { business_type: 'Bad Type!' }, 'business_type'],
    ['unknown field (e.g. an attempt to pick the plan)', { plan_code: 'business' }, 'plan_code'],
  ])('rejects %s', async (_name, override, property) => {
    expect(await errorsFor({ ...valid, ...override })).toContain(property);
  });
});

describe('SignupRateLimiter', () => {
  it('allows a few signups per address per hour, then rejects, per address', () => {
    const limiter = new SignupRateLimiter();
    const t0 = 1_000_000;
    for (let i = 0; i < 5; i++) limiter.check('1.1.1.1', t0 + i);
    expect(() => limiter.check('1.1.1.1', t0 + 10)).toThrow(expect.objectContaining({ code: 'SIGNUP_RATE_LIMITED' }));
    expect(() => limiter.check('2.2.2.2', t0 + 10)).not.toThrow();
    // ...and the window slides.
    expect(() => limiter.check('1.1.1.1', t0 + 61 * 60 * 1000)).not.toThrow();
  });
});

describe('SignupService', () => {
  const dto = plainToInstance(SignupDto, { ...valid, business_type: 'fashion' });

  function setup(overrides: { plan?: unknown; failAt?: string } = {}) {
    const created: string[] = [];
    const step = (name: string, result: unknown = { id: `${name}-id` }) =>
      jest.fn(async () => {
        if (overrides.failAt === name) {
          throw new Prisma.PrismaClientKnownRequestError('Unique constraint failed', { code: 'P2002', clientVersion: 'x' });
        }
        created.push(name);
        return result;
      });
    const tx = {
      plan: { findFirst: jest.fn(async () => ('plan' in overrides ? overrides.plan : { id: 'plan-id', code: 'pro' })) },
      tenant: { create: step('tenant') },
      productType: { createMany: step('product_types') },
      unitOfMeasure: { createMany: step('uoms') },
      user: { create: step('user') },
      membership: { create: step('membership') },
      subscription: { create: step('subscription') },
      subscriptionEvent: { create: step('event') },
    };
    // Like a real transaction: whatever the callback did is discarded if it throws.
    const committed: string[] = [];
    const prisma: any = {
      $transaction: jest.fn(async (callback: any) => {
        const result = await callback(tx);
        committed.push(...created);
        return result;
      }),
    };
    const branches = { save: jest.fn(async () => { created.push('branch'); return {}; }) } as any;
    const auth = { login: jest.fn(async () => ({ access_token: 'jwt' })) } as any;
    const service = new SignupService(prisma, branches, auth, new SignupRateLimiter());
    return { service, tx, branches, auth, created, committed };
  }

  it('creates tenant, first branch, owner, membership with tenant-wide scope and a trial subscription in one transaction', async () => {
    const { service, tx, branches, auth, committed } = setup();
    const result = await service.signup(dto, '9.9.9.9');

    expect(committed).toEqual(['tenant', 'product_types', 'uoms', 'branch', 'user', 'membership', 'subscription', 'event']);
    expect(tx.tenant.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        name: 'Bold Fashion',
        organization_profile: { create: { display_name: 'Bold Fashion', business_type: 'fashion' } },
        legal_entities: { create: { legal_name: 'Bold Fashion', is_primary: true } },
      }),
    });
    // The branch goes through the branches repository, inside the same transaction.
    expect(branches.save).toHaveBeenCalledWith({ tenantId: 'tenant-id' }, expect.objectContaining({ code: 'MAIN' }), tx);
    expect(tx.membership.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        role: 'tenant_owner',
        status: 'active',
        access_scope_assignments: { create: { scope_type: 'tenant_wide', grant_source: 'signup' } },
      }),
    });
    const trial = (tx.subscription.create.mock.calls as any)[0][0].data;
    expect(trial).toMatchObject({ status: 'trial', plan_id: 'plan-id' });
    const days = (trial.trial_ends_at.getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(13.9);
    expect(days).toBeLessThan(14.1);
    // The owner is signed in straight away, into the new tenant.
    expect(auth.login).toHaveBeenCalledWith('01012345678', 'correct horse', 'tenant-id');
    expect(result).toMatchObject({ tenant_id: 'tenant-id', access_token: 'jwt' });
  });

  it('never stores the plain password', async () => {
    const { service, tx } = setup();
    await service.signup(dto, '9.9.9.9');
    const stored = (tx.user.create.mock.calls as any)[0][0].data;
    expect(stored.password_hash).toMatch(/^\$2[aby]\$/);
    expect(JSON.stringify(stored)).not.toContain('correct horse');
  });

  it('a duplicate phone/email is a conflict, and nothing is committed or signed in', async () => {
    const { service, committed, auth } = setup({ failAt: 'user' });
    await expect(service.signup(dto, '9.9.9.9')).rejects.toBeInstanceOf(ConflictException);
    expect(committed).toEqual([]);
    expect(auth.login).not.toHaveBeenCalled();
  });

  it('fails cleanly when the trial plan is not configured, creating nothing', async () => {
    const { service, tx, committed } = setup({ plan: null });
    await expect(service.signup(dto, '9.9.9.9')).rejects.toMatchObject({ code: 'INTERNAL_ERROR' });
    expect(tx.tenant.create).not.toHaveBeenCalled();
    expect(committed).toEqual([]);
  });

  it('is rate limited per address before doing any work', async () => {
    const { service, tx } = setup();
    for (let i = 0; i < 5; i++) await service.signup(dto, '3.3.3.3');
    tx.tenant.create.mockClear();
    await expect(service.signup(dto, '3.3.3.3')).rejects.toMatchObject({ code: 'SIGNUP_RATE_LIMITED' });
    expect(tx.tenant.create).not.toHaveBeenCalled();
  });
});
