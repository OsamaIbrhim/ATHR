/**
 * Compile-time contract check, not a public export.
 *
 * These are literal object assignments transcribed directly from the JSON
 * examples in API Contract v1.0 §8–§10, §12, §26–§28, §33–§34. They exist so
 * that `npm run build` / `npm run typecheck` fails the moment an envelope or
 * wire-format interface drifts from the shape documented there. Nothing here
 * is exported from `./index`.
 */

import type {
  CommandAcceptedEnvelope,
  CommandSuccessEnvelope,
  ErrorEnvelope,
  ListEnvelope,
  QueryEnvelope,
} from './envelopes';
import type { MoneyWire, PercentageWire, QuantityWire } from './money';
import type { PageMeta, PageRequest } from './pagination';

// API Contract §8
const queryEnvelopeSample: QueryEnvelope<Record<string, never>> = {
  data: {},
  meta: {
    request_id: 'req_1',
    correlation_id: 'corr_1',
    generated_at: '2026-07-29T01:00:00Z',
    resource_version: 12,
    projection_freshness: { as_of: '2026-07-29T00:59:58Z', lag_ms: 120 },
  },
  links: { self: '/api/v1/example' },
};
void queryEnvelopeSample;

// API Contract §9
const listEnvelopeSample: ListEnvelope<Record<string, never>> = {
  data: [],
  page: { limit: 50, next_cursor: null, previous_cursor: null, has_more: false },
  meta: { request_id: 'req_1', generated_at: '2026-07-29T01:00:00Z' },
  links: { self: '/api/v1/example', next: null },
};
void listEnvelopeSample;

// API Contract §10 — synchronous completed command
const commandSuccessSample: CommandSuccessEnvelope<Record<string, never>> = {
  data: {
    resource: {},
    command: { command_id: 'cmd_1', status: 'succeeded', resulting_version: 13 },
  },
  meta: { request_id: 'req_1', correlation_id: 'corr_1' },
};
void commandSuccessSample;

// API Contract §10 — accepted async command
const commandAcceptedSample: CommandAcceptedEnvelope = {
  data: {
    operation_id: 'op_1',
    status: 'accepted',
    status_url: '/api/v1/tenants/t_1/operations/op_1',
  },
  meta: { request_id: 'req_1' },
};
void commandAcceptedSample;

// API Contract §12, Error Catalog §3–§4
const errorEnvelopeSample: ErrorEnvelope = {
  error: {
    code: 'SALE_INVALID_STATE',
    category: 'state_conflict',
    message: 'The sale cannot be completed in its current state.',
    retryable: false,
    retry_mode: 'after_user_action',
    outcome: 'no_effect',
    severity: 'error',
    target: 'sale',
    details: [
      {
        type: 'field',
        code: 'VALUE_OUT_OF_RANGE',
        target: 'lines[2].quantity.value',
        message: 'Quantity exceeds the allowed maximum.',
        rejected_value: null,
        allowed: { minimum: '0.001', maximum: '1000.000' },
        resource_id: null,
        client_operation_id: null,
      },
    ],
    current_state: 'payment_resolution_pending',
    current_version: 14,
    required_action: 'resolve_payment_outcome',
    operation_id: null,
    support_reference: 'req_1',
  },
  meta: { request_id: 'req_1', correlation_id: 'corr_1', occurred_at: '2026-07-29T01:00:00Z' },
};
void errorEnvelopeSample;

// API Contract §26–§28
const moneySample: MoneyWire = { amount: '1250.50', currency: 'USD' };
const quantitySample: QuantityWire = { value: '3.250', unit_id: 'uom_1', unit_code: 'kg' };
const percentageSample: PercentageWire = { rate: '0.150000', display_percent: '15.0000' };
void moneySample;
void quantitySample;
void percentageSample;

// API Contract §33–§34
const pageRequestSample: PageRequest = { limit: 50, after: 'cursor_1' };
const pageMetaSample: PageMeta = {
  limit: 50,
  next_cursor: null,
  previous_cursor: null,
  has_more: false,
};
void pageRequestSample;
void pageMetaSample;
