# دليل وثائق أثر

> **مش عارف تبدأ منين؟** اقرأ [`PROJECT-OVERVIEW.md`](../PROJECT-OVERVIEW.md) في جذر المستودع الأول. الوثيقة دي مجرد خريطة للمراجع.
>
> **قاعدة ذهبية:** ما تقراش المجلد كله. افتح اللي يخص شغلك بس.

---

## الأربع وثائق اللي بتتقري فعلاً

| الوثيقة | امتى تفتحها |
|---|---|
| [`../CLAUDE.md`](../CLAUDE.md) | **قبل أول سطر كود.** دستور هندسي مُلزِم. مش اختياري. |
| [`delivery/execution-plan.md`](delivery/execution-plan.md) | تعرف منها حزمة العمل المكلَّف بيها (WP-000 → WP-027). |
| [`delivery/delivery-log.md`](delivery/delivery-log.md) | **السجل.** مدخل لكل تنفيذ، بيتضاف مش بيتبدّل. اقرأ آخر مدخل قبل ما تبدأ. |
| `00-product/br-*.md` | وثيقة قواعد العمل بتاعة مجالك أنت. |

> ⚠️ **عند التعارض: وثيقة قواعد العمل (BR) هي اللي تُتَّبع** — مش ملخّصها في وثيقة الـ WP. بلّغ عن التعارض، ما تحسمهوش من عندك.

---

## الخريطة

### `00-product/` — قواعد العمل: النظام بيعمل إيه وليه

| ملف | المجال |
|---|---|
| `business-rules-foundation.md` | الأساس المشترك |
| `br-catalog-pricing-tax-promotions.md` | الكتالوج، التسعير، الضرايب، العروض |
| `br-sales-payments.md` | المبيعات والدفع |
| `br-inventory-stock.md` | المخزون |
| `br-returns-refunds-exchanges.md` | المرتجعات والاستبدال |
| `br-purchasing-suppliers.md` | المشتريات والموردين |
| `br-customers-loyalty-store-credit.md` | العملاء والولاء والرصيد |
| `br-shifts-cash-drawer-terminals.md` | الورديات والدرج والترمينالات |
| `br-tenant-org-locations-membership.md` | المستأجر والفروع والعضوية |
| `br-billing-subscriptions-entitlements.md` | الاشتراكات والباقات |
| `br-notifications-documents-reporting.md` | الإشعارات والمستندات والتقارير |
| `workflow-catalog.md` | مسارات العمل |
| `state-machines.md` | آلات الحالة |

### `01-domain/` — النموذج والبيانات

`domain-model.md` · `entity-ownership-matrix.md` · `database-blueprint.md` · `event-catalog.md` · `audit-catalog.md`

### `02-contracts/` — العقود المُلزِمة

`api-contract.md` · `error-catalog.md` · `permission-matrix.md` · `sync-protocol.md` · `offline-protocol.md` · `notification-contract.md` · `reporting-model.md` · `billing-model.md`

> أي `endpoint` جديد لازم يتوافق مع `api-contract.md` و`error-catalog.md`، ويتربط بمفتاح صلاحية من `permission-matrix.md`.

### `03-architecture/` — المعمارية والتشغيل

`multi-tenancy-blueprint.md` · `security-blueprint.md` · `deployment-architecture.md` · `backup-and-recovery.md` · `monitoring-observability.md` · `performance-strategy.md` · `repository-package-architecture.md` · `module-boundaries.md` · `dependency-rules.md`

### `04-engineering/` — معايير الهندسة

`coding-standards.md` · `testing-strategy.md` · `git-branching-strategy.md` · `ci-cd-release-strategy.md` · `documentation-standards.md` · `adr-catalog.md`

### `wp/` — وثائق حزم العمل المكتوبة

مش كل حزمة ليها وثيقة. الحزم اللي من غير وثيقة تفاصيلها في `delivery/execution-plan.md`.

`WP-000-to-002-baseline-status.md` · `WP-003` … `WP-008` · `WP-T` (تقوية الاختبارات) · `WP-P1` (ميزانيات الأداء)

### `adr/` — قرارات معمارية

`0001` مساحة العمل · `0002` ملكية بيانات المستأجر · `0003` الهوية والعضوية · `0004` الموقع والمخزن · `0005` الصلاحيات والاستحقاقات · `0006` حدود المنصة

### `delivery/` — السجل والخطة

`execution-plan.md` · `delivery-log.md` · `wp-002-delivery-summary.md` · `pos-releases.md`

### مجلدات مساعدة

| المجلد | فيه إيه |
|---|---|
| `design-notes/` | ملاحظات تصميم لحزم بعينها |
| `runbooks/` | إجراءات تشغيلية (مثال: التراجع عن مهاجرة) |
| `testing/` | تحليل هشاشة الاختبارات (بنود F1–F9) |
| `mobile/` | خطة تطبيق الموبايل |
| `archive/` | **وثائق قديمة أو متجاوَزة. لا تُعتمد.** محفوظة للسياق التاريخي بس. |

---

## قواعد الكتابة في المجلد ده

1. أسماء الملفات `kebab-case` إنجليزي. ممنوع الهاشات ولا المسافات.
2. الوثيقة المتجاوَزة تروح `archive/` — ما تتمسحش وما تتساب في مكانها.
3. `delivery-log.md` **يُضاف إليه فقط**، ما يتعادش كتابته.
4. المعماري هو اللي يكتب وثائق الـ WP و ADR وسجل التسليم. الـ CLI بيكتب كود بس.
