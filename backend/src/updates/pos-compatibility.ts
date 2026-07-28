import { ServiceUnavailableException } from '@nestjs/common';

const VERSION_PATTERN = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/;

function optional(name: string): string {
  return String(process.env[name] || '').trim();
}

function parseVersion(value: string) {
  const match = VERSION_PATTERN.exec(value.trim());
  if (!match) return null;
  return {
    core: [Number(match[1]), Number(match[2]), Number(match[3])],
    prerelease: match[4] ? match[4].split('.') : [],
  };
}

function compareIdentifier(left: string, right: string) {
  const leftNumeric = /^\d+$/.test(left);
  const rightNumeric = /^\d+$/.test(right);
  if (leftNumeric && rightNumeric) return Number(left) - Number(right);
  if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1;
  return left.localeCompare(right);
}

export function comparePosVersions(leftValue: string, rightValue: string) {
  const left = parseVersion(leftValue);
  const right = parseVersion(rightValue);
  if (!left || !right) throw new Error('Invalid semantic version');
  for (let index = 0; index < left.core.length; index += 1) {
    const difference = left.core[index] - right.core[index];
    if (difference !== 0) return difference;
  }
  if (left.prerelease.length === 0 && right.prerelease.length > 0) return 1;
  if (right.prerelease.length === 0 && left.prerelease.length > 0) return -1;
  const length = Math.max(left.prerelease.length, right.prerelease.length);
  for (let index = 0; index < length; index += 1) {
    const leftPart = left.prerelease[index];
    const rightPart = right.prerelease[index];
    if (leftPart === undefined) return -1;
    if (rightPart === undefined) return 1;
    const difference = compareIdentifier(leftPart, rightPart);
    if (difference !== 0) return difference;
  }
  return 0;
}

function positiveInteger(name: string, fallback: number): number {
  const raw = optional(name);
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new ServiceUnavailableException({
      code: 'POS_COMPATIBILITY_CONFIG_INVALID',
      message: `${name} must be a positive integer.`,
    });
  }
  return parsed;
}

export type PosCompatibilityManifest = {
  api_protocol: { minimum: number; maximum: number };
  minimum_pos_version: string;
  backend_version: string;
  deployment_sha: string | null;
  require_protocol_headers: boolean;
  server_time: string;
};

export function readPosCompatibilityManifest(): PosCompatibilityManifest {
  const minimum = positiveInteger('POS_PROTOCOL_MIN', 2);
  const maximum = positiveInteger('POS_PROTOCOL_MAX', 2);
  const minimumPosVersion = optional('POS_MIN_APP_VERSION') || '1.4.0';
  if (minimum > maximum || !parseVersion(minimumPosVersion)) {
    throw new ServiceUnavailableException({
      code: 'POS_COMPATIBILITY_CONFIG_INVALID',
      message: 'POS protocol bounds or POS_MIN_APP_VERSION are invalid.',
    });
  }
  return {
    api_protocol: { minimum, maximum },
    minimum_pos_version: minimumPosVersion,
    backend_version:
      optional('POS_BACKEND_VERSION') || optional('npm_package_version') || '1.0.0',
    deployment_sha:
      optional('RAILWAY_GIT_COMMIT_SHA') || optional('GITHUB_SHA') || null,
    require_protocol_headers:
      optional('POS_REQUIRE_PROTOCOL_HEADERS').toLowerCase() === 'true',
    server_time: new Date().toISOString(),
  };
}
