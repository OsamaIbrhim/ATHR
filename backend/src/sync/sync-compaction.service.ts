import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { compareCursors, formatCursor, parseCursor, type SyncCursor } from './sync-cursor';

const DAY_MS = 24 * 60 * 60 * 1000;
/** Beyond any real transaction id: "everything finished so far". */
const NEWEST: SyncCursor = { txid: 9_223_372_036_854_775_807n, sequence: 9_223_372_036_854_775_807n };

/**
 * Keeps the change stream short. For each tenant it deletes the changes every
 * active till has already applied (below the lowest till cursor) and records
 * the highest deleted position as the tenant's `sync_floor`; a till whose
 * cursor is below the floor is told to take a fresh snapshot on its next pull.
 * Run it daily (ops endpoint `POST /platform/sync/compact`).
 */
@Injectable()
export class SyncCompactionService {
  constructor(private readonly prisma: PrismaService) {}

  async compact(retentionDays = 30): Promise<{ tenants: number; deleted: number }> {
    const tenants = await this.prisma.tenant.findMany({ select: { id: true, sync_floor: true } });
    let deleted = 0;
    for (const tenant of tenants) deleted += await this.compactTenant(tenant.id, tenant.sync_floor, retentionDays);
    return { tenants: tenants.length, deleted };
  }

  private async compactTenant(tenantId: string, storedFloor: string, retentionDays: number): Promise<number> {
    const terminals = await this.prisma.posTerminal.findMany({
      where: {
        tenant_id: tenantId,
        is_revoked: false,
        sync_cursor: { not: null },
        last_seen_at: { gte: new Date(Date.now() - retentionDays * DAY_MS) },
      },
      select: { sync_cursor: true },
    });
    // No active till: everything finished can go, and any till that returns starts over.
    const cutoff = terminals
      .map((terminal) => parseCursor(terminal.sync_cursor as string))
      .reduce((lowest, cursor) => (compareCursors(cursor, lowest) < 0 ? cursor : lowest), NEWEST);

    // Never touch the last day of changes, and only changes of finished transactions.
    const [result] = await this.prisma.$queryRaw<Array<{ deleted: number; txid: string | null; sequence: bigint | null }>>`
      WITH gone AS (
        DELETE FROM "SyncChange"
        WHERE "tenant_id" = ${tenantId}::uuid
          AND ("txid", "sequence") <= (${cutoff.txid.toString()}::text::xid8, ${cutoff.sequence}::bigint)
          AND "txid" < pg_snapshot_xmin(pg_current_snapshot())
          AND "created_at" < now() - interval '1 day'
        RETURNING "txid", "sequence"
      ), top AS (
        SELECT "txid"::text AS txid, "sequence" FROM gone ORDER BY "txid" DESC, "sequence" DESC LIMIT 1
      )
      SELECT (SELECT count(*) FROM gone)::int AS deleted, top.txid, top.sequence
      FROM (SELECT 1) one LEFT JOIN top ON true`;

    if (result.txid !== null && result.sequence !== null) {
      const highest: SyncCursor = { txid: BigInt(result.txid), sequence: result.sequence };
      if (compareCursors(highest, parseCursor(storedFloor)) > 0) {
        await this.prisma.tenant.update({ where: { id: tenantId }, data: { sync_floor: formatCursor(highest) } });
      }
    }
    return result.deleted;
  }
}
