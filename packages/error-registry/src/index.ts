export type RetryMode = 'never' | 'safe' | 'after-delay' | 'reconcile';
export type OutcomeCertainty = 'known-success' | 'known-failure' | 'unknown';

export interface ErrorDescriptor<TCode extends string = string> {
  readonly code: TCode;
  readonly retryMode: RetryMode;
  readonly outcome: OutcomeCertainty;
  readonly localizationKey: string;
}

export function defineError<TCode extends string>(
  descriptor: ErrorDescriptor<TCode>,
): Readonly<ErrorDescriptor<TCode>> {
  return Object.freeze({ ...descriptor });
}
