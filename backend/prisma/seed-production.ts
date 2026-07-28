import { PrismaClient } from '@prisma/client';
import * as bcryptjs from 'bcryptjs';
import {
  assertProductionSeedDatabaseState,
  validateProductionSeedEnvironment,
} from '../src/config/production-seed';

const prisma = new PrismaClient();

async function main() {
  const configuration = validateProductionSeedEnvironment();
  const passwordHash = await bcryptjs.hash(configuration.owner.password, 12);

  const result = await prisma.$transaction(
    async (tx) => {
      const [
        branches,
        users,
        products,
        salesInvoices,
        terminals,
        expectedBranch,
        expectedOwner,
      ] = await Promise.all([
        tx.branch.count(),
        tx.user.count(),
        tx.product.count(),
        tx.salesInvoice.count(),
        tx.posTerminal.count(),
        tx.branch.findUnique({
          where: { code: configuration.branch.code },
          select: { id: true },
        }),
        tx.user.findUnique({
          where: { phone: configuration.owner.phone },
          select: { id: true },
        }),
      ]);

      const otherTables = await tx.$queryRaw<Array<{ tablename: string }>>`
        SELECT tablename
        FROM pg_catalog.pg_tables
        WHERE schemaname = 'public'
          AND tablename NOT IN (
            '_prisma_migrations',
            'Branch',
            'User',
            'Product',
            'SalesInvoice',
            'PosTerminal'
          )
        ORDER BY tablename
      `;
      const otherTablesWithRows: string[] = [];
      for (const { tablename } of otherTables) {
        const quotedTableName = `"${tablename.replace(/"/g, '""')}"`;
        const rows = await tx.$queryRawUnsafe<Array<{ has_rows: boolean }>>(
          `SELECT EXISTS (SELECT 1 FROM ${quotedTableName} LIMIT 1) AS has_rows`,
        );
        if (rows[0]?.has_rows) otherTablesWithRows.push(tablename);
      }

      assertProductionSeedDatabaseState({
        branches,
        users,
        products,
        salesInvoices,
        terminals,
        otherTablesWithRows,
        expectedBranchExists: !!expectedBranch,
        expectedOwnerExists: !!expectedOwner,
      });

      const branch = await tx.branch.upsert({
        where: { code: configuration.branch.code },
        update: {
          name_ar: configuration.branch.nameAr,
          name_en: configuration.branch.nameEn,
          address: configuration.branch.address,
          phone: configuration.branch.phone,
          is_active: true,
        },
        create: {
          code: configuration.branch.code,
          name_ar: configuration.branch.nameAr,
          name_en: configuration.branch.nameEn,
          address: configuration.branch.address,
          phone: configuration.branch.phone,
          cash_drawer_enabled: false,
          is_active: true,
        },
      });

      const owner = await tx.user.upsert({
        where: { phone: configuration.owner.phone },
        update: {
          branch_id: branch.id,
          name: configuration.owner.name,
          email: configuration.owner.email,
          password_hash: passwordHash,
          role: 'owner',
          is_active: true,
        },
        create: {
          branch_id: branch.id,
          name: configuration.owner.name,
          phone: configuration.owner.phone,
          email: configuration.owner.email,
          password_hash: passwordHash,
          role: 'owner',
          is_active: true,
        },
      });

      return { branch, owner };
    },
    {
      maxWait: 10_000,
      timeout: 60_000,
    },
  );

  console.log(
    JSON.stringify({
      event: 'production_seed_completed',
      project_ref: configuration.projectRef,
      branch: {
        id: result.branch.id,
        code: result.branch.code,
      },
      owner: {
        id: result.owner.id,
        email: result.owner.email,
        phone: result.owner.phone,
      },
    }),
  );
}

main()
  .catch((error) => {
    console.error(
      JSON.stringify({
        event: 'production_seed_failed',
        message:
          error instanceof Error ? error.message : 'Unknown production seed error',
      }),
    );
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
