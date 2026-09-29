import { readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';

describe('deployment contract', () => {
  const workflowsDir = resolve(process.cwd(), '../.github/workflows');
  const railwayConfig = readFileSync(
    resolve(process.cwd(), 'railway.toml'),
    'utf8',
  );

  it('authorizes destructive development reset only in the local hard-load database', () => {
    const hardLoad = readFileSync(join(workflowsDir, 'hard-load.yml'), 'utf8');

    expect(hardLoad).toContain(
      'DATABASE_URL: postgresql://postgres:postgres@localhost:5432/athr_perf',
    );
    expect(hardLoad).toContain('npm run prisma:seed');
    expect(hardLoad).toContain(
      'ALLOW_DEVELOPMENT_ACCOUNTING_RESET: reset-development-accounting',
    );
    expect(hardLoad).not.toContain('ALLOW_REMOTE_DEVELOPMENT_ACCOUNTING_RESET');
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
