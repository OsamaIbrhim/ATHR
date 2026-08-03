import { SupportAccessGrantService } from './support-access-grant.service';
import { TenantScope } from './tenant-context.type';

const context = { tenantId: 'tenant-1' } as unknown as TenantScope;

function fakeRepository(rows: Record<string, any> = {}) {
  return {
    findById: jest.fn(async (_ctx: any, id: string) => rows[id] ?? null),
    list: jest.fn(async () => Object.values(rows)),
    save: jest.fn(async (_ctx: any, input: any) => {
      const id = `grant-${Object.keys(rows).length + 1}`;
      const row = { id, tenant_id: 'tenant-1', revoked_at: null, starts_at: new Date(), ...input };
      rows[id] = row;
      return row;
    }),
    revoke: jest.fn(async (_ctx: any, id: string, reason: string | null) => {
      rows[id] = { ...rows[id], revoked_at: new Date(), revoked_reason: reason };
      return rows[id];
    }),
  } as any;
}

const future = new Date(Date.now() + 60 * 60 * 1000);
const past = new Date(Date.now() - 60 * 1000);

describe('SupportAccessGrantService.create — BR-SUPA-100/101 (time-boxed, consent by default)', () => {
  it('rejects a grant created already expired', async () => {
    const service = new SupportAccessGrantService(fakeRepository());
    const result = await service.create(context, {
      operatorIdentityId: 'op-1',
      mode: 'metadata_only',
      purpose: 'health check',
      scopes: [],
      reason: 'routine',
      expiresAt: past,
    });
    expect(result.ok).toBe(false);
    if (result.ok === false) expect(result.failure.code).toBe('SUPPORT_ACCESS_GRANT_EXPIRED');
  });

  it('allows metadata_only without consent', async () => {
    const service = new SupportAccessGrantService(fakeRepository());
    const result = await service.create(context, {
      operatorIdentityId: 'op-1',
      mode: 'metadata_only',
      purpose: 'health check',
      scopes: [],
      reason: 'routine',
      expiresAt: future,
    });
    expect(result.ok).toBe(true);
  });

  it('rejects read_only_diagnostic without consent_obtained', async () => {
    const service = new SupportAccessGrantService(fakeRepository());
    const result = await service.create(context, {
      operatorIdentityId: 'op-1',
      mode: 'read_only_diagnostic',
      purpose: 'investigate ticket',
      scopes: ['tenant_wide'],
      reason: 'customer ticket #123',
      expiresAt: future,
      consentObtained: false,
    });
    expect(result.ok).toBe(false);
    if (result.ok === false) expect(result.failure.code).toBe('SUPPORT_ACCESS_CONSENT_REQUIRED');
  });

  it('allows read_only_diagnostic with consent_obtained', async () => {
    const service = new SupportAccessGrantService(fakeRepository());
    const result = await service.create(context, {
      operatorIdentityId: 'op-1',
      mode: 'read_only_diagnostic',
      purpose: 'investigate ticket',
      scopes: ['tenant_wide'],
      reason: 'customer ticket #123',
      expiresAt: future,
      consentObtained: true,
    });
    expect(result.ok).toBe(true);
  });

  it('BR-SUPA-102: allows break_glass without consent (the sole exception)', async () => {
    const service = new SupportAccessGrantService(fakeRepository());
    const result = await service.create(context, {
      operatorIdentityId: 'op-1',
      mode: 'break_glass',
      purpose: 'critical incident #999',
      scopes: ['tenant_wide'],
      reason: 'production outage',
      expiresAt: future,
      consentObtained: false,
    });
    expect(result.ok).toBe(true);
  });
});

describe('SupportAccessGrantService — expiry and revocation', () => {
  it('checkActive succeeds for a currently-active grant', async () => {
    const service = new SupportAccessGrantService(fakeRepository());
    const created = await service.create(context, {
      operatorIdentityId: 'op-1',
      mode: 'metadata_only',
      purpose: 'health check',
      scopes: [],
      reason: 'routine',
      expiresAt: future,
    });
    if (created.ok === false) throw new Error('setup failed');

    const active = await service.checkActive(context, created.value.id);
    expect(active.ok).toBe(true);
  });

  it('checkActive fails once past expires_at', async () => {
    const rows = {
      'grant-1': { id: 'grant-1', starts_at: new Date(Date.now() - 10000), expires_at: past, revoked_at: null },
    };
    const service = new SupportAccessGrantService(fakeRepository(rows));
    const result = await service.checkActive(context, 'grant-1');
    expect(result.ok).toBe(false);
    if (result.ok === false) expect(result.failure.code).toBe('SUPPORT_ACCESS_GRANT_EXPIRED');
  });

  it('checkActive fails immediately after revocation, even before expires_at (BR-SUPA-104)', async () => {
    const service = new SupportAccessGrantService(fakeRepository());
    const created = await service.create(context, {
      operatorIdentityId: 'op-1',
      mode: 'metadata_only',
      purpose: 'health check',
      scopes: [],
      reason: 'routine',
      expiresAt: future,
    });
    if (created.ok === false) throw new Error('setup failed');

    await service.revoke(context, created.value.id, 'no longer needed');
    const result = await service.checkActive(context, created.value.id);
    expect(result.ok).toBe(false);
    if (result.ok === false) expect(result.failure.code).toBe('SUPPORT_ACCESS_GRANT_EXPIRED');
  });

  it('checkActive returns SUPPORT_ACCESS_GRANT_NOT_FOUND for an unknown id', async () => {
    const service = new SupportAccessGrantService(fakeRepository());
    const result = await service.checkActive(context, 'missing');
    expect(result.ok).toBe(false);
    if (result.ok === false) expect(result.failure.code).toBe('SUPPORT_ACCESS_GRANT_NOT_FOUND');
  });
});
