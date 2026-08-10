/**
 * The declared allowlist of backend modules permitted to mutate central stock.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * `inventory-ledger-contract.spec.ts` scans `src/` for every module that writes
 * to the central stock table and compares the result against this list. The
 * invariant being protected is that nobody moves stock outside the audited
 * mutation surface — every such write must be paired with a ledger movement.
 *
 * The list used to be inlined in the spec as a literal `toEqual([...])`. That
 * made a legitimate new writer look like a broken test: the failure surfaced as
 * an assertion diff in an inventory spec, with no indication that the correct
 * response was "yes, and that is fine — record it".
 *
 * UPDATING THIS LIST IS EXPECTED — AND MUST BE A CONSCIOUS DECISION
 * ----------------------------------------------------------------
 * Adding an entry is a normal, reviewable event. It is not a workaround for a
 * failing test. Before adding one, confirm the new writer records a matching
 * inventory movement, then add it here in the same pull request as the writer
 * itself, with the reason it is entitled to move stock. A reviewer seeing a
 * diff to this file should read it as "this change widens the audited stock
 * mutation surface" and review it on those terms.
 *
 * Removing an entry is equally deliberate: it asserts that the module no longer
 * touches central stock at all.
 *
 * Paths are relative to `backend/src` and use forward slashes.
 */
export const AUDITED_STOCK_WRITERS: readonly string[] = [
  // Receives supplier deliveries and reverses them on supplier returns.
  'purchasing/purchasing.service.ts',
  // The single writer for acceptance-first sales, including negative-stock
  // deficits (see migration 202607290001_sales_inventory_single_writer).
  'sales/sales.service.ts',
  // Moves stock between locations as paired out/in movements.
  'transfers/transfers.service.ts',
];

/**
 * This module is itself excluded from the writer scan. It is an allowlist, not
 * a writer, and excluding it keeps a future editor from accidentally enrolling
 * the file by mentioning a mutation call in a comment.
 */
export const AUDITED_STOCK_WRITERS_MODULE = 'inventory/audited-stock-writers.ts';
