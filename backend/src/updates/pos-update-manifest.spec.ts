import { ServiceUnavailableException } from '@nestjs/common';
import {
  parsePosUpdateManifest,
  PosUpdateManifestResolver,
  readPosUpdateManifest,
} from './pos-update-manifest';

const remoteManifest = {
  available: true,
  version: '1.3.3',
  url: 'https://github.com/OsamaIbrhim/bold_system/releases/download/pos-v1.3.3/Bold-POS-Setup-1.3.3.exe',
  sha256: 'a'.repeat(64),
  notes: 'Release notes',
  mandatory: false,
  published_at: '2026-07-27T12:00:00.000Z',
};

function response(payload: unknown) {
  const text = JSON.stringify(payload);
  return {
    ok: true,
    status: 200,
    url: 'https://github.com/OsamaIbrhim/bold_system/releases/download/pos-v1.3.3/pos-update.json',
    headers: { get: (name: string) => name.toLowerCase() === 'content-length' ? String(Buffer.byteLength(text)) : null },
    text: async () => text,
  };
}

describe('POS update manifest', () => {
  it('keeps the legacy Railway environment contract as a fallback', () => {
    expect(readPosUpdateManifest({
      POS_UPDATE_VERSION: '1.3.3',
      POS_UPDATE_URL: remoteManifest.url,
      POS_UPDATE_SHA256: remoteManifest.sha256.toUpperCase(),
      POS_UPDATE_NOTES: 'Release notes',
      POS_UPDATE_MANDATORY: 'false',
      POS_UPDATE_PUBLISHED_AT: remoteManifest.published_at,
    })).toEqual(remoteManifest);
  });

  it('supports an emergency update kill switch', async () => {
    const fetchMock = jest.fn();
    const resolver = new PosUpdateManifestResolver({ fetch: fetchMock as any });
    await expect(resolver.resolve({
      POS_UPDATE_ENABLED: 'false',
      POS_UPDATE_MANIFEST_URL: 'https://example.com/pos-update.json',
    })).resolves.toEqual({ available: false });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('validates remote release manifests strictly', () => {
    expect(parsePosUpdateManifest(remoteManifest)).toEqual(remoteManifest);
    expect(() => parsePosUpdateManifest({
      ...remoteManifest,
      url: 'http://example.com/update.exe',
    })).toThrow(ServiceUnavailableException);
    expect(() => parsePosUpdateManifest({
      ...remoteManifest,
      sha256: 'bad',
    })).toThrow(ServiceUnavailableException);
  });

  it('fetches a remote manifest once and serves it from the short cache', async () => {
    let now = 1_000_000;
    const fetchMock = jest.fn(async () => response(remoteManifest));
    const resolver = new PosUpdateManifestResolver({
      fetch: fetchMock as any,
      now: () => now,
    });
    const env = {
      POS_UPDATE_MANIFEST_URL: 'https://github.com/OsamaIbrhim/bold_system/releases/latest/download/pos-update.json',
      POS_UPDATE_MANIFEST_CACHE_MS: '300000',
    };

    await expect(resolver.resolve(env)).resolves.toEqual(remoteManifest);
    now += 10_000;
    await expect(resolver.resolve(env)).resolves.toEqual(remoteManifest);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('serves the last valid manifest during a temporary release-host outage', async () => {
    let now = 1_000_000;
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(response(remoteManifest))
      .mockRejectedValueOnce(new Error('network down'));
    const resolver = new PosUpdateManifestResolver({
      fetch: fetchMock as any,
      now: () => now,
    });
    const env = {
      POS_UPDATE_MANIFEST_URL: 'https://github.com/OsamaIbrhim/bold_system/releases/latest/download/pos-update.json',
      POS_UPDATE_MANIFEST_CACHE_MS: '1000',
      POS_UPDATE_MANIFEST_STALE_MS: '86400000',
    };

    await resolver.resolve(env);
    now += 2_000;
    await expect(resolver.resolve(env)).resolves.toEqual(remoteManifest);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('rejects a non-HTTPS remote manifest source before making a request', async () => {
    const fetchMock = jest.fn();
    const resolver = new PosUpdateManifestResolver({ fetch: fetchMock as any });
    await expect(resolver.resolve({
      POS_UPDATE_MANIFEST_URL: 'http://example.com/pos-update.json',
    })).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
