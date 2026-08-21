/**
 * The declared allowlist of raw-SQL statements `fakePrisma` is permitted to
 * stub out instead of throwing (WP-T2 / F4).
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * `fakePrisma`'s `$queryRaw`/`$queryRawUnsafe`/`$executeRaw`/`$executeRawUnsafe`
 * throw by default (`cross-tenant-harness.ts`). Ten production files contain
 * raw SQL that a hand-written in-memory fake cannot honestly execute (the
 * original F4 analysis counted nine; `promotions/coupon.repository.ts` was
 * added by WP-008 Phase D afterward) — before this file existed, every one
 * of them silently returned `[]`/`0`, so every spec covering them was green
 * while testing nothing. See
 * `docs/testing/test-fragility-analysis-2026-08-10.md` item F4.
 *
 * A statement belongs on this list ONLY if it neither writes nor locks a real
 * row whose content matters to the test: pure session-level state
 * (`set_config`) or an advisory lock keyed on values that carry no tenant
 * component (`pg_advisory_xact_lock`), whose entire purpose is serialization,
 * not data. Every statement that reads, writes, or locks a real row — even
 * one whose predicate is provably correct on inspection — is deliberately
 * EXCLUDED: allowlisting it would mean nothing ever proves that predicate.
 * Those go to `scripts/verify-raw-sql-tenant-scoping.cjs` against real
 * Postgres instead.
 *
 * UPDATING THIS LIST IS EXPECTED — AND MUST BE A CONSCIOUS DECISION
 * ----------------------------------------------------------------
 * Adding an entry is a normal, reviewable event, but a narrow one: confirm
 * the statement's result is never consumed for a business decision AND that
 * it does not write or lock a row before adding it. A reviewer seeing a diff
 * here should be able to answer "does this statement matter if silently
 * skipped?" — no is the only acceptable answer.
 *
 * MATCHING
 * --------
 * Call sites are not identified by file/line (a fake has no reliable way to
 * observe that) — they are matched by rendering the statement's SQL text
 * (handling both the tagged-template calling form and the `Prisma.sql`
 * composed-object form), collapsing whitespace, and checking for a
 * DISTINCTIVE substring, scoped to the specific method used. Two of the five
 * entries below (`offers.service.ts:66` and `shifts.service.ts:31`) render to
 * textually identical SQL — `pg_advisory_xact_lock(hashtext(...))`, the
 * interpolated value never appears in the matched text — so the method
 * (`$queryRaw` vs `$executeRaw`) is what tells them apart. Do not shorten a
 * marker to a shared prefix (e.g. bare `'set_config('`): that would silently
 * authorize every future `set_config` call in the codebase through one entry,
 * defeating "adding a site must be a visible diff."
 */
export interface RawSqlAllowlistEntry {
  /** Which fake method this entry applies to. */
  readonly method: 'queryRaw' | 'queryRawUnsafe' | 'executeRaw' | 'executeRawUnsafe';
  /**
   * Substring the rendered, whitespace-collapsed statement text must contain.
   * Must be specific to this one call site (see MATCHING above).
   */
  readonly marker: string;
  /** Value the fake returns when this entry matches. */
  readonly stub: unknown;
  /** File:line this entry authorizes, and why it needs no real proof. */
  readonly reason: string;
}

export const RAW_SQL_ALLOWLIST: readonly RawSqlAllowlistEntry[] = [
  {
    method: 'queryRaw',
    marker: 'pg_advisory_xact_lock(hashtext(',
    stub: [],
    reason:
      "offers.service.ts:66 — advisory lock guarding idempotent OfferSuggestion " +
      "creation, keyed on branch_id+variant_id. No row is read or written by " +
      "this statement and the lock key carries no tenant component; the " +
      "tenant predicate that actually matters is the ORM findFirst/create " +
      "immediately after it, inside the same transaction.",
  },
  {
    method: 'executeRaw',
    marker: 'pg_advisory_xact_lock(hashtext(',
    stub: 0,
    reason:
      "shifts.service.ts:31 — advisory lock guarding concurrent shift-open " +
      "for a branch, keyed on branch_id alone. No row is read or written; " +
      "same shape as offers.service.ts:66, distinguished from it here only by " +
      "method ($executeRaw vs $queryRaw) because the rendered SQL text is " +
      "identical (the interpolated branch_id never appears in it).",
  },
  {
    method: 'queryRaw',
    // Starts at the string literal, not `set_config(` — the production
    // statement wraps across lines (`set_config(\n  'bold...'`), so a marker
    // spanning the paren would depend on exactly how many lines the source
    // happens to use and break on a purely cosmetic reformat.
    marker: "'bold.purchase_accounting_document_write', 'on'",
    stub: [],
    reason:
      "purchasing.service.ts:1106 — session-level flag purchasing.service.ts " +
      "sets immediately before the plain purchaseInvoice.update() in reverse() " +
      "so a real Postgres trigger recognizes the write as accounting-document " +
      "traffic. No row effect of its own; the trigger's behavior itself is " +
      "unprovable against the fake either way and is not claimed proven here.",
  },
  {
    method: 'queryRaw',
    marker: "'bold.purchase_accounting_document_write', 'off'",
    stub: [],
    reason: 'purchasing.service.ts:1124 — same flag, cleared immediately after the update. See the :1106 entry.',
  },
  {
    method: 'queryRaw',
    marker: "'bold.transfer_command', 'on'",
    stub: [],
    reason:
      "transfers.service.ts:575 (enableTransferCommand) — same session-flag " +
      "pattern as the purchasing.service.ts pair above, gating a trigger on " +
      "TransferCommand writes. No row effect of its own.",
  },
];
