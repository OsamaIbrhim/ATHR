import { Prisma } from '@prisma/client';
import { fakePrisma, TENANT_A, TENANT_B } from './cross-tenant-harness';
import { RAW_SQL_ALLOWLIST } from './raw-sql-allowlist';

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

  /**
   * WP-T2 / F4. `$queryRaw`/`$executeRaw` used to return `[]`/`0` for every
   * call, silently — nine production files' raw-SQL paths were unverified by
   * any cross-tenant spec while those specs stayed green. These pin the
   * fail-loud default and the narrow allowlist that replaces it.
   */
  describe('raw SQL fails loud by default', () => {
    it('rejects $queryRaw for a statement with no allowlist entry', async () => {
      const prisma = fakePrisma({});
      await expect(prisma.$queryRaw`SELECT 1`).rejects.toThrow(
        /RAW_SQL_ALLOWLIST/,
      );
    });

    it('rejects $executeRaw for a statement with no allowlist entry', async () => {
      const prisma = fakePrisma({});
      await expect(prisma.$executeRaw`UPDATE "X" SET "y" = 1`).rejects.toThrow(
        /RAW_SQL_ALLOWLIST/,
      );
    });

    it('rejects $queryRawUnsafe and $executeRawUnsafe the same way', async () => {
      const prisma = fakePrisma({});
      await expect(prisma.$queryRawUnsafe('SELECT 1')).rejects.toThrow(/RAW_SQL_ALLOWLIST/);
      await expect(prisma.$executeRawUnsafe('SELECT 1')).rejects.toThrow(/RAW_SQL_ALLOWLIST/);
    });

    it('includes the offending statement text in the error, for debuggability', async () => {
      const prisma = fakePrisma({});
      await expect(prisma.$queryRaw`SELECT "id" FROM "Widget"`).rejects.toThrow(
        /SELECT "id" FROM "Widget"/,
      );
    });

    it('resolves every currently-declared allowlist entry with its stub', async () => {
      const prisma = fakePrisma({});
      for (const entry of RAW_SQL_ALLOWLIST) {
        const method = `$${entry.method}` as '$queryRaw' | '$executeRaw';
        await expect(prisma[method](entry.marker)).resolves.toEqual(entry.stub);
      }
    });

    it('does not let an allowlisted marker match under the wrong method', async () => {
      // offers.service.ts:66 and shifts.service.ts:31 render to identical SQL
      // text (`pg_advisory_xact_lock(hashtext(...))` — the interpolated value
      // never appears); only the method used ($queryRaw vs $executeRaw)
      // distinguishes the two entries. Calling the lock text through a third,
      // unlisted method must still fail loud.
      const prisma = fakePrisma({});
      await expect(prisma.$queryRawUnsafe('SELECT pg_advisory_xact_lock(hashtext(1))')).rejects.toThrow(
        /RAW_SQL_ALLOWLIST/,
      );
    });

    it('distinguishes the two purchasing set_config entries by their on/off value', async () => {
      // A marker of bare `set_config(` would silently authorize both — and
      // every future set_config call anywhere. Each entry must require its
      // own on/off value.
      const prisma = fakePrisma({});
      const onOnly = RAW_SQL_ALLOWLIST.find((entry) => entry.marker.includes("'on'"));
      expect(onOnly).toBeDefined();
      await expect(
        prisma.$queryRaw`SELECT set_config('bold.purchase_accounting_document_write', 'off', true)`,
      ).resolves.toEqual([]); // matches the :1124 "off" entry specifically, not :1106's "on"
      await expect(
        prisma.$queryRaw`SELECT set_config('bold.some_other_flag', 'on', true)`,
      ).rejects.toThrow(/RAW_SQL_ALLOWLIST/);
    });
  });
});
