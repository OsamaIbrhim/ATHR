import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('development and CI seed contract', () => {
  const seed = readFileSync(
    resolve(process.cwd(), 'prisma/seed.ts'),
    'utf8',
  );
  const validator = readFileSync(
    resolve(process.cwd(), 'prisma/validate-development-seed.mjs'),
    'utf8',
  );
  const packageJson = JSON.parse(
    readFileSync(resolve(process.cwd(), 'package.json'), 'utf8'),
  );

  it('creates every operational role deterministically', () => {
    for (const role of [
      'owner',
      'branch_manager',
      'cashier',
      'warehouse_manager',
      'seller',
    ]) {
      expect(seed).toContain(`role: '${role}'`);
      expect(validator).toContain(`'${role}'`);
    }

    expect(seed).toContain('deterministicRandom');
    expect(seed).not.toContain('Math.random');
  });

  it('validates mutation prerequisites immediately after every normal seed', () => {
    expect(packageJson.scripts['prisma:seed']).toContain(
      'validate-development-seed.mjs',
    );
    expect(packageJson.prisma.seed).toContain(
      'validate-development-seed.mjs',
    );
    expect(validator).toContain('qty_on_hand: { gte: 12 }');
    expect(validator).toContain('qty_reserved: 0');
    expect(validator).toContain('development-seed-contract');
  });
});
