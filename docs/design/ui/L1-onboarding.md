# L1 — Getting a shop's stock into ATHR (UI spec)

Status: spec, before build. Surface: Admin (`admin-web/`), Arabic RTL, desktop first. **The stock-count counter view is phone-first.**
Owner: UX. Build: frontend engineer. Endpoints are not final; this spec fixes flows, states and copy only.
Read with `design-system-audit.md` (same folder): several items there are prerequisites for these screens (marked **[DS-n]**).

Conventions in this doc
- Arabic text in quotes is the exact copy. `{n}` is a placeholder. No English in the UI except SKU and the currency suffix rules below.
- "Permission keys" are the existing catalog keys where one exists; where the backend has not named a key yet it is marked **(TBC)** and the screen must call one `hasPermission(...)` so the key is changed in one place.
- Breakpoints: phone < 768px (`md:`), desktop >= 768px. Touch target >= 44px on every control below `md`.

---

## 0. Shared rules for every L1 screen

### 0.1 Numbers, money, quantities (data-misread risk, must follow)
- Digits: Western (0-9) everywhere, including dates (`ar-EG-u-nu-latn`). Shop owners paste from Excel and scanners emit Western digits; mixing Arabic-Indic digits is a misread risk. One helper set: `formatMoney`, `formatQty`, `formatDate` in `lib/format.ts`.
- Money: amount then unit, always `ج.م` (not the bare `ج`): `1,250.00 ج.م`. Always 2 decimals. Negative: `−1,250.00 ج.م` (U+2212 minus, leading), plus sign explicit when the column is a delta: `+300.00 ج.م`.
- Quantity: decimals per the item's unit precision (piece = 0, kg = 3, never trailing noise: `24` not `24.000`, `1.500` kg keeps 3). Unit label beside it when not piece: `1.500 كجم`. Deltas are signed: `+5`, `−3`.
- Every number, SKU and barcode is rendered in a `dir="ltr"` inline element with `tabular-nums`. Numeric table columns are `text-end` and the `<th>` matches. Component: `Num` (see §7).
- Colour never carries meaning alone: every red/green value also has a sign or a word (`زيادة` / `نقص` / `نفد` / `بالسالب`).
- Cost and value columns (`cost`, `value impact`, stat cards with ج.م) are shown only with `inventory.position.view-cost`. Without it the column/card is removed (not blurred, not "—"), and the cost input on the opening-balance screen is hidden — that screen then requires the permission (see §3.6).

### 0.2 One way to do each thing
- Item selection anywhere in L1: `ItemPicker` (scan or search, server-side, unlimited catalog). **Never** a native `<select>` of the first N products (the current `/inventory` and `/transfers` do this and silently lose products beyond 100/200).
- Confirmation of a destructive/irreversible step: `ConfirmDialog`. Never `window.confirm()`.
- Success feedback: `toast.success` (sonner, existing). Errors: inline next to the thing that failed (banner with retry or field error). A toast is never the only place an error appears.
- Loading lists: skeleton rows (`DataTable loading`), never a bare "جارٍ التحميل…" line **[DS-8]**.
- Disabled primary button: always a one-line reason directly under/next to it ("أكمل ربط الأعمدة المطلوبة أولًا").
- Status: `StatusBadge` = coloured pill + words. Tones: `ok` (green), `warn` (amber), `danger` (red), `info` (blue), `neutral` (gray) **[DS-15]**.
- Page shell: `PageHeader` (title, subtitle, back link, actions) then content in `.card`. One primary action per view, placed in the header `actions` slot (it sits at the start side = right in RTL) and, on phones, repeated in a sticky bottom bar when the page is a long form.
- Write actions are idempotent on the backend; the UI still disables the button and shows "جارٍ…" on press (instant feedback, no double submit).

### 0.3 Generic state copy (reuse)
| State | Copy |
|---|---|
| Load failed | title "تعذر تحميل البيانات" · hint "تحقق من الاتصال ثم أعد المحاولة." · button "إعادة المحاولة" |
| No permission (page) | title "ليس لديك صلاحية لهذه الصفحة" · hint "اطلب من مدير المحل أن يمنحك الصلاحية." |
| No permission (action) | button hidden; one gray line states who can do it, e.g. "الترحيل يقوم به من لديه صلاحية الترحيل." |
| Conflict (someone else changed it) | banner "تغيّر هذا المستند أثناء عملك." · button "تحديث الصفحة" |
| Session expired | handled by existing AuthGate |
| Plan without the feature | title "هذه الميزة غير متاحة في باقتك" · hint "تواصل معنا لترقية الباقة." |

---

## 1. Navigation and "get started"

### 1.1 Sidebar
The sidebar gets group headings (small, `text-white/60`, not links) so the 18 flat items stop growing. New/changed entries (existing ones unchanged):

| Group heading | Item | Route | Permission |
|---|---|---|---|
| (none) | لوحة التحكم | `/` | existing |
| المبيعات | فواتير المبيعات | `/sales` | existing |
| الكتالوج | المنتجات | `/products` | existing |
| | أنواع المنتجات | `/product-types` | existing |
| | **استيراد من Excel** | `/products/import` | `catalog.product.create` |
| المخزون | الأرصدة | `/inventory` | `inventory.position.view` |
| | **منتهية أو بالسالب** | `/inventory/low` | `inventory.position.view` |
| | **الرصيد الافتتاحي** | `/inventory/opening` | (TBC) see §3.6 |
| | **تسويات المخزون** | `/inventory/adjustments` | `inventory.movement.view` (list); create/approve/post per §4.6 |
| | **الجرد** | `/inventory/counts` | (TBC) see §5.9 |
| | التحويلات | `/transfers` | existing |
| rest (العملاء … الإعدادات) | unchanged | | |

Why: onboarding is a sequence; the sidebar order (catalog → balances → count) mirrors it.
`NAV_ITEMS` in `lib/permissions.ts` needs an optional `group` field; `requiredPermission()` already picks the longest matching href, so `/products/import` must be listed before relying on `/products`' permission.

Phone: the sidebar becomes a drawer behind a top bar with a menu button **[DS-1]** — the count screen cannot ship without it.

### 1.2 "ابدأ تشغيل محلك" checklist on the dashboard
Who: a brand-new owner, first sessions only. Primary task: know the next step. It replaces nothing; it sits **above** the stat cards while incomplete.

Layout: one `.card`, full width. Start side (right): title + "{done} من {total} خطوات" + thin `ProgressBar`. Below: a vertical list, one row per step: status icon (check for done / number for pending; also text "تم" / "التالي") · title · one-line hint · action button on the end side. Only the **first pending step** has a filled `.btn`; other pending steps have `.btn-secondary`; done steps have no button (a quiet "عرض" link). Top-end: "إخفاء" (text button). Hide persists per user (localStorage is acceptable for this convenience; it reappears under الإعدادات > "ابدأ تشغيل محلك").

Completion is **derived from data**, never ticked by hand:

| # | Title | Hint | Button | Done when |
|---|---|---|---|---|
| 1 | "أضف فرع المحل" | "اسم الفرع وعنوانه يظهران على الفاتورة." | "الفروع" → `/branches` | >= 1 branch with name set (usually done at signup) |
| 2 | "أضف منتجاتك" | "ارفع ملف Excel بمنتجاتك وأسعارها وباركوداتها، أو أضفها واحدًا واحدًا." | primary "استيراد من Excel" → `/products/import`; secondary link "إضافة يدوية" → `/products/new` | product count > 0 |
| 3 | "سجّل كميات المخزون" | "أدخل الكمية وتكلفة كل صنف لتبدأ المبيعات بأرقام صحيحة." | "الرصيد الافتتاحي" → `/inventory/opening` | every stocked item in the main branch has an opening balance (or the import created quantities); shows "{n} صنف بلا رصيد" while pending |
| 4 | "أضف الكاشير وصلاحياتهم" — tag "اختياري" | "كل كاشير بحساب وصلاحيات خاصة به." | "المستخدمون" → `/users` | >= 2 users |
| 5 | "اربط جهاز نقطة البيع" | "فعّل جهاز الكاشير لبدء البيع." | "أجهزة نقاط البيع" → `/terminals` | >= 1 provisioned terminal |
| 6 | "اعمل جرد للتأكد" — tag "اختياري" | "بعد أسبوع من التشغيل قارن المخزون الفعلي بالنظام." | "بدء جرد" → `/inventory/counts` | >= 1 posted count |

Rules: a step whose permission the user lacks shows the row without a button and with the gray line "يقوم بها مدير المحل". If all required steps (1,2,3,5) are done the card collapses to one line "كل شيء جاهز — تم تجهيز محلك" with "إخفاء"; it never blocks anything. States: loading = 3 skeleton rows (no layout shift: card reserves its height); error = card hidden silently (it is guidance, not data) and the dashboard's own error banner is unaffected.

Also: `/products` empty state (no products at all) shows the same step-2 actions instead of "لا توجد منتجات مطابقة": title "لا توجد منتجات بعد" · hint "ابدأ بملف Excel لتوفير الوقت." · actions "استيراد من Excel" (primary) and "إضافة منتج".

---

## 2. Bulk import — `/products/import`

**Users:** owner or manager setting up the shop (`catalog.product.create`). **Frequency:** once per shop, sometimes 2-3 attempts in the first days; rarely afterwards. **Primary task:** turn my Excel into catalog + stock with no surprises. **Environment:** desktop; Excel file from the owner's own records (messy headers, Arabic, blank cells, duplicates).

### 2.1 Structure
Wizard with `Stepper` (4 steps, read-only indicator; steps are not clickable forward): **1 رفع الملف · 2 ربط الأعمدة · 3 فحص الملف · 4 الاستيراد والنتيجة**. `PageHeader` title "استيراد المنتجات من Excel", subtitle "ارفع ملفك، راجع الأخطاء، ثم استورد." back link "المنتجات". The header action is empty (the wizard's own primary button lives at the end of each step's card, bottom-start). Content max width `max-w-5xl`.
A step card: heading, content, footer bar with **primary** (start side) and "رجوع" `.btn-secondary` (next to it). Leaving mid-wizard before step 4: `ConfirmDialog` "تغادر الصفحة؟ لم يُستورد شيء بعد." / "البقاء" / "مغادرة".

### 2.2 Step 1 — رفع الملف
- Left/right: two columns on desktop (upload 2/3, guide 1/3; guide below on phone).
- `FileDropzone`: dashed border, title "اسحب ملف Excel أو CSV هنا", secondary line "أو" + button "اختيار ملف", hint "الصيغ المسموحة: xlsx وcsv · الحد الأقصى {size} ميجا و{rows} صف". Whole zone is a `<button>` (keyboard: Enter/Space opens the picker; visible focus).
- Template card (guide column): "لا تعرف الشكل المطلوب؟" · buttons "تنزيل قالب Excel" and "تنزيل قالب CSV" · a mini table of the template's columns with a one-line meaning each (same labels as §2.3) and one sample row. Hint "لا يلزم استخدام القالب؛ في الخطوة التالية تربط أعمدة ملفك بنفسك."
- After a file is chosen: a file row (name, size, "إزالة") and options:
  - "الصف الأول يحتوي عناوين الأعمدة" checkbox, default on, auto-detected.
  - If the workbook has several sheets: Field "الورقة" select (default first non-empty).
  - Field "الفرع الذي تُسجَّل فيه الكميات" select (branches the user may use; default the user's branch). Shown **only when** a quantity column is mapped in step 2 (the field appears at the top of step 2 then); before that it is hidden to keep step 1 light.
  - CSV: hint "إذا ظهر العربي بحروف غريبة احفظ الملف بترميز UTF-8."
- Primary: "قراءة الملف" (disabled until a file is chosen; reason: "اختر ملفًا أولًا").
- States:
  - Reading: skeleton of the mapping table + "جارٍ قراءة الملف…".
  - Wrong type: inline error under the zone "هذا النوع غير مدعوم. ارفع ملف xlsx أو csv."
  - Too large: "الملف أكبر من {size} ميجا. قسّمه إلى ملفين."
  - Too many rows: "الملف يحتوي {n} صف والحد {rows}. قسّمه إلى ملفين أو أكثر."
  - Empty/no data rows: "لم نجد بيانات في الملف. تأكد أن المنتجات تبدأ بعد صف العناوين."
  - Password-protected/corrupt: "تعذر فتح الملف. احفظه من Excel من جديد بصيغة xlsx وحاول مرة أخرى."
  - No permission: generic no-permission page state.
  - Interrupted import found on load (server says a previous import is unfinished): top banner "يوجد استيراد لم يكتمل بدأ في {date}." buttons "متابعة" / "تجاهل".

### 2.3 Step 2 — ربط الأعمدة
Purpose: tell ATHR which Excel column is which field. **Auto-detected** by header synonyms (Arabic + English: اسم/الصنف/name, كود/SKU, باركود/barcode, سعر البيع/السعر/price, التكلفة/سعر الشراء/cost, الكمية/الرصيد/qty, الوحدة/unit, التصنيف/النوع) and, when headers are missing, by content shape (13-digit numbers = barcode).

Layout: a mapping table, one row per **ATHR field** (not per file column — the owner thinks in ATHR terms). Columns: ATHR field (label + "مطلوب" badge or "اختياري") · `select` "عمود الملف" (options: file headers, plus "— لا يوجد —") · "أمثلة من الملف" (first 3 non-empty values, each in `dir="ltr"` mono chip, truncated) · status (icon + word: "تم التعرف تلقائيًا" `ok`, "اختر العمود" `warn`, "غير مستخدم" neutral).

| ATHR field | Required | Notes shown as hint |
|---|---|---|
| اسم المنتج | yes | |
| SKU (كود الصنف) | one of SKU / الباركود | "الأصناف التي لها نفس SKU موجودة بالفعل لن تتغير." |
| الباركود | (see above) | "لأكثر من باركود للصنف افصل بينها بـ ؛ أو ," |
| سعر البيع | yes | "بالجنيه المصري" |
| سعر الشراء (التكلفة) | no | "مطلوب إذا أدخلت كمية" |
| الكمية الافتتاحية | no | "تُسجَّل في الفرع المختار" |
| الوحدة | no | "قطعة، كجم، … الافتراضي: قطعة" |
| التصنيف / نوع المنتج | no | "يُنشأ تلقائيًا إن لم يوجد؟" → **decision D-L1-3** |

Rules, enforced inline:
- Same file column chosen for two fields: the second select shows error "هذا العمود مربوط بحقل آخر" (`aria-invalid`, text-sm red-700 + icon).
- Quantity mapped but cost not: non-blocking warning under the row "بدون تكلفة ستُسجَّل الكمية بتكلفة صفر وتظهر أرباح غير صحيحة." `warn` tone.
- Quantity mapped: the branch select appears at the top of the card: Field "سجّل الكميات في فرع" (required).
- Below the table: "أعمدة في الملف لن تُستورد: {list}" as chips (informational).
- Primary "فحص الملف" disabled until required fields mapped; reason line "اربط: {missing fields}" listing them by name.
- Footer secondary "رجوع".
Phone: each field becomes a stacked card (label, select, examples), table only at `md:`.

### 2.4 Step 3 — فحص الملف (dry run, nothing is written)
On entering, the check runs immediately with `ProgressBar` indeterminate + "جارٍ فحص {n} صف…". Result:

- Row of 4 `StatCard`s: **"جاهز للاستيراد"** `{n}` (ok) · **"سيتم تخطيه"** `{n}` with sub-label "SKU موجود بالفعل" (neutral) · **"به أخطاء"** `{n}` (danger, only if > 0) · **"خارج حد الباقة"** `{n}` (warn, only if the plan stops rows).
- Plan limit banner (only if limited): "باقتك تسمح بـ {max} صنف وعندك {current}. سنستورد أول {allowed} صنف فقط، والصفوف الباقية لن تُستورد." hint "لزيادة الحد تواصل معنا لترقية الباقة." Rows beyond the limit are marked "خارج حد الباقة" in the table; they are never silently dropped.
- Filter tabs: الكل ({n}) · أخطاء ({n}) · تنبيهات ({n}) · سيتم تخطيه ({n}) · خارج الباقة ({n}). Default tab: **أخطاء** if any, else الكل.
- `DataTable` of problem rows, paged 25: columns **رقم الصف** (as in Excel, `Num`) · **SKU** · **المنتج** · **الحالة** (`StatusBadge`) · **المشكلة** (plain sentence) . Zebra not needed; row with error has a start-side 3px red border + the word in the status cell. On phone: rows become cards (row number + status on top, problem text below).
- Problem sentences (exact):
  - "اسم المنتج فارغ."
  - "السعر غير صالح — اكتب رقمًا أكبر من أو يساوي صفر."
  - "التكلفة غير صالحة — اكتب رقمًا أكبر من أو يساوي صفر."
  - "الكمية غير صالحة."
  - "الكمية لا تقبل كسورًا لأن الوحدة {unit}."
  - "الباركود {code} مكرر في الملف (الصف {row})."
  - "الباركود {code} مستخدم بالفعل للصنف {sku}."
  - "SKU {sku} مكرر في الملف (الصف {row})."
  - "لا يوجد SKU ولا باركود — لا يمكن تمييز الصنف."
  - "الوحدة {x} غير معروفة."
  - "التصنيف {x} غير موجود."
  - "تجاوز حد الباقة."
  - Warnings (row still imports): "سعر البيع أقل من التكلفة." · "الكمية بدون تكلفة."
  - Skipped: "SKU موجود بالفعل — لن يتغير."
- Actions: primary **"استيراد {n} صنف"** (n = ready rows; errors and skipped are excluded; the label carries the count so it is never a surprise). Secondary **"تنزيل ملف الأخطاء"** (download, enabled if errors+skipped+out-of-plan > 0) and **"رفع ملف مصحَّح"** (back to step 1). Helper under the primary: "الصفوف التي بها أخطاء لن تُستورد. يمكنك تصحيحها ورفعها لاحقًا." 
- Zero ready rows: primary disabled, reason "لا توجد صفوف صالحة للاستيراد."; empty-state copy "كل الصفوف بها أخطاء أو موجودة بالفعل" with action "رفع ملف مصحَّح".
- Fully clean file: a green `ok` line "الملف سليم 100%." above the cards; no table (empty tab shows "لا توجد مشاكل").
- Errors file columns (for the backend): original columns + "رقم الصف" + "سبب الخطأ" (Arabic sentence as above), so the owner fixes and re-uploads the same file.
- "Existing products are not updated" is stated once, plainly, under the skip card: "الاستيراد يضيف أصنافًا جديدة فقط ولا يعدّل أسعار أو كميات أصناف موجودة."

### 2.5 Step 4 — الاستيراد والنتيجة
In progress (chunks): card with big `ProgressBar` (determinate), "تم استيراد {done} من {total}", live counters created / skipped / failed, elapsed time. Copy: "لا تغلق هذه الصفحة حتى ينتهي الاستيراد." (browser `beforeunload` guard while running). Button "إيقاف بعد الدفعة الحالية" (secondary): what was imported stays; the result screen says so. A failed chunk (network): inline banner "انقطع الاتصال عند الدفعة {k}." button "متابعة من حيث توقفنا" (safe: backend is idempotent per SKU). Page reload: the resume banner from §2.2 brings the user back.

Result (replaces the progress card; all numbers are final):
- Headline by outcome: all good → `ok` "تم الاستيراد بنجاح"; some failed → `warn` "اكتمل الاستيراد مع {n} أخطاء"; nothing created → `info` "لم يُضف أي صنف جديد".
- 3 `StatCard`s: **"تمت إضافته"** `{n}` (ok) · **"تم تخطيه — SKU موجود"** `{n}` (neutral) · **"فشل"** `{n}` (danger, hidden if 0). If quantities: a line "سُجّلت كميات افتتاحية لـ {n} صنف في {branch}."
- Failed table (same columns as §2.4, reason from the server) + **"تنزيل ملف الأخطاء"**.
- Next steps: primary **"عرض المنتجات"** → `/products`; secondary **"استيراد ملف آخر"**; if some created items have no quantity: a callout "{n} صنف بلا كمية. سجّلها من شاشة الرصيد الافتتاحي." with button "الرصيد الافتتاحي".
- The summary stays reachable: import history is not in v1; the page keeps the result until the user leaves (state: decision **D-L1-4**).

### 2.6 Keyboard / touch
Tab order follows the visual order; Enter on the focused primary advances; selects are native `<select>` (good on phones and keyboards); file drop + picker both work; no hover-only affordances. Phone: usable but the owner is expected to do this on a computer — the page shows no special mobile layout beyond stacking.

---

## 3. Opening balance — `/inventory/opening`

**Users:** owner/manager (TBC permission). **Frequency:** heavy for 1-3 days at setup, then almost never. **Primary task:** give each item a starting quantity and cost in one branch as fast as possible, with no wrong numbers. **Input mix:** barcode scanner (fastest), search by name, sometimes typing from a paper list.

### 3.1 Layout (desktop)
`PageHeader`: title "الرصيد الافتتاحي", subtitle "أدخل كمية وتكلفة كل صنف عند بداية التشغيل.", back "المخزون".
1. **Top card** (sticky under the header while scrolling): Field "الفرع" select (required; locked once lines exist, with hint "لتغيير الفرع احفظ أو احذف الأسطر الحالية") · `ItemPicker` full width, autofocus, placeholder "امسح الباركود أو اكتب اسم الصنف أو SKU" · secondary "إضافة كل الأصناف بلا رصيد ({n})" (loads the items without an opening balance in this branch into lines, up to 200 per press).
2. **Lines table** (newest line on top so the item you just scanned is directly under the picker). Columns: الصنف (name + variant label, SKU below in mono `dir=ltr`) · "الكمية الحالية في النظام" (`Num`, gray; shows "لا يوجد" when none) · **الكمية الافتتاحية** (`NumberInput`, required, > 0) · **التكلفة للوحدة** (`NumberInput`, money, with suffix "ج.م") · **قيمة السطر** (qty × cost, computed, `Num`) · remove (icon button, `aria-label` "حذف السطر").
3. **Footer bar** (sticky bottom, also on phones): "{n} صنف · إجمالي القيمة {x} ج.م" at the end side · primary **"تسجيل الرصيد الافتتاحي"** at the start side.

Phone: lines become cards (name, SKU, two inputs side by side each labeled, value); picker stays sticky at top; footer bar sticky bottom with 48px primary.

### 3.2 Behaviour
- Scan of a barcode: exact match -> line added, **focus jumps to that line's quantity**, content selected. Enter in quantity -> focus cost. Enter in cost -> focus returns to the picker, ready for the next scan. Whole loop with keyboard only, no mouse.
- Scan of an item already in the list: its quantity **+1**, row flashes (background `bg-amber-50` for 600ms, plus a "+1" chip — colour is not alone), focus stays on the picker. (Same rule as count: each scan = +1.) Pack barcodes add the pack multiplier; the row shows "×6".
- Unknown barcode: inline red bar under the picker "الباركود {code} غير موجود في المنتجات." + buttons "بحث يدوي" (focuses search with the code) and "إضافة منتج جديد" (opens `/products/new` in a new tab). The bar stays until the next scan; no toast, no modal.
- Cost prefilled from the item's current cost when it has one, with a small "من بيانات الصنف" hint under the input; blank otherwise. Cost is required when quantity > 0: empty -> row error "اكتب التكلفة" (`aria-invalid`). Cost 0 allowed but shows inline `warn` "التكلفة صفر — ستظهر الأرباح غير صحيحة." (does not block).
- Quantity precision per unit: extra decimals rejected on blur with "هذا الصنف يُباع بالـ{unit}؛ اكتب عددًا صحيحًا." (piece) / "بحد أقصى {p} أرقام بعد الفاصلة." (kg etc).
- Item that already has an opening balance or stock movements in this branch: the picker result is disabled with "له رصيد مسجل بالفعل — لتعديله استخدم تسوية مخزون." + link "تسوية مخزون". (Rule **D-L1-5** to confirm with backend: what makes an item "already opened".)
- Serial/batch-tracked items (post-launch feature): picker shows them disabled with "الأصناف المتتبَّعة بالسيريال أو الدفعة لا يُسجَّل لها رصيد من هنا."
- Draft safety: lines are kept in `localStorage` per branch (per-viewer convenience); on return: banner "لديك {n} سطر لم يُسجَّل." "متابعة" / "مسح". Nothing is written to stock until the primary is pressed.
- Submit: `ConfirmDialog` title "تسجيل الرصيد الافتتاحي" body "سيتم تسجيل {n} صنف في {branch} بقيمة {x} ج.م. بعد التسجيل يتغيّر رصيد المخزون ولا يمكن التراجع؛ التصحيح يكون بتسوية مخزون." buttons "تسجيل" (primary) / "رجوع". On success: toast "تم تسجيل الرصيد الافتتاحي لـ {n} صنف" and the lines clear; a result card stays with buttons "إدخال المزيد" and "الذهاب للأرصدة".
- Partial server rejection (some lines fail): the lines that succeeded leave the list; failed lines stay with their reason under the row in red text + icon, top banner "سُجّل {ok} صنف وتعذّر {bad}. راجع الأسطر المعلّمة."

### 3.3 States
- Loading branches: skeleton in the top card.
- Empty (no lines): below the picker an `EmptyState` "لم تُضف أصناف بعد" hint "امسح باركود أي صنف أو ابحث بالاسم لتبدأ." (no action button; the picker is the action).
- Nothing left to open (all items already have balances): "كل أصنافك لها رصيد افتتاحي" + link "الأرصدة".
- Error on search: inline under the picker "تعذر البحث. أعد المحاولة." 
- No permission: generic. Missing cost permission: generic no-permission page (the screen cannot work without cost).
- Not offline-capable (admin); on network failure at submit: banner "لم يتم التسجيل بسبب انقطاع الاتصال. الأسطر محفوظة، أعد المحاولة." lines stay.

### 3.4 Copy summary
Picker placeholder above; column labels above; primary "تسجيل الرصيد الافتتاحي"; secondary "إضافة كل الأصناف بلا رصيد ({n})"; line errors "اكتب الكمية" · "اكتب التكلفة"; footer "{n} صنف · إجمالي القيمة {x} ج.م".

### 3.5 Components
`ItemPicker`, `NumberInput`, `StickyActionBar`, `ConfirmDialog`, `DataTable` (with `mobileCard`), `Num`, `EmptyState`.

### 3.6 Permissions
Screen requires the opening-balance permission (TBC, suggest backend reuses `inventory.adjustment.post` so one person can both open and post) **and** `inventory.position.view-cost`. Branch select lists only branches the user may post to.

---

## 4. Stock adjustments — `/inventory/adjustments`

**Users:** three roles that may be different people: requester (`inventory.adjustment.request`, e.g. branch manager), approver (`inventory.adjustment.approve`, owner), poster (`inventory.adjustment.post`). **Frequency:** weekly/monthly (damage, loss, corrections). **Primary task (list):** find what needs my action. **Primary task (document):** record what changed and why, then move it forward.

### 4.1 List page
`PageHeader` title "تسويات المخزون", subtitle "تعديل رصيد أصناف مع ذكر السبب. تمر بمراحل: مسودة ثم اعتماد ثم ترحيل.", action primary **"+ تسوية جديدة"** (only with request permission).
- Status tabs with counts: الكل · مسودة · معتمدة · مرحّلة · ملغاة. When the user can approve or post, the default tab is the one that needs them ("مسودة" for approver, "معتمدة" for poster) and the tab shows a count chip.
- Filters: الفرع select, search by number. Table columns: **الرقم** (mono, e.g. ADJ-000123) · **الفرع** · **التاريخ** · **عدد الأصناف** · **الأثر على القيمة** (signed ج.م, hidden without view-cost) · **الحالة** (`StatusBadge`: مسودة `neutral`, معتمدة `info`, مرحّلة `ok`, ملغاة `neutral` struck label) · **أنشأها** · row is a link to the document. Paging 20.
- Empty (none at all): "لا توجد تسويات بعد" · "استخدم التسوية لتسجيل التالف أو المفقود أو تصحيح الكمية." · action "+ تسوية جديدة". Empty tab: "لا توجد تسويات في هذه الحالة."
- Loading: 6 skeleton rows. Error: generic with retry.
- Phone: cards (number + status, branch/date, value).

### 4.2 Document page — `/inventory/adjustments/[id]` and `/new`
Header: title "تسوية {number}" (or "تسوية جديدة"), back "تسويات المخزون", status badge next to the title.

**Progress strip (`Stepper`, read-only, 3 steps: الطلب · الاعتماد · الترحيل)**: under each step, who and when once done ("{name} · {date}"), or gray "بانتظار" for future ones. Current step highlighted with border + bold (not colour only).

**Body (draft, editable):**
- Field group: الفرع (select; locked after the first line) · ملاحظة عامة (optional textarea, 300 chars).
- `ItemPicker` ("أضف صنفًا: امسح أو ابحث").
- Lines table, columns: الصنف · "الرصيد الحالي" (`Num`, gray) · **الكمية +/−** (`NumberInput allowSign`, with a direction chip beside it: "زيادة" green / "نقص" red — computed) · **السبب** (select, required) · **ملاحظة** (text, required when reason = "أخرى") · **الأثر على القيمة** (signed, view-cost only) · "الرصيد بعد التسوية" (`Num`; if < 0 a `warn` chip "بالسالب") · remove.
- Fixed reason list (select options, exact): "تالف" · "مفقود أو سرقة" · "انتهت صلاحيته" · "خطأ في تسجيل الرصيد" · "استخدام داخلي أو عينة" · "هدية" · "أخرى (اكتب ملاحظة)". "فرق جرد" exists only on documents generated from a count and is read-only there.
- Totals strip (end side): زيادات `+{x} ج.م` · نقص `−{y} ج.م` · **الصافي `±{z} ج.م`**.
- Validation: quantity 0 or empty -> "اكتب كمية أكبر أو أقل من صفر"; decimals per unit precision as in §3.2; reason missing -> "اختر السبب"; same item twice -> inline "هذا الصنف مضاف في سطر آخر" with focus on the existing line (scan on an existing line increments its quantity instead; in adjustments a scan adds **+1** for a newly added line, then focus goes to the quantity so the user overtypes with the real ± value).

**Actions by state and permission (primary always at the start side of the footer / sticky bar):**

| State | Who sees what |
|---|---|
| Draft, requester | "حفظ المسودة" (secondary) · **"إرسال للاعتماد"** is not a separate status: primary is **"حفظ وطلب الاعتماد"** only if backend has submit (decision **D-L1-6**); default spec: draft is saved, and approvers see it in tab "مسودة". Cancel: "إلغاء التسوية". |
| Draft, approver | primary **"اعتماد"**; secondary "إلغاء التسوية" |
| Approved, poster | primary **"ترحيل"**; secondary "إلغاء التسوية" |
| Approved, no post permission | gray line "بانتظار الترحيل من مسؤول المخزون." |
| Draft, no approve permission | gray line "بانتظار الاعتماد من مسؤول المحل." |
| Posted / Cancelled | read-only; no actions; posted shows link "عرض حركات المخزون" |

Separation of duties: if the backend forbids approving one's own request, the approve button is disabled with reason "لا يمكنك اعتماد تسوية أنشأتها بنفسك." (decision **D-L1-7**).

**ConfirmDialogs:**
- Approve: "اعتماد التسوية؟" / "ستصبح التسوية جاهزة للترحيل ولن يمكن تعديل أسطرها." / "اعتماد", "رجوع".
- Post: "ترحيل التسوية؟" / "سيتغيّر رصيد {n} صنف في {branch} بصافي {±z} ج.م. لا يمكن التراجع؛ التصحيح يكون بتسوية جديدة." / "ترحيل", "رجوع". If any line ends below zero, add a `warn` line: "{m} صنف سيصبح رصيده بالسالب."
- Cancel: "إلغاء التسوية؟" / "لن يتغيّر أي رصيد." / "إلغاء التسوية", "رجوع" (danger tone).

**States:** loading skeleton of header + 4 rows · not found "هذه التسوية غير موجودة" · error on action: banner with server reason and retry (e.g. "تعذر الترحيل: رصيد {sku} تغيّر. راجع السطر.") · conflict (status changed) per §0.3 · approved lines locked with a lock icon and "مغلقة بعد الاعتماد".
Phone: lines as cards with the same fields stacked; totals and primary in the sticky bar.

---

## 5. Stock count (جرد) — `/inventory/counts`

**Users:** counters (shop staff walking the aisles with a phone or a scanner on a laptop), and the owner/manager who reviews and posts. **Frequency:** at launch once per branch (verifying opening balances), then weekly to quarterly. **Primary task (counter):** scan/enter quantities fast and never lose a scan. **Primary task (reviewer):** see what differs, what it costs, decide on uncounted items, post.
Sales keep running during the count; the UI says so and shows the effect (§5.6).

### 5.1 List — `/inventory/counts`
Title "الجرد", subtitle "قارن المخزون الفعلي بما في النظام وصحّح الفروق.", primary **"بدء جرد جديد"**.
Table/cards: **الاسم** (default "جرد {branch} {date}") · الفرع · النطاق ("كل الأصناف" / "تصنيف: {name}" / "نوع: {name}") · **التقدم** ("{counted} من {total} صنف" + mini bar) · **الحالة** (`StatusBadge`: جارٍ العدّ `info`, قيد المراجعة `warn`, مرحّل `ok`, ملغي `neutral`) · آخر نشاط. Row opens the count. A count in progress shows a primary-quiet "متابعة العدّ" button (on phones the whole card).
Empty: "لا يوجد جرد بعد" · "ابدأ جردًا لتتأكد أن أرقام المخزون تطابق الرف." · action "بدء جرد جديد". Loading: skeleton. Error: generic.

### 5.2 Start a count (dialog on desktop, full page on phone)
Fields: الفرع (required) · النطاق radio: "كل أصناف الفرع" / "تصنيف محدد" / "نوع منتج محدد" (shows multi-select when chosen; shows live "{n} صنف في هذا النطاق") · الاسم (optional, placeholder "جرد {branch} {date}") .
Info box (always visible): "المبيعات تستمر أثناء الجرد. نحسب المتوقع لكل صنف وقت عدّه، فلا تحتاج لإيقاف البيع."
Primary "بدء الجرد" → opens the counter view. Errors: empty scope "لا توجد أصناف في هذا النطاق." · active count conflict "يوجد جرد جارٍ لهذا الفرع بدأه {name}." buttons "فتح الجرد الجاري" (decision **D-L1-8**: one active count per branch+overlapping scope).

### 5.3 Count page — `/inventory/counts/[id]`
Two tabs (real `role=tablist`): **العدّ** and **المراجعة**. Phone default: العدّ. Users without post permission see only العدّ and a read-only "المراجعة". Header: name, branch, `StatusBadge`, and a running summary chip "عُدّ {items} صنف · {units} وحدة".

### 5.4 Counter view (العدّ) — phone-first
Design target: 375x667 phone in one hand, scanner on a Bluetooth gun or typing on the phone keyboard, poor light, interrupted constantly.

Layout top to bottom (phone):
1. Thin top bar (existing mobile header, §DS-1): menu icon + count name. Info strip under it, small: "المبيعات مستمرة أثناء الجرد." (dismissible for the session).
2. **Scan field** (sticky under the top bar, always visible): full width, height 56px, `inputmode="none"` is **not** used (user must be able to type); `autofocus`, `autocomplete=off`, `enterkeyhint=done`. Placeholder "امسح الباركود أو اكتب الاسم". A camera button at the field's end: "مسح بالكاميرا" (progressive enhancement via the browser `BarcodeDetector` API where available; hidden otherwise; **D-L1-9**). Scanner guns type digits + Enter: Enter with an exact barcode match counts +1 immediately (no dropdown). Typed text of >= 2 chars shows results (same `ItemPicker` results list); tapping a result counts +1.
3. **Last-scanned card** (the thing the eye lands on after scanning): name (18px bold), variant, SKU (mono); **huge counted number** (48px, tabular) between two round buttons `−` and `+` (56x56); under it "عددت أنت {mine} · الإجمالي {all}" (total over all counters), and the pack note "×6" if the barcode is a pack. Tapping the number opens a numeric keypad input (`inputmode=decimal`, digits preselected) to type an exact quantity; "حفظ" at the keyboard's Enter. Right under the card a full-width **"تراجع عن آخر مسح"** (secondary, 48px) active for 10 seconds after each scan (covers mis-scans; prefer this to a toast).
4. **Feedback on every scan** (within 100ms, optimistic): card flips to the new item, number animates +1 (no animation if reduced-motion), card border flashes `ok`, `navigator.vibrate(40)` where supported, short beep option in "الإعدادات" toggle (default off). Unknown barcode: card turns red: "باركود غير معروف" + the code (mono) + buttons "بحث بالاسم" and "تجاهل" ; vibrate 3x; it is added to a counted "غير معروف ({n})" list visible in the review tab (never silently lost).
5. **Recently counted list** (below): search field "ابحث فيما عددته" + rows (name, SKU, my qty with inline edit button "تعديل", delete "حذف"). Newest first, virtualised beyond 100 rows. Empty: "لم تعدّ شيئًا بعد" / "امسح أول صنف لتبدأ."
6. **Sticky bottom bar**: primary **"انتهيت — مراجعة الفروق"** (48px, only for users who may review; for counters without that right: "انتهيت من عدّي" which just shows a confirmation "تم حفظ عدّك. أبلغ المسؤول ليراجع الجرد."). 

Desktop (>= 768px): two columns — scan field + last-scanned card on the start side (right, 2/5), recently counted table on the other (3/5), same rules. Keyboard: the scan field regains focus after every action and on Escape; `+`/`−` keys adjust the last item while the field is empty; Enter on empty field does nothing; Ctrl+Z = undo last scan.

Counting rules (for engineer and backend):
- Each scan is an **event** (+1 × pack qty, or the weight quantity for scale barcodes) with a client-generated id (idempotent retry). Totals = sum of events; a typed exact quantity is stored as a correcting delta on the user's own events. Multiple counters add up; nobody edits another person's count from this view.
- **Connectivity:** scans queue locally and show a status chip at the field's end: "تم الحفظ" / "جارٍ الإرسال ({n})" / "لا يوجد اتصال — {n} في الانتظار". Offline banner: "لا يوجد اتصال. عدّك محفوظ على هذا الجهاز وسيُرسل تلقائيًا." Leaving the page while pending: `beforeunload` guard. The queue survives reload (localStorage).
- **Keep screen awake** (`navigator.wakeLock` where available) while on this tab.
- Item outside the count's scope scanned: card amber "هذا الصنف خارج نطاق الجرد" buttons "أضفه للجرد" / "تجاهل" (adding is allowed only if reviewer permits — otherwise just "تجاهل").
- Tracked (serial/batch) items: "الأصناف المتتبَّعة لا تُجرد هنا حاليًا."
- Count posted/cancelled by someone else while counting: full-width banner "هذا الجرد أُغلق. لم يعد يقبل العدّ." and the scan field disabled.

### 5.5 Touch / accessibility
All controls >= 48px on this tab; `+`/`−` have `aria-label` "زيادة الكمية" / "إنقاص الكمية"; scan result announced via `aria-live="polite"` region ("تم عدّ {name}: {qty}"); status chip text, not colour only; layout has no horizontal scroll at 320px; landscape phone keeps the last-scanned card above the fold.

### 5.6 Review (المراجعة)
1. **Stat cards** (`StatCard`): "أصناف معدودة" `{n}` · "أصناف بها فرق" `{n}` · "زيادة" `+{x} ج.م` (ok) · "نقص" `−{y} ج.م` (danger) · **"صافي أثر الجرد" `±{z} ج.م`** (largest; hidden with no view-cost, counts remain).
2. **Not counted decision** (only if the scope has items nobody counted): a `warn` card above the table, title "{n} صنف لم يُعدّ", body "اختر ما يحدث لرصيد هذه الأصناف عند الترحيل:" and **two radio options with no default**:
   - "اعتبرها صفر — يُصفَّر رصيدها في النظام (نقص {x} ج.م)"
   - "اتركها كما هي — لا يتغيّر رصيدها"
   Error if posting without choosing: "اختر ما يحدث للأصناف التي لم تُعدّ." Per row in the table a toggle "اعتباره صفر" overrides the global choice (shown only after a choice is made). 
3. **Table** (sorted by absolute value impact desc; toggles to sort by name): **الصنف** · **المتوقع** · **المعدود** · **حركة بعد العدّ** (sales/receipts after the item was counted, signed, e.g. "−2"; hidden if the backend folds it into expected — **D-L1-1**) · **الفرق** (signed, `StatusBadge`-like word: "زيادة {n}" / "نقص {n}" / "مطابق") · **الأثر على القيمة** (signed ج.م). Not-counted rows show "لم يُعدّ" in the المعدود cell. Large variances (more than 20% of expected or more than a value threshold set by backend) carry a `warn` chip "فرق كبير" and a row action "إعادة العدّ" (clears this item's count and returns it to the counter list; polish-level if time is short).
   Filter chips: الكل · بها فرق · زيادة · نقص · لم يُعدّ · غير معروف ({n}). Default chip: "بها فرق". Search box. The unknown-barcode list (code, times scanned, counter) sits under chip "غير معروف" with action "إضافة منتج" per row.
   Phone: cards; the expected/counted/difference trio laid out as three labelled numbers in a row.
4. **Post bar** (sticky bottom): start side primary **"ترحيل الجرد"**, end side text "{n} صنف سيتغيّر رصيده · صافي ±{z} ج.م". Disabled reasons: no post permission -> hidden and gray line "الترحيل يقوم به مسؤول المخزون."; undecided not-counted choice -> "اختر ما يحدث للأصناف التي لم تُعدّ أولًا."; nothing counted -> "لم يُعدّ أي صنف بعد."
5. **Post ConfirmDialog**: title "ترحيل الجرد؟" body (each on its own line): "سيتم تعديل رصيد {n} صنف في {branch}." · "زيادة +{x} ج.م · نقص −{y} ج.م · صافي ±{z} ج.م" · (if chosen zero) "{m} صنف لم يُعدّ وسيُصفَّر رصيده." / (if keep) "{m} صنف لم يُعدّ وسيبقى رصيده كما هو." · "لا يمكن التراجع؛ التصحيح يكون بتسوية جديدة." Checkbox required only when zeroing uncounted items: "أؤكد تصفير رصيد {m} صنف". Buttons "ترحيل الجرد" (primary, danger tone when zeroing) / "رجوع". Success: toast "تم ترحيل الجرد" and the page becomes read-only with a `ok` banner "تم الترحيل بواسطة {name} في {date}." and link to the generated adjustment/movements.
6. Other actions in the header overflow: "تنزيل تقرير الفروق (Excel)" · "إلغاء الجرد" (danger; dialog "إلغاء الجرد؟" / "سيتم حذف كل ما عُدّ ولن يتغيّر أي رصيد." / "إلغاء الجرد", "رجوع").
States: review loading = stat skeletons + 8 rows; empty (nothing counted yet) "لم يُعدّ أي صنف بعد" / "عُد للعدّ ثم ارجع للمراجعة." action "الذهاب للعدّ"; error per §0.3; partial (counters still active): info line "{n} عدّاد نشط الآن" (live, refresh on focus) so the reviewer knows numbers may still move.

### 5.9 Permissions (TBC with backend)
Counting: `inventory.adjustment.request` (TBC) · Review/start/cancel: request+approve · Post: `inventory.adjustment.post` · cost columns: `inventory.position.view-cost`.

---

## 6. Items at or below zero — `/inventory/low`

**Users:** owner/manager/store keeper (`inventory.position.view`). **Frequency:** daily-weekly; also right after launch to find items sold before stock was entered. **Primary task:** which items do I need to restock or fix.

- `PageHeader`: title "أصناف منتهية أو بالسالب", subtitle "أصناف رصيدها صفر أو أقل في الفرع المختار."; action: secondary "تصدير Excel" (if export permission exists; polish).
- Toolbar: الفرع select (default user's branch; "كل الفروع" option only if the user sees several) · search (aria-label "ابحث بالاسم أو SKU أو الباركود") · status tabs: **الكل · نفد (صفر) · بالسالب · بلا رصيد مسجّل** with counts. The last tab only if backend can list them (items never given any balance); it is where a new shop lands before opening balances.
- Explainer (dismissible info box, shown while any "بالسالب" exist): "الرصيد بالسالب يعني أنك بعت صنفًا قبل تسجيل كميته. سجّل الرصيد الافتتاحي أو اعمل تسوية لتصحيحه."
- Table: **SKU** · **الصنف** · **الكمية** (signed `Num`; negative in red with minus sign) · **الحالة** (`StatusBadge`: "نفد" `warn`, "بالسالب" `danger`, "بلا رصيد مسجّل" `neutral`) · **آخر بيع** (date, LTR Western digits) · row action: "تسوية" (creates a draft adjustment for that item with the quantity needed to reach zero) for negatives; "رصيد افتتاحي" for no-balance rows. Sort default: most negative first, then by last sale desc. Paging 50. Only stock-tracked items (services excluded).
- Empty (for the filter): positive copy "لا توجد أصناف منتهية أو بالسالب في {branch}" / "كل أصنافك لها رصيد." Empty catalog: the step-2 empty state from §1.2.
- Loading skeleton; error generic; no permission generic.
- Phone: cards — name + status on top, big quantity at the end side, SKU and last sale below.

---

## 7. New components (name + props)

All in `admin-web/components/ui/`, RTL-safe (logical properties), tokens only.

1. **`Stepper`** `{ steps: { key: string; label: string; meta?: string }[]; current: number; ariaLabel?: string }` — read-only progress; `aria-current="step"`; done steps show check + word "تم" for screen readers.
2. **`FileDropzone`** `{ accept: string; maxBytes: number; onFile: (file: File) => void; error?: string; disabled?: boolean; hint?: string }` — `<button>` semantics + drag over state.
3. **`ItemPicker`** `{ branchId?: string; onPick: (item: PickedItem, opts: { fromScan: boolean }) => void; onUnknownBarcode?: (code: string) => void; disabledWhen?: (item) => string | undefined; autoFocus?: boolean; size?: 'md' | 'lg'; placeholder?: string; excludeTracked?: boolean }` — one input: scanner Enter with exact barcode match picks without a dropdown; text >= 2 chars debounced (150ms) server search; arrow keys + Enter in results; results show name, variant, SKU, barcode; `disabledWhen` returns the reason shown under a disabled result; re-focuses itself after `onPick`; `aria-live` result count.
4. **`NumberInput`** `{ value: string; onChange: (v: string) => void; precision: number; allowSign?: boolean; min?: number; unit?: string; size?: 'md' | 'lg'; ariaLabel: string; error?: string; selectOnFocus?: boolean }` — `inputmode="decimal"`, `dir="ltr"`, accepts Arabic-Indic digits and converts them to Western, rejects extra decimals.
5. **`Num`** `{ value: number | string; kind?: 'qty' | 'money' | 'plain'; precision?: number; signed?: boolean; unit?: string; tone?: 'auto' | 'none' }` — renders `dir="ltr"` `tabular-nums`, minus U+2212, optional +, money suffix `ج.م`. `tone=auto` colours negatives red **and** keeps the sign.
6. **`StatusBadge`** `{ tone: 'ok' | 'warn' | 'danger' | 'info' | 'neutral'; children: ReactNode; icon?: boolean }` — replaces ad-hoc `.badge bg-*` combos.
7. **`StatCard`** `{ label: string; value: ReactNode; sub?: string; tone?: 'neutral' | 'ok' | 'warn' | 'danger'; loading?: boolean }` — unify the dashboard's hand-written cards.
8. **`ProgressBar`** `{ value?: number; max?: number; label: string }` — no `value` = indeterminate; `role="progressbar"` with `aria-valuenow`.
9. **`ConfirmDialog`** `{ open: boolean; title: string; children: ReactNode; confirmLabel: string; cancelLabel?: string; tone?: 'primary' | 'danger'; loading?: boolean; requireCheck?: string; onConfirm: () => void; onClose: () => void }` — focus trap, Esc closes, focus starts on the **cancel** button for danger tone, `role="alertdialog"`. No new dependency: native `<dialog>` is enough.
10. **`StickyActionBar`** `{ children: ReactNode }` — `sticky bottom-0`, safe-area padding (`pb-[env(safe-area-inset-bottom)]`), white with top border; only from `md:` down it is `fixed`-like full width; reserves space so content is not covered.
11. **`GetStartedChecklist`** `{ steps: { key; title; hint; href; actionLabel; done: boolean; optional?: boolean; permission?: Permission }[]; onHide: () => void }` — dashboard card per §1.2.
12. **`AppShell` / mobile drawer** — change to existing `Sidebar` + `layout.tsx` (not a new visual): `md:` static sidebar, below `md` a top bar (56px) with menu button and a drawer. **[DS-1]**
13. **Changes to `DataTable`** (required by these screens; details in audit **[DS-8]**): `loading` renders skeleton rows, `mobileCard?: (row) => ReactNode`, `columns[].align: 'start' | 'end'`, `columns[].key`, `stickyHeader`, `rowClassName?`, `caption` (visually hidden).

Reused as is: `PageHeader`, `Field`, `EmptyState`, `TagInput` (category pick in the start-count dialog may use it), `BarcodeChips`, sonner `Toaster`.

---

## 8. Decisions needed

For the **owner** (business rules; UX recommendation in bold):
- **D-L1-1** Count "expected" while sales continue: per-item snapshot **at the moment the item is counted**, with later sales shown in a "حركة بعد العدّ" column (recommended, because otherwise every busy item shows a false shortage) versus one snapshot at count start.
- **D-L1-3** Import: if a category/product type in the file does not exist, **create it automatically** vs reject the row. Recommend reject for product type (it carries attributes), auto-create for plain categories if they exist.
- **D-L1-4** Keep an import history (list of past imports with their error files) in v1? Recommend no; keep only the last result.
- **D-L1-6** Does a draft adjustment need an explicit "submit for approval" step? Recommend no: draft is visible to approvers.
- **D-L1-7** May a person approve/post what they requested themselves? Recommend **no** by default, with a tenant setting for small shops where the owner does everything (otherwise a one-person shop is stuck).
- **D-L1-8** One active count per branch+overlapping scope: recommend yes.
- Tag needed from the owner also: is the camera-scan button (D-L1-9) wanted for v1 — the owner must accept that iPhone Safari does not support `BarcodeDetector` (typing and Bluetooth scanner still work).

For the **tech lead / backend**:
- **D-L1-2** Identity rule for import: require SKU or barcode (recommended), update-on-existing is out of scope.
- **D-L1-5** Definition of "already opened" for opening balance and the error returned.
- Permission keys for opening balance and count (TBC above); who may see the count screen (counter vs reviewer).
- Client-driven chunks (user must keep the page open) vs server job; UI copy in §2.5 assumes client-driven with resume.
- Count scans as idempotent events with client ids, per-user totals in the API, `BarcodeDetector` approval (no dependency).
- Whether the "never had a balance" list (§6) is queryable.
