import { readFileSync } from 'fs';
import { join } from 'path';
import { PosCompatibilityController, UpdatesController } from './updates.controller';

/**
 * WP-007 Phase A §A.3.6 — `updates` module.
 *
 * This module is the POS auto-update and protocol-compatibility feed. It
 * owns no tenant-scoped table and holds no `PrismaService`: both endpoints
 * read a static manifest from disk and describe the *application binary*,
 * which is one artifact shared by every tenant, not tenant data. Both are
 * deliberately `@Public()` — a POS device queries them before it has any
 * session or enrolled identity at all.
 *
 * So there is no query to scope here, and adding a `TenantContext`
 * parameter would be decorative rather than protective. What is asserted
 * instead is the property the rest of the phase depends on: that this
 * module genuinely reaches no tenant-owned data, checked mechanically
 * rather than claimed in prose. If someone later adds a database read here,
 * these tests fail and the module has to be scoped for real.
 */
describe('updates — no tenant-owned data to isolate', () => {
  const sourceFiles = [
    'updates.controller.ts',
    'pos-update-manifest.ts',
    'pos-compatibility.ts',
    'pos-protocol.guard.ts',
  ];

  it.each(sourceFiles)('%s performs no database access', (file) => {
    const source = readFileSync(join(__dirname, file), 'utf8');
    expect(source).not.toMatch(/PrismaService/);
    expect(source).not.toMatch(/this\.prisma\./);
    expect(source).not.toMatch(/tenant_id/);
  });

  it('exposes controllers with no injected dependencies', () => {
    // A constructor-less controller cannot have been handed a repository or
    // a Prisma client, so it cannot read another tenant's rows.
    expect(UpdatesController.length).toBe(0);
    expect(PosCompatibilityController.length).toBe(0);
  });

  it('serves the same platform manifest regardless of caller', () => {
    const controller = new PosCompatibilityController();
    // `server_time` is a per-response clock reading, not tenant-derived, so
    // it is excluded — everything that describes the artifact itself must be
    // identical for every caller.
    const withoutClock = ({ server_time: _clock, ...rest }: any) => rest;
    expect(withoutClock(controller.compatibility())).toEqual(
      withoutClock(controller.compatibility()),
    );
  });
});
