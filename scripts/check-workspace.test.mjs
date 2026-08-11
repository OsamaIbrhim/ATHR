import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  findCycles,
  packageNameFromSpecifier,
  referencedApplication,
  stringLiterals,
  validateWorkspace,
} from './check-workspace.mjs';

test('extracts dependency package names without treating local imports as packages', () => {
  assert.equal(
    packageNameFromSpecifier('@athr/contracts/subpath'),
    '@athr/contracts',
  );
  assert.equal(packageNameFromSpecifier('react/jsx-runtime'), 'react');
  assert.equal(packageNameFromSpecifier('node:fs'), null);
  assert.equal(packageNameFromSpecifier('../local'), null);
  assert.equal(packageNameFromSpecifier('@/lib/api'), null);
});

test('detects workspace dependency cycles', () => {
  const graph = new Map([
    ['@athr/a', new Set(['@athr/b'])],
    ['@athr/b', new Set(['@athr/c'])],
    ['@athr/c', new Set(['@athr/a'])],
  ]);

  assert.deepEqual(findCycles(graph), [
    ['@athr/a', '@athr/b', '@athr/c', '@athr/a'],
  ]);
});

/**
 * Builds a minimal, otherwise-valid workspace fixture on disk so
 * validateWorkspace() can run its real filesystem/import-scanning logic
 * against it, rather than only against the real repository. `domainCoreExtra`
 * lets a test inject the exact kind of forbidden edge WP-004 shipped with:
 * an @athr/contracts import inside @athr/domain-core.
 */
function writeFixtureWorkspace({
  domainCoreDependencies = {},
  domainCoreImport = '',
  backendDependencies = {},
  dockerfile = 'CMD ["node", "dist/main.js"]\n',
  backendTestFile = '',
} = {}) {
  const root = mkdtempSync(join(tmpdir(), 'check-workspace-fixture-'));

  writeFileSync(
    join(root, 'package.json'),
    JSON.stringify({
      private: true,
      workspaces: ['packages/*', 'backend', 'admin-web', 'pos-electron'],
    }),
  );
  writeFileSync(
    join(root, 'package-lock.json'),
    JSON.stringify({
      packages: {
        'node_modules/@rollup/rollup-linux-x64-gnu': { version: '4.62.2' },
        'node_modules/@rollup/rollup-win32-x64-msvc': { version: '4.62.2' },
      },
    }),
  );
  writeFileSync(join(root, 'vercel.json'), JSON.stringify({
    installCommand: 'npm ci',
    outputDirectory: '.next',
  }));

  mkdirSync(join(root, 'backend'), { recursive: true });
  writeFileSync(
    join(root, 'backend', 'railway.toml'),
    'dockerfilePath = "backend/Dockerfile"\nrun = "npm run prisma:migrate:deploy"\n',
  );
  writeFileSync(join(root, 'backend', 'Dockerfile'), dockerfile);
  writeFileSync(
    join(root, 'backend', 'package.json'),
    JSON.stringify({
      name: 'athr-operations-api',
      private: true,
      dependencies: backendDependencies,
    }),
  );

  if (backendTestFile) {
    mkdirSync(join(root, 'backend', 'src', 'common'), { recursive: true });
    writeFileSync(
      join(root, 'backend', 'src', 'common', 'money-contract.spec.ts'),
      backendTestFile,
    );
  }

  for (const [directory, name] of [
    ['admin-web', 'athr-operations-admin'],
    ['pos-electron', 'athr-pos-electron'],
  ]) {
    mkdirSync(join(root, directory), { recursive: true });
    writeFileSync(
      join(root, directory, 'package.json'),
      JSON.stringify({
        name,
        private: true,
        optionalDependencies: {
          '@rollup/rollup-linux-x64-gnu': '4.62.2',
          '@rollup/rollup-win32-x64-msvc': '4.62.2',
        },
      }),
    );
  }

  mkdirSync(join(root, 'packages', 'contracts'), { recursive: true });
  writeFileSync(
    join(root, 'packages', 'contracts', 'package.json'),
    JSON.stringify({
      name: '@athr/contracts',
      private: true,
      exports: { '.': './dist/index.js' },
    }),
  );

  mkdirSync(join(root, 'packages', 'domain-core', 'src'), { recursive: true });
  writeFileSync(
    join(root, 'packages', 'domain-core', 'package.json'),
    JSON.stringify({
      name: '@athr/domain-core',
      private: true,
      exports: { '.': './dist/index.js' },
      devDependencies: domainCoreDependencies,
    }),
  );
  writeFileSync(
    join(root, 'packages', 'domain-core', 'src', 'money.ts'),
    `${domainCoreImport}\nexport const placeholder = true;\n`,
  );

  return root;
}

test('validateWorkspace passes for an otherwise-clean fixture with no forbidden edges', () => {
  const root = writeFixtureWorkspace();
  try {
    const { failures } = validateWorkspace(root);
    assert.deepEqual(failures, []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('validateWorkspace does not mistake template-literal prose for an import (WP-008 Phase A regression)', () => {
  // A domain error message containing the word "from" followed by a quoted
  // `${...}` interpolation reads, to the naive regex, like
  // `import ... from "${exists.item_type}"` -- it is not an import at all.
  const root = writeFixtureWorkspace({
    domainCoreImport:
      'export function describe(exists, dto) {\n' +
      '  return `cannot change item_type from "${exists.item_type}" to "${dto.item_type}" directly.`;\n' +
      '}',
  });
  try {
    const { failures } = validateWorkspace(root);
    assert.ok(
      !failures.some((failure) => failure.includes('undeclared dependency')),
      `expected no false-positive undeclared-dependency failure, got: ${JSON.stringify(failures)}`,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('validateWorkspace fails when @athr/domain-core imports @athr/contracts (WP-004 regression)', () => {
  const root = writeFixtureWorkspace({
    domainCoreDependencies: { '@athr/contracts': '^0.1.0' },
    domainCoreImport: "import type { MoneyWire } from '@athr/contracts';",
  });
  try {
    const { failures } = validateWorkspace(root);
    assert.ok(
      failures.some((failure) =>
        failure.includes(
          '@athr/domain-core must not depend on @athr/contracts (forbidden reverse edge per ATHR Dependency Rules v1.0 §3).',
        ),
      ),
      `expected a forbidden-reverse-dependency failure, got: ${JSON.stringify(failures)}`,
    );
    assert.ok(
      failures.some((failure) =>
        failure.includes(
          'imports @athr/contracts, a forbidden reverse edge per ATHR Dependency Rules v1.0 §3.',
        ),
      ),
      `expected a forbidden-reverse-import failure, got: ${JSON.stringify(failures)}`,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('validateWorkspace fails when a backend @athr/* dependency is missing from the Dockerfile runtime stage (WP-006 regression)', () => {
  const root = writeFixtureWorkspace({
    backendDependencies: { '@athr/domain-core': '^0.1.0' },
  });
  try {
    const { failures } = validateWorkspace(root);
    assert.ok(
      failures.some((failure) =>
        failure.includes(
          'Backend Dockerfile runtime stage must copy /app/packages/domain-core/dist for the @athr/domain-core dependency.',
        ),
      ),
      `expected a missing-runtime-COPY failure, got: ${JSON.stringify(failures)}`,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('validateWorkspace passes once the Dockerfile runtime stage copies the dependency', () => {
  const root = writeFixtureWorkspace({
    backendDependencies: { '@athr/domain-core': '^0.1.0' },
    dockerfile:
      'COPY --from=build /app/packages/domain-core/dist /app/packages/domain-core/dist\nCMD ["node", "dist/main.js"]\n',
  });
  try {
    const { failures } = validateWorkspace(root);
    assert.deepEqual(failures, []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('stringLiterals ignores comments and template literals', () => {
  const source = [
    "// see ../pos-electron/src/utils.ts for the POS half",
    '/* reads ../admin-web/app/page.tsx historically */',
    'const banner = `../pos-electron/electron/main.ts`;',
    "const real = readFileSync('src/reports/reports.service.ts');",
    'const url = "https://example.test/a";',
  ].join('\n');

  assert.deepEqual(stringLiterals(source), [
    'src/reports/reports.service.ts',
    'https://example.test/a',
  ]);
});

test('referencedApplication resolves a literal to the application workspace it names', () => {
  assert.equal(
    referencedApplication('../pos-electron/electron/main.ts'),
    'pos-electron',
  );
  assert.equal(
    referencedApplication('admin-web/app/sales/[id]/page.tsx'),
    'admin-web',
  );
  // Own-workspace and non-application paths are not cross-workspace reads.
  assert.equal(referencedApplication('src/utils.ts'), null);
  assert.equal(referencedApplication('../.github/workflows/ci.yml'), null);
  assert.equal(referencedApplication('backend'), null);
  assert.equal(referencedApplication('../${name}/main.ts'), null);
});

test('validateWorkspace fails when a test reads source from another application workspace (WP-T1 F1 regression)', () => {
  // The literal pre-fix body of backend/src/common/money-contract.spec.ts:
  // a backend test asserting about POS and Admin source, so that editing a
  // cashier screen or an invoice page failed the backend CI job.
  const root = writeFixtureWorkspace({
    backendTestFile: [
      "import { readFileSync } from 'node:fs';",
      "import { join } from 'node:path';",
      '',
      "describe('financial precision contract', () => {",
      '  const source = (path) => readFileSync(join(process.cwd(), path), "utf8");',
      '',
      "  it('keeps POS totals in integer cents', () => {",
      "    const main = source('../pos-electron/electron/main.ts');",
      "    const utils = source('../pos-electron/src/utils.ts');",
      "    expect(main).toContain('lineCents(item.unit_price, item.qty)');",
      "    expect(utils).not.toMatch(/\\*\\s*100/);",
      '  });',
      '',
      "  it('does not recompute invoice money with floats in Admin', () => {",
      "    const invoicePage = source('../admin-web/app/sales/[id]/page.tsx');",
      "    expect(invoicePage).toContain('lineTotal(i.unit_price,i.unit_tax,i.qty)');",
      '  });',
      '});',
    ].join('\n'),
  });
  try {
    const { failures } = validateWorkspace(root);
    for (const application of ['admin-web', 'pos-electron']) {
      assert.ok(
        failures.some(
          (failure) =>
            failure.includes(
              'backend/src/common/money-contract.spec.ts reads files from the',
            ) && failure.includes(`the ${application} workspace`),
        ),
        `expected a cross-workspace test-read failure for ${application}, got: ${JSON.stringify(failures)}`,
      );
    }
    assert.ok(
      failures.some((failure) =>
        failure.includes('Move these assertions into a test that lives in'),
      ),
      `expected the failure to say what to do, got: ${JSON.stringify(failures)}`,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('validateWorkspace allows a test that reads only its own workspace, and ignores prose naming another one', () => {
  const root = writeFixtureWorkspace({
    backendTestFile: [
      "import { readFileSync } from 'node:fs';",
      "import { join } from 'node:path';",
      '',
      '/**',
      ' * The POS half of this contract lives in',
      ' * pos-electron/src/money-contract.test.ts, and the Admin half in',
      ' * admin-web/app/sales/money-contract.test.ts.',
      ' */',
      "describe('financial precision contract', () => {",
      '  const source = (path) => readFileSync(join(process.cwd(), path), "utf8");',
      '',
      "  it('keeps report aggregation on Decimal arithmetic', () => {",
      "    expect(source('src/reports/reports.service.ts')).toContain('sumMoney(');",
      '  });',
      '});',
    ].join('\n'),
  });
  try {
    const { failures } = validateWorkspace(root);
    assert.deepEqual(failures, []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('validateWorkspace fails when @athr/domain-core imports @athr/testing even if undeclared', () => {
  const root = writeFixtureWorkspace({
    domainCoreImport: "import { fixture } from '@athr/testing';",
  });
  try {
    const { failures } = validateWorkspace(root);
    assert.ok(
      failures.some((failure) =>
        failure.includes(
          'imports @athr/testing, a forbidden reverse edge per ATHR Dependency Rules v1.0 §3.',
        ),
      ),
      `expected a forbidden-reverse-import failure, got: ${JSON.stringify(failures)}`,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
