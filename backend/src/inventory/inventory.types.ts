import type {
  InventoryCostMovementType,
  InventoryMovementType,
  Prisma,
} from '@prisma/client';

type Numeric = Prisma.Decimal | number | string;

/** Links a cost movement to the purchase documents it belongs to. */
export type CostLinks = {
  purchaseInvoiceId?: string;
  purchaseInvoiceItemId?: string;
  supplierReturnId?: string;
  supplierReturnItemId?: string;
};

export type StockLine = {
  variantId: string;
  /** Signed change of on-hand quantity (Decimal(14,3)); never zero. */
  qtyDelta: Numeric;
  referenceLineId?: string;
  /**
   * Incoming cost per unit. Only meaningful with `ApplyStockCommand.costType`:
   * the warehouse's moving average is recomputed and a cost movement is logged.
   */
  unitCost?: Numeric;
  /** Exact line value when it is not `round(qty * unitCost, 2)` (e.g. a discounted purchase line). */
  value?: Numeric;
  /** `purchase_reversal` only: the average cost to restore. */
  restoreCost?: Numeric;
  links?: CostLinks;
  metadata?: Record<string, unknown>;
};

/**
 * One inventory command against one warehouse. All lines commit together and
 * share `idempotencyKey`; replaying the command returns the first result.
 */
export type ApplyStockCommand = {
  tenantId: string;
  warehouseId: string;
  occurredAt: Date;
  actorId?: string | null;
  type: InventoryMovementType;
  reference: { type: string; id: string };
  idempotencyKey: string;
  /** `true` lets stock go below zero (acceptance-first sales); otherwise available = on_hand - reserved must cover the change. */
  allowNegative: boolean;
  /** Present when lines carry costs; decides how the average moves. */
  costType?: InventoryCostMovementType;
  metadata?: Record<string, unknown>;
  lines: StockLine[];
};

export type StockAfter = {
  variantId: string;
  qtyBefore: Prisma.Decimal;
  qtyAfter: Prisma.Decimal;
  reserved: Prisma.Decimal;
  avgCostBefore: Prisma.Decimal;
  /** Moving average after the command (equals `avgCostBefore` when no cost moved). */
  avgCost: Prisma.Decimal;
};
