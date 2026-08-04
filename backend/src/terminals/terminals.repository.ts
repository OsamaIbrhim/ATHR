import { Injectable } from '@nestjs/common';
import type { Prisma, PosTerminal, PosTerminalEnrollment } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AthrDomainError } from '../common/http/athr-exception.filter';
import type { TenantScope } from '../identity/tenant-context.type';

type Db = PrismaService | Prisma.TransactionClient;

/**
 * WP-007 Phase A §A.3.2 — tenant-scoped repository for the `terminals` module.
 *
 * This is the most security-sensitive surface in the phase: it issues and
 * verifies the device credential the whole POS protocol rests on. Three
 * things needed real attention rather than a mechanical predicate:
 *
 * 1. `createEnrollment` looked up the target branch as
 *    `findFirst({ id, is_active })` with no ownership check, so an operator
 *    could mint an enrollment code against *another tenant's* branch simply
 *    by passing its id. `findBranch` scopes that lookup.
 *
 * 2. `PosTerminal.device_id`, `terminal_code` and `device_token_hash` are all
 *    still *globally* unique (tenant-scoped uniqueness is Phase B), so every
 *    `findUnique` on them is a genuine cross-tenant read. The
 *    device-credential path deliberately keeps a global lookup — a device
 *    authenticates itself before any tenant is known, and its own row is
 *    what establishes the tenant — but every *operator*-driven path resolves
 *    the terminal under the caller's tenant instead.
 *
 * 3. Newly enrolled terminals previously received no `tenant_id` at all.
 *    Left alone, a terminal enrolled after this deploy would fail
 *    `deviceTenantContext()` and could not sell. `save` inherits the tenant
 *    from the enrolling branch. Note the boundary: extending the enrollment
 *    *contract* (requiring a tenant in the request, the sync handshake, POS
 *    local state, the re-enrollment migration path) is Phase C — this only
 *    stamps the column WP-005 already added, so Phase A's own scoping holds.
 */
@Injectable()
export class TerminalsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findById(context: TenantScope, id: string): Promise<PosTerminal | null> {
    return this.prisma.posTerminal.findFirst({ where: { id, tenant_id: context.tenantId } });
  }

  async findByDeviceId(context: TenantScope, deviceId: string): Promise<PosTerminal | null> {
    return this.prisma.posTerminal.findFirst({
      where: { device_id: deviceId, tenant_id: context.tenantId },
    });
  }

  /**
   * Deliberately **not** tenant-scoped: a device presents only its id and
   * token, before any session or tenant is known, and the row it resolves to
   * is what establishes the tenant for the rest of the request (see
   * `deviceTenantContext`). Callers must treat the result's `tenant_id` as
   * authoritative rather than trusting anything supplied by the caller.
   */
  async findByDeviceIdForAuthentication(deviceId: string): Promise<PosTerminal | null> {
    return this.prisma.posTerminal.findUnique({ where: { device_id: deviceId } });
  }

  async list(context: TenantScope, branchId?: string) {
    return this.prisma.posTerminal.findMany({
      where: {
        tenant_id: context.tenantId,
        ...(branchId ? { branch_id: branchId } : {}),
      },
      include: { branch: { select: { code: true, name_ar: true, name_en: true } } },
      orderBy: [{ last_seen_at: 'desc' }, { created_at: 'desc' }],
    });
  }

  async findBranch(context: TenantScope, branchId: string) {
    return this.prisma.branch.findFirst({
      where: { id: branchId, tenant_id: context.tenantId, is_active: true },
    });
  }

  async saveEnrollment(
    context: TenantScope,
    data: Omit<Prisma.PosTerminalEnrollmentUncheckedCreateInput, 'tenant_id'>,
  ): Promise<PosTerminalEnrollment> {
    return this.prisma.posTerminalEnrollment.create({
      data: { ...data, tenant_id: context.tenantId },
    });
  }

  /**
   * Enrollment codes are redeemed by a device that has no session yet, so
   * this resolves globally by code hash — the code itself is the secret. The
   * enrollment row's own tenant then scopes everything that follows.
   */
  async findEnrollmentByCodeHash(codeHash: string) {
    return this.prisma.posTerminalEnrollment.findUnique({
      where: { code_hash: codeHash },
      include: { branch: true },
    });
  }

  async update(
    context: TenantScope,
    id: string,
    data: Prisma.PosTerminalUncheckedUpdateInput,
  ): Promise<PosTerminal> {
    await this.assertInTenant(context, id);
    return this.prisma.posTerminal.update({ where: { id }, data });
  }

  /** Post-authentication device self-update; the terminal row is already proven. */
  async updateAuthenticated(
    id: string,
    data: Prisma.PosTerminalUncheckedUpdateInput,
    include?: Prisma.PosTerminalInclude,
  ) {
    return this.prisma.posTerminal.update({ where: { id }, data, ...(include ? { include } : {}) });
  }

  async assertInTenant(context: TenantScope, id: string): Promise<PosTerminal> {
    const terminal = await this.findById(context, id);
    if (!terminal) {
      throw new AthrDomainError('RESOURCE_NOT_FOUND', 'POS terminal not found');
    }
    return terminal;
  }
}
