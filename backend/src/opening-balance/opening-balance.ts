import { ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { CONFLICT, domainError } from '../common/domain-error';
import { quantity } from '../common/quantity';
import type { InventoryService } from '../inventory/inventory.service';
import { refuseVariant, type LineRefusal, type StockVariant } from '../inventory/inventory-variants';

type Tx = Prisma.TransactionClient;

export type OpeningLine = {
  /** Position of the line in the caller's request. */
  index: number;
  variantId: string;
  qty: Prisma.Decimal.Value;
  /** Per-unit cost; null = the variant's current cost. */
  unitCost: Prisma.Decimal.Value | null;
};

export type OpeningLineResult =
  | { index: number; variant_id: string; status: 'posted'; qty_after: Prisma.Decimal; avg_cost: Prisma.Decimal }
  | ({ index: number; variant_id: string; status: 'rejected' } & LineRefusal);

export type OpeningInput = {
  tenantId: string;
  warehouseId: string;
  actorId: string;
  idempotencyKey: string;
  /** Id the movements reference (`OpeningBalance:<id>`). */
  referenceId: string;
  lines: OpeningLine[];
  variants: Map<string, StockVariant>;
  /** The caller just created these variants, so none can have a movement yet. */
  variantsAreNew?: boolean;
};

type Candidate = OpeningLine & { qtyDecimal: Prisma.Decimal };

const rejected = (line: OpeningLine, refusal: LineRefusal): OpeningLineResult => ({
  index: line.index,
  variant_id: line.variantId,
  status: 'rejected',
  ...refusal,
});

const OPENING_NOT_ALLOWED: LineRefusal = {
  code: 'OPENING_BALANCE_NOT_ALLOWED',
  message: 'This item already has stock movements in this warehouse; use a stock adjustment instead',
  message_ar: 'لهذا الصنف رصيد أو حركة مسجلة بالفعل في هذا الفرع. استخدم تسوية مخزون لتعديله.',
};

/** The first refusal a line earns before it reaches the database, or null. */
function refusalOf(line: OpeningLine, qty: Prisma.Decimal, input: OpeningInput, seen: Set<string>): LineRefusal | null {
  if (seen.has(line.variantId)) {
    return { code: 'DUPLICATE_LINE', message: 'The same item appears twice in this request', message_ar: 'الصنف مكرر في الطلب.' };
  }
  if (qty.lte(0)) {
    return { code: 'QUANTITY_INVALID', message: 'Quantity must be greater than zero', message_ar: 'الكمية يجب أن تكون أكبر من صفر.' };
  }
  return refuseVariant(input.variants.get(line.variantId), qty);
}

/**
 * Posts starting quantities through the engine, as ONE command for all lines
 * that are allowed, and says what happened to each line. The single opening
 * path: the admin screen and the bulk import both call it.
 *
 * A variant may be opened once per warehouse: any earlier movement refuses it.
 * The check ignores movements of this very key first, so a retried request is
 * a replay and not a refusal, and it runs again after the engine has locked the
 * stock rows, so two concurrent requests with different keys cannot both win.
 * Must run inside the caller's transaction.
 */
export async function postOpeningBalance(
  inventory: Pick<InventoryService, 'apply'>,
  tx: Tx,
  input: OpeningInput,
): Promise<OpeningLineResult[]> {
  const results = new Map<number, OpeningLineResult>();
  const candidates: Candidate[] = [];
  const seen = new Set<string>();
  for (const line of input.lines) {
    const qtyDecimal = quantity(line.qty);
    const refusal = refusalOf(line, qtyDecimal, input, seen);
    seen.add(line.variantId);
    if (refusal) results.set(line.index, rejected(line, refusal));
    else candidates.push({ ...line, qtyDecimal });
  }

  // A key that already holds movements is a retry. The items may have sold since, so a replay is
  // answered from what the key posted, never from today's movements.
  const own = input.variantsAreNew || !candidates.length ? new Map<string, OwnRow>() : await ownMovements(tx, input);
  if (own.size) return replay(tx, input, candidates, results, own);

  const blocked = input.variantsAreNew
    ? new Set<string>()
    : await priorMovements(tx, input, candidates.map((line) => line.variantId));
  const accepted = candidates.filter((line) => {
    if (!blocked.has(line.variantId)) return true;
    results.set(line.index, rejected(line, OPENING_NOT_ALLOWED));
    return false;
  });

  if (accepted.length) {
    const after = await applyOpening(inventory, tx, input, accepted);
    if (!input.variantsAreNew) {
      const late = await priorMovements(tx, input, accepted.map((line) => line.variantId));
      if (late.size) {
        throw domainError(
          CONFLICT,
          'OPENING_BALANCE_CONFLICT',
          'Another request changed this stock while it was being opened; retry',
          'تغيّر رصيد بعض الأصناف أثناء التسجيل. أعد المحاولة.',
          { variant_ids: [...late] },
        );
      }
    }
    for (const line of accepted) {
      const stock = after.get(line.variantId)!;
      results.set(line.index, {
        index: line.index,
        variant_id: line.variantId,
        status: 'posted',
        qty_after: stock.qtyAfter,
        avg_cost: stock.avgCost,
      });
    }
  }
  return input.lines.map((line) => results.get(line.index)!);
}

type OwnRow = { delta: Prisma.Decimal; qtyAfter: Prisma.Decimal; avgCost: Prisma.Decimal | null };

const keyReused = () =>
  domainError(
    CONFLICT,
    'IDEMPOTENCY_KEY_REUSED',
    'This idempotency key was already used for a different opening balance',
    'مفتاح التكرار هذا استُخدم بالفعل لطلب مختلف.',
  );

/** What this key already posted, per variant. */
async function ownMovements(tx: Tx, input: OpeningInput): Promise<Map<string, OwnRow>> {
  const rows = await tx.$queryRaw<
    Array<{ variant_id: string; on_hand_delta: Prisma.Decimal; on_hand_after: Prisma.Decimal; cost_after: Prisma.Decimal | null }>
  >`
    SELECT m."variant_id", m."on_hand_delta", m."on_hand_after", c."cost_after"
    FROM "InventoryMovement" m
    LEFT JOIN "InventoryCostMovement" c
      ON c."tenant_id" = m."tenant_id" AND c."idempotency_key" = m."idempotency_key" AND c."variant_id" = m."variant_id"
    WHERE m."tenant_id" = ${input.tenantId}::uuid AND m."idempotency_key" = ${input.idempotencyKey}
  `;
  return new Map(rows.map((row) => [row.variant_id, { delta: row.on_hand_delta, qtyAfter: row.on_hand_after, avgCost: row.cost_after }]));
}

/**
 * The answer to a retried request: lines the key posted are `posted` (their
 * quantity must match what was asked), lines the first request was refused for
 * stay refused. Anything else means the payload changed under the same key.
 */
async function replay(
  tx: Tx,
  input: OpeningInput,
  candidates: Candidate[],
  results: Map<number, OpeningLineResult>,
  own: Map<string, OwnRow>,
): Promise<OpeningLineResult[]> {
  const requested = new Set(input.lines.map((line) => line.variantId));
  if ([...own.keys()].some((variantId) => !requested.has(variantId))) throw keyReused();
  const unposted: Candidate[] = [];
  for (const line of candidates) {
    const posted = own.get(line.variantId);
    if (!posted) {
      unposted.push(line);
      continue;
    }
    if (!posted.delta.equals(line.qtyDecimal)) throw keyReused();
    results.set(line.index, {
      index: line.index,
      variant_id: line.variantId,
      status: 'posted',
      qty_after: posted.qtyAfter,
      avg_cost: posted.avgCost ?? input.variants.get(line.variantId)!.cost_price,
    });
  }
  if (unposted.length) {
    const blocked = await priorMovements(tx, input, unposted.map((line) => line.variantId));
    for (const line of unposted) {
      if (!blocked.has(line.variantId)) throw keyReused();
      results.set(line.index, rejected(line, OPENING_NOT_ALLOWED));
    }
  }
  return input.lines.map((line) => results.get(line.index)!);
}

async function applyOpening(
  inventory: Pick<InventoryService, 'apply'>,
  tx: Tx,
  input: OpeningInput,
  lines: Candidate[],
) {
  try {
    const after = await inventory.apply(tx, {
      tenantId: input.tenantId,
      warehouseId: input.warehouseId,
      occurredAt: new Date(),
      actorId: input.actorId,
      type: 'opening_balance',
      costType: 'opening_balance',
      reference: { type: 'OpeningBalance', id: input.referenceId },
      idempotencyKey: input.idempotencyKey,
      allowNegative: false,
      lines: lines.map((line) => ({
        variantId: line.variantId,
        qtyDelta: line.qtyDecimal,
        referenceLineId: String(line.index),
        unitCost: line.unitCost ?? input.variants.get(line.variantId)!.cost_price,
      })),
    });
    return new Map(after.map((stock) => [stock.variantId, stock]));
  } catch (error) {
    if (error instanceof ConflictException && error.message.includes('idempotency key')) throw keyReused();
    throw error;
  }
}

/** Variants that already have a movement in the warehouse from any command but this one. */
async function priorMovements(tx: Tx, input: OpeningInput, variantIds: string[]): Promise<Set<string>> {
  if (!variantIds.length) return new Set();
  const rows = await tx.$queryRaw<Array<{ variant_id: string }>>`
    SELECT DISTINCT "variant_id"
    FROM "InventoryMovement"
    WHERE "tenant_id" = ${input.tenantId}::uuid
      AND "warehouse_id" = ${input.warehouseId}::uuid
      AND "variant_id" = ANY(${variantIds}::uuid[])
      AND "idempotency_key" <> ${input.idempotencyKey}
  `;
  return new Set(rows.map((row) => row.variant_id));
}
