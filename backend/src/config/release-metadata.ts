const SHA_PATTERN = /^[a-f0-9]{7,40}$/i;

function clean(value: string | undefined, fallback: string) {
  const normalized = String(value || '').trim();
  return normalized || fallback;
}

export function releaseMetadata(
  env: NodeJS.ProcessEnv = process.env,
) {
  const commitCandidate = clean(
    env.ATHR_COMMIT_SHA ||
      env.RAILWAY_GIT_COMMIT_SHA ||
      env.VERCEL_GIT_COMMIT_SHA,
    'unknown',
  );

  return {
    product: 'ATHR',
    service: 'athr-api',
    version: clean(env.ATHR_APP_VERSION, '1.0.0'),
    commit: SHA_PATTERN.test(commitCandidate)
      ? commitCandidate.toLowerCase()
      : 'unknown',
    environment: clean(
      env.ATHR_ENVIRONMENT || env.NODE_ENV,
      'development',
    ),
    configuration_schema: 1,
  } as const;
}
