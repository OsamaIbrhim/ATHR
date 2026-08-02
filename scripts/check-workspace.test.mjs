import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  findCycles,
  packageNameFromSpecifier,
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
function writeFixtureWorkspace({ domainCoreDependencies = {}, domainCoreImport = '' } = {}) {
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
  writeFileSync(join(root, 'backend', 'Dockerfile'), 'CMD ["node", "dist/main.js"]\n');
  writeFileSync(
    join(root, 'backend', 'package.json'),
    JSON.stringify({ name: 'athr-operations-api', private: true }),
  );

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
