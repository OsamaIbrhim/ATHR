# W2b — التتبع (Serial / Batch)

> مرجع تنفيذي للموجة W2b. يكمل `W1-W2-data-core.md` §5.
> القاعدة: الصنف غير المتتبَّع لا يدفع أي تكلفة (صفر statements إضافية في مسار البيع).

## 1. النموذج

- `ProductVariant.tracking`: `none | serial | batch` (افتراضي `none`). يحدد سلوك المخزون، وليس نوع التجارة.
- `InventoryBatch (tenant_id, warehouse_id, variant_id, batch_no, expiry_date?, qty Decimal(14,3))` — unique `(tenant_id, warehouse_id, variant_id, batch_no)`، index `(tenant_id, warehouse_id, variant_id, expiry_date)` للـFEFO.
  `batch_no = ''` هو صف **"غير مخصص"** الوحيد لكل (مخزن، صنف)، وهو الوحيد المسموح أن يصبح سالبًا (انظر §3).
- `InventorySerial (tenant_id, variant_id, serial, warehouse_id?, status)` — unique `(tenant_id, variant_id, serial)`؛ `status`: `in_stock | sold | in_transit | returned_to_supplier`؛ `warehouse_id` = مكانه وهو `in_stock`.
- `InventoryLotMovement` (append-only): `movement_id → InventoryMovement`، واحد فقط من `batch_id | serial_id`، `qty_delta`. هو سجل "أي دفعة/سيريال تحرك في أي حركة"، ومنه يُعرف ما بيع في سطر فاتورة (للمرتجع والضمان والـrecall).

**الثوابت (تُفحص في `reconcile`، ليست في المسار الساخن):**
- صنف batch: `SUM(InventoryBatch.qty)` في المخزن = `InventoryStock.qty_on_hand` **دائمًا** (العجز يذهب لصف "غير مخصص" فيبقى المجموع صحيحًا والعجز ظاهرًا للموظف).
- صنف serial: عدد `in_stock` في المخزن = `qty_on_hand` + عدد القطع المباعة بدون سيريال معروف ولم تُسوَّ بعد (`InventoryStock` لا يتغير تعريفه؛ الفرق يظهر في `reconcile` كبند "سيريالات تحتاج تسوية" وليس كخطأ).

## 2. تفعيل التتبع

- تغيير `tracking` مسموح فقط والرصيد صفر في كل المخازن (لا أدوات backfill). serial يتطلب وحدة بدقة 0.
- يتطلب ميزة الباقة (`tracking.serial` / `tracking.batch`) **عند التفعيل فقط**. نزول الباقة لا يعطل أصنافًا متتبعة موجودة ولا يحذف بيانات (D3).

## 3. المحرك (`InventoryService.apply`)

`StockLine` يأخذ حقلًا اختياريًا:

```ts
lots?: { serials?: string[]; batches?: { batchNo: string; expiryDate?: string; qty: Numeric }[] }
```

- استعلام القفل الحالي يرجّع `tracking` مع صفوف المخزون (JOIN، بدون statement إضافي) بـ**`FOR UPDATE OF "InventoryStock"`** — لا يُقفل صف `ProductVariant` أبدًا (وإلا تسلسلت مبيعات الفروع على نفس الصنف). لو لا يوجد سطر متتبَّع → نفس الـstatements الحالية بالضبط (يُثبَت باختبار عدّ statements).
- لو يوجد: `inventory-tracking.ts` يضيف عددًا ثابتًا من الـstatements الجماعية (لا حلقات استعلام):
  - **serial وارد:** upsert جماعي → `in_stock` في المخزن. العدد = الكمية. سيريال موجود `in_stock` = رفض.
  - **serial صادر:** `UPDATE ... WHERE serial = ANY(...) AND status='in_stock' AND warehouse_id=...`. في المسارات الـonline (مرتجع مورد، تحويل) عدد الصفوف يجب أن يساوي الكمية. في **البيع** (`allowNegative`، مقبول أولًا): سيريال غير معروف يُسجَّل `sold` مع warning `SERIAL_NOT_IN_STOCK`، وسطر بدون سيريالات (أو أقل من الكمية) يُقبل مع warning `SERIAL_NOT_CAPTURED` — البيع لا يُرفض أبدًا بسبب التتبع.
  - **batch وارد:** upsert جماعي `qty += ...` (`batch_no` إلزامي، `expiry_date` اختياري).
  - **batch صادر:** دفعات محددة أو **FEFO** تلقائي (`expiry_date NULLS LAST, created_at`) بقفل صفوف الدفعات، ثم UPDATE جماعي. لو الدفعات لا تكفي مع `allowNegative`: الباقي يُخصم من صف "غير مخصص" (`batch_no = ''`، يصبح سالبًا) + warning `BATCH_UNALLOCATED`؛ بدون `allowNegative` = رفض. أول استلام لاحق يسوّي الصف السالب أولًا (يُنقل منه للدفعة المستلمة) حتى لا يبقى عجز دائم.
  - INSERT جماعي في `InventoryLotMovement`.
- الـidempotency كما هي (مفتاح الأمر)؛ إعادة نفس الأمر لا تعيد تطبيق التتبع.

## 4. المستندات

| المستند | المدخل | السلوك |
|---|---|---|
| استلام مشتريات | `serials[]` أو `batch_no` + `expiry_date` على السطر | وارد؛ serial: العدد = الكمية |
| بيع | `serials[]` **اختياري دائمًا** ؛ `batch_no` اختياري | صادر؛ batch بدون تحديد = FEFO. `serials` تدخل في fingerprint الـidempotency فقط إن وُجدت (payloads 1.6.0 بدونها تبقى بنفس الـfingerprint) |
| مرتجع عميل | `serials[]` للـserial | السيريال يجب أن يكون مباعًا في نفس السطر → `in_stock`. batch: يرجع لنفس دفعات السطر (عكس lot movements، الأحدث أولًا) |
| مرتجع مورد | `serials[]` أو `batch_no` | صادر → `returned_to_supplier` |
| تحويل | shipping: `serials[]` / FEFO. receiving: نفس ما شُحن | serial: `in_transit` ثم `in_stock` في الوجهة؛ batch: نفس `batch_no` و`expiry_date` في الوجهة |

**قاعدة الـoutbox (صفر فقد بيانات):** أي أمر يمكن أن يخرج من outbox الـPOS (حاليًا البيع فقط) لا يُرفض بسبب نقص/خطأ بيانات تتبع — يُقبل مع warning. الإلزام فقط في مسارات الإدارة الـonline (الاستلام، مرتجع المورد، التحويل). اختبار دائم: بيع بشكل POS 1.6.0 (بدون `serials`) لصنف serial ينجح مع `SERIAL_NOT_CAPTURED`.

## 5. المزامنة والعملاء

- صف الكتالوج يأخذ `tracking` (حقل إضافي؛ لا يحتاج protocol جديد).
- POS: صنف serial → يطلب مسح السيريال لكل قطعة قبل إضافته للسلة (offline: يُقبل ويتحقق الخادم لاحقًا). صنف batch → لا شيء (FEFO على الخادم).
- Admin: اختيار التتبع في فورم المنتج، إدخال السيريالات/الدفعة عند الاستلام، عرض الدفعات (مع الصلاحية) والسيريالات، تقرير قرب انتهاء الصلاحية.

## 6. ترتيب التنفيذ

1. **W2b-1 (backend):** migration + المحرك + التفعيل + استلام/بيع/مرتجع عميل/مرتجع مورد + reconcile + حقل `tracking` في المزامنة + اختبارات (unit + `verify-inventory-engine`).
2. **W2b-2 (backend):** التحويلات بأصناف متتبعة. حتى ذلك: التحويل يرفض الصنف المتتبع بخطأ واضح (آمن، لا فساد بيانات).
3. **W2b-3 (clients):** POS + Admin.
