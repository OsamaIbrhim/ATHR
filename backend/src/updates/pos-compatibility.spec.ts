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
    expect(readPosCompatibilityManifest()).toMatchObject({
      api_protocol: { minimum: 3, maximum: 3 },
      minimum_pos_version: '1.6.0',
    });
    expect(readPosCompatibilityManifest()).not.toHaveProperty('require_protocol_headers');
  });

  it('compares semantic versions including prereleases', () => {
    expect(comparePosVersions('1.4.1', '1.4.0')).toBeGreaterThan(0);
    expect(comparePosVersions('1.4.0', '1.4.0-beta.1')).toBeGreaterThan(0);
  });

  it('requires the protocol headers on every request', () => {
    for (const headers of [{}, { 'x-pos-protocol-version': '3' }, { 'x-pos-app-version': '1.6.0' }]) {
      expect(responseOf(() => new PosProtocolGuard().canActivate(context(headers)))).toMatchObject({
        status: 426,
        response: { code: 'POS_PROTOCOL_HEADER_REQUIRED', retryable: false },
      });
    }
  });

  it('accepts a supported protocol and application version', () => {
    expect(new PosProtocolGuard().canActivate(context({
      'x-pos-protocol-version': '3',
      'x-pos-app-version': '1.6.0',
    }))).toBe(true);
  });

  it('rejects unsupported protocols as permanent conflicts', () => {
    const result = responseOf(() => new PosProtocolGuard().canActivate(context({
      'x-pos-protocol-version': '4',
      'x-pos-app-version': '1.6.0',
    })));
    expect(result).toMatchObject({
      status: 409,
      response: { code: 'POS_PROTOCOL_UNSUPPORTED', retryable: false },
    });
  });

  it('rejects the retired protocol 2 as a permanent conflict', () => {
    expect(responseOf(() => new PosProtocolGuard().canActivate(context({
      'x-pos-protocol-version': '2',
      'x-pos-app-version': '1.6.0',
    })))).toMatchObject({ status: 409, response: { code: 'POS_PROTOCOL_UNSUPPORTED' } });
  });

  it('rejects an application below the configured minimum', () => {
    process.env.POS_MIN_APP_VERSION = '1.6.0';
    const result = responseOf(() => new PosProtocolGuard().canActivate(context({
      'x-pos-protocol-version': '3',
      'x-pos-app-version': '1.5.9',
    })));
    expect(result).toMatchObject({
      status: 426,
      response: { code: 'POS_UPDATE_REQUIRED', retryable: false },
    });
  });

  it('fails closed when the configured range is invalid', () => {
    process.env.POS_PROTOCOL_MIN = '4';
    process.env.POS_PROTOCOL_MAX = '3';
    expect(() => readPosCompatibilityManifest()).toThrow(
      'POS protocol bounds or POS_MIN_APP_VERSION are invalid',
    );
  });
});
