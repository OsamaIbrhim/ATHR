# W1–W2 — تصميم قلب البيانات (المخزون + الكتالوج العام)

> مرجع تنفيذي لموجتي W1 و W2 في `docs/ATHR_MASTER_PLAN.md`.
> مبني على D1: لا بيانات حقيقية، فنصمم الشكل الصحيح مباشرة بدون expand/backfill طويل.

## 1. نموذج المواقع (Site model)

**المشكلة:** `Branch` و `Location` نفس المفهوم مكرر (`Location.id == Branch.id` بالاتفاق)، و`InventoryStock` مفتاحه `branch_id` بينما `warehouse_id` nullable ولا أحد يكتبه.

**القرار:**
- `Branch` يبقى هو **الموقع التشغيلي** (محل/فرع). يُحذف `Location` لأنه تكرار.
- `Warehouse` يتبع `Branch` (`branch_id` nullable للمخزن المركزي).
- كل فرع له مخزن بيع افتراضي واحد: `Warehouse.is_default` + partial unique index `(branch_id) WHERE is_default`.
- إنشاء فرع = إنشاء مخزنه الافتراضي في نفس الـtransaction.
- `LegalEntity` يبقى مرتبطًا بالـTenant (بيانات ضريبية/سجل تجاري للإيصال)، بدون ربط بالفرع في MVP.

## 2. الهوية والصلاحيات

**المشكلة:** `User.role` و`User.branch_id` و`granted_capabilities` بجانب `Membership`، وثلاث decorators صلاحيات فوق بعض.

**القرار:**
- `User` = هوية عالمية فقط (اسم، إيميل، تليفون، باسورد).
- `Membership` = كل ما يخص الـTenant: الدور، النطاق (فروع/مخازن)، الحالة.
- decorator واحد: `@RequirePermission('sales.create')`، وguard واحد يقيّم Permission ∩ Scope (والاشتراك لاحقًا في W5 بنفس المكان).

## 3. محرك المخزون

**المشكلة:** الكتابة على المخزون مبعثرة (sales / returns trigger / purchasing raw SQL / transfers)، ودالة `record_inventory_movement` تجمع كل تاريخ الصنف مع كل حركة.

**القرار — `InventoryService` واحد هو الكاتب الوحيد:**

```ts
inventory.apply(tx, {
  tenantId, warehouseId, occurredAt, actorId,
  reference: { type: 'SalesInvoice', id },
  lines: [{ variantId, qtyDelta, referenceLineId, unitCost? }],
  idempotencyKey,           // لكل أمر وليس لكل سطر
  allowNegative: boolean,
}): Promise<StockAfter[]>
```

- **3 statements ثابتة لأي عدد سطور:**
  1. `SELECT ... FOR UPDATE` على صفوف المخزون مرتبة بـ`variant_id` (منع deadlock) + إنشاء الصفوف الناقصة بـ`INSERT ... ON CONFLICT DO NOTHING`.
  2. `UPDATE "InventoryStock" ... FROM (VALUES ...)` (تحديث جماعي).
  3. `INSERT INTO "InventoryMovement" ... ` (جماعي) مع `on_hand_after` المحسوب.
- **Running balance:** الرصيد الحالي في `InventoryStock` هو الحقيقة التشغيلية، والـledger سجل غير قابل للتعديل. التطابق بينهما يُفحص بـreconciliation endpoint/job — **ليس** داخل كل عملية بيع.
- التكلفة: `InventoryStock.avg_cost` (متوسط مرجح متحرك) يتحدث عند الاستلام/مرتجع المورد، و`InventoryCostMovement` سجل له. تُحذف الدوال PL/pgSQL للـledger، وتبقى فقط triggers منع التعديل (append-only) لأنها رخيصة وحامية.
- `item_type`: فقط `stocked` ينتج حركات مخزون؛ `service` و`non_stock` لا يلمسان المخزون أبدًا.
- مفتاح المخزون: `(warehouse_id, variant_id)`. لا `branch_id` في المخزون/الحركات (يُشتق من المخزن عند التقارير).

## 4. الكميات والوحدات

- كل الكميات `Decimal(14,3)` (مخزون، حركات، سطور بيع/مرتجع/شراء/تحويل).
- الدقة المسموحة من `UnitOfMeasure.precision` للوحدة الأساسية للصنف (قطعة = 0، كجم = 3). التحقق في الـbackend وفي الـPOS من نفس الدالة المشتركة (`@athr/domain-core` Quantity).
- المال: `Decimal(14,2)`؛ التكلفة: `Decimal(14,4)`.

## 5. الكتالوج العام (W2)

- `ProductType` (لكل Tenant): `name`, `attributes` (jsonb):
  ```json
  [{ "key": "size", "label_ar": "المقاس", "kind": "select", "options": ["S","M","L"], "axis": true },
   { "key": "color", "label_ar": "اللون", "kind": "text", "axis": true }]
  ```
- `Product.product_type_id` (nullable = منتج بسيط بدون خصائص).
- `ProductVariant.attributes` jsonb (`{"size":"L","color":"أسود"}`) + `label` نصي محسوب عند الحفظ ("L · أسود") للعرض والبحث السريع.
- سطر الفاتورة: `variant_label_snapshot` بدل `size_snapshot/color_snapshot`.
- **الباركود:** جدول `ProductBarcode (tenant_id, code UNIQUE, variant_id, pack_qty, kind: standard|scale_plu)` بدل عمودي الباركود. البحث في الـPOS = exact match على index.
- **باركود الميزان:** إعداد لكل tenant (prefixes، عدد أرقام الصنف، وزن أو سعر، الخانات العشرية). المحلل (parser) دالة واحدة في package مشتركة يستخدمها الـPOS والـbackend.
- **التتبع:** `ProductVariant.tracking = none | serial | batch`:
  - serial → `InventorySerial (variant, warehouse, serial, status)`.
  - batch → `InventoryBatch (variant, warehouse, batch_no, expiry_date, qty)`؛ البيع FEFO افتراضيًا.
  - يُفعَّل حسب الباقة (feature keys: `tracking.serial`, `tracking.batch`).

## 6. أنواع التجارة كبيانات (Vertical presets)

```
backend/src/catalog/presets/
  index.ts          ← registry: [clothing, grocery, electronics, pharmacy, general]
  clothing.ts       ← ProductTypes + UoMs + default settings
  grocery.ts
  ...
```

كل preset ملف بيانات فقط. الـOnboarding يختار preset ويطبّقه على الـTenant الجديد.
**إضافة نوع تجارة جديد = إضافة ملف preset واحد** — بدون تعديل البيع أو المخزون أو الـPOS.

## 7. المزامنة

- `SyncChange`: index `(tenant_id, branch_id, sequence)`.
- قراءة آمنة من ترتيب الـcommits: عمود `txid xid8 DEFAULT pg_current_xact_id()` والـpull يقرأ فقط `txid < pg_snapshot_xmin(pg_current_snapshot())` — يمنع تخطي تغييرات commit متأخر.
- Delta بالكيان (منتج/سعر/مخزون متغير) — لا إعادة تحميل الكتالوج كله عند تغيير صنف واحد.
- Snapshot أول مرة مقسّم لصفحات (keyset على `variant.id`).
- Compaction: حذف ما قبل أقل cursor لكل الأجهزة النشطة، وأي جهاز متأخر أكثر من المدة المسموحة يأخذ snapshot جديد.

## 8. مسار البيع المستهدف (Hot path)

عدد ثابت من الـqueries بغض النظر عن عدد السطور:

| الخطوة | queries |
|---|---|
| هوية الجهاز + الشفت + فحص `sync_id` | 1–2 |
| الأصناف + الأسعار + الضرائب المطلوبة للسطور فقط (cache للـprice book/tax بالـversion) | 1–2 |
| إنشاء الفاتورة + السطور + المدفوعات (createMany) | 3 |
| `inventory.apply` | 3 |
| audit + sync change | 1 |

## ترتيب التنفيذ

1. **W1a — الهوية:** إزالة الأدوار القديمة من `User`، guard واحد.
2. **W1b — المواقع + المخزون + الكميات العشرية:** حذف `Location`، مفتاح المخزن، `InventoryService`، Decimal، تحديث البيع/المرتجع/الشراء/التحويل ليمروا بالخدمة، وتعديل الـPOS ليقبل الكميات العشرية.
3. **W1c — الأداء:** cache الأسعار/الضرائب، تنظيف indexes، إعادة تصميم SyncChange.
4. **W2a — الكتالوج:** ProductType/attributes/barcodes/label + seed + sync payload + تعديل الـPOS والـadmin للحد الأدنى.
5. **W2b — التتبع والـpresets.**
