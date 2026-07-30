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
