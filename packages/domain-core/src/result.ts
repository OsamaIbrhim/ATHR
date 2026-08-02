export interface DomainFailure {
  readonly code: string;
  readonly message: string;
}

export type Result<TValue, TFailure extends DomainFailure = DomainFailure> =
  | { readonly ok: true; readonly value: TValue }
  | { readonly ok: false; readonly failure: TFailure };

export function ok<TValue>(value: TValue): Result<TValue, never> {
  return { ok: true, value };
}

export function fail<TFailure extends DomainFailure>(failure: TFailure): Result<never, TFailure> {
  return { ok: false, failure };
}
