import { actorFor } from '../auth/testing/actors';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { TransfersService } from './transfers.service';
import { TENANT_A, contextFor } from '../identity/testing/cross-tenant-harness';

// WP-007 Phase A: every transfer entry point takes the resolved TenantContext first.
const ctx = contextFor(TENANT_A);

const SOURCE_BRANCH_ID = '11111111-1111-4111-8111-111111111111';
const DESTINATION_BRANCH_ID = '22222222-2222-4222-8222-222222222222';
const OTHER_BRANCH_ID = '33333333-3333-4333-8333-333333333333';
const TRANSFER_ID = '44444444-4444-4444-8444-444444444444';
const TRANSFER_ITEM_ID = '55555555-5555-4555-8555-555555555555';
const VARIANT_ID = '66666666-6666-4666-8666-666666666666';
const SOURCE_ACTOR_ID = '77777777-7777-4777-8777-777777777777';
const DESTINATION_ACTOR_ID = '88888888-8888-4888-8888-888888888888';
const CREATE_COMMAND_ID = '99999999-9999-4999-8999-999999999999';
const SHIP_COMMAND_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const RECEIVE_COMMAND_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const CANCEL_COMMAND_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const SOURCE_WAREHOUSE_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const DESTINATION_WAREHOUSE_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';

// Warehouse managers work across the tenant (tenant-wide scope) from their own branch.
const sourceActor = actorFor('warehouse_manager', { sub: SOURCE_ACTOR_ID, tenantWide: true, branchId: SOURCE_BRANCH_ID });
const destinationActor = actorFor('warehouse_manager', { sub: DESTINATION_ACTOR_ID, tenantWide: true, branchId: DESTINATION_BRANCH_ID });
const branchManager = actorFor('location_manager', { sub: SOURCE_ACTOR_ID, branchId: SOURCE_BRANCH_ID });

const D = (value: number) => new Prisma.Decimal(value);

const pendingTransfer = {
  id: TRANSFER_ID,
  from_branch_id: SOURCE_BRANCH_ID,
  to_branch_id: DESTINATION_BRANCH_ID,
  transfer_number: 'TR-20260723-00000001',
  status: 'pending',
  command_fingerprint: null,
};

const shippedItem = {
  id: TRANSFER_ITEM_ID,
  variant_id: VARIANT_ID,
  qty: D(3),
  shipped_qty: D(3),
  received_qty: D(0),
  damaged_qty: D(0),
  missing_qty: D(0),
  unit_cost: D(50),
};

/**
 * InventoryService double. The engine itself (locking, ledgers, idempotency,
 * the insufficient-stock refusal) is proven against Postgres by
 * `scripts/verify-inventory-engine.cjs`; these specs pin what transfers ask of it.
 */
function inventoryDouble() {
  return {
    defaultWarehouseId: jest.fn(async (_db: unknown, _tenant: string, branchId: string) =>
      branchId === SOURCE_BRANCH_ID ? SOURCE_WAREHOUSE_ID : DESTINATION_WAREHOUSE_ID,
    ),
    apply: jest.fn().mockResolvedValue([
      {
        variantId: VARIANT_ID,
        qtyBefore: D(10),
        qtyAfter: D(7),
        reserved: D(0),
        avgCostBefore: D(50),
        avgCost: D(50),
      },
    ]),
  };
}

function setup(variant: any = { id: VARIANT_ID, sku: 'SKU-1', item_type: 'stocked', base_uom: null }) {
  const loadedTransfer = {
    ...pendingTransfer,
    items: [shippedItem],
    from_branch: { id: SOURCE_BRANCH_ID },
    to_branch: { id: DESTINATION_BRANCH_ID },
  };
  const tx = {
    $queryRaw: jest.fn().mockResolvedValue([]),
    $executeRaw: jest.fn().mockResolvedValue(1),
    transfer: {
      findUniqueOrThrow: jest.fn().mockResolvedValue(loadedTransfer),
      findUnique: jest.fn().mockResolvedValue(loadedTransfer),
    },
    auditLog: {
      create: jest.fn().mockResolvedValue({}),
    },
    branch: {
      count: jest.fn().mockResolvedValue(2),
    },
    productVariant: {
      findMany: jest.fn().mockResolvedValue([variant]),
    },
  };
  const prisma = {
    $transaction: jest.fn((callback) => callback(tx)),
    transfer: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
    },
    $queryRaw: jest.fn(),
  };
  const inventory = inventoryDouble();
  const service = new TransfersService(prisma as any, inventory as any);
  return { service, prisma, tx, loadedTransfer, inventory };
}

function mockCommandFlow(
  service: TransfersService,
  options: {
    transfer?: typeof pendingTransfer;
    items?: typeof shippedItem[];
    replay?: boolean;
    result?: unknown;
  } = {},
) {
  jest
    .spyOn(service as any, 'enableTransferCommand')
    .mockResolvedValue(undefined);
  jest
    .spyOn(service as any, 'lockTransfer')
    .mockResolvedValue(options.transfer || pendingTransfer);
  jest
    .spyOn(service as any, 'replayCommand')
    .mockResolvedValue(options.replay || false);
  jest
    .spyOn(service as any, 'lockItems')
    .mockResolvedValue(options.items || [shippedItem]);
  jest.spyOn(service as any, 'recordCommand').mockResolvedValue(1);
  jest.spyOn(service as any, 'audit').mockResolvedValue({});
  jest
    .spyOn(service as any, 'loadTransfer')
    .mockResolvedValue(options.result || { id: TRANSFER_ID });
}

describe('TransfersService', () => {
  it('prevents a branch manager from creating an outgoing transfer for another branch', async () => {
    const { service, prisma } = setup();

    await expect(
      service.create(
      ctx,
        {
          from_branch_id: OTHER_BRANCH_ID,
          to_branch_id: DESTINATION_BRANCH_ID,
          command_id: CREATE_COMMAND_ID,
          items: [{ variant_id: VARIANT_ID, qty: 1 }],
        },
        branchManager,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  describe('create', () => {
    const createDto = (qty: number) => ({
      from_branch_id: SOURCE_BRANCH_ID,
      to_branch_id: DESTINATION_BRANCH_ID,
      command_id: CREATE_COMMAND_ID,
      items: [{ variant_id: VARIANT_ID, qty }],
    });

    function mockCreateFlow(service: TransfersService) {
      jest.spyOn(service as any, 'enableTransferCommand').mockResolvedValue(undefined);
      jest.spyOn(service as any, 'nextTransferNumber').mockResolvedValue('TR-1');
      jest.spyOn(service as any, 'audit').mockResolvedValue({});
      jest.spyOn(service as any, 'loadTransfer').mockResolvedValue({ id: TRANSFER_ID });
    }

    it('creates all items with one statement and accepts kg quantities for a unit with 3 decimals', async () => {
      const { service, tx } = setup({ id: VARIANT_ID, sku: 'KG-1', item_type: 'stocked', base_uom: { precision: 3 } });
      mockCreateFlow(service);

      await service.create(ctx, createDto(1.25), sourceActor);

      // The transfer header and every item: two statements, however many items.
      expect(tx.$executeRaw).toHaveBeenCalledTimes(2);
    });

    it('rejects fractional quantities for a piece-counted item', async () => {
      const { service, tx } = setup({ id: VARIANT_ID, sku: 'PC-1', item_type: 'stocked', base_uom: { precision: 0 } });
      mockCreateFlow(service);

      await expect(service.create(ctx, createDto(1.5), sourceActor)).rejects.toBeInstanceOf(
        UnprocessableEntityException,
      );
      expect(tx.$executeRaw).not.toHaveBeenCalled();
    });

    it.each(['serial', 'batch'])('refuses a %s-tracked item with a clear error until W2b-2', async (tracking) => {
      const { service, tx } = setup({ id: VARIANT_ID, sku: 'TRK-1', item_type: 'stocked', tracking, base_uom: null });
      mockCreateFlow(service);

      await expect(service.create(ctx, createDto(1), sourceActor)).rejects.toMatchObject({
        response: { code: 'TRACKED_TRANSFER_NOT_SUPPORTED', variant_id: VARIANT_ID },
      });
      expect(tx.$executeRaw).not.toHaveBeenCalled();
    });

    it('does not transfer service or non-stock items', async () => {
      const { service } = setup({ id: VARIANT_ID, sku: 'SVC-1', item_type: 'service', base_uom: null });
      mockCreateFlow(service);

      await expect(service.create(ctx, createDto(1), sourceActor)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });
  });

  it('ships a pending transfer as one inventory command out of the source default warehouse', async () => {
    const { service, tx, inventory } = setup();
    mockCommandFlow(service);

    await service.ship(
      ctx,
      TRANSFER_ID,
      { command_id: SHIP_COMMAND_ID },
      sourceActor,
    );

    expect(inventory.defaultWarehouseId).toHaveBeenCalledWith(tx, ctx.tenantId, SOURCE_BRANCH_ID);
    expect(inventory.apply).toHaveBeenCalledTimes(1);
    const [, command] = inventory.apply.mock.calls[0];
    expect(command).toMatchObject({
      warehouseId: SOURCE_WAREHOUSE_ID,
      type: 'transfer_out',
      allowNegative: false,
      reference: { type: 'Transfer', id: TRANSFER_ID },
    });
    expect(command.lines).toHaveLength(1);
    expect(command.lines[0].qtyDelta.toString()).toBe('-3');
    // items (shipped qty + cost), transfer status, in-transit ledger.
    expect(tx.$executeRaw).toHaveBeenCalledTimes(3);
    expect((service as any).recordCommand).toHaveBeenCalledWith(
      tx,
      ctx,
      TRANSFER_ID,
      'ship',
      SHIP_COMMAND_ID,
      expect.any(String),
      'shipped',
      SOURCE_ACTOR_ID,
    );
    expect((service as any).audit).toHaveBeenCalledWith(
      tx,
      ctx,
      SOURCE_ACTOR_ID,
      'transfer.shipped',
      TRANSFER_ID,
      expect.objectContaining({ command_id: SHIP_COMMAND_ID }),
    );
  });

  it('rejects shipping when available source stock is insufficient', async () => {
    const { service, tx, inventory } = setup();
    mockCommandFlow(service);
    inventory.apply.mockRejectedValueOnce(
      new ConflictException({ code: 'INVENTORY_INSUFFICIENT_AVAILABLE_QUANTITY' }),
    );

    await expect(
      service.ship(
      ctx,
        TRANSFER_ID,
        { command_id: SHIP_COMMAND_ID },
        sourceActor,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(tx.$executeRaw).not.toHaveBeenCalled();
    expect((service as any).recordCommand).not.toHaveBeenCalled();
  });

  it('returns the stored result for an idempotent ship replay without mutating stock', async () => {
    const { service, tx, inventory } = setup();
    const replayed = { id: TRANSFER_ID, status: 'shipped' };
    mockCommandFlow(service, { replay: true, result: replayed });

    await expect(
      service.ship(
      ctx,
        TRANSFER_ID,
        { command_id: SHIP_COMMAND_ID },
        sourceActor,
      ),
    ).resolves.toEqual(replayed);
    expect(inventory.apply).not.toHaveBeenCalled();
    expect(tx.$executeRaw).not.toHaveBeenCalled();
    expect((service as any).recordCommand).not.toHaveBeenCalled();
  });

  it('receives the requested quantity into the destination at the shipped cost and completes the transfer', async () => {
    const { service, inventory } = setup();
    mockCommandFlow(service, {
      transfer: { ...pendingTransfer, status: 'shipped' },
    });

    await service.receive(
      ctx,
      TRANSFER_ID,
      {
        command_id: RECEIVE_COMMAND_ID,
        items: [
          {
            transfer_item_id: TRANSFER_ITEM_ID,
            received_qty: 3,
          },
        ],
      },
      destinationActor,
    );

    expect(inventory.apply).toHaveBeenCalledTimes(1);
    const [, command] = inventory.apply.mock.calls[0];
    expect(command).toMatchObject({
      warehouseId: DESTINATION_WAREHOUSE_ID,
      type: 'transfer_in',
      reference: { type: 'Transfer', id: TRANSFER_ID },
      idempotencyKey: `transfer-in:${TRANSFER_ID}:${RECEIVE_COMMAND_ID}`,
    });
    expect(command.lines).toHaveLength(1);
    expect(command.lines[0].qtyDelta.toString()).toBe('3');
    expect(command.lines[0].unitCost.toString()).toBe('50');
    expect((service as any).recordCommand).toHaveBeenCalledWith(
      expect.anything(),
      ctx,
      TRANSFER_ID,
      'receive',
      RECEIVE_COMMAND_ID,
      expect.any(String),
      'received',
      DESTINATION_ACTOR_ID,
    );
  });

  it('keeps the transfer partially received while units remain in transit', async () => {
    const { service } = setup();
    mockCommandFlow(service, {
      transfer: { ...pendingTransfer, status: 'shipped' },
      items: [{ ...shippedItem, qty: D(5), shipped_qty: D(5) }],
    });

    await service.receive(
      ctx,
      TRANSFER_ID,
      {
        command_id: RECEIVE_COMMAND_ID,
        items: [
          {
            transfer_item_id: TRANSFER_ITEM_ID,
            received_qty: 3,
          },
        ],
      },
      destinationActor,
    );

    expect((service as any).recordCommand).toHaveBeenCalledWith(
      expect.anything(),
      ctx,
      TRANSFER_ID,
      'receive',
      RECEIVE_COMMAND_ID,
      expect.any(String),
      'partially_received',
      DESTINATION_ACTOR_ID,
    );
  });

  it('adds only received units to stock while resolving damaged and missing units', async () => {
    const { service, inventory, tx } = setup();
    mockCommandFlow(service, {
      transfer: { ...pendingTransfer, status: 'shipped' },
    });

    await service.receive(
      ctx,
      TRANSFER_ID,
      {
        command_id: RECEIVE_COMMAND_ID,
        items: [
          {
            transfer_item_id: TRANSFER_ITEM_ID,
            received_qty: 1,
            damaged_qty: 1,
            missing_qty: 1,
          },
        ],
      },
      destinationActor,
    );

    const [, command] = inventory.apply.mock.calls[0];
    expect(command.lines).toHaveLength(1);
    expect(command.lines[0].qtyDelta.toString()).toBe('1');
    // items, transfer status, in-transit ledger (received + damaged + missing rows).
    expect(tx.$executeRaw).toHaveBeenCalledTimes(3);
  });

  it('rejects duplicate transfer items in a receipt command', async () => {
    const { service, inventory } = setup();
    mockCommandFlow(service, {
      transfer: { ...pendingTransfer, status: 'shipped' },
    });

    await expect(
      service.receive(
      ctx,
        TRANSFER_ID,
        {
          command_id: RECEIVE_COMMAND_ID,
          items: [
            {
              transfer_item_id: TRANSFER_ITEM_ID,
              received_qty: 1,
            },
            {
              transfer_item_id: TRANSFER_ITEM_ID,
              received_qty: 1,
            },
          ],
        },
        destinationActor,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(inventory.apply).not.toHaveBeenCalled();
  });

  it('rejects a receipt that resolves more than is in transit', async () => {
    const { service, inventory } = setup();
    mockCommandFlow(service, {
      transfer: { ...pendingTransfer, status: 'shipped' },
    });

    await expect(
      service.receive(
        ctx,
        TRANSFER_ID,
        {
          command_id: RECEIVE_COMMAND_ID,
          items: [{ transfer_item_id: TRANSFER_ITEM_ID, received_qty: 3, damaged_qty: 0.001 }],
        },
        destinationActor,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(inventory.apply).not.toHaveBeenCalled();
  });

  it('cancels only a pending transfer through an idempotent command DTO', async () => {
    const { service, tx, inventory } = setup();
    mockCommandFlow(service);

    await service.cancel(
      ctx,
      TRANSFER_ID,
      {
        command_id: CANCEL_COMMAND_ID,
        reason: 'Created for the wrong destination',
      },
      sourceActor,
    );

    // Nothing was shipped, so cancelling never touches stock.
    expect(inventory.apply).not.toHaveBeenCalled();
    expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
    expect((service as any).recordCommand).toHaveBeenCalledWith(
      tx,
      ctx,
      TRANSFER_ID,
      'cancel',
      CANCEL_COMMAND_ID,
      expect.any(String),
      'cancelled',
      SOURCE_ACTOR_ID,
    );
  });
});
