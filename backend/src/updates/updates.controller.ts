import {
  Controller,
  Get,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Public } from '../auth/public.decorator';
import { readPosCompatibilityManifest } from './pos-compatibility';

const VERSION_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/i;

export type PosUpdateManifest =
  | { available: false }
  | {
      available: true;
      version: string;
      url: string;
      sha256: string;
      notes: string | null;
      mandatory: boolean;
      published_at: string | null;
    };

function optional(name: string) {
  return String(process.env[name] || '').trim();
}

export function readPosUpdateManifest(): PosUpdateManifest {
  const version = optional('POS_UPDATE_VERSION');
  const url = optional('POS_UPDATE_URL');
  const sha256 = optional('POS_UPDATE_SHA256').toLowerCase();
  const notes = optional('POS_UPDATE_NOTES');
  const publishedAt = optional('POS_UPDATE_PUBLISHED_AT');
  const configured = [version, url, sha256].filter(Boolean).length;

  if (configured === 0) return { available: false };

  let parsedUrl: URL | null = null;
  try {
    parsedUrl = new URL(url);
  } catch {
    parsedUrl = null;
  }

  const publishedAtValid =
    !publishedAt || Number.isFinite(Date.parse(publishedAt));

  if (
    configured !== 3 ||
    !VERSION_PATTERN.test(version) ||
    !parsedUrl ||
    parsedUrl.protocol !== 'https:' ||
    !SHA256_PATTERN.test(sha256) ||
    !publishedAtValid
  ) {
    throw new ServiceUnavailableException({
      code: 'POS_UPDATE_CONFIG_INVALID',
      message:
        'The POS update manifest is partially configured or contains invalid values.',
    });
  }

  return {
    available: true,
    version,
    url: parsedUrl.toString(),
    sha256,
    notes: notes || null,
    mandatory:
      optional('POS_UPDATE_MANDATORY').toLowerCase() === 'true',
    published_at: publishedAt || null,
  };
}

@Controller('pos-updates')
export class UpdatesController {
  @Public()
  @Get('latest')
  latest() {
    return readPosUpdateManifest();
  }
}

@Controller('pos')
export class PosCompatibilityController {
  @Public()
  @Get('compatibility')
  compatibility() {
    return readPosCompatibilityManifest();
  }
}
