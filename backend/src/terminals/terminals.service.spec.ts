import { actorFor } from '../auth/testing/actors';
import { ConflictException, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { createHash } from 'crypto';
import { TerminalsService } from './terminals.service';
import { TerminalsRepository } from './terminals.repository';
import { TENANT_A, contextFor } from '../identity/testing/cross-tenant-harness';
import { fullAccess, unlimited } from '../entitlements/testing';

// The per-tenant counter is one real statement (covered against Postgres by
// scripts/verify-document-sequence.cjs); these specs only need a number back.
jest.mock('../common/document-sequence', () => ({
  ...jest.requireActual('../common/document-sequence'),
  nextDocumentValue: jest.fn().mockResolvedValue(1n),
  nextDocumentNumber: jest.fn().mockImplementation((_tx: unknown, _tenant: string, key: string) =>
    Promise.resolve(key === 'terminal' ? 'POS1' : 'R-000001')),
}));

// WP-007 Phase A: TerminalsService delegates to a tenant-scoped repository,
// and the operator-driven methods take a TenantContext. Device-credential
// paths (authenticateDevice/heartbeat) are unchanged: a device proves itself
// before any tenant is known.
const ctx = contextFor(TENANT_A);

describe('TerminalsService', () => {
  const actor = actorFor('cashier', { sub: 'user-1', branchId: 'branch-1' });
  const manager = actorFor('location_manager', { sub: 'manager-1', branchId: 'branch-1' });
  const dto = { device_id: '93de7eb8-4fbe-4f78-8c83-2fefea327ffc', sync_status: 'success', pending_count: 0 };
  const hash = (value: string) => createHash('sha256').update(value).digest('hex');

  it('creates a short-lived enrollment code for the manager branch', async () => {
    const prisma = {
      branch: { findFirst: jest.fn().mockResolvedValue({ id: 'branch-1', code: 'MAIN', name_ar: 'الرئيسي', name_en: 'Main' }) },
      posTerminalEnrollment: { create: jest.fn().mockResolvedValue({}) },
    };
    const result = await new TerminalsService(prisma as any, new TerminalsRepository(prisma as any), fullAccess, unlimited).createEnrollment(ctx, { name: 'Till 1' }, manager);
    expect(result.enrollment_code).toHaveLength(12);
    expect(prisma.posTerminalEnrollment.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ branch_id: 'branch-1', created_by: manager.sub, terminal_name: 'Till 1' }),
    }));
  });

  it('exchanges an enrollment code for a one-time device credential', async () => {
    const enrollment = {
      id: 'enrollment-1', branch_id: 'branch-1', created_by: manager.sub,
      terminal_name: 'Till 1', used_at: null, expires_at: new Date(Date.now() + 60_000),
      branch: { id: 'branch-1', code: 'MAIN' },
    };
    const tx = {
      posTerminalEnrollment: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      posTerminal: { upsert: jest.fn().mockImplementation(({ create }) => Promise.resolve({ id: 'terminal-1', ...create, branch: enrollment.branch })) },
    };
    const prisma = {
      posTerminalEnrollment: { findUnique: jest.fn().mockResolvedValue(enrollment) },
      posTerminal: { findUnique: jest.fn().mockResolvedValue(null) },
      $transaction: jest.fn((callback) => callback(tx)),
    };
    const service = new TerminalsService(prisma as any, new TerminalsRepository(prisma as any), fullAccess, unlimited);
    // The code hash is looked up by the database mock, so any correctly-sized code is sufficient here.
    const result = await service.enroll({ enrollment_code: 'ABCDEF123456', device_id: dto.device_id });
    expect(result.device_token.length).toBeGreaterThan(40);
    expect(tx.posTerminal.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ branch_id: 'branch-1', enrolled_by: manager.sub }),
    }));
  });

  it('gives a new device a per-tenant terminal code and reports a zero sale sequence', async () => {
    const enrollment = {
      id: 'enrollment-1', branch_id: 'branch-1', created_by: manager.sub, tenant_id: 'tenant-1',
      terminal_name: null, used_at: null, expires_at: new Date(Date.now() + 60_000),
      branch: { id: 'branch-1', code: 'MAIN', tenant_id: 'tenant-1' },
    };
    const tx = {
      posTerminalEnrollment: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      posTerminal: { upsert: jest.fn().mockImplementation(({ create }) => Promise.resolve({ id: 't1', ...create, branch: enrollment.branch })) },
    };
    const prisma = {
      posTerminalEnrollment: { findUnique: jest.fn().mockResolvedValue(enrollment) },
      posTerminal: { findUnique: jest.fn().mockResolvedValue(null) },
      $transaction: jest.fn((callback) => callback(tx)),
    };
    const service = new TerminalsService(prisma as any, new TerminalsRepository(prisma as any), fullAccess, unlimited);
    const { terminal } = await service.enroll({ enrollment_code: 'ABCDEF123456', device_id: dto.device_id });
    expect(terminal.terminal_code).toBe('POS1');
    expect(terminal.last_sale_sequence).toBe('0');
  });

  it('keeps the code of a device that enrolls again and tells it the sequence the server holds', async () => {
    const enrollment = {
      id: 'enrollment-2', branch_id: 'branch-1', created_by: manager.sub, tenant_id: 'tenant-1',
      terminal_name: null, used_at: null, expires_at: new Date(Date.now() + 60_000),
      branch: { id: 'branch-1', code: 'MAIN', tenant_id: 'tenant-1' },
    };
    const known = { id: 't1', device_id: dto.device_id, branch_id: 'branch-1', is_revoked: false, terminal_code: 'POS7', name: 'Till', last_sale_sequence: 412n };
    const tx = {
      posTerminalEnrollment: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      posTerminal: { upsert: jest.fn().mockImplementation(({ update }) => Promise.resolve({ ...known, ...update, branch: enrollment.branch })) },
    };
    const prisma = {
      posTerminalEnrollment: { findUnique: jest.fn().mockResolvedValue(enrollment) },
      posTerminal: { findUnique: jest.fn().mockResolvedValue(known) },
      $transaction: jest.fn((callback) => callback(tx)),
    };
    const service = new TerminalsService(prisma as any, new TerminalsRepository(prisma as any), fullAccess, unlimited);
    (require('../common/document-sequence').nextDocumentNumber as jest.Mock).mockClear();
    const { terminal } = await service.enroll({ enrollment_code: 'ABCDEF123456', device_id: dto.device_id });
    // No new number is taken: the existing code (and so the existing invoice numbers) stay valid.
    expect(terminal.terminal_code).toBe('POS7');
    expect(terminal.last_sale_sequence).toBe('412');
    expect(require('../common/document-sequence').nextDocumentNumber).not.toHaveBeenCalledWith(expect.anything(), 'tenant-1', 'terminal');
  });

  it('accepts heartbeats only from an enrolled device in the cashier branch', async () => {
    const token = 'device-secret';
    const existing = { id: 'terminal-1', tenant_id: 'tenant-1', branch_id: 'branch-1', is_revoked: false, device_token_hash: hash(token) };
    const prisma = {
      posTerminal: {
        // Heartbeat authenticates the device first (global `findUnique`, since
        // a device proves itself before any tenant is known), then updates the
        // row it just proved.
        findUnique: jest.fn().mockResolvedValue(existing),
        update: jest.fn().mockImplementation(({ data }) => Promise.resolve({ ...existing, ...data })),
      },
    };
    const result = await new TerminalsService(prisma as any, new TerminalsRepository(prisma as any), fullAccess, unlimited).heartbeat(dto, token, actor);
    expect(prisma.posTerminal.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: existing.id },
      data: expect.objectContaining({ last_sync_status: 'success' }),
    }));
    expect(result.online).toBe(true);
  });

  it('authenticates an enrolled device for delayed sale upload without a JWT actor', async () => {
    const token = 'device-secret';
    const existing = {
      id: 'terminal-1',
      branch_id: 'branch-1',
      is_revoked: false,
      device_token_hash: hash(token),
    };
    const prisma = {
      posTerminal: {
        findUnique: jest.fn().mockResolvedValue(existing),
      },
    };

    await expect(
      new TerminalsService(prisma as any, new TerminalsRepository(prisma as any), fullAccess, unlimited).authenticateDevice(
        dto.device_id,
        token,
      ),
    ).resolves.toBe(existing);
  });

  /**
   * WP-007 Phase C: the POS client self-heals a pre-Phase-C local device
   * record's missing `tenant_id` from the next heartbeat response it already
   * sends periodically (`reconcileDeviceTenantId` in pos-electron). That only
   * works if the heartbeat response actually carries the terminal's
   * tenant_id — this proves the server side of that contract.
   */
  it('includes the terminal\'s tenant_id in the heartbeat response', async () => {
    const token = 'device-secret';
    const existing = {
      id: 'terminal-1',
      branch_id: 'branch-1',
      tenant_id: 'tenant-a',
      is_revoked: false,
      device_token_hash: hash(token),
    };
    const prisma = {
      posTerminal: {
        findUnique: jest.fn().mockResolvedValue(existing),
        update: jest.fn().mockImplementation(({ data }) => Promise.resolve({ ...existing, ...data })),
      },
    };
    const result = await new TerminalsService(prisma as any, new TerminalsRepository(prisma as any), fullAccess, unlimited).heartbeat(
      dto,
      token,
      { ...actor, tenant_id: 'tenant-a' },
    );
    expect(result.terminal.tenant_id).toBe('tenant-a');
  });

  it('rejects an unknown or incorrectly credentialed device', async () => {
    const prisma = { posTerminal: { findUnique: jest.fn().mockResolvedValue(null) } };
    await expect(new TerminalsService(prisma as any, new TerminalsRepository(prisma as any), fullAccess, unlimited).heartbeat(dto, 'wrong', actor)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects a device already registered to another branch', async () => {
    const token = 'device-secret';
    const prisma = { posTerminal: { findUnique: jest.fn().mockResolvedValue({
      id: 'terminal-1', branch_id: 'branch-2', is_revoked: false, device_token_hash: hash(token),
    }) } };
    await expect(new TerminalsService(prisma as any, new TerminalsRepository(prisma as any), fullAccess, unlimited).heartbeat(dto, token, actor)).rejects.toBeInstanceOf(ConflictException);
  });

  it('does not allow a revoked device to come online', async () => {
    const token = 'device-secret';
    const prisma = { posTerminal: { findUnique: jest.fn().mockResolvedValue({
      id: 'terminal-1', branch_id: 'branch-1', is_revoked: true, device_token_hash: hash(token),
    }) } };
    await expect(new TerminalsService(prisma as any, new TerminalsRepository(prisma as any), fullAccess, unlimited).heartbeat(dto, token, actor)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('revokes the current terminal only after manager confirmation and empty local queues', async () => {
    const token = 'device-secret';
    const existing = {
      id: 'terminal-1',
      device_id: dto.device_id,
      terminal_code: 'POS-93DE7EB8',
      branch_id: 'branch-1',
      is_revoked: false,
      device_token_hash: hash(token),
    };
    const prisma = {
      posTerminal: {
        findFirst: jest.fn().mockResolvedValue(existing),
        update: jest.fn().mockImplementation(({ data }) => Promise.resolve({ ...existing, ...data })),
      },
    };

    const result = await new TerminalsService(prisma as any, new TerminalsRepository(prisma as any), fullAccess, unlimited).selfDecommission(ctx, {
      device_id: dto.device_id,
      terminal_code: existing.terminal_code,
      pending_count: 0,
      held_count: 0,
    }, token, manager);

    expect(result.decommissioned).toBe(true);
    expect(prisma.posTerminal.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: existing.id },
      data: expect.objectContaining({
        is_revoked: true,
        device_token_hash: null,
        pending_count: 0,
        last_sync_status: 'decommissioned',
      }),
    }));
  });

  it('refuses terminal decommission while local operations remain unresolved', async () => {
    const token = 'device-secret';
    const existing = {
      id: 'terminal-1',
      device_id: dto.device_id,
      terminal_code: 'POS-93DE7EB8',
      branch_id: 'branch-1',
      is_revoked: false,
      device_token_hash: hash(token),
    };
    const prisma = {
      posTerminal: {
        findFirst: jest.fn().mockResolvedValue(existing),
        update: jest.fn(),
      },
    };

    await expect(new TerminalsService(prisma as any, new TerminalsRepository(prisma as any), fullAccess, unlimited).selfDecommission(ctx, {
      device_id: dto.device_id,
      terminal_code: existing.terminal_code,
      pending_count: 1,
      held_count: 0,
    }, token, manager)).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.posTerminal.update).not.toHaveBeenCalled();
  });

  it('derives online state from the heartbeat time instead of persisting a stale boolean', async () => {
    const prisma = { posTerminal: { findMany: jest.fn().mockResolvedValue([
      { id: 'online', is_revoked: false, last_seen_at: new Date(Date.now() - 1000) },
      { id: 'offline', is_revoked: false, last_seen_at: new Date(Date.now() - 120000) },
    ]) } };
    const result = await new TerminalsService(prisma as any, new TerminalsRepository(prisma as any), fullAccess, unlimited).list(ctx, actorFor('tenant_owner', { tenantWide: true }));
    expect(result.items.map((item:any) => [item.id, item.online])).toEqual([['online', true], ['offline', false]]);
  });
});
