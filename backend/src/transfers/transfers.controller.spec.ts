import { TransfersController } from './transfers.controller';
import { TENANT_A, contextFor } from '../identity/testing/cross-tenant-harness';

// WP-007 Phase A: every transfer entry point takes the resolved TenantContext first.
const ctx = contextFor(TENANT_A);

describe('TransfersController command forwarding', () => {
  const actor = {
    sub: '11111111-1111-4111-8111-111111111111',
    role: 'warehouse_manager' as const,
    branch_id: '22222222-2222-4222-8222-222222222222',
  };
  const request = { user: actor } as any;

  function setup() {
    const service = {
      ship: jest.fn().mockResolvedValue({ id: 'transfer-1' }),
      receive: jest.fn().mockResolvedValue({ id: 'transfer-1' }),
    };
    return {
      service,
      controller: new TransfersController(service as any),
    };
  }

  it('keeps legacy empty-body ship requests compatible with the command DTO', async () => {
    const { controller, service } = setup();

    await controller.ship(
      ctx,
      'transfer-1',
      undefined as any,
      request,
    );

    expect(service.ship).toHaveBeenCalledWith(
      ctx,
      'transfer-1',
      {},
      actor,
    );
  });

  it('keeps legacy empty-body receive requests as full receipts', async () => {
    const { controller, service } = setup();

    await controller.receive(
      ctx,
      'transfer-1',
      undefined as any,
      request,
    );

    expect(service.receive).toHaveBeenCalledWith(
      ctx,
      'transfer-1',
      {},
      actor,
    );
  });
});
