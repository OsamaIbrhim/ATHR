import { SellersService } from './sellers.service';
import { SellersRepository } from './sellers.repository';
import { TENANT_A, contextFor } from '../identity/testing/cross-tenant-harness';
import { Prisma } from '@prisma/client';

// WP-007 Phase A: the service delegates to a tenant-scoped repository and
// takes a TenantContext. Commission settings moved off the shared `id = 1`
// singleton to a per-tenant row, so the double exposes `findFirst` rather
// than `upsert`. Assertions are otherwise unchanged.
const ctx = contextFor(TENANT_A);

describe('SellersService', () => {
  it('subtracts in-period returns from pre-tax seller sales', async () => {
    const prisma = {
      user: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'seller-1', name: 'Seller', branch_id: 'branch-1', is_active: true, branch: null, seller_commission_override: null },
        ])
      },
      salesInvoice: {
        findMany: jest.fn().mockResolvedValue([
          { seller_id: 'seller-1', subtotal: 1000 },
          { seller_id: 'seller-1', subtotal: 500 },
        ])
      },
      return: {
        findMany: jest.fn().mockResolvedValue([
          { refund_subtotal: 200, original_invoice: { seller_id: 'seller-1' } },
        ])
      },
      sellerCommissionSettings: {
        findFirst: jest.fn().mockResolvedValue({
          id: 1,
          tenant_id: ctx.tenantId,
          default_rate: 2,
          default_target: 1000,
          default_bonus: 100,
          period_length_days: 30,
          period_anchor: new Date('2026-07-01'),
        })
      },
    };
    const result = await new SellersService(new SellersRepository(prisma as any)).report(
      ctx,
      '2026-07-01',
      '2026-07-31',
      'branch-1',
    );
    expect(result.rows[0]).toMatchObject({
      invoice_count: 2,
      gross_sales_before_tax: 1500,
      return_count: 1,
      returns_before_tax: 200,
      net_sales_before_tax: 1300,
      commission_rate: 2,
      percentage_commission: 26,
      target_achieved: true,
      target_bonus: 100,
      estimated_total: 126,
    });
  });

  it('stores an immutable row and settings snapshot when closing a completed period', async () => {
    const create = jest.fn().mockImplementation(({ data }) => ({ id: 'period-1', ...data }));
    const prisma = {
      sellerCommissionPeriod: {
        findFirst: jest.fn().mockResolvedValue(null),
        create,
      },
      sellerCommissionSettings: {
        findFirst: jest.fn().mockResolvedValue({
          id: 1,
          tenant_id: ctx.tenantId,
          default_rate: new Prisma.Decimal(3),
          default_target: new Prisma.Decimal(1000),
          default_bonus: new Prisma.Decimal(200),
          period_length_days: 30,
        })
      },
    };
    const service = new SellersService(new SellersRepository(prisma as any));
    jest.spyOn(service, 'report').mockResolvedValue({
      from: '2026-06-01',
      to: '2026-06-30',
      branch_id: null,
      seller_id: null,
      rows: [{
        seller: {
          id: 'seller-1',
          name: 'Historical name',
          branch_id: 'branch-1',
          branch: { name_ar: 'Main' },
        },
        invoice_count: 2,
        gross_sales_before_tax: 1200,
        return_count: 1,
        returns_before_tax: 200,
        net_sales_before_tax: 1000,
        commission_rate: 3,
        percentage_commission: 30,
        target: 1000,
        target_achieved: true,
        target_bonus: 200,
        estimated_total: 230,
      }],
    } as any);

    await service.closePeriod(
      ctx,
      '2026-06-01',
      '2026-06-30',
      { sub: 'owner-1', role: 'owner', branch_id: null } as any,
    );

    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        default_rate: new Prisma.Decimal(3),
        period_length_days: 30,
        tenant_id: ctx.tenantId,
        rows: {
          create: [expect.objectContaining({
            seller_name: 'Historical name',
            net_sales_before_tax: 1000,
            commission_rate: 3,
            estimated_total: 230,
            tenant_id: ctx.tenantId,
          })],
        },
      }),
    }));
  });
});
