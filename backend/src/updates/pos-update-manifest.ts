import { ServiceUnavailableException } from '@nestjs/common';

const VERSION_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/i;
const MAX_MANIFEST_BYTES = 32 * 1024;
const DEFAULT_CACHE_MS = 5 * 60 * 1000;
const DEFAULT_STALE_MS = 24 * 60 * 60 * 1000;
const DEFAULT_TIMEOUT_MS = 5_000;

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

type ManifestResponse = {
  ok: boolean;
  status: number;
  url?: string;
  headers: { get(name: string): string | null };
  text(): Promise<string>;
};

type ManifestFetch = (
  url: string,
  init: {
    method: 'GET';
    headers: Record<string, string>;
    signal: AbortSignal;
    redirect: 'follow';
  },
) => Promise<ManifestResponse>;

type ResolverOptions = {
  fetch?: ManifestFetch;
  now?: () => number;
};

type CachedManifest = {
  sourceUrl: string;
  fetchedAt: number;
  manifest: PosUpdateManifest;
};

function optional(name: string, env: NodeJS.ProcessEnv) {
  return String(env[name] || '').trim();
}

function invalidConfig(message: string) {
  return new ServiceUnavailableException({
    code: 'POS_UPDATE_CONFIG_INVALID',
    message,
  });
}

function unavailable(message: string) {
  return new ServiceUnavailableException({
    code: 'POS_UPDATE_MANIFEST_UNAVAILABLE',
    message,
  });
}

function httpsUrl(value: unknown, field: string) {
  let parsed: URL;
  try {
    parsed = new URL(String(value || ''));
  } catch {
    throw invalidConfig(`${field} must be a valid HTTPS URL.`);
  }
  if (parsed.protocol !== 'https:') {
    throw invalidConfig(`${field} must use HTTPS.`);
  }
  return parsed.toString();
}

function duration(
  env: NodeJS.ProcessEnv,
  name: string,
  fallback: number,
  maximum: number,
) {
  const raw = optional(name, env);
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 0 || value > maximum) {
    throw invalidConfig(`${name} must be an integer between 0 and ${maximum}.`);
  }
  return value;
}

function updateEnabled(env: NodeJS.ProcessEnv) {
  return optional('POS_UPDATE_ENABLED', env).toLowerCase() !== 'false';
}

export function parsePosUpdateManifest(value: unknown): PosUpdateManifest {
  if (!value || typeof value !== 'object') {
    throw invalidConfig('The POS update manifest must be a JSON object.');
  }

  const input = value as Record<string, unknown>;
  if (input.available === false) return { available: false };
  if (input.available !== true) {
    throw invalidConfig('The POS update manifest must declare available=true or available=false.');
  }

  const version = String(input.version || '').trim();
  const sha256 = String(input.sha256 || '').trim().toLowerCase();
  const notes = input.notes === null || input.notes === undefined
    ? null
    : String(input.notes).trim();
  const publishedAt = input.published_at === null || input.published_at === undefined
    ? null
    : String(input.published_at).trim();

  if (!VERSION_PATTERN.test(version)) {
    throw invalidConfig('The POS update version is invalid.');
  }
  if (!SHA256_PATTERN.test(sha256)) {
    throw invalidConfig('The POS update SHA-256 checksum is invalid.');
  }
  if (notes && notes.length > 4_000) {
    throw invalidConfig('The POS update notes are too long.');
  }
  if (typeof input.mandatory !== 'boolean') {
    throw invalidConfig('The POS update mandatory flag must be boolean.');
  }
  if (publishedAt && !Number.isFinite(Date.parse(publishedAt))) {
    throw invalidConfig('The POS update publication date is invalid.');
  }

  return {
    available: true,
    version,
    url: httpsUrl(input.url, 'POS update installer URL'),
    sha256,
    notes: notes || null,
    mandatory: input.mandatory,
    published_at: publishedAt || null,
  };
}

export function readPosUpdateManifest(
  env: NodeJS.ProcessEnv = process.env,
): PosUpdateManifest {
  if (!updateEnabled(env)) return { available: false };

  const version = optional('POS_UPDATE_VERSION', env);
  const url = optional('POS_UPDATE_URL', env);
  const sha256 = optional('POS_UPDATE_SHA256', env).toLowerCase();
  const notes = optional('POS_UPDATE_NOTES', env);
  const publishedAt = optional('POS_UPDATE_PUBLISHED_AT', env);
  const configured = [version, url, sha256].filter(Boolean).length;

  if (configured === 0) return { available: false };
  if (configured !== 3) {
    throw invalidConfig(
      'The POS update manifest is partially configured or contains invalid values.',
    );
  }

  return parsePosUpdateManifest({
    available: true,
    version,
    url,
    sha256,
    notes: notes || null,
    mandatory: optional('POS_UPDATE_MANDATORY', env).toLowerCase() === 'true',
    published_at: publishedAt || null,
  });
}

export class PosUpdateManifestResolver {
  private readonly fetchImpl: ManifestFetch;
  private readonly now: () => number;
  private cached: CachedManifest | null = null;
  private inFlight: { sourceUrl: string; promise: Promise<PosUpdateManifest> } | null = null;

  constructor(options: ResolverOptions = {}) {
    this.fetchImpl = options.fetch || (globalThis.fetch as unknown as ManifestFetch);
    this.now = options.now || Date.now;
  }

  async resolve(
    env: NodeJS.ProcessEnv = process.env,
  ): Promise<PosUpdateManifest> {
    if (!updateEnabled(env)) return { available: false };

    const configuredUrl = optional('POS_UPDATE_MANIFEST_URL', env);
    if (!configuredUrl) return readPosUpdateManifest(env);

    const sourceUrl = httpsUrl(configuredUrl, 'POS_UPDATE_MANIFEST_URL');
    const cacheMs = duration(
      env,
      'POS_UPDATE_MANIFEST_CACHE_MS',
      DEFAULT_CACHE_MS,
      24 * 60 * 60 * 1000,
    );
    const staleMs = duration(
      env,
      'POS_UPDATE_MANIFEST_STALE_MS',
      DEFAULT_STALE_MS,
      7 * 24 * 60 * 60 * 1000,
    );
    const age = this.cached && this.cached.sourceUrl === sourceUrl
      ? this.now() - this.cached.fetchedAt
      : Number.POSITIVE_INFINITY;

    if (this.cached && age <= cacheMs) return this.cached.manifest;
    if (this.inFlight?.sourceUrl === sourceUrl) return this.inFlight.promise;

    const promise = this.fetchRemote(sourceUrl, env)
      .then((manifest) => {
        this.cached = {
          sourceUrl,
          fetchedAt: this.now(),
          manifest,
        };
        return manifest;
      })
      .catch((error) => {
        const staleAge = this.cached && this.cached.sourceUrl === sourceUrl
          ? this.now() - this.cached.fetchedAt
          : Number.POSITIVE_INFINITY;
        if (this.cached && staleAge <= staleMs) return this.cached.manifest;

        const legacy = readPosUpdateManifest(env);
        if (legacy.available) return legacy;
        if (error instanceof ServiceUnavailableException) throw error;
        throw unavailable('The POS update manifest could not be loaded.');
      })
      .finally(() => {
        if (this.inFlight?.promise === promise) this.inFlight = null;
      });

    this.inFlight = { sourceUrl, promise };
    return promise;
  }

  private async fetchRemote(
    sourceUrl: string,
    env: NodeJS.ProcessEnv,
  ): Promise<PosUpdateManifest> {
    const timeoutMs = duration(
      env,
      'POS_UPDATE_MANIFEST_TIMEOUT_MS',
      DEFAULT_TIMEOUT_MS,
      30_000,
    );
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await this.fetchImpl(sourceUrl, {
        method: 'GET',
        redirect: 'follow',
        signal: controller.signal,
        headers: {
          Accept: 'application/json',
          'Cache-Control': 'no-cache',
          'User-Agent': 'ATHR-Operations-API',
        },
      });
      if (!response.ok) {
        throw unavailable(`The POS update manifest returned HTTP ${response.status}.`);
      }
      if (response.url) httpsUrl(response.url, 'POS update manifest response URL');

      const declaredLength = Number(response.headers.get('content-length') || 0);
      if (declaredLength > MAX_MANIFEST_BYTES) {
        throw invalidConfig('The POS update manifest is larger than the allowed limit.');
      }

      const text = await response.text();
      if (!text || Buffer.byteLength(text, 'utf8') > MAX_MANIFEST_BYTES) {
        throw invalidConfig('The POS update manifest size is invalid.');
      }

      let payload: unknown;
      try {
        payload = JSON.parse(text);
      } catch {
        throw invalidConfig('The POS update manifest is not valid JSON.');
      }
      return parsePosUpdateManifest(payload);
    } catch (error) {
      if (error instanceof ServiceUnavailableException) throw error;
      throw unavailable('The POS update manifest request failed.');
    } finally {
      clearTimeout(timer);
    }
  }
}
