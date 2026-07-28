export type ProductionSeedConfig = {
  projectRef: string;
  branch: {
    code: string;
    nameAr: string;
    nameEn: string | null;
    address: string | null;
    phone: string | null;
  };
  owner: {
    name: string;
    phone: string;
    email: string;
    password: string;
  };
};

export type ProductionSeedDatabaseState = {
  branches: number;
  users: number;
  products: number;
  salesInvoices: number;
  terminals: number;
  otherTablesWithRows: string[];
  expectedBranchExists: boolean;
  expectedOwnerExists: boolean;
};

const CONFIRMATION = 'seed-clean-production-v1';
const PLACEHOLDER =
  /(?:change[-_ ]?me|replace[-_ ]?me|placeholder|example|password|secret|<|>)/i;

function required(name: string, value: string | undefined) {
  const normalized = String(value || '').trim();
  if (!normalized) throw new Error(`${name} must be configured`);
  return normalized;
}

function optional(value: string | undefined) {
  const normalized = String(value || '').trim();
  return normalized || null;
}

function validateProjectTarget(
  databaseUrl: string,
  expectedProjectRef: string,
) {
  let parsed: URL;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    throw new Error('DIRECT_URL must be a valid PostgreSQL URL');
  }

  if (!['postgres:', 'postgresql:'].includes(parsed.protocol)) {
    throw new Error('DIRECT_URL must use the PostgreSQL protocol');
  }

  const hostname = parsed.hostname.toLowerCase();
  const username = decodeURIComponent(parsed.username).toLowerCase();
  const projectRef = expectedProjectRef.toLowerCase();
  const targetsProject =
    hostname === `db.${projectRef}.supabase.co` ||
    username === `postgres.${projectRef}`;

  if (!targetsProject) {
    throw new Error(
      'DIRECT_URL does not target PRODUCTION_SEED_PROJECT_REF',
    );
  }
}

function validatePassword(value: string) {
  if (value.length < 16) {
    throw new Error(
      'PRODUCTION_SEED_OWNER_PASSWORD must contain at least 16 characters',
    );
  }
  if (PLACEHOLDER.test(value)) {
    throw new Error(
      'PRODUCTION_SEED_OWNER_PASSWORD contains a placeholder',
    );
  }
  if (
    !/[a-z]/.test(value) ||
    !/[A-Z]/.test(value) ||
    !/\d/.test(value) ||
    !/[^A-Za-z0-9]/.test(value)
  ) {
    throw new Error(
      'PRODUCTION_SEED_OWNER_PASSWORD must include upper, lower, number, and symbol characters',
    );
  }
  return value;
}

export function validateProductionSeedEnvironment(
  env: NodeJS.ProcessEnv = process.env,
): ProductionSeedConfig {
  if (env.NODE_ENV !== 'production') {
    throw new Error('Production seed requires NODE_ENV=production');
  }
  if (env.PRODUCTION_SEED_CONFIRMATION !== CONFIRMATION) {
    throw new Error(
      `Set PRODUCTION_SEED_CONFIRMATION=${CONFIRMATION} for the clean cutover only`,
    );
  }

  const projectRef = required(
    'PRODUCTION_SEED_PROJECT_REF',
    env.PRODUCTION_SEED_PROJECT_REF,
  );
  if (!/^[a-z0-9]{20}$/.test(projectRef)) {
    throw new Error(
      'PRODUCTION_SEED_PROJECT_REF must be a 20-character Supabase project ref',
    );
  }

  validateProjectTarget(
    required('DIRECT_URL', env.DIRECT_URL),
    projectRef,
  );

  const branchCode = required(
    'PRODUCTION_SEED_BRANCH_CODE',
    env.PRODUCTION_SEED_BRANCH_CODE,
  ).toUpperCase();
  if (!/^[A-Z0-9-]{2,32}$/.test(branchCode)) {
    throw new Error(
      'PRODUCTION_SEED_BRANCH_CODE must use 2-32 uppercase letters, numbers, or hyphens',
    );
  }

  const ownerEmail = required(
    'PRODUCTION_SEED_OWNER_EMAIL',
    env.PRODUCTION_SEED_OWNER_EMAIL,
  ).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(ownerEmail)) {
    throw new Error('PRODUCTION_SEED_OWNER_EMAIL must be a valid email');
  }

  const ownerPhone = required(
    'PRODUCTION_SEED_OWNER_PHONE',
    env.PRODUCTION_SEED_OWNER_PHONE,
  );
  if (!/^\+[1-9]\d{7,14}$/.test(ownerPhone)) {
    throw new Error(
      'PRODUCTION_SEED_OWNER_PHONE must use international E.164 format',
    );
  }

  return {
    projectRef,
    branch: {
      code: branchCode,
      nameAr: required(
        'PRODUCTION_SEED_BRANCH_NAME_AR',
        env.PRODUCTION_SEED_BRANCH_NAME_AR,
      ),
      nameEn: optional(env.PRODUCTION_SEED_BRANCH_NAME_EN),
      address: optional(env.PRODUCTION_SEED_BRANCH_ADDRESS),
      phone: optional(env.PRODUCTION_SEED_BRANCH_PHONE),
    },
    owner: {
      name: required(
        'PRODUCTION_SEED_OWNER_NAME',
        env.PRODUCTION_SEED_OWNER_NAME,
      ),
      phone: ownerPhone,
      email: ownerEmail,
      password: validatePassword(
        required(
          'PRODUCTION_SEED_OWNER_PASSWORD',
          env.PRODUCTION_SEED_OWNER_PASSWORD,
        ),
      ),
    },
  };
}

export function assertProductionSeedDatabaseState(
  state: ProductionSeedDatabaseState,
) {
  const isEmpty =
    state.branches === 0 &&
    state.users === 0 &&
    state.products === 0 &&
    state.salesInvoices === 0 &&
    state.terminals === 0 &&
    state.otherTablesWithRows.length === 0;
  if (isEmpty) return;

  const isSafeReplay =
    state.branches === 1 &&
    state.users === 1 &&
    state.products === 0 &&
    state.salesInvoices === 0 &&
    state.terminals === 0 &&
    state.otherTablesWithRows.length === 0 &&
    state.expectedBranchExists &&
    state.expectedOwnerExists;
  if (isSafeReplay) return;

  throw new Error(
    'Production seed requires an empty database or an exact branch/owner-only replay state',
  );
}
