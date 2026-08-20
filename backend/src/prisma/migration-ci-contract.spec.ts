import { readFileSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';

describe('migration CI database isolation', () => {
  const workflowsDir = resolve(process.cwd(), '../.github/workflows');
  // ci.yml specifically, for the assertions below that are about its own
  // structure (migration-gate's isolated databases, the workflow-level
  // concurrency group) rather than about locating a job that could live in
  // any workflow file.
  const workflow = readFileSync(join(workflowsDir, 'ci.yml'), 'utf8');
  const railwayConfig = readFileSync(
    resolve(process.cwd(), 'railway.toml'),
    'utf8',
  );

  // Jobs move between workflow files (hard-load was extracted out of ci.yml
  // into its own file so it could be dispatched without the other 9 jobs --
  // see WP-P1). Scanning every file under .github/workflows/ means this
  // contract survives the next such move instead of re-breaking on it.
  const workflowContents = readdirSync(workflowsDir)
    .filter((file) => file.endsWith('.yml') || file.endsWith('.yaml'))
    .map((file) => readFileSync(join(workflowsDir, file), 'utf8'));

  const getJob = (jobName: string): string => {
    for (const contents of workflowContents) {
      const jobStart = contents.search(new RegExp(`^  ${jobName}:\\r?$`, 'm'));

      if (jobStart === -1) {
        continue;
      }

      const remainingJobs = contents.slice(jobStart + 1);
      const nextJob = remainingJobs.search(/^  [a-z0-9-]+:\r?$/m);

      return nextJob === -1
        ? contents.slice(jobStart)
        : contents.slice(jobStart, jobStart + 1 + nextJob);
    }

    // Not found anywhere under .github/workflows/ -- fail loud. A job that
    // silently disappeared (renamed, deleted, moved without updating this
    // spec) is exactly the case this contract exists to catch.
    throw new Error(
      `job "${jobName}" not found in any .github/workflows/*.yml file`,
    );
  };

  it('uses a separate PostgreSQL database for each migration target and shadow', () => {
    const databaseNames = [
      'athr_migrations_clean',
      'athr_migrations_clean_shadow',
      'athr_migrations_upgrade',
      'athr_migrations_upgrade_shadow',
    ];

    for (const databaseName of databaseNames) {
      const occurrences = workflow.match(new RegExp(databaseName, 'g')) ?? [];

      expect(occurrences.length).toBeGreaterThanOrEqual(2);
      expect(workflow).toContain(`localhost:5432/${databaseName}`);
    }

    expect(new Set(databaseNames).size).toBe(databaseNames.length);
    expect(workflow).toContain('createdb');
    expect(workflow).not.toMatch(/athr_migrations\?schema=/);
  });

  it('authorizes destructive reset only in local seeded CI jobs', () => {
    for (const jobName of ['hard-smoke', 'hard-load']) {
      const job = getJob(jobName);

      expect(job).toContain(
        'DATABASE_URL: postgresql://postgres:postgres@localhost:5432/athr_perf',
      );
      expect(job).toContain('npm run prisma:seed');
      expect(job).toContain(
        'ALLOW_DEVELOPMENT_ACCOUNTING_RESET: reset-development-accounting',
      );
      expect(job).not.toContain('ALLOW_REMOTE_DEVELOPMENT_ACCOUNTING_RESET');
      expect(job).toContain('PERF_LOGIN_PHONE: "+200100000000"');
    }

    expect(getJob('hard-load')).toContain(
      'PERF_CASHIER_PHONE: "+200100000002"',
    );
    expect(workflow).not.toMatch(/PERF_(?:LOGIN|CASHIER)_PHONE:\s+\+\d/);
  });

  it('keeps scheduled load tests isolated from push and pull-request gates', () => {
    expect(workflow).toContain(
      'group: ci-${{ github.workflow }}-${{ github.event_name }}-${{ github.ref }}',
    );
    expect(workflow).toContain('cancel-in-progress: true');
  });

  it('runs production migrations before deploy without coupling server startup', () => {
    expect(railwayConfig).toContain(
      'preDeployCommand = ["npm run prisma:migrate:deploy"]',
    );
    expect(railwayConfig).toContain(
      'startCommand = "dumb-init -- node dist/src/main.js"',
    );

    const startCommand = railwayConfig.match(/^startCommand\s*=.*$/m)?.[0];

    expect(startCommand).toBeDefined();
    expect(startCommand).not.toMatch(/prisma|migrate/i);
  });
});
