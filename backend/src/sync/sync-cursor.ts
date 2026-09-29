import { BadRequestException } from '@nestjs/common';

/**
 * A position in a tenant's change stream: "txid:sequence". Changes are handed
 * out ordered by (txid, sequence), and only once their transaction has
 * finished, so a transaction that commits late can never fall behind a cursor.
 */
export interface SyncCursor {
  readonly txid: bigint;
  readonly sequence: bigint;
}

export function formatCursor(cursor: SyncCursor): string {
  return `${cursor.txid}:${cursor.sequence}`;
}

export function parseCursor(text: string): SyncCursor {
  const match = /^(\d{1,20}):(\d{1,19})$/.exec(text);
  if (!match) throw new BadRequestException('cursor must look like "<txid>:<sequence>"');
  return { txid: BigInt(match[1]), sequence: BigInt(match[2]) };
}

export function compareCursors(a: SyncCursor, b: SyncCursor): number {
  if (a.txid !== b.txid) return a.txid < b.txid ? -1 : 1;
  if (a.sequence !== b.sequence) return a.sequence < b.sequence ? -1 : 1;
  return 0;
}
