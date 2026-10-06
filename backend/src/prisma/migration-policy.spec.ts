const {
  evaluateMigrationChanges,
  parseGitChanges,
} = require('../../scripts/check-migration-policy.cjs');

describe('migration release policy', () => {
  const migrationPath =
    'prisma/migrations/202607230002_transfer_state_machine/migration.sql';

  it('allows a new forward-only migration', () => {
    const result = evaluateMigrationChanges({
      changes: [{ status: 'A', path: migrationPath }],
      readBaseFile: () => {
        throw new Error('base content should not be read for a new migration');
      },
      readCurrentFile: () => 'CREATE TABLE "SafeMigration" ("id" UUID);',
    });

    expect(result.errors).toEqual([]);
    expect(result.addedMigrations).toEqual([
      '202607230002_transfer_state_machine',
    ]);
  });

  it('rejects edits to an existing migration by default', () => {
    const result = evaluateMigrationChanges({
      changes: [{ status: 'M', path: migrationPath }],
      readBaseFile: () => 'old SQL',
      readCurrentFile: () => 'new SQL',
    });

    expect(result.errors).toEqual([
      expect.stringContaining('Applied migration cannot be edited'),
    ]);
  });

  it('allows the explicit re-baseline that replaces the whole history', () => {
    const result = evaluateMigrationChanges({
      changes: [
        { status: 'A', path: 'prisma/migrations/000000000000_baseline/migration.sql' },
        { status: 'D', path: migrationPath },
      ],
      readBaseFile: () => 'old SQL',
      readCurrentFile: () => 'CREATE TABLE "Baseline" ("id" UUID);',
    });

    expect(result.errors).toEqual([]);
  });

  it('rejects deleting an applied migration', () => {
    const result = evaluateMigrationChanges({
      changes: [{ status: 'D', path: migrationPath }],
      readBaseFile: () => 'old SQL',
      readCurrentFile: () => '',
    });

    expect(result.errors).toEqual([
      expect.stringContaining('Applied migration cannot be deleted'),
    ]);
  });

  it('requires a migration when the database-facing Prisma schema changes', () => {
    const baseSchema = `
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model Product {
  id String @id
}
`;

    const currentSchema = `
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model Product {
  id   String @id
  name String
}
`;

    const result = evaluateMigrationChanges({
      changes: [{ status: 'M', path: 'prisma/schema.prisma' }],
      readBaseFile: (path: string) => {
        expect(path).toBe('prisma/schema.prisma');
        return baseSchema;
      },
      readCurrentFile: (path: string) => {
        expect(path).toBe('prisma/schema.prisma');
        return currentSchema;
      },
    });

    expect(result.errors).toEqual([
      expect.stringContaining('changed without a new migration'),
    ]);
  });

  it('allows generator-only Prisma schema changes without a migration', () => {
    const baseSchema = `
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model Product {
  id String @id
}
`;

    const currentSchema = `
generator client {
  provider      = "prisma-client-js"
  binaryTargets = ["native", "debian-openssl-3.0.x"]
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model Product {
  id String @id
}
`;

    const result = evaluateMigrationChanges({
      changes: [{ status: 'M', path: 'prisma/schema.prisma' }],
      readBaseFile: () => baseSchema,
      readCurrentFile: () => currentSchema,
    });

    expect(result.errors).toEqual([]);
    expect(result.addedMigrations).toEqual([]);
  });

  it('parses null-delimited git changes without path ambiguity', () => {
    expect(
      parseGitChanges(
        `A\0${migrationPath}\0M\0prisma/schema.prisma\0`,
      ),
    ).toEqual([
      { status: 'A', path: migrationPath },
      { status: 'M', path: 'prisma/schema.prisma' },
    ]);
  });
});
