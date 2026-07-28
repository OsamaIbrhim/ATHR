import { readFileSync } from 'fs';
import { join } from 'path';
import {
  validateRuntimeEnvironment,
  validateSecret,
} from './environment';

const strongJwt =
  '97c902a7a75e5aa54898c728656aaa72d5977d59e1a81086376cd28f53df7c9a';

function validEnvironment(): NodeJS.ProcessEnv {
  return {
    NODE_ENV: 'production',
    DATABASE_URL: 'postgresql://runtime',
    DIRECT_URL: 'postgresql://migrations',
    JWT_SECRET: strongJwt,
    JWT_EXPIRES: '15m',
    REFRESH_EXPIRES: '30d',
    PORT: '3000',
    CORS_ORIGINS: 'https://bold.example,null',
  };
}

describe('runtime environment', () => {
  it('starts without price or offline-accounting keyrings', () => {
    const config = validateRuntimeEnvironment(validEnvironment());

    expect(config).toMatchObject({
      nodeEnv: 'production',
      databaseUrl: 'postgresql://runtime',
      directUrl: 'postgresql://migrations',
      port: 3000,
      corsOrigins: ['https://bold.example', 'null'],
    });
    expect(config).not.toHaveProperty('priceSnapshots');
    expect(config).not.toHaveProperty('offlineAccounting');
  });

  it('keeps JWT validation strict', () => {
    expect(() => validateSecret('JWT_SECRET', 'replace-me')).toThrow();
    expect(() =>
      validateRuntimeEnvironment({
        ...validEnvironment(),
        JWT_SECRET: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      }),
    ).toThrow(/diversity/);
  });

  it('rejects invalid ports and wildcard CORS origins', () => {
    expect(() =>
      validateRuntimeEnvironment({ ...validEnvironment(), PORT: '0' }),
    ).toThrow(/PORT/);
    expect(() =>
      validateRuntimeEnvironment({
        ...validEnvironment(),
        CORS_ORIGINS: '*',
      }),
    ).toThrow(/wildcard/);
  });

  it('documents the plain offline context instead of secret keyrings', () => {
    const example = readFileSync(
      join(process.cwd(), '.env.example'),
      'utf8',
    );

    expect(example).toContain('POS_OFFLINE_CONTEXT_TTL_MS=86400000');
    expect(example).not.toContain('PRICE_SNAPSHOT_KEYS=');
    expect(example).not.toContain('POS_OFFLINE_TICKET_KEYS=');
  });
});
