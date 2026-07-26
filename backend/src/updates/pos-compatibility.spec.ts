import { ExecutionContext, HttpException } from '@nestjs/common';
import {
  comparePosVersions,
  readPosCompatibilityManifest,
} from './pos-compatibility';
import { PosProtocolGuard } from './pos-protocol.guard';

describe('POS compatibility contract', () => {
  const original = { ...process.env };

  afterEach(() => {
    process.env = { ...original };
  });

  function context(headers: Record<string, string> = {}) {
    return {
      switchToHttp: () => ({ getRequest: () => ({ headers }) }),
    } as unknown as ExecutionContext;
  }

  function responseOf(operation: () => unknown) {
    try {
      operation();
      throw new Error('Expected compatibility guard to reject the request');
    } catch (error) {
      if (!(error instanceof HttpException)) throw error;
      return {
        status: error.getStatus(),
        response: error.getResponse(),
      };
    }
  }

  it('publishes production-safe protocol defaults', () => {
    delete process.env.POS_PROTOCOL_MIN;
    delete process.env.POS_PROTOCOL_MAX;
    delete process.env.POS_MIN_APP_VERSION;
    delete process.env.POS_REQUIRE_PROTOCOL_HEADERS;
    expect(readPosCompatibilityManifest()).toMatchObject({
      api_protocol: { minimum: 1, maximum: 1 },
      minimum_pos_version: '1.3.0',
      require_protocol_headers: false,
    });
  });

  it('compares semantic versions including prereleases', () => {
    expect(comparePosVersions('1.3.1', '1.3.0')).toBeGreaterThan(0);
    expect(comparePosVersions('1.3.0', '1.3.0-beta.1')).toBeGreaterThan(0);
  });

  it('accepts legacy clients while header enforcement is staged off', () => {
    process.env.POS_REQUIRE_PROTOCOL_HEADERS = 'false';
    expect(new PosProtocolGuard().canActivate(context())).toBe(true);
  });

  it('accepts a supported protocol and application version', () => {
    expect(new PosProtocolGuard().canActivate(context({
      'x-pos-protocol-version': '1',
      'x-pos-app-version': '1.3.1',
    }))).toBe(true);
  });

  it('rejects unsupported protocols as permanent conflicts', () => {
    const result = responseOf(() => new PosProtocolGuard().canActivate(context({
      'x-pos-protocol-version': '2',
      'x-pos-app-version': '1.3.1',
    })));
    expect(result).toMatchObject({
      status: 409,
      response: { code: 'POS_PROTOCOL_UNSUPPORTED', retryable: false },
    });
  });

  it('rejects an application below the configured minimum', () => {
    process.env.POS_MIN_APP_VERSION = '1.4.0';
    const result = responseOf(() => new PosProtocolGuard().canActivate(context({
      'x-pos-protocol-version': '1',
      'x-pos-app-version': '1.3.1',
    })));
    expect(result).toMatchObject({
      status: 426,
      response: { code: 'POS_UPDATE_REQUIRED', retryable: false },
    });
  });

  it('can require upgraded clients after rollout completion', () => {
    process.env.POS_REQUIRE_PROTOCOL_HEADERS = 'true';
    const result = responseOf(() => new PosProtocolGuard().canActivate(context()));
    expect(result).toMatchObject({
      status: 426,
      response: { code: 'POS_PROTOCOL_HEADER_REQUIRED', retryable: false },
    });
  });

  it('fails closed when the configured range is invalid', () => {
    process.env.POS_PROTOCOL_MIN = '3';
    process.env.POS_PROTOCOL_MAX = '2';
    expect(() => readPosCompatibilityManifest()).toThrow(
      'POS protocol bounds or POS_MIN_APP_VERSION are invalid',
    );
  });
});
