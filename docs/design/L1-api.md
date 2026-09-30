# L1 — عقد الـAPI (تجهيز مخزون المحل)

> مرجع للواجهة (admin). الشاشات: `docs/design/ui/L1-onboarding.md`. المصدر: `backend/src/{opening-balance,adjustments,stock-counts,product-import}`, `backend/src/inventory/low-stock.service.ts`.

## أعراف عامة

- كل المسارات تحت `/api/v1`. الكميات أرقام JSON؛ المال/التكلفة نصوص (2 و4 خانات). حقول التكلفة (`unit_cost`, `value`, `*_value`, `cost_price`) تظهر فقط مع `inventory.position.view-cost`.
- الأخطاء: `{ status_code, code, message, message_ar, field?, details?, data?, request_id }`.
- القوائم: `page`, `page_size` (≤100) → `{ items, page, page_size, total, total_pages }`.
- حد الـJSON = 2mb (دفعة استيراد 2000 صف).

## 1. الرصيد الافتتاحي — `POST /inventory/opening-balance` (`inventory.adjustment.post`)

```
{ branch_id, idempotency_key /*8-100 [A-Za-z0-9._:-]*/, lines: [{ variant_id, qty /*>0, ≤3dp*/, unit_cost? /*≥0, ≤4dp; default = variant cost*/ }] }  // 1..500
```
200 → `{ branch_id, posted, rejected, results: [{ index, variant_id, status: 'posted', qty_after, avg_cost } | { index, variant_id, status: 'rejected', code, message, message_ar }] }`.
لو لم يُرحَّل شيء: 422 `OPENING_BALANCE_REJECTED` + `data.results`.
أكواد السطر: `OPENING_BALANCE_NOT_ALLOWED`, `DUPLICATE_LINE`, `QUANTITY_INVALID`, `VARIANT_NOT_FOUND`, `ITEM_NOT_STOCKED`, `TRACKED_VARIANT_NOT_SUPPORTED`, `QUANTITY_PRECISION_EXCEEDED`. الطلب: 404، `IDEMPOTENCY_KEY_REUSED` (409)، `OPENING_BALANCE_CONFLICT` (409، أعد المحاولة).
"مفتوح بالفعل" = للصنف أي حركة في مخزن الفرع الافتراضي. "كل الأصناف بلا رصيد" ← `GET /inventory/low-stock?status=no_stock_row&branch_id=`.

## 2. التسويات — `/inventory/adjustments`

draft → approved → posted، أو cancelled. لا خطوة إرسال. الاعتماد الذاتي مسموح (السجل يحفظ من فعل ماذا).

| الخطوة | المسار | الصلاحية |
|---|---|---|
| قائمة | `GET /?status&branch_id&q&page&page_size` | `inventory.movement.view` |
| الأسباب | `GET /reasons` | `inventory.movement.view` |
| قراءة | `GET /:id` | `inventory.movement.view` |
| إنشاء مسودة | `POST /` | `inventory.adjustment.request` |
| تعديل مسودة (يستبدل السطور) | `PUT /:id` | `inventory.adjustment.request` |
| اعتماد | `POST /:id/approve` | `inventory.adjustment.approve` |
| ترحيل | `POST /:id/post` | `inventory.adjustment.post` |
| إلغاء | `POST /:id/cancel` `{ reason? }` | request أو approve |

إنشاء: `{ branch_id, note?, command_id?, lines: [{ variant_id, qty_delta /*signed ≠0*/, reason_code, note? }] }` (≤300). الأسباب: `damaged`, `lost_stolen`, `expired`, `correction`, `internal_use`, `gift`, `other` (يتطلب note).
القائمة: `items: [{ id, adjustment_number, status, branch, note, created_at, created_by, line_count, net_value? }]` + `status_counts`.
التفاصيل: `{ id, adjustment_number, status, branch, warehouse_id, note, created|approved|posted|cancelled: { id, name, at }|null, cancellation_reason, items: [{ id, variant: { id, sku, label, name_ar, name_en }, qty_delta, reason_code, note, qty_on_hand, qty_before, qty_after, unit_cost?, value? }], totals: { line_count, increase_qty, decrease_qty, increase_value?, decrease_value?, net_value? } }`.
أخطاء: 422 للسطر (`data.line_index`, `data.variant_id`): `DUPLICATE_LINE`, `ADJUSTMENT_NOTE_REQUIRED`, `ADJUSTMENT_REASON_INVALID`, `TRACKED_VARIANT_NOT_SUPPORTED`, `ITEM_NOT_STOCKED`, `VARIANT_NOT_FOUND`, `QUANTITY_PRECISION_EXCEEDED`. 409: `ADJUSTMENT_NOT_DRAFT`, `ADJUSTMENT_NOT_APPROVED`, `ADJUSTMENT_ALREADY_POSTED`, `INVENTORY_INSUFFICIENT_AVAILABLE_QUANTITY` (المستند يبقى approved).

## 3. الجرد — `/inventory/counts`

المتوقع = رصيد الصنف لحظة أول عدّ له (يُخزن على السطر)؛ الترحيل يطبق `counted − expected_at_count` لكل سطر في أمر واحد.

| Endpoint | الصلاحية |
|---|---|
| `GET /?status&branch_id&page` | request |
| `GET /scope-size?branch_id&scope_type&scope_id` → `{ items }` | request |
| `POST /` بدء | request + approve |
| `GET /:id` | request |
| `GET /:id/review?filter&q&page&page_size` | request + approve |
| `GET /:id/recent?q&page` (ما عدّه المستخدم) | request |
| `POST /:id/entries` (مسح) | request |
| `DELETE /:id/lines/:variantId` (إعادة عدّ) | request + approve |
| `POST /:id/post` | `inventory.adjustment.post` |
| `POST /:id/cancel` | request + approve |

بدء: `{ branch_id, scope: { type: 'all'|'category'|'product_type', id? }, name?, command_id? }` → `{ id, count_number, name, status: 'open'|'posted'|'cancelled', branch, warehouse_id, scope: { type, id, name }, started|posted|cancelled, uncounted_choice, counted_items, counted_units, items_in_scope, active_counters, unknown_scans }`.
جرد مفتوح واحد لكل مخزن ونطاق (والنطاقات المتداخلة مرفوضة: `STOCK_COUNT_ALREADY_OPEN` + `data.count_id`).
مسح: `{ entries: [{ entry_id /*client, 8-100*/, barcode | variant_id, qty? /*1*/, mode?: 'add'|'set', allow_out_of_scope? }] }` (≤100). باركود الكرتونة يضيف `pack_qty`؛ `add` بسالب = تراجع؛ `set` يضبط إجمالي المستخدم؛ نفس `entry_id` لا يكرر.
النتيجة: `{ count_id, results: [{ entry_id, barcode, status, message?, message_ar?, variant|null, pack_qty, added, counted_total, counted_by_me, expected_at_count }] }`؛ `status`: `counted`, `duplicate`, `unknown_barcode`, `variant_not_found`, `not_countable`, `tracked_not_supported`, `out_of_scope`, `precision_exceeded`, `below_zero`, `invalid_quantity`.
المراجعة: `count`, `summary: { counted_items, items_with_variance, uncounted_items, increase_qty, decrease_qty, [increase_value, decrease_value, net_value, uncounted_value] }`, `unknown_barcodes`, `items: [{ variant, status, zeroed, expected_at_count, counted, variance, current_on_hand, movement_after_count, would_go_negative, applied_delta, [unit_cost, variance_value] }]`. فلاتر: `all`, `variance`, `increase`, `decrease`, `matched`, `uncounted`.
ترحيل: `{ uncounted?: 'ignore'|'zero', zero_variant_ids?, keep_variant_ids? }` — الاختيار مطلوب فقط لو يوجد صنف غير معدود برصيد ≠0 (422 `STOCK_COUNT_UNCOUNTED_DECISION_REQUIRED`). أخطاء أخرى: `STOCK_COUNT_EMPTY_SCOPE`, `STOCK_COUNT_SCOPE_NOT_FOUND`, `STOCK_COUNT_CLOSED`, `STOCK_COUNT_WOULD_GO_NEGATIVE` (`data.items`).

## 4. الاستيراد — `POST /products/import`

صلاحيات: `catalog.product.create` + `catalog.variant.create` + `pricing.price-entry.manage` + `pricing.price-book.activate` (+ `inventory.adjustment.post` لو فيه كميات افتتاحية).
```
{ dry_run?, on_existing_sku?: 'skip', price_tax_mode: 'inclusive'|'exclusive', branch_id? /*required with opening_qty*/, rows: [...] }  // 1..2000
```
الصف: `row_ref`, `sku`, `name`, `name_ar`, `barcode`/`barcodes` (`;` أو `,`), `price`, `cost`, `opening_qty`, `unit`, `category`, `product_type` (أرقام أو نص، والأرقام العربية مقبولة). SKU فارغ = أول باركود.
الرد: `{ dry_run, on_existing_sku, summary: { total, ready|created, skipped, failed, out_of_plan, categories_created, opening_quantities }, plan_limit: { limit, current, remaining }, rows: [{ index, row_ref, sku, status: 'ready'|'created'|'skipped'|'failed', variant_id?, errors: [{ code, field, message, message_ar, data? }], warnings }] }`.
أكواد: `IMPORT_NAME_REQUIRED`, `IMPORT_NAME_INVALID`, `IMPORT_NO_IDENTITY`, `IMPORT_SKU_INVALID`, `IMPORT_BARCODE_INVALID`, `IMPORT_PRICE_INVALID`, `IMPORT_COST_INVALID`, `IMPORT_QTY_INVALID`, `IMPORT_QTY_PRECISION`, `IMPORT_DUPLICATE_SKU_IN_FILE`, `IMPORT_DUPLICATE_BARCODE_IN_FILE`, `CATALOG_BARCODE_CONFLICT`, `IMPORT_UNIT_UNKNOWN`, `IMPORT_PRODUCT_TYPE_UNKNOWN`, `IMPORT_PRODUCT_TYPE_NEEDS_ATTRIBUTES`, `ENTITLEMENT_LIMIT_REACHED`, `IMPORT_ROW_FAILED`؛ تخطي `SKU_EXISTS`؛ تحذيرات `IMPORT_PRICE_BELOW_COST`, `IMPORT_QTY_WITHOUT_COST`. الطلب: `IMPORT_BRANCH_REQUIRED`, 404, `PERMISSION_DENIED`, `TAX_NO_ACTIVE_CODE`.
قواعد: الـdry run والتنفيذ نفس الـplanner · create-only · إعادة إرسال دفعة = `skipped` بلا تكرار للكميات · صف = منتج بسيط بصنف واحد (أنواع بمحاور مرفوضة) · الدفعات بين الـchunks لا تتشارك حالة: الواجهة تتحقق من تكرار SKU/باركود عبر الملف كله وتتابع `plan_limit.remaining`.

## 5. قوائم المخزون — `GET /inventory/low-stock` (`inventory.position.view`)

`branch_id`, `status=all|zero|negative|no_stock_row`, `q`, `page`, `page_size` → `items: [{ branch, variant: { id, sku, label, name_ar, name_en, tracking, barcode }, qty_on_hand|null, status, last_sold_at, cost_price? }]` + `counts: { all, zero, negative, no_stock_row }` (`no_stock_row` يتطلب `branch_id`).
