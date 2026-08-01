/**
 * Response envelope shapes — API Contract v1.0 §8–§10, §12 and Error Catalog
 * v1.0 §3–§4.
 *
 * `ErrorCategory`/`RetryMode`/`OutcomeCertainty`/`ErrorSeverity` below are wire
 * literal unions transcribed from Error Catalog §5–§8. They intentionally do
 * not import `@athr/error-registry` (kept package-self-contained so contracts
 * stays a pure wire-shape package); each package independently contract-tests
 * its copy against the same source document, so the two cannot silently drift
 * without a test failing on one side.
 */

import type { PageMeta } from './pagination';

export type ErrorCategory =
  | 'request_invalid'
  | 'authentication'
  | 'authorization'
  | 'resource_not_found'
  | 'state_conflict'
  | 'business_rule'
  | 'precondition'
  | 'concurrency'
  | 'idempotency'
  | 'entitlement'
  | 'limit'
  | 'rate_limit'
  | 'dependency'
  | 'provider'
  | 'temporarily_unavailable'
  | 'outcome_unknown'
  | 'partial_completion'
  | 'manual_intervention'
  | 'data_integrity'
  | 'internal';

export type RetryMode =
  | 'never'
  | 'same_request_immediately'
  | 'same_idempotency_key_after_delay'
  | 'after_refresh'
  | 'after_reauthentication'
  | 'after_step_up'
  | 'after_approval'
  | 'after_user_action'
  | 'after_dependency_recovery'
  | 'manual_review_only'
  | 'poll_operation';

export type OutcomeCertainty =
  | 'no_effect'
  | 'committed'
  | 'pending'
  | 'partial'
  | 'unknown'
  | 'not_applicable';

export type ErrorSeverity = 'info' | 'warning' | 'error' | 'critical';

// --- Query envelope — API Contract §8 -------------------------------------

export interface ProjectionFreshness {
  readonly as_of: string;
  readonly lag_ms: number;
}

export interface QueryEnvelopeMeta {
  readonly request_id: string;
  readonly correlation_id?: string;
  readonly generated_at: string;
  readonly resource_version?: number;
  /** Present only for read models that may be eventually consistent. */
  readonly projection_freshness?: ProjectionFreshness;
}

export interface QueryEnvelopeLinks {
  readonly self: string;
}

export interface QueryEnvelope<TData> {
  readonly data: TData;
  readonly meta: QueryEnvelopeMeta;
  readonly links: QueryEnvelopeLinks;
}

// --- List envelope — API Contract §9 ---------------------------------------

export interface ListEnvelopeMeta {
  readonly request_id: string;
  readonly generated_at: string;
}

export interface ListEnvelopeLinks {
  readonly self: string;
  readonly next?: string | null;
}

export interface ListEnvelope<TItem> {
  readonly data: readonly TItem[];
  readonly page: PageMeta;
  readonly meta: ListEnvelopeMeta;
  readonly links: ListEnvelopeLinks;
}

// --- Command envelopes — API Contract §10 -----------------------------------

export interface CommandResult {
  readonly command_id: string;
  readonly status: 'succeeded';
  readonly resulting_version?: number;
}

export interface CommandSuccessEnvelopeData<TResource> {
  readonly resource: TResource;
  readonly command: CommandResult;
}

export interface CommandSuccessEnvelopeMeta {
  readonly request_id: string;
  readonly correlation_id: string;
}

export interface CommandSuccessEnvelope<TResource> {
  readonly data: CommandSuccessEnvelopeData<TResource>;
  readonly meta: CommandSuccessEnvelopeMeta;
}

export interface CommandAcceptedEnvelopeData {
  readonly operation_id: string;
  readonly status: 'accepted';
  readonly status_url: string;
}

export interface CommandAcceptedEnvelopeMeta {
  readonly request_id: string;
}

/** HTTP 202 — operation accepted, not yet a business outcome. API Contract §10/§11. */
export interface CommandAcceptedEnvelope {
  readonly data: CommandAcceptedEnvelopeData;
  readonly meta: CommandAcceptedEnvelopeMeta;
}

// --- Error envelope — API Contract §12, Error Catalog §3–§4 -----------------

export type ErrorDetailType = 'field' | 'item' | 'rule' | 'conflict' | 'limit' | 'dependency';

export interface ErrorDetail {
  readonly type: ErrorDetailType;
  readonly code: string;
  readonly target: string;
  readonly message: string;
  /** Never populated for sensitive fields — Error Catalog §4 rule. */
  readonly rejected_value?: unknown;
  readonly allowed?: Record<string, unknown>;
  readonly resource_id?: string | null;
  readonly client_operation_id?: string | null;
}

export interface ErrorEnvelopeBody {
  readonly code: string;
  readonly category: ErrorCategory;
  readonly message: string;
  readonly retryable: boolean;
  readonly retry_mode: RetryMode;
  readonly outcome: OutcomeCertainty;
  readonly severity: ErrorSeverity;
  readonly target?: string;
  readonly details?: readonly ErrorDetail[];
  readonly current_state?: string;
  readonly current_version?: number;
  readonly required_action?: string;
  readonly operation_id?: string | null;
  readonly support_reference: string;
}

export interface ErrorEnvelopeMeta {
  readonly request_id: string;
  readonly correlation_id: string;
  readonly occurred_at: string;
}

export interface ErrorEnvelope {
  readonly error: ErrorEnvelopeBody;
  readonly meta: ErrorEnvelopeMeta;
}
