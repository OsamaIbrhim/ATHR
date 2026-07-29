import { ShiftsService } from './shifts.service';

const actor = {
  sub: 'cashier-1',
  role: 'cashier' as const,
  branch_id: 'branch-1',
};
const shiftId = '11111111-1111-4111-8111-111111111111';

describe('ShiftsService', () => {
  it.each([undefined, null, '', ' ', 'undefined', 'null'])(
    'rejects an invalid shift ID before querying Prisma: %p',
    async (value) => {
      const findUnique = jest.fn();
      const service = new ShiftsService({
        shift: { findUnique },
      } as any);

      await expect(
        service.issueOfflineContext(value as any, actor, {
          id: 'terminal-1',
          branch_id: 'branch-1',
          last_sale_sequence: 0n,
        }),
      ).rejects.toMatchObject({
        response: expect.objectContaining({
          code: 'RESOURCE_ID_INVALID',
          field: 'shift_id',
        }),
      });
      expect(findUnique).not.toHaveBeenCalled();
    },
  );

  it('calculates expected cash from sales and returns explicitly linked to the shift', async () => {
    const shiftFindUnique = jest.fn()
      .mockResolvedValueOnce({
        id: shiftId,
        branch_id: 'branch-1',
        status: 'open',
        opening_cash: 50,
        opened_at: new Date(0),
      })
      .mockResolvedValueOnce({ id: shiftId, status: 'closed' });
    const shiftUpdateMany = jest.fn().mockResolvedValue({ count: 1 });
    const salesAggregate = jest.fn().mockResolvedValue({ _sum: { total: 500 } });
    const returnAggregate = jest.fn().mockResolvedValue({ _sum: { refund_total: 100 } });
    const prisma = {
      shift: {
        findUnique: shiftFindUnique,
        updateMany: shiftUpdateMany,
      },
      salesInvoice: { aggregate: salesAggregate },
      return: { aggregate: returnAggregate },
    };
    const service = new ShiftsService(prisma as any);

    await service.close(shiftId, actor, 440);

    expect(salesAggregate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ shift_id: shiftId }),
      }),
    );
    expect(returnAggregate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ shift_id: shiftId }),
      }),
    );
    const data = shiftUpdateMany.mock.calls[0][0].data;
    expect(Number(data.expected_cash)).toBe(450);
    expect(Number(data.difference)).toBe(-10);
    expect(data.closed_by).toBe(actor.sub);
  });

  it('issues a plain terminal-bound context for an open shift in the same branch', async () => {
    const prisma = {
      shift: {
        findUnique: jest.fn().mockResolvedValue({
          id: shiftId,
          branch_id: 'branch-1',
          status: 'open',
          closed_at: null,
        }),
      },
    };
    const service = new ShiftsService(prisma as any);
    const result = await service.issueOfflineContext(
      shiftId,
      actor,
      {
        id: 'terminal-1',
        branch_id: 'branch-1',
        last_sale_sequence: 4n,
      },
    );

    expect(result).toMatchObject({
      context_version: 2,
      session_id: expect.any(String),
      user_id: actor.sub,
      role: 'cashier',
      branch_id: 'branch-1',
      terminal_id: 'terminal-1',
      shift_id: shiftId,
      server_last_sale_sequence: '4',
    });
    expect(result).toHaveProperty('issued_at');
    expect(result).toHaveProperty('expires_at');
    expect(result).not.toHaveProperty('token');
    expect(result).not.toHaveProperty('key_id');
  });
});
