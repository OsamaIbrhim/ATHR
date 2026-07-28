export type RuntimeEnvironment = {
  nodeEnv: 'development' | 'test' | 'production';
  databaseUrl: string;
  directUrl: string;
  jwtSecret: string;
  jwtExpires: string;
  refreshExpires: string;
  port: number;
  corsOrigins: string[];
};

const SECRET_PLACEHOLDER =
  /(?:change[-_ ]?me|replace[-_ ]?me|placeholder|example[-_ ]?secret|generate[-_ ]?with|your[-_ ]?(?:secret|key)|secret[-_ ]?here|<|>)/i;
const DURATION = /^\d+[mhd]$/;

function required(name: string, value: string | undefined) {
  const normalized = String(value || '').trim();
  if (!normalized) throw new Error(`${name} must be configured`);
  return normalized;
}

export function validateSecret(name: string, value: string | undefined) {
  const secret = required(name, value);
  if (secret.length < 32) {
    throw new Error(`${name} must contain at least 32 characters`);
  }
  if (SECRET_PLACEHOLDER.test(secret)) {
    throw new Error(`${name} contains a placeholder and must be replaced`);
  }
  if (new Set(secret).size < 10) {
    throw new Error(`${name} does not contain enough character diversity`);
  }
  return secret;
}

function parsePort(value: string | undefined) {
  const port = Number(value || 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT must be an integer between 1 and 65535');
  }
  return port;
}

function parseDuration(
  name: string,
  value: string | undefined,
  fallback: string,
) {
  const duration = String(value || fallback).trim();
  if (!DURATION.test(duration)) {
    throw new Error(`${name} must use an integer followed by m, h, or d`);
  }
  return duration;
}

function parseNodeEnv(
  value: string | undefined,
): RuntimeEnvironment['nodeEnv'] {
  const nodeEnv = String(value || 'development');
  if (!['development', 'test', 'production'].includes(nodeEnv)) {
    throw new Error('NODE_ENV must be development, test, or production');
  }
  return nodeEnv as RuntimeEnvironment['nodeEnv'];
}

function parseCorsOrigins(value: string | undefined) {
  const origins = String(value || 'null')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  if (!origins.length) {
    throw new Error('CORS_ORIGINS must contain at least one origin');
  }
  if (origins.includes('*')) {
    throw new Error('CORS_ORIGINS must not contain a wildcard');
  }
  return origins;
}

export function validateRuntimeEnvironment(
  env: NodeJS.ProcessEnv = process.env,
): RuntimeEnvironment {
  return {
    nodeEnv: parseNodeEnv(env.NODE_ENV),
    databaseUrl: required('DATABASE_URL', env.DATABASE_URL),
    directUrl: required('DIRECT_URL', env.DIRECT_URL),
    jwtSecret: validateSecret('JWT_SECRET', env.JWT_SECRET),
    jwtExpires: parseDuration('JWT_EXPIRES', env.JWT_EXPIRES, '15m'),
    refreshExpires: parseDuration(
      'REFRESH_EXPIRES',
      env.REFRESH_EXPIRES,
      '30d',
    ),
    port: parsePort(env.PORT),
    corsOrigins: parseCorsOrigins(env.CORS_ORIGINS),
  };
}
