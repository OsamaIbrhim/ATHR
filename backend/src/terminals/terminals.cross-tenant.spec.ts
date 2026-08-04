import { randomUUID } from 'crypto';
import { createHash } from 'crypto';
import { TerminalsRepository } from './terminals.repository';
import { TerminalsService } from './terminals.service';
import { TENANT_A, TENANT_B, contextFor, fakePrisma } from '../identity/testing/cross-tenant-harness';

/**
 * WP-007 Phase A §A.3.6 — cross-tenant isolation for the `terminals` module.
 *
 * This module issues and verifies the device credential the whole POS
 * protocol rests on, so the cases below target ownership rather than mere
 * query shape.
 */

const TERMINAL_A = randomUUID();
const TERMINAL_B = randomUUID();
const BRANCH_A = randomUUID();
const BRANCH_B = randomUUID();
const DEVICE_A = randomUUID();
const DEVICE_B = randomUUID();

const hash = (value: string) => createHash('sha256').update(value).digest('hex');

function setup() {
  const prisma = fakePrisma({
    branch: [
      { id: BRANCH_A, tenant_id: TENANT_A, code: 'A', name_ar: 'A', name_en: 'A', is_active: true },
      { id: BRANCH_B, tenant_id: TENANT_B, code: 'B', name_ar: 'B', name_en: 'B', is_active: true },
    ],
    posTerminal: [
      {
        id: TERMINAL_A,
        tenant_id: TENANT_A,
        branch_id: BRANCH_A,
        device_id: DEVICE_A,
        terminal_code: 'POS-A',
        name: 'A till',
        is_revoked: false,
        pending_count: 0,
        device_token_hash: hash('token-a'),
        last_seen_at: new Date(),
      },
      {
        id: TERMINAL_B,
        tenant_id: TENANT_B,
        branch_id: BRANCH_B,
        device_id: DEVICE_B,
        terminal_code: 'POS-B',
        name: 'B till',
        is_revoked: false,
        pending_count: 0,
        device_token_hash: hash('token-b'),
        last_seen_at: new Date(),
      },
    ],
    posTerminalEnrollment: [],
  }, {
    posTerminal: { branch: { table: 'branch', localKey: 'branch_id' } },
  });
  const repository = new TerminalsRepository(prisma);
  return { prisma, repository, service: new TerminalsService(prisma, repository) };
}

const ownerOf = (branchId: string, tenantId: string) =>
  ({ sub: randomUUID(), role: 'owner', branch_id: branchId, tenant_id: tenantId, capabilities: [] }) as any;

describe('terminals — cross-tenant isolation', () => {
  it('lists only the calling tenant\'s terminals', async () => {
    const { service } = setup();
    const forA: any = await service.list(contextFor(TENANT_A), ownerOf(BRANCH_A, TENANT_A));
    expect(forA.items.map((t: any) => t.id)).toEqual([TERMINAL_A]);

    const forB: any = await service.list(contextFor(TENANT_B), ownerOf(BRANCH_B, TENANT_B));
    expect(forB.items.map((t: any) => t.id)).toEqual([TERMINAL_B]);
  });

  /**
   * The sharpest finding in this module: the branch lookup accepted any
   * active branch id, so an operator could mint a working enrollment code
   * against another tenant's branch just by passing its id.
   */
  it('refuses to mint an enrollment code against another tenant\'s branch', async () => {
    const { service, prisma } = setup();
    await expect(
      service.createEnrollment(
        contextFor(TENANT_A),
        { branch_id: BRANCH_B } as any,
        ownerOf(BRANCH_A, TENANT_A),
      ),
    ).rejects.toThrow('Active branch not found');
    expect(prisma.posTerminalEnrollment.rows).toHaveLength(0);
  });

  it('stamps a new enrollment with the calling tenant', async () => {
    const { service, prisma } = setup();
    await service.createEnrollment(
      contextFor(TENANT_A),
      { branch_id: BRANCH_A } as any,
      ownerOf(BRANCH_A, TENANT_A),
    );
    expect(prisma.posTerminalEnrollment.rows[0].tenant_id).toBe(TENANT_A);
  });

  /**
   * A terminal enrolled after this deploy must carry a tenant_id, otherwise
   * deviceTenantContext() fails closed on the POS sale path and the till
   * cannot sell at all.
   */
  it('gives a newly enrolled terminal the tenant of its branch', async () => {
    const { service, prisma } = setup();
    const code = 'ENROLLCODE';
    prisma.posTerminalEnrollment.rows.push({
      id: randomUUID(),
      tenant_id: TENANT_B,
      code_hash: hash(code),
      branch_id: BRANCH_B,
      terminal_name: 'New B till',
      created_by: randomUUID(),
      used_at: null,
      expires_at: new Date(Date.now() + 60_000),
      branch: { id: BRANCH_B, tenant_id: TENANT_B, code: 'B', name_ar: 'B', name_en: 'B' },
    });

    const newDevice = randomUUID();
    await service.enroll({ enrollment_code: code, device_id: newDevice, app_version: '1.4.0' } as any);

    const created = prisma.posTerminal.rows.find((t: any) => t.device_id === newDevice);
    expect(created).toBeDefined();
    expect(created.tenant_id).toBe(TENANT_B);
  });

  it('does not resolve another tenant\'s terminal for an operator', async () => {
    const { repository } = setup();
    expect(await repository.findById(contextFor(TENANT_B), TERMINAL_A)).toBeNull();
    expect(await repository.findByDeviceId(contextFor(TENANT_B), DEVICE_A)).toBeNull();
  });

  it('refuses to revoke another tenant\'s terminal', async () => {
    const { service, prisma } = setup();
    await expect(
      service.update(contextFor(TENANT_B), TERMINAL_A, { revoked: true } as any, ownerOf(BRANCH_B, TENANT_B)),
    ).rejects.toThrow('POS terminal not found');
    expect(prisma.posTerminal.rows.find((t: any) => t.id === TERMINAL_A).is_revoked).toBe(false);
  });

  it('refuses to decommission another tenant\'s terminal', async () => {
    const { service, prisma } = setup();
    const manager = {
      sub: randomUUID(),
      role: 'branch_manager',
      branch_id: BRANCH_B,
      tenant_id: TENANT_B,
      capabilities: [],
    } as any;

    await expect(
      service.selfDecommission(
        contextFor(TENANT_B),
        { device_id: DEVICE_A, terminal_code: 'POS-A', pending_count: 0, held_count: 0 } as any,
        'token-a',
        manager,
      ),
    ).rejects.toThrow('This POS terminal must be enrolled before use');
    expect(prisma.posTerminal.rows.find((t: any) => t.id === TERMINAL_A).is_revoked).toBe(false);
  });

  /**
   * An operator in one tenant must not be able to drive a terminal enrolled
   * in another, even holding a valid device token for it.
   */
  it('rejects an operator authenticating another tenant\'s device', async () => {
    const { service } = setup();
    await expect(
      service.authenticate(DEVICE_A, 'token-a', ownerOf(BRANCH_B, TENANT_B)),
    ).rejects.toThrow('registered to another branch');
  });

  it('still authenticates a device against its own tenant', async () => {
    const { service } = setup();
    const terminal = await service.authenticate(DEVICE_A, 'token-a', ownerOf(BRANCH_A, TENANT_A));
    expect(terminal.id).toBe(TERMINAL_A);
    expect(terminal.tenant_id).toBe(TENANT_A);
  });
});
