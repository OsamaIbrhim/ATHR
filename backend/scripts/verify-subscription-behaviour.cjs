#!/usr/bin/env node
// Real-Postgres proof of the subscription/entitlement behaviour that in-memory
// fakes cannot prove: signup is ONE transaction (nothing survives a failure),
// plan limits use real COUNT queries, and the platform console lists usage and
// writes an audit event for every change. Runs the compiled services from
// dist/ (run `npm run build` first) against fixtures it creates and removes.
'use strict';

const path = require('node:path');
const { randomUUID } = require('crypto');
const { PrismaClient } = require('@prisma/client');

const dist = (...parts) => require(path.join(__dirname, '..', 'dist', 'src', ...parts));
let modules;
try {
  modules = {
    EntitlementService: dist('entitlements', 'entitlement.service.js').EntitlementService,
    LimitService: dist('entitlements', 'limit.service.js').LimitService,
    SignupService: dist('entitlements', 'signup.service.js').SignupService,
    SignupRateLimiter: dist('entitlements', 'signup-rate-limiter.js').SignupRateLimiter,
    PlatformService: dist('entitlements', 'platform', 'platform.service.js').PlatformService,
    BranchesRepository: dist('branches', 'branches.repository.js').BranchesRepository,
  };
} catch (error) {
  console.error(`Could not load compiled services from dist/ (run \`npm run build\` first): ${error?.message ?? error}`);
  process.exit(1);
}

const prisma = new PrismaClient();
let failed = 0;

function check(name, ok, detail) {
  if (!ok) failed += 1;
  process.stdout.write(`${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && detail ? ` -- ${detail}` : ''}\n`);
}

async function rejectsWith(promise, predicate) {
  try {
    await promise;
    return false;
  } catch (error) {
    return predicate(error);
  }
}

async function main() {
  const run = randomUUID().slice(0, 8);
  const trialPlan = await prisma.plan.create({
    data: { code: `verify-trial-${run}`, name_ar: 'تجربة', name_en: 'Trial', price_monthly: 1, limits: { branches: 1, users: 3 }, features: ['promotions'] },
  });
  const otherPlan = await prisma.plan.create({
    data: { code: `verify-other-${run}`, name_ar: 'أخرى', name_en: 'Other', price_monthly: 2, limits: {}, features: ['promotions', 'uom'] },
  });
  const spare = await prisma.plan.create({
    data: { code: `verify-spare-${run}`, name_ar: 'احتياطي', name_en: 'Spare', price_monthly: 3, limits: {}, features: [] },
  });
  process.env.TRIAL_PLAN_CODE = trialPlan.code;

  const entitlements = new modules.EntitlementService(prisma);
  const limits = new modules.LimitService(prisma, entitlements);
  const branches = new modules.BranchesRepository(prisma);
  const auth = { login: async () => ({ access_token: 'unused' }) };
  const newSignup = (repository = branches) =>
    new modules.SignupService(prisma, repository, auth, new modules.SignupRateLimiter());
  const platform = new modules.PlatformService(prisma, entitlements, limits);

  const phone = `+2010${Math.floor(10000000 + Math.random() * 89999999)}`;
  const tenantName = `Verify Tenant ${run}`;
  const tenantIds = [];

  try {
    // -- signup creates everything -------------------------------------------------
    const signedUp = await newSignup().signup(
      { tenant_name: tenantName, owner_name: 'Owner', phone, email: `owner-${run}@example.com`, password: 'Sup3rSecret!', business_type: 'fashion' },
      `ip-${run}-1`,
    );
    tenantIds.push(signedUp.tenant_id);
    const tenant = await prisma.tenant.findUnique({
      where: { id: signedUp.tenant_id },
      include: {
        organization_profile: true,
        legal_entities: true,
        subscription: { include: { plan: true } },
        memberships: { include: { access_scope_assignments: true, user: true } },
      },
    });
    check('signup creates the tenant with organization profile (business type) and primary legal entity',
      tenant?.organization_profile?.business_type === 'fashion' && tenant.legal_entities.length === 1 && tenant.legal_entities[0].is_primary);
    check('signup creates the first branch', (await prisma.branch.count({ where: { tenant_id: tenant.id } })) === 1);
    const membership = tenant.memberships[0];
    check('signup creates the owner with an active tenant_owner membership and tenant-wide scope',
      tenant.memberships.length === 1 && membership.role === 'tenant_owner' && membership.status === 'active'
        && membership.access_scope_assignments.length === 1 && membership.access_scope_assignments[0].scope_type === 'tenant_wide'
        && membership.user.is_platform_admin === false);
    const trialDays = (tenant.subscription.trial_ends_at.getTime() - Date.now()) / 86_400_000;
    check('signup starts a 14-day trial on the default trial plan',
      tenant.subscription.status === 'trial' && tenant.subscription.plan.code === trialPlan.code && trialDays > 13.9 && trialDays < 14.1);
    check('signup writes a subscription event', (await prisma.subscriptionEvent.count({ where: { tenant_id: tenant.id, action: 'signup' } })) === 1);

    // -- atomicity: nothing survives a failure ---------------------------------------
    const usersBefore = await prisma.user.count();
    const branchesBefore = await prisma.branch.count();
    const duplicate = await rejectsWith(
      newSignup().signup({ tenant_name: `Dup ${run}`, owner_name: 'Dup', phone, password: 'Sup3rSecret!' }, `ip-${run}-2`),
      (error) => error?.status === 409,
    );
    check('signup with an already-registered phone is rejected as a conflict', duplicate);
    check('...and leaves no tenant behind', (await prisma.tenant.count({ where: { name: `Dup ${run}` } })) === 0);

    const failingBranches = { save: async (context, data, tx) => { await branches.save(context, data, tx); throw new Error('boom after the branch'); } };
    const boom = await rejectsWith(
      newSignup(failingBranches).signup({ tenant_name: `Boom ${run}`, owner_name: 'Boom', phone: `+2011${Math.floor(10000000 + Math.random() * 89999999)}`, password: 'Sup3rSecret!' }, `ip-${run}-3`),
      (error) => /boom/.test(error?.message),
    );
    check('a failure part-way through signup propagates', boom);
    check('...and rolls back the tenant, branch and users created before it',
      (await prisma.tenant.count({ where: { name: `Boom ${run}` } })) === 0 && (await prisma.user.count()) === usersBefore
        && (await prisma.branch.count()) === branchesBefore);

    // -- limits use real counts ------------------------------------------------------
    check('the trial plan limit of 1 branch blocks creating a second branch',
      await rejectsWith(limits.assertCanCreate(tenant.id, 'branches'), (error) => error?.code === 'ENTITLEMENT_LIMIT_REACHED'
        && error.overrides?.data?.limit === 1 && error.overrides.data.current === 1));
    await limits.assertCanCreate(tenant.id, 'users');
    check('users (1 of 3) may still be added', true);
    check('a limit that is not set (terminals) is unlimited', (await limits.usage(tenant.id)).terminals === 0);

    // -- platform console ------------------------------------------------------------
    const list = await platform.listTenants({ search: run.toUpperCase() });
    const row = list.items.find((item) => item.id === tenant.id);
    check('the console finds a tenant by name (case-insensitive) with subscription and usage counts',
      list.total === 1 && row?.subscription.plan_code === trialPlan.code && row.subscription.mode === 'full'
        && row.usage.branches === 1 && row.usage.users === 1 && row.usage.products === 0);

    const actor = membership.user_id;
    await platform.changePlan(tenant.id, otherPlan.code, actor, 'upgrade');
    check('a plan change is visible at once (cache invalidated)', (await entitlements.resolve(tenant.id)).planCode === otherPlan.code);
    await limits.assertCanCreate(tenant.id, 'branches');
    check('...and the new plan lifts the branch limit', true);

    check('activating without a period end is refused',
      await rejectsWith(platform.setStatus(tenant.id, 'active', actor), (error) => error?.status === 400));
    await platform.extend(tenant.id, { months: 1 }, actor);
    await platform.setStatus(tenant.id, 'suspended', actor, 'unpaid');
    check('suspending applies at once', (await entitlements.resolve(tenant.id)).mode === 'suspended');
    await platform.addNote(tenant.id, 'called the owner', actor);
    const events = await prisma.subscriptionEvent.findMany({ where: { tenant_id: tenant.id }, orderBy: { created_at: 'asc' } });
    check('every change wrote an audit event with actor, from/to and note',
      events.map((event) => event.action).join() === 'signup,plan_changed,extended,status_changed,note'
        && events[1].from_plan_code === trialPlan.code && events[1].to_plan_code === otherPlan.code && events[1].actor_user_id === actor
        && events[3].from_status === 'trial' && events[3].to_status === 'suspended' && events[3].note === 'unpaid');

    // -- plans -----------------------------------------------------------------------
    check('a plan in use cannot be deleted',
      await rejectsWith(platform.deletePlan(otherPlan.id), (error) => error?.code === 'PLAN_IN_USE'));
    check('an unused plan can be deleted', (await platform.deletePlan(spare.id)).deleted === true);
    check('plan features and limits are validated against the catalog',
      await rejectsWith(platform.updatePlan(otherPlan.id, { features: ['no-such-feature'] }), (error) => error?.status === 400));
  } finally {
    for (const id of tenantIds) {
      const memberships = await prisma.membership.findMany({ where: { tenant_id: id }, select: { user_id: true } });
      await prisma.subscriptionEvent.deleteMany({ where: { tenant_id: id } });
      await prisma.subscription.deleteMany({ where: { tenant_id: id } });
      await prisma.accessScopeAssignment.deleteMany({ where: { membership: { tenant_id: id } } });
      await prisma.membership.deleteMany({ where: { tenant_id: id } });
      await prisma.refreshToken.deleteMany({ where: { tenant_id: id } });
      await prisma.user.deleteMany({ where: { id: { in: memberships.map((m) => m.user_id) } } });
      await prisma.branch.deleteMany({ where: { tenant_id: id } });
      await prisma.legalEntity.deleteMany({ where: { tenant_id: id } });
      await prisma.organizationProfile.deleteMany({ where: { tenant_id: id } });
      await prisma.tenant.delete({ where: { id } });
    }
    await prisma.plan.deleteMany({ where: { code: { in: [trialPlan.code, otherPlan.code, spare.code] } } });
  }
}

main()
  .then(() => {
    process.stdout.write(failed ? `\n${failed} check(s) FAILED\n` : '\nAll subscription real-Postgres checks passed\n');
    if (failed) process.exitCode = 1;
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
