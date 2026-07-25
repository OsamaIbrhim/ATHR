import { ServiceUnavailableException } from '@nestjs/common';
import { readPosUpdateManifest } from './updates.controller';

const names = [
  'POS_UPDATE_VERSION',
  'POS_UPDATE_URL',
  'POS_UPDATE_SHA256',
  'POS_UPDATE_NOTES',
  'POS_UPDATE_MANDATORY',
  'POS_UPDATE_PUBLISHED_AT',
] as const;

function clearUpdateEnvironment() {
  for (const name of names) delete process.env[name];
}

describe('readPosUpdateManifest', () => {
  beforeEach(clearUpdateEnvironment);
  afterAll(clearUpdateEnvironment);

  it('disables updates when no release is configured', () => {
    expect(readPosUpdateManifest()).toEqual({ available: false });
  });

  it('returns a normalized HTTPS manifest', () => {
    process.env.POS_UPDATE_VERSION = '1.4.0';
    process.env.POS_UPDATE_URL = 'https://downloads.example.com/Bold-POS.exe';
    process.env.POS_UPDATE_SHA256 = 'A'.repeat(64);
    process.env.POS_UPDATE_NOTES = 'Reliability fixes';
    process.env.POS_UPDATE_MANDATORY = 'true';
    process.env.POS_UPDATE_PUBLISHED_AT = '2026-07-25T12:00:00.000Z';

    expect(readPosUpdateManifest()).toEqual({
      available: true,
      version: '1.4.0',
      url: 'https://downloads.example.com/Bold-POS.exe',
      sha256: 'a'.repeat(64),
      notes: 'Reliability fixes',
      mandatory: true,
      published_at: '2026-07-25T12:00:00.000Z',
    });
  });

  it('rejects partial or non-HTTPS configuration', () => {
    process.env.POS_UPDATE_VERSION = '1.4.0';
    process.env.POS_UPDATE_URL = 'http://downloads.example.com/Bold-POS.exe';
    process.env.POS_UPDATE_SHA256 = 'b'.repeat(64);

    expect(() => readPosUpdateManifest()).toThrow(
      ServiceUnavailableException,
    );
  });
});
