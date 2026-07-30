#!/usr/bin/env node
'use strict';

const { spawnSync } = require('node:child_process');
const { existsSync, readdirSync } = require('node:fs');
const path = require('node:path');

const backendRoot = path.resolve(__dirname, '..');
const migrationsDirectory = path.join(backendRoot, 'prisma', 'migrations');
const maximumAttempts = 4;
const retryDelayMilliseconds = 15_000;

function inspectMigrationUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error('DIRECT_URL must be a valid PostgreSQL connection URL.');
  }

  if (!['postgres:', 'postgresql:'].includes(url.protocol)) {
    throw new Error('DIRECT_URL must use the PostgreSQL protocol.');
  }

  const port = url.port === '' ? 5432 : Number(url.port);
  const isSupabasePooler = url.hostname.endsWith('.pooler.supabase.com');
  const transactionPooler =
    isSupabasePooler &&
    (port === 6543 || url.searchParams.get('pgbouncer') === 'true');

  if (transactionPooler) {
    throw new Error(
      'DIRECT_URL cannot use the Supavisor transaction pooler. Use a direct PostgreSQL connection, or the session pooler on port 5432 when direct connectivity is unavailable.',
    );
  }

  return {
    connectionKind:
      url.hostname.startsWith('db.') &&
      url.hostname.endsWith('.supabase.co')
        ? 'supabase-direct'
        : isSupabasePooler
          ? 'supabase-session-pooler'
          : 'postgresql',
    port,
  };
}

function listMigrationFolders() {
  return readdirSync(migrationsDirectory, { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isDirectory() &&
        existsSync(path.join(migrationsDirectory, entry.name, 'migration.sql')),
    )
    .map((entry) => entry.name)
    .sort();
}

function countMigrationFolders() {
  return listMigrationFolders().length;
}

function isAdvisoryLockTimeout(output) {
  return (
    /\bP1002\b/.test(output) &&
    /pg_advisory_lock\(72707369\)/.test(output)
  );
}

function runPrisma(argumentsList, environment) {
  const executable = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  const result = spawnSync(executable, ['prisma', ...argumentsList], {
    cwd: backendRoot,
    env: environment,
    encoding: 'utf8',
  });

  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.error) throw result.error;

  return {
    exitCode: result.status ?? 1,
    output: `${result.stdout ?? ''}\n${result.stderr ?? ''}`,
  };
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function main() {
  const directUrl = process.env.DIRECT_URL;
  if (!directUrl) {
    throw new Error('DIRECT_URL is required for migration deployment.');
  }

  const connection = inspectMigrationUrl(directUrl);
  const environment = {
    ...process.env,
    DATABASE_URL: directUrl,
    DIRECT_URL: directUrl,
  };

  console.log(
    JSON.stringify({
      event: 'athr_migration_runner_started',
      migrationFolders: countMigrationFolders(),
      connectionKind: connection.connectionKind,
      port: connection.port,
    }),
  );

  console.log('Checking migration status before deployment.');
  runPrisma(['migrate', 'status'], environment);

  for (let attempt = 1; attempt <= maximumAttempts; attempt += 1) {
    console.log(`Running migrate deploy (attempt ${attempt}/${maximumAttempts}).`);
    const deployment = runPrisma(['migrate', 'deploy'], environment);

    if (deployment.exitCode === 0) {
      const finalStatus = runPrisma(['migrate', 'status'], environment);
      if (finalStatus.exitCode !== 0) {
        throw new Error(
          'Migration deployment finished but schema status is not up to date.',
        );
      }

      console.log(
        JSON.stringify({
          event: 'athr_migration_runner_succeeded',
          migrationFolders: countMigrationFolders(),
        }),
      );
      return;
    }

    if (
      !isAdvisoryLockTimeout(deployment.output) ||
      attempt === maximumAttempts
    ) {
      throw new Error(`Migration deployment failed on attempt ${attempt}.`);
    }

    console.warn(
      `Another migration runner owns Prisma's advisory lock; retrying in ${retryDelayMilliseconds / 1000}s.`,
    );
    await sleep(retryDelayMilliseconds);
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}

module.exports = {
  countMigrationFolders,
  inspectMigrationUrl,
  isAdvisoryLockTimeout,
  listMigrationFolders,
};
