export const API_CONTRACT_VERSION = 1 as const;
export const POS_PROTOCOL_VERSION = 2 as const;

export type ApiContractVersion = typeof API_CONTRACT_VERSION;
export type PosProtocolVersion = typeof POS_PROTOCOL_VERSION;

export interface CursorPage<TItem> {
  readonly items: readonly TItem[];
  readonly nextCursor: string | null;
}

export interface OffsetPage<TItem> {
  readonly items: readonly TItem[];
  readonly page: number;
  readonly pageSize: number;
  readonly total: number;
}

export type {
  ErrorCategory,
  RetryMode,
  OutcomeCertainty,
  ErrorSeverity,
  ProjectionFreshness,
  QueryEnvelopeMeta,
  QueryEnvelopeLinks,
  QueryEnvelope,
  ListEnvelopeMeta,
  ListEnvelopeLinks,
  ListEnvelope,
  CommandResult,
  CommandSuccessEnvelopeData,
  CommandSuccessEnvelopeMeta,
  CommandSuccessEnvelope,
  CommandAcceptedEnvelopeData,
  CommandAcceptedEnvelopeMeta,
  CommandAcceptedEnvelope,
  ErrorDetailType,
  ErrorDetail,
  ErrorEnvelopeBody,
  ErrorEnvelopeMeta,
  ErrorEnvelope,
} from './envelopes';

export type { MoneyWire, QuantityWire, PercentageWire } from './money';

export {
  REQUEST_ID_HEADER,
  CORRELATION_ID_HEADER,
  IDEMPOTENCY_KEY_HEADER,
  IF_MATCH_HEADER,
  ETAG_HEADER,
  RETRY_AFTER_HEADER,
  CLIENT_OPERATION_ID_HEADER,
  ATHR_HEADERS,
} from './headers';
export type { AthrHeaderName } from './headers';

export type { PageRequest, PageMeta } from './pagination';
