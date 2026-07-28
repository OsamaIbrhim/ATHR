import {
  assertProductionSeedDatabaseState,
  validateProductionSeedEnvironment,
} from './production-seed';

function validEnvironment(): NodeJS.ProcessEnv {
  return {
    NODE_ENV: 'production',
    DIRECT_URL:
      'postgresql://postgres.qckaxnojypfglqbbcdov:encoded@aws-1-eu-central-1.pooler.supabase.com:5432/postgres',
    PRODUCTION_SEED_CONFIRMATION: 'seed-clean-production-v1',
    PRODUCTION_SEED_PROJECT_REF: 'qckaxnojypfglqbbcdov',
    PRODUCTION_SEED_BRANCH_CODE: 'bold-01',
    PRODUCTION_SEED_BRANCH_NAME_AR: 'بولد – الفرع الرئيسي',
    PRODUCTION_SEED_BRANCH_NAME_EN: 'Bold Main',
    PRODUCTION_SEED_OWNER_NAME: 'Owner',
    PRODUCTION_SEED_OWNER_PHONE: '+201000000000',
    PRODUCTION_SEED_OWNER_EMAIL: 'owner@bold.eg',
    PRODUCTION_SEED_OWNER_PASSWORD: 'Strong!Production9',
  };
}

describe('production seed environment', () => {
  it('normalizes a valid clean-cutover configuration', () => {
    expect(validateProductionSeedEnvironment(validEnvironment())).toEqual({
      projectRef: 'qckaxnojypfglqbbcdov',
      branch: {
        code: 'BOLD-01',
        nameAr: 'بولد – الفرع الرئيسي',
        nameEn: 'Bold Main',
        address: null,
        phone: null,
      },
      owner: {
        name: 'Owner',
        phone: '+201000000000',
        email: 'owner@bold.eg',
        password: 'Strong!Production9',
      },
    });
  });

  it('refuses non-production execution or a missing confirmation', () => {
    expect(() =>
      validateProductionSeedEnvironment({
        ...validEnvironment(),
        NODE_ENV: 'development',
      }),
    ).toThrow(/NODE_ENV=production/);

    expect(() =>
      validateProductionSeedEnvironment({
        ...validEnvironment(),
        PRODUCTION_SEED_CONFIRMATION: '',
      }),
    ).toThrow(/confirmation/i);
  });

  it('refuses a connection string for another Supabase project', () => {
    expect(() =>
      validateProductionSeedEnvironment({
        ...validEnvironment(),
        DIRECT_URL:
          'postgresql://postgres.otherprojectref00000:encoded@aws-1-eu-central-1.pooler.supabase.com:5432/postgres',
      }),
    ).toThrow(/does not target/);
  });

  it('requires strong credentials and stable owner identifiers', () => {
    expect(() =>
      validateProductionSeedEnvironment({
        ...validEnvironment(),
        PRODUCTION_SEED_OWNER_PASSWORD: 'Bold1234',
      }),
    ).toThrow(/16 characters/);

    expect(() =>
      validateProductionSeedEnvironment({
        ...validEnvironment(),
        PRODUCTION_SEED_OWNER_PHONE: '01000000000',
      }),
    ).toThrow(/E.164/);
  });

  it('allows only an empty database or an exact branch/owner replay', () => {
    expect(() =>
      assertProductionSeedDatabaseState({
        branches: 0,
        users: 0,
        products: 0,
        salesInvoices: 0,
        terminals: 0,
        otherTablesWithRows: [],
        expectedBranchExists: false,
        expectedOwnerExists: false,
      }),
    ).not.toThrow();

    expect(() =>
      assertProductionSeedDatabaseState({
        branches: 1,
        users: 1,
        products: 0,
        salesInvoices: 0,
        terminals: 0,
        otherTablesWithRows: [],
        expectedBranchExists: true,
        expectedOwnerExists: true,
      }),
    ).not.toThrow();

    expect(() =>
      assertProductionSeedDatabaseState({
        branches: 2,
        users: 9,
        products: 12,
        salesInvoices: 15,
        terminals: 3,
        otherTablesWithRows: ['InventoryMovement'],
        expectedBranchExists: true,
        expectedOwnerExists: true,
      }),
    ).toThrow(/empty database/);

    expect(() =>
      assertProductionSeedDatabaseState({
        branches: 0,
        users: 0,
        products: 0,
        salesInvoices: 0,
        terminals: 0,
        otherTablesWithRows: ['RefreshToken'],
        expectedBranchExists: false,
        expectedOwnerExists: false,
      }),
    ).toThrow(/empty database/);
  });
});
