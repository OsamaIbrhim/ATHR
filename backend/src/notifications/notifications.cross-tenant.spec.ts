import { NotificationsService } from './notifications.service';
import { TENANT_A, TENANT_B, contextFor } from '../identity/testing/cross-tenant-harness';

/**
 * WP-007 Phase A §A.3.6 — `notifications` module.
 *
 * This module owns no tenant-scoped table: it formats a report payload the
 * caller already produced and dispatches it over SMTP/WhatsApp, with
 * recipients coming from environment configuration. There is therefore no
 * cross-tenant *query* to isolate. What is asserted instead is the property
 * that actually matters here — a dispatch is attributed to the calling
 * tenant, and the service reads no tenant-owned data of its own that could
 * cross a boundary.
 */
describe('notifications — cross-tenant isolation', () => {
  const service = new NotificationsService();

  it('attributes a dispatch to the calling tenant', async () => {
    const forA = await service.sendReport(contextFor(TENANT_A), { total_sales: 10 }, []);
    const forB = await service.sendReport(contextFor(TENANT_B), { total_sales: 10 }, []);

    expect(forA.tenant_id).toBe(TENANT_A);
    expect(forB.tenant_id).toBe(TENANT_B);
  });

  it('renders only the report payload it was handed, reading no tenant data', async () => {
    const results = await service.sendReport(
      contextFor(TENANT_A),
      { total_sales: 42, count: 1 },
      [],
    );
    // No channel requested: nothing dispatched, and no query was needed to
    // decide that — the service holds no PrismaService at all.
    expect(Object.keys(results)).toEqual(['tenant_id']);
    expect((service as any).prisma).toBeUndefined();
  });
});
