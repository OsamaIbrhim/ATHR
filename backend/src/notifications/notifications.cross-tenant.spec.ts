import { NotificationsService } from './notifications.service';
import { TENANT_A, TENANT_B, contextFor } from '../identity/testing/cross-tenant-harness';

/**
 * Report recipients are derived from the calling tenant's active owners, so a
 * report can never be delivered to another tenant's owners or to a global
 * address.
 */
describe('notifications — per-tenant recipients', () => {
  const owners: Record<string, { email: string | null; phone: string | null }[]> = {
    [TENANT_A]: [{ email: 'a-owner@a.test', phone: '+201000000001' }],
    [TENANT_B]: [{ email: 'b-owner@b.test', phone: null }],
  };

  function setup() {
    const prisma = {
      user: {
        findMany: jest.fn(({ where }) => Promise.resolve(owners[where.memberships.some.tenantId] ?? [])),
      },
    };
    const service = new NotificationsService(prisma as any);
    const sendEmail = jest.spyOn(service, 'sendEmail').mockResolvedValue({ sent: true } as any);
    const sendWhatsApp = jest.spyOn(service, 'sendWhatsApp').mockResolvedValue({ sent: true } as any);
    return { prisma, service, sendEmail, sendWhatsApp };
  }

  it('sends each tenant\'s report only to its own owners', async () => {
    const { service, sendEmail } = setup();
    const forA = await service.sendReport(contextFor(TENANT_A), { total_sales: 10 }, ['email']);
    await service.sendReport(contextFor(TENANT_B), { total_sales: 10 }, ['email']);

    expect(forA.tenant_id).toBe(TENANT_A);
    expect(sendEmail.mock.calls[0][0]).toBe('a-owner@a.test');
    expect(sendEmail.mock.calls[1][0]).toBe('b-owner@b.test');
  });

  it('queries only active owner memberships of the calling tenant', async () => {
    const { service, prisma } = setup();
    await service.sendReport(contextFor(TENANT_A), {}, ['whatsapp']);
    expect(prisma.user.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { is_active: true, memberships: { some: { tenantId: TENANT_A, role: 'tenant_owner', status: 'active' } } },
    }));
  });

  it('does not dispatch, or look up recipients, when no channel is requested', async () => {
    const { service, prisma, sendEmail } = setup();
    const results = await service.sendReport(contextFor(TENANT_A), { total_sales: 42 }, []);
    expect(Object.keys(results)).toEqual(['tenant_id']);
    expect(prisma.user.findMany).not.toHaveBeenCalled();
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('reports a missing recipient instead of falling back to a global address', async () => {
    const { service, sendWhatsApp } = setup();
    const results = await service.sendReport(contextFor(TENANT_B), {}, ['whatsapp']);
    expect(results.whatsapp.sent).toBe(false);
    expect(sendWhatsApp).not.toHaveBeenCalled();
  });
});
