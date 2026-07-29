import { releaseMetadata } from './release-metadata';

describe('releaseMetadata', () => {
  it('exposes stable ATHR service identity and validated release fields', () => {
    expect(
      releaseMetadata({
        ATHR_APP_VERSION: '1.2.3',
        ATHR_COMMIT_SHA: 'ABCDEF1234567',
        ATHR_ENVIRONMENT: 'canary',
      }),
    ).toEqual({
      product: 'ATHR',
      service: 'athr-api',
      version: '1.2.3',
      commit: 'abcdef1234567',
      environment: 'canary',
      configuration_schema: 1,
    });
  });

  it('never exposes malformed commit metadata', () => {
    expect(
      releaseMetadata({ ATHR_COMMIT_SHA: 'not-a-sha' }).commit,
    ).toBe('unknown');
  });
});
