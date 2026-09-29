#!/usr/bin/env node

const { execFileSync } = require('node:child_process');
const { readFileSync } = require('node:fs');
const { join, resolve } = require('node:path');

const MIGRATION_PATH_PATTERN =
  /^prisma\/migrations\/(\d{12,14}_[a-z0-9_]+)\/migration\.sql$/;
const BASELINE_PATH = 'prisma/migrations/000000000000_baseline/migration.sql';

function stripGeneratorBlocks(schema) {
  const lines = schema.split(/\r?\n/);
  const result = [];

  let insideGenerator = false;
  let braceDepth = 0;

  for (const line of lines) {
    if (!insideGenerator && /^\s*generator\s+\w+\s*\{/.test(line)) {
      insideGenerator = true;
      braceDepth =
        (line.match(/\{/g) || []).length -
        (line.match(/\}/g) || []).length;

      if (braceDepth <= 0) {
        insideGenerator = false;
      }

      continue;
    }

    if (insideGenerator) {
      braceDepth +=
        (line.match(/\{/g) || []).length -
        (line.match(/\}/g) || []).length;

      if (braceDepth <= 0) {
        insideGenerator = false;
      }

      continue;
    }

    result.push(line);
  }

  return result.join('\n').trim();
}

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--base') {
      result.base = argv[index + 1];
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${argv[index]}`);
    }
  }
  return result;
}

// Applied migrations are immutable: a change is a new forward-only migration.
// The one exception is an explicit re-baseline, i.e. a change that adds
// 000000000000_baseline itself (collapsing the history into one migration).
function evaluateMigrationChanges({ changes, readBaseFile, readCurrentFile }) {
  const errors = [];
  const addedMigrations = [];
  const isRebaseline = changes.some(
    (change) => change.status === 'A' && change.path === BASELINE_PATH,
  );
  const schemaChanged = changes.some(
    (change) => change.path === 'prisma/schema.prisma',
  );
  const schemaRequiresMigration =
    schemaChanged &&
    stripGeneratorBlocks(readBaseFile('prisma/schema.prisma')) !==
      stripGeneratorBlocks(readCurrentFile('prisma/schema.prisma'));

  for (const change of changes) {
    if (!change.path.startsWith('prisma/migrations/')) {
      continue;
    }
    if (change.path === 'prisma/migrations/migration_lock.toml') {
      if (change.status !== 'A' && !isRebaseline) {
        errors.push('prisma/migrations/migration_lock.toml is immutable.');
      }
      continue;
    }

    if (change.status === 'D' && isRebaseline) {
      continue;
    }

    const match = MIGRATION_PATH_PATTERN.exec(change.path);
    if (!match) {
      errors.push(
        `Migration file must use prisma/migrations/<timestamp>_<snake_case>/migration.sql: ${change.path}`,
      );
      continue;
    }

    if (change.status === 'A') {
      addedMigrations.push(match[1]);
      if (!readCurrentFile(change.path).trim()) {
        errors.push(`New migration is empty: ${change.path}`);
      }
    } else if (!isRebaseline) {
      errors.push(
        `Applied migration cannot be ${change.status === 'D' ? 'deleted' : 'edited'}: ${change.path}. Add a new forward-only migration instead.`,
      );
    }
  }

  if (schemaRequiresMigration && addedMigrations.length === 0) {
    errors.push(
      'prisma/schema.prisma changed without a new migration. Generate and commit a forward-only migration.',
    );
  }

  return { errors, addedMigrations };
}

function git(repositoryRoot, args, options = {}) {
  return execFileSync('git', ['-C', repositoryRoot, ...args], {
    encoding: 'utf8',
    stdio: options.stdio || ['ignore', 'pipe', 'pipe'],
  });
}

function parseGitChanges(output) {
  if (!output) {
    return [];
  }

  const fields = output.split('\0').filter(Boolean);
  const changes = [];
  for (let index = 0; index < fields.length; index += 2) {
    const status = fields[index];
    const path = fields[index + 1];
    if (!path) {
      throw new Error(`Could not parse git diff entry for status ${status}`);
    }
    if (status.startsWith('R') || status.startsWith('C')) {
      throw new Error(
        `Migration and schema files cannot be renamed or copied (${status}: ${path}).`,
      );
    }
    changes.push({ status: status[0], path });
  }
  return changes;
}

function appendGitHubOutput(outputPath, key, value) {
  if (!outputPath) {
    return;
  }
  require('node:fs').appendFileSync(outputPath, `${key}=${value}\n`);
}

function run(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (!args.base) {
    throw new Error(
      'Missing --base <git-ref>. CI must compare migrations with the exact target commit.',
    );
  }

  const backendRoot = resolve(__dirname, '..');
  const repositoryRoot = git(backendRoot, ['rev-parse', '--show-toplevel']).trim();
  git(repositoryRoot, ['cat-file', '-e', `${args.base}^{commit}`]);
  git(repositoryRoot, ['merge-base', '--is-ancestor', args.base, 'HEAD']);

  const relativeBackend = resolve(backendRoot)
    .slice(resolve(repositoryRoot).length + 1)
    .replaceAll('\\', '/');
  const diffOutput = git(repositoryRoot, [
    'diff',
    '--name-status',
    '--no-renames',
    '-z',
    `${args.base}...HEAD`,
    '--',
    `${relativeBackend}/prisma`,
  ]);
  const changes = parseGitChanges(diffOutput).map((change) => ({
    ...change,
    path: change.path.slice(relativeBackend.length + 1),
  }));

  const result = evaluateMigrationChanges({
    changes,
    readBaseFile: (path) =>
      git(repositoryRoot, [
        'show',
        `${args.base}:${relativeBackend}/${path}`,
      ]),
    readCurrentFile: (path) => readFileSync(join(backendRoot, path), 'utf8'),
  });

  if (result.errors.length > 0) {
    throw new Error(
      `Migration policy failed:\n- ${result.errors.join('\n- ')}`,
    );
  }

  process.stdout.write(
    `Migration policy passed against ${args.base}. New migrations: ${result.addedMigrations.length}.\n`,
  );
}

if (require.main === module) {
  try {
    run();
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = {
  evaluateMigrationChanges,
  parseGitChanges,
  stripGeneratorBlocks,
};
