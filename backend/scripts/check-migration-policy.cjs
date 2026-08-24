#!/usr/bin/env node

const { createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { existsSync, readFileSync } = require('node:fs');
const { basename, join, resolve } = require('node:path');

const MIGRATION_PATH_PATTERN =
  /^prisma\/migrations\/(\d{12,14}_[a-z0-9_]+)\/migration\.sql$/;
const REPAIR_RECORD_PATH_PATTERN =
  /^prisma\/migration-repairs\/(\d{12,14}_[a-z0-9_]+)\.json$/;
const INITIAL_REPAIR_MANIFEST_SHA256 =
  'de096ebbd167eec1c0ed08fb0dbddfa77aad79043db74cc32c0e8c526d43d120';

// `migration-base/` (ci.yml's "populated" scenario) checks out this ref and
// seeds against ITS migrations/schema, so this defines the oldest
// pre-existing-data shape the populated path still proves an upgrade
// against. This used to default to `--base` (the PR's own target-branch
// commit): correct for the PR that adds a migration, since --base is then
// still whatever master looked like before that migration existed -- but
// only for as long as the migration stays unmerged. The instant it merges,
// every later run's --base also contains it, migration-base pre-applies it
// against an empty database before seed ever runs, "new migrations" against
// that baseline drops to zero, and the populated-path proof for that
// migration silently stops running -- while still reporting green, because
// nothing failed. Confirmed 2026-08-23: a docs-only PR (touching no
// migrations at all) tripped WP-009 Phase A's populated-path post-check,
// because `--base` had, by then, quietly become a post-Phase-A commit.
//
// Pinning here to a fixed pre-existing commit fixes that, and is the only
// one of the two workable fixes: the other candidate -- seed against
// whatever HEAD's own seed.ts produces before HEAD's migrations apply --
// stops working the moment seed.ts itself is fixed not to leave legacy-shape
// (pre-backfill) rows lying around, which this same incident's fix #2
// required doing regardless. Only a checkout frozen from before both that
// migration AND that seed.ts fix can still hand the populated path genuinely
// unmigrated, legacy-shaped data to prove a backfill against.
//
// ceb40e75 = the commit immediately before WP-009 Phase A's first migration
// (80da5a8) landed -- "Merge pull request #81 from
// OsamaIbrhim/fix/wp-009-p0.5-receive-composite-fk". Bump this pin (and this
// comment) only when a later phase's own populated-path proof needs a newer
// floor -- an older pin never invalidates a newer migration's proof, it just
// makes the populated path apply more history before seeding, which is
// strictly more coverage, not less.
const POPULATED_PROOF_BASELINE_REF =
  'ceb40e751e773417d8cbc828649263a687b9fa1d';

function sha256(content) {
  return createHash('sha256').update(content).digest('hex');
}

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
    const argument = argv[index];
    if (argument === '--base') {
      result.base = argv[index + 1];
      index += 1;
    } else if (argument === '--github-output') {
      result.githubOutput = argv[index + 1];
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }
  return result;
}

function evaluateMigrationChanges({
  changes,
  repairs,
  readBaseFile,
  readCurrentFile,
}) {
  const errors = [];
  const changedMigrationFiles = changes.filter((change) =>
    change.path.startsWith('prisma/migrations/'),
  );
  const schemaChanged = changes.some(
    (change) => change.path === 'prisma/schema.prisma',
  );

  const schemaRequiresMigration =
    schemaChanged &&
    stripGeneratorBlocks(readBaseFile('prisma/schema.prisma')) !==
    stripGeneratorBlocks(readCurrentFile('prisma/schema.prisma'));

  const addedMigrations = [];
  const approvedRepairs = [];

  for (const change of changedMigrationFiles) {
    if (change.path === 'prisma/migrations/migration_lock.toml') {
      if (change.status !== 'A') {
        errors.push(
          'prisma/migrations/migration_lock.toml is immutable after the initial migration setup.',
        );
      }
      continue;
    }

    const match = MIGRATION_PATH_PATTERN.exec(change.path);
    if (!match) {
      errors.push(
        `Migration file must use prisma/migrations/<timestamp>_<snake_case>/migration.sql: ${change.path}`,
      );
      continue;
    }

    const migration = match[1];
    if (change.status === 'A') {
      addedMigrations.push(migration);
      const current = readCurrentFile(change.path);
      if (!current.trim()) {
        errors.push(`New migration is empty: ${change.path}`);
      }
      continue;
    }

    if (change.status === 'D') {
      errors.push(`Applied migration cannot be deleted: ${change.path}`);
      continue;
    }

    const baseHash = sha256(readBaseFile(change.path));
    const repairedHash = sha256(readCurrentFile(change.path));
    const repair = repairs.find(
      (candidate) =>
        candidate.migration === migration &&
        candidate.baseSha256 === baseHash &&
        candidate.repairedSha256 === repairedHash,
    );

    if (!repair) {
      errors.push(
        `Applied migration cannot be edited: ${change.path}. Add a new forward-only migration instead.`,
      );
      continue;
    }

    if (!repair.upgradeFromRef || !repair.incident) {
      errors.push(
        `Approved repair ${migration} must document upgradeFromRef and incident.`,
      );
      continue;
    }
    approvedRepairs.push(repair);
  }

  if (
    schemaRequiresMigration &&
    addedMigrations.length === 0 &&
    approvedRepairs.length === 0
  ) {
    errors.push(
      'prisma/schema.prisma changed without a new migration. Generate and commit a forward-only migration.',
    );
  }

  const repairRefs = [
    ...new Set(approvedRepairs.map((repair) => repair.upgradeFromRef)),
  ];
  if (repairRefs.length > 1) {
    errors.push(
      `Approved repairs use conflicting upgrade baselines: ${repairRefs.join(', ')}`,
    );
  }

  return {
    errors,
    addedMigrations,
    approvedRepairs,
    upgradeFromRef: repairRefs[0] || null,
  };
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
    '-z',
    `${args.base}...HEAD`,
    '--',
    `${relativeBackend}/prisma`,
  ]);
  const changes = parseGitChanges(diffOutput).map((change) => ({
    ...change,
    path: change.path.slice(relativeBackend.length + 1),
  }));

  const repairManifestRelativePath = 'prisma/migration-repairs.json';
  const repairManifestPath = join(
    backendRoot,
    'prisma',
    'migration-repairs.json',
  );
  const manifestChange = changes.find(
    (change) => change.path === repairManifestRelativePath,
  );
  let repairManifestContent = null;

  if (manifestChange) {
    if (manifestChange.status !== 'A') {
      throw new Error(
        'prisma/migration-repairs.json is immutable. A repair approval cannot be edited or extended after release.',
      );
    }
    repairManifestContent = readFileSync(repairManifestPath, 'utf8');
    if (sha256(repairManifestContent) !== INITIAL_REPAIR_MANIFEST_SHA256) {
      throw new Error(
        'The initial migration repair manifest does not match the reviewed incident checksum.',
      );
    }
  } else {
    try {
      repairManifestContent = git(repositoryRoot, [
        'show',
        `${args.base}:${relativeBackend}/${repairManifestRelativePath}`,
      ]);
    } catch {
      repairManifestContent = existsSync(repairManifestPath)
        ? readFileSync(repairManifestPath, 'utf8')
        : null;
    }
  }

  const repairs = repairManifestContent
    ? JSON.parse(repairManifestContent).repairs || []
    : [];
  const repairRecordChanges = changes.filter((change) =>
    change.path.startsWith('prisma/migration-repairs/'),
  );
  for (const change of repairRecordChanges) {
    const match = REPAIR_RECORD_PATH_PATTERN.exec(change.path);
    if (!match) {
      throw new Error(
        `Repair record must use prisma/migration-repairs/<migration>.json: ${change.path}`,
      );
    }
    if (change.status !== 'A') {
      throw new Error(
        `Migration repair records are append-only and immutable: ${change.path}`,
      );
    }

    const record = JSON.parse(
      readFileSync(join(backendRoot, change.path), 'utf8'),
    );
    if (
      record.version !== 1 ||
      record.migration !== match[1] ||
      !record.baseSha256 ||
      !record.repairedSha256 ||
      !record.upgradeFromRef ||
      !record.incident
    ) {
      throw new Error(`Invalid migration repair record: ${change.path}`);
    }
    repairs.push(record);
  }

  const result = evaluateMigrationChanges({
    changes,
    repairs,
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

  const upgradeRef = result.upgradeFromRef || args.base; // TEMP DRILL: revert to the pre-fix fallback
  git(repositoryRoot, ['cat-file', '-e', `${upgradeRef}^{commit}`]);
  appendGitHubOutput(args.githubOutput, 'upgrade_ref', upgradeRef);

  const summary = [
    `Migration policy passed against ${args.base}.`,
    `Upgrade baseline: ${upgradeRef}.`,
    `New migrations: ${result.addedMigrations.length || 0}.`,
    `Exact incident repairs: ${result.approvedRepairs.length || 0}.`,
  ];
  process.stdout.write(`${summary.join('\n')}\n`);
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
  sha256,
  stripGeneratorBlocks,
};
