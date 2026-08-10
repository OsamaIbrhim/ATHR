import { Prisma } from '@prisma/client';
import { fakePrisma, TENANT_A, TENANT_B } from './cross-tenant-harness';

/**
 * Tests for the test harness itself.
 *
 * `FakeTable` is trusted by every `*.cross-tenant.spec.ts` in this repository:
 * if the fake silently returns wrong data, those isolation tests pass while
 * proving nothing. These cases pin the two behaviours that are easiest to get
 * wrong and hardest to notice — composite `groupBy` keys, and the `*OrThrow`
 * finders whose absence surfaces only as `TypeError: ... is not a function`.
 */
describe('FakeTable harness', () => {
  describe('groupBy', () => {
    it('round-trips a two-field key back to the exact field values', async () => {
      const prisma = fakePrisma({
        inventoryStock: [
          { tenant_id: TENANT_A, product_id: 'product-1' },
          { tenant_id: TENANT_A, product_id: 'product-1' },
          { tenant_id: TENANT_A, product_id: 'product-2' },
        ],
      });

      const grouped = await prisma.inventoryStock.groupBy({
        by: ['tenant_id', 'product_id'],
      });

      expect(grouped).toEqual([
        { tenant_id: TENANT_A, product_id: 'product-1', _count: 2 },
        { tenant_id: TENANT_A, product_id: 'product-2', _count: 1 },
      ]);
    });

    it('does not collide two tenants into one bucket', async () => {
      const prisma = fakePrisma({
        inventoryStock: [
          { tenant_id: TENANT_A, product_id: 'shared-product' },
          { tenant_id: TENANT_B, product_id: 'shared-product' },
        ],
      });

      const grouped = await prisma.inventoryStock.groupBy({
        by: ['tenant_id', 'product_id'],
      });

      expect(grouped).toHaveLength(2);
      expect(grouped.map((row: any) => row.tenant_id).sort()).toEqual(
        [TENANT_A, TENANT_B].sort(),
      );
      expect(grouped.every((row: any) => row._count === 1)).toBe(true);
    });

    it('keeps field tuples distinct when a grouped value contains the separator-adjacent characters', async () => {
      // A space separator would merge these two rows into one bucket keyed
      // "a b c" and then mis-split the fields. They are distinct tuples and
      // must stay distinct.
      const prisma = fakePrisma({
        inventoryStock: [
          { tenant_id: 'a b', product_id: 'c' },
          { tenant_id: 'a', product_id: 'b c' },
        ],
      });

      const grouped = await prisma.inventoryStock.groupBy({
        by: ['tenant_id', 'product_id'],
      });

      expect(grouped).toEqual([
        { tenant_id: 'a b', product_id: 'c', _count: 1 },
        { tenant_id: 'a', product_id: 'b c', _count: 1 },
      ]);
    });

    it('applies the where clause before grouping', async () => {
      const prisma = fakePrisma({
        inventoryStock: [
          { tenant_id: TENANT_A, product_id: 'product-1' },
          { tenant_id: TENANT_B, product_id: 'product-1' },
        ],
      });

      const grouped = await prisma.inventoryStock.groupBy({
        by: ['tenant_id', 'product_id'],
        where: { tenant_id: TENANT_A },
      });

      expect(grouped).toEqual([
        { tenant_id: TENANT_A, product_id: 'product-1', _count: 1 },
      ]);
    });
  });

  describe('findFirstOrThrow', () => {
    it('returns the matching row when one exists', async () => {
      const prisma = fakePrisma({
        purchaseInvoice: [
          { id: 'invoice-1', tenant_id: TENANT_A },
          { id: 'invoice-2', tenant_id: TENANT_B },
        ],
      });

      await expect(
        prisma.purchaseInvoice.findFirstOrThrow({
          where: { tenant_id: TENANT_A },
        }),
      ).resolves.toMatchObject({ id: 'invoice-1' });
    });

    it('throws a Prisma P2025 error when nothing matches', async () => {
      const prisma = fakePrisma({
        purchaseInvoice: [{ id: 'invoice-1', tenant_id: TENANT_A }],
      });

      // Production maps exactly this class + code to a 404 in
      // `common/api-error.filter.ts`; anything else would surface as a 500.
      await expect(
        prisma.purchaseInvoice.findFirstOrThrow({
          where: { tenant_id: TENANT_B },
        }),
      ).rejects.toBeInstanceOf(Prisma.PrismaClientKnownRequestError);

      await expect(
        prisma.purchaseInvoice.findFirstOrThrow({
          where: { tenant_id: TENANT_B },
        }),
      ).rejects.toMatchObject({ code: 'P2025' });
    });
  });

  describe('findUniqueOrThrow', () => {
    it('returns the matching row when one exists', async () => {
      const prisma = fakePrisma({
        transfer: [{ id: 'transfer-1', tenant_id: TENANT_A }],
      });

      await expect(
        prisma.transfer.findUniqueOrThrow({ where: { id: 'transfer-1' } }),
      ).resolves.toMatchObject({ id: 'transfer-1' });
    });

    it('throws a Prisma P2025 error when nothing matches', async () => {
      const prisma = fakePrisma({
        transfer: [{ id: 'transfer-1', tenant_id: TENANT_A }],
      });

      await expect(
        prisma.transfer.findUniqueOrThrow({ where: { id: 'missing' } }),
      ).rejects.toBeInstanceOf(Prisma.PrismaClientKnownRequestError);

      await expect(
        prisma.transfer.findUniqueOrThrow({ where: { id: 'missing' } }),
      ).rejects.toMatchObject({ code: 'P2025' });
    });
  });
});
