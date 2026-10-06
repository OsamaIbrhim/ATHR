# W3 — API contract (sales)

> Companion to `W3-sales.md` (design). Describes what the backend does after W3. D9: no compatibility with dev versions; `payment_method` is gone. W3-backend merges together with W3-POS (the POS must send `payments[]`).

**Rule (§0):** a POS sale, whatever W3 checks it fails, is never refused: it is stored and the failure is a *warning code* on the invoice (`warning_codes`). Strict checks (4xx) exist only on online paths (admin, return, exchange, debt collection).

## 1. `POST /pos/sale` (device-authenticated)

Body (`CreateSaleDto`), new or changed fields:

| field | meaning |
|---|---|
| `invoice_number?` | The number the till printed (`POS1-000123`, 1-64 of letters, digits, `.`, `-`, `_`). Cleaned, not validated: an unusable one is dropped. Stored verbatim. Absent/unusable: the server uses `{terminal_code}-{terminal_sequence, 6 digits}` + warning `INVOICE_NUMBER_REASSIGNED`. |
| `payments[]` (1-10) | `{ method: cash\|card\|wallet\|bank_transfer\|credit\|other, amount, tendered?, reference? }`. `amount` is what stays in the till (cash: net of change); `tendered` is for the receipt only. |
| `items[].discount?`, `discount?` | `{ type: 'amount'\|'percent', value }` on a line or the whole invoice. Cleaned: an unusable discount is none. |
| `local_total` | The till total (after discounts, tax included). **Authoritative**: stored as `total`. |

`payment_method` was removed. `terminal_sequence` is no longer unique per terminal (`sync_id` is the idempotency key).

### Arithmetic (shared with the POS: `@athr/domain-core` `priceSale`)
- `unit_price` is the tax-exclusive unit price, `unit_tax` the tax of one unit, as quoted by the catalog the till holds. A line without discount keeps `net = unit_price x qty`, `tax = unit_tax x qty`.
- A discount reduces the price **as the cashier sees it** (gross under a tax-inclusive price, net under tax-exclusive); tax is then recomputed on what is left, per line.
- Percent = `authored x value / 100`; amount = off the whole line (capped at the line). The invoice discount is spread over the lines by what each has left; the last positive line takes the rounding.
- The tax rate and mode used to recompute come from the server's tax resolution at sale time; the amounts come from the till.
- Stored: `SalesInvoice.subtotal` (net before discounts), `discount_amount` (net discount), `tax_amount`, `total` (= `local_total`). `SalesInvoiceItem.discount_amount` (own + share of the invoice discount, tax-exclusive) and `tax_amount` (whole line, after discount); `unit_tax` stays the quoted unit tax. Several lines of one variant merge into one row (their discounts add), never a conflict. The tax snapshot is over the discounted base, at the server quote.

### Warning codes added by W3
`INVOICE_NUMBER_REASSIGNED` (printed number taken or absent: stored `POS1-000123-2`, `-3`, ...), `LOCAL_TOTAL_MISMATCH` (till total differs from the priced lines; the till total is stored), `PAYMENT_TOTAL_MISMATCH` (payments differ from the stored total), `PAYMENT_METHOD_DISABLED` (method not in the tenant's `sales.payment_methods`), `DISCOUNT_ABOVE_LIMIT`, `CUSTOMER_CREDIT_LIMIT_EXCEEDED`, `CREDIT_WITHOUT_CUSTOMER` (a `credit` payment without `customer_phone`: no ledger entry). Existing codes are unchanged.

### Permissions (catalog v11)
`sales.discount.apply` (cashier, location_manager, owner): a discount up to `sales.max_discount_percent` of a line. `sales.discount.override` (location_manager, owner): above it. The server checks the **origin cashier** of the sale; above their limit the sale is accepted with `DISCOUNT_ABOVE_LIMIT`. `customer.account.view` / `customer.account.collect` (cashier, manager, owner), `customer.credit.manage` (manager, owner).

### Response
The invoice with `items` (no `unit_cost`) and `payments` (ordered). A replay (same `sync_id`, same content) returns the stored invoice; the same `sync_id` with different content (payments, discounts and invoice number included) is `409 SALE_IDEMPOTENCY_CONTEXT_CONFLICT`.

### Statements per sale (measured on real Postgres)
17 for 1 or 30 lines (before W3: 16; +1 for the payment rows). With a customer: 18. With a credit payment and a customer: 19 (+1 ledger entry). Discounts and numbering add none.

## 2. Credit and customer accounts (online)
- `Customer.balance` (what the customer owes; negative = store credit) and `credit_limit` (null = none). Always the sum of the customer's `CustomerLedgerEntry` rows (append-only: `sale_credit +`, `payment -`, `refund_credit -`, `adjustment +-`), each with `balance_after`.
- `POST /customers/:id/payments` `{ amount, method (not credit), idempotency_key, shift_id?, note? }` (`customer.account.collect`). Idempotent: same key and content returns the first result (`replayed: true`), other content `409 IDEMPOTENCY_KEY_REUSED`. With `shift_id` (an open shift the actor may work in) cash enters that shift's expected cash. Response `{ id, customer_id, amount, method, balance_after, shift_id, replayed }`.
- `GET /customers/debtors?page&page_size&q` returns `{ items: [{id, name, phone, balance, credit_limit, total_invoices}], total, page, page_size, total_pages, total_owed }` (`customer.account.view`).
- `GET /customers/:id/statement?page&page_size` returns `{ customer: {id, name, phone, balance, credit_limit}, items: [{id, type, amount, balance_after, method, note, occurred_at, sales_invoice?, return_record?}], total, page, ... }`.
- `PUT /customers/:id/credit-limit` `{ credit_limit: number | null }` (`customer.credit.manage`).

## 3. Shifts
Expected cash = opening + cash `SalesPayment`s of the shift's invoices + cash debt collections taken in the shift - returns of the shift with `refund_method = cash`. A late (offline) sale on a closed shift moves it by its cash payments only.

## 4. Returns (`POST /pos/return`)
- New `refund_method?` (`cash` default, `credit`, `card`, `wallet`, `other`). `credit` needs an invoice with a customer (`400 REFUND_TO_CREDIT_NEEDS_CUSTOMER`) and writes a `refund_credit` ledger entry.
- The refund is what was paid: each line's cumulative share of its stored net (after discount) and tax, so returns in several goes add up to the line exactly. Stored per return line as `net_amount` / `tax_amount`; `refund_subtotal` is net after discount.
- Window: tenant `sales.return_window_days` (default 14). Outside it `400 RETURN_WINDOW_EXPIRED`; `0` switches returns off (`400 RETURNS_NOT_ACCEPTED`).
- `GET /pos/invoices/lookup` lines also carry `discount_amount` and `tax_amount`.

## 5. Exchange (`POST /pos/exchange`, online; terminal headers + user token; `returns.return.request` and `sales.sale.create`)
Body: the return fields (`original_invoice_id`, `items`, `reason?`, `refund_method?`) plus `sale`: a full `CreateSaleDto` (own `sync_id`, `invoice_number`, `terminal_sequence`, `payments`, discounts). One transaction books the sale, then the return linked by `Return.new_invoice_id`. Response `{ sale, return }`. Replaying the same `sale.sync_id` returns the same pair; a refused return books no sale. Money settles through the two documents (the new sale's payments, the return's refund method): a refund onto the account plus a new sale paid with `credit` nets on the balance.

## 6. Settings (`GET/PUT /tenant-settings/sales`, also in the POS sync `settings`)
`sales.payment_methods`, `sales.return_window_days`, `sales.max_discount_percent`, `receipt.store_name`, `receipt.footer`, `receipt.show_tax_breakdown`, `receipt.show_branding` (default true; setting it false needs the plan feature `receipt.remove_branding`, Pro and Business; after a downgrade the sync sends true again). The "Powered by Athar" line is printed by the POS. Sync product rows carry `tax_rate` and `tax_mode`; enroll returns `terminal.last_sale_sequence` (the POS continues after it).

## 7. Numbering
Per-tenant `DocumentSequence` (no gaps; a rolled-back document gives its number back): returns `R-000001`, adjustments `ADJ-`, counts `CNT-`, transfers `TR-`, terminal codes `POS1`, `POS2`. POS invoices carry the till's own number (section 1).

## Known limits
- **`TaxRoundingPolicy = 'document'` is not honoured.** Tax is rounded per line for every sale, whatever the tax code says: a document-level rounding would make a line's stored tax depend on the other lines, which breaks returns of single lines. The value is kept in the tax snapshot as written; no W3 behaviour depends on it. Revisit only if a customer needs invoice-level rounding.
- `GET /sales` still filters with the query param `payment_method` (it now matches any payment of the invoice) and returns `payments[]` instead of the column.
- The admin screens still use `payment_method` until W3-admin. The POS (W3-POS) sends `payments[]`, `invoice_number`, discounts and uses `/pos/exchange` and `refund_method`.

## POS notes (W3-POS)
- Local schema v2 (migration, outbox kept): `products.tax_rate/tax_mode`, `sales_local.payments_json/discount_minor_units`. Unsent v1 outbox sales are rewritten to `payments[]` (instapay->bank_transfer, vodafone_cash->wallet, installment->other) with their printed number, so none is lost. Catalog format bumped (`offline-sales-v4`): one full refresh fills tax rate/mode.
- Till-side checks before a sale is stored (the cashier is still present): total = shared `priceSale`, payments = total, methods enabled, credit needs a customer, discount <= limit (cashier: `sales.max_discount_percent`; branch_manager: override). The server still never refuses.
- Exchange: the main process numbers the sale (sequence persisted, retry replays the same command); the register sends return + sale to `/pos/exchange` online.
