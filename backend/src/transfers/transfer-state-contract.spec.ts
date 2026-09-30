import { readFileSync } from 'fs';
import { join } from 'path';

describe('transfer state baseline contract', () => {
  const baseline = readFileSync(
    join(
      process.cwd(),
      'prisma/migrations/000000000000_baseline/migration.sql',
    ),
    'utf8',
  );

  it('has partial receipt and explicit transit quantities', () => {
    expect(baseline).toContain("'partially_received'");
    expect(baseline).toContain('shipped_qty');
    expect(baseline).toContain('received_qty');
    expect(baseline).toContain('damaged_qty');
    expect(baseline).toContain('missing_qty');
  });

  it('moves inventory per transfer item through the service, not through a trigger', () => {
    const engineMigration = readFileSync(
      join(
        process.cwd(),
        'prisma/migrations/202609300001_site_model_inventory_engine/migration.sql',
      ),
      'utf8',
    );
    const service = readFileSync(
      join(process.cwd(), 'src/transfers/transfers.service.ts'),
      'utf8',
    );

    expect(baseline).not.toContain('"Transfer_inventory_movement"');
    expect(engineMigration).toContain(
      'DROP TRIGGER "TransferItem_inventory_and_transit_movements"',
    );
    expect(service).toContain("type: 'transfer_out'");
    expect(service).toContain("type: 'transfer_in'");
    expect(service).toContain('this.inventory.apply(tx');
  });

  it('has append-only in-transit accounting', () => {
    expect(baseline).toContain('CREATE TABLE "TransferTransitMovement"');
    expect(baseline).toContain('"TransferTransitMovement_append_only"');
    expect(baseline).toContain('quantity_delta');
    expect(baseline).toContain('in_transit_after');
  });

  it('guards posted transfer documents', () => {
    expect(baseline).toContain('"Transfer_protect_posted_document"');
    expect(baseline).toContain('"TransferItem_protect_posted_document"');
  });

  it('keeps the hard smoke command cross-platform', () => {
    const packageJson = JSON.parse(
      readFileSync(join(process.cwd(), 'package.json'), 'utf8'),
    );
    const hardLoad = readFileSync(
      join(process.cwd(), 'perf/hard-load.mjs'),
      'utf8',
    );

    expect(packageJson.scripts['test:hard:smoke']).toContain(
      'run-hard-suite.mjs --smoke',
    );
    expect(packageJson.scripts['test:hard:smoke']).not.toContain(
      'PERF_SMOKE=1',
    );
    expect(hardLoad).toContain("process.argv.includes('--smoke')");
  });

  it('guards the destructive accounting reset from production and accidents', () => {
    const resetScript = readFileSync(
      join(process.cwd(), 'prisma/reset-development-accounting.ts'),
      'utf8',
    );

    expect(resetScript).toContain("process.env.NODE_ENV === 'production'");
    expect(resetScript).toContain(
      'ALLOW_DEVELOPMENT_ACCOUNTING_RESET',
    );
    expect(resetScript).toContain(
      'ALLOW_REMOTE_DEVELOPMENT_ACCOUNTING_RESET',
    );
    expect(resetScript).toContain('maxWait: 15_000');
    expect(resetScript).toContain('timeout: 120_000');
    expect(resetScript.indexOf('assertDevelopmentResetAllowed();')).toBeLessThan(
      resetScript.indexOf('prisma.$transaction'),
    );
  });
});
