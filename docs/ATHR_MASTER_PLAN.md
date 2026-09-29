# ATHR — الخطة الرئيسية (Master Plan)

> هذه الوثيقة هي المرجع الحالي للمشروع وتلغي `BOLD_FINAL_ROADMAP.md` عند أي تعارض.
> آخر تحديث: 2026-09-29

## الهدف

تحويل ATHR من POS لمحلات الملابس إلى **منصة SaaS لأي نوع تجارة تجزئة**، باشتراكات
تُفعَّل يدويًا (بدون دفع أونلاين حاليًا)، مع أعلى كفاءة ممكنة من قاعدة البيانات حتى
الواجهات، وكود نظيف مقروء قابل للتطوير **بدون over-engineering**.

## قرارات المالك (مُلزِمة)

| # | القرار |
|---|---|
| D1 | لا توجد بيانات إنتاج حقيقية؛ كل البيانات الحالية وهمية. مسموح بإعادة بناء الـmigrations في Baseline واحدة. |
| D2 | شكل المنتج يتحول من `size/color` ثابتة إلى **خصائص مرنة حسب نوع المنتج**، والـseed يستخدم الشكل الجديد. |
| D3 | الباقات المبدئية: Starter / Pro / Business + تجربة 14 يوم. **الباقات بيانات وليست كودًا**: المالك يغيّر الأسعار والحدود والمزايا من لوحة المنصة في أي وقت بدون deploy وبدون كسر شيء. |
| D4 | الدفع خارج النظام: صفحة الأسعار فيها "تواصل معنا"، والتفعيل يدوي من لوحة المنصة. |
| D5 | قاعدة بيانات الـPOS المحلية تتحول إلى `better-sqlite3` + WAL. الشروط: استهلاك رام منخفض، صفر فقد بيانات، سرعة عالية في البيع والمزامنة. |
| D6 | أنواع التجارة الجديدة (بقالة، إلكترونيات، صيدلية، ...) تُضاف **كبيانات/إعدادات** وليس بتعديل الكود في أماكن متفرقة. التصميم يجهّز نقاط التوسع مرة واحدة. |
| D7 | الـCI يُخفَّف: يبقى ما يحمي الجودة فعلًا، ويُحذف كل ما ليس له لزوم. |
| D8 | تصميم الـPOS والـWeb يكون احترافي High-end. **قبل بدء مرحلة التصميم نرجع للمالك للاتفاق على الاتجاه.** |

## مبادئ الكود

1. **بساطة أولًا:** أقل عدد من الطبقات يحل المشكلة. لا abstractions لاحتمالات غير موجودة.
2. **مصدر واحد للحقيقة:** كل كتابة على المخزون تمر بـ`InventoryService` واحد؛ كل منطق بيع في Sales domain؛ لا business logic في controllers أو triggers.
3. **الأداء محسوب:** كل endpoint ساخن له عدد queries معروف، كل list له pagination، كل تقرير يُجمَّع في SQL، كل index يبدأ بـ`tenant_id` على المسارات الساخنة.
4. **الملف الواحد مسؤولية واحدة** (استرشادًا: الخدمة لا تتجاوز ~400 سطر).
5. **TypeScript strict** لكل كود جديد أو معدّل.
6. **الاختبار دائم:** لا TEMP DRILL commits؛ أي تحقق يصبح test داخل الـsuite.

## نقاط التوسع المعمارية

### أنواع المنتجات (D2, D6)

- `ProductType` (لكل Tenant): اسم + قائمة `attributes` (key, label, kind: text|number|select, options, is_variant_axis).
- `ProductVariant.attributes` = `jsonb` بالقيم (مثال: `{ "size": "L", "color": "أسود" }`)، مع snapshot للاسم المعروض في سطر الفاتورة.
- `ProductVariant.tracking` = `none | serial | batch` — يحدد سلوك المخزون، وليس نوع التجارة.
- الكميات `Decimal` والدقة تأتي من `UnitOfMeasure.precision` (قطعة = 0، كجم = 3).
- **إضافة نوع تجارة جديد = Preset بيانات** (قالب ProductType + وحدات قياس)، بدون تعديل كود البيع أو المخزون.

### الباقات والاشتراكات (D3, D4)

- `Plan` (بيانات): `code`, `name`, `price_display`, `limits` (jsonb: branches, terminals, users, products)، `features` (مصفوفة مفاتيح).
- `Subscription`: `tenant_id`, `plan_id`, `status`, `trial_ends_at`, `current_period_end`, `notes`, `activated_by`.
- كتالوج مفاتيح المزايا والحدود **ملف واحد في الكود** (`entitlements/catalog.ts`)؛ القيم في قاعدة البيانات.
- تقييم الوصول = Permission ∩ Entitlement ∩ Limit (ADR-0005)، والتحقق في guard/decorator واحد.
- تغيير الباقة لا يحذف بيانات أبدًا؛ تجاوز الحد يمنع **الإضافة** فقط.

## خريطة المراحل والحالة

✅ موجود وسليم · 🟡 موجود وناقص/به مشكلة · ❌ غير موجود

| Phase | الحالة المختصرة |
|---|---|
| 0 — الأساس الهندسي | ✅ workspace/CI · 🟡 strict TS, shared packages, docs · ❌ CI خفيف |
| 1 — البيانات والـTenancy | ✅ tenant FKs · 🟡 اختيار الـtenant، WP-009 drift · ❌ tenant switcher |
| 2 — كتالوج عام | 🟡 UoM/item_type غير مفعّلين · ❌ خصائص مرنة، كميات عشرية، باركود متعدد، serial/batch |
| 3 — محرك المخزون | ✅ ledger/transfers · 🟡 كتابة مبعثرة، SUM على كل التاريخ · ❌ جرد وتسويات |
| 4 — محرك البيع | ✅ idempotent sale · 🟡 مسار تقيل، ترقيم · ❌ مدفوعات مقسمة، خصومات، استبدال، إعدادات tenant |
| 5 — تطبيق الـPOS | ✅ offline outbox · 🟡 تخزين sql.js، بحث بدون index، أخطاء scan · ❌ عمليات offline كاملة، طباعة صامتة |
| 6 — لوحة الإدارة | ✅ BFF آمن · 🟡 لا design system ولا data layer · ❌ صفحات لمعظم مزايا الـbackend |
| 7 — SaaS والاشتراكات | 🟡 enum فقط · ❌ كل شيء |
| 8 — تقارير وأداء وتشغيل | 🟡 تقارير في JS · ❌ rate limit، backups، إشعارات لكل tenant |

## موجات التنفيذ

| Wave | المحتوى |
|---|---|
| **W0 — تثبيت وتنظيف** | Baseline migration واحدة + حذف السكربتات المرتبطة بالـmigrations القديمة · تخفيف CI · اختيار tenant حتمي · إزالة sync triggers المكررة · إشعارات لكل tenant · إصلاح خط PDF · BFF single-flight refresh · إيقاف refetch `/auth/me` مع كل تنقل · أخطاء scan في الـPOS |
| **W1 — قلب البيانات** | `InventoryService` واحد + running balance بدل SUM · المخزون مفتاحه Warehouse · cache للأسعار والضرائب في مسار البيع · تنظيف indexes · compaction لـSyncChange |
| **W2 — الكتالوج العام** | ProductType + attributes · كميات Decimal + UoM على السطور · `item_type` مطبق · باركود متعدد · باركود الميزان · tracking (serial/batch) |
| **W3 — البيع** | Payments + دفع مقسم · خصومات + ربط promotions/coupons · ترقيم مسلسل لكل فرع · إعدادات بيع لكل tenant · استبدال |
| **W4 — محرك الـPOS** | better-sqlite3 + WAL + ترحيل آمن · lookup مفهرس · cart reducer · sync في main process · تقسيم main.ts · IPC typed · migrations محلية بإصدار · طباعة صامتة ودرج |
| **W5 — الاشتراكات** (بالتوازي) | Plan/Subscription/Limits · تطبيق access mode في backend وPOS · Onboarding · لوحة المنصة · Landing + صفحة أسعار |
| **W6 — لوحة الإدارة** | ⏸ **مراجعة التصميم مع المالك أولًا** · design system · React Query · route groups · صفحات كل المزايا · فورم منتج ديناميكي |
| **W7 — تقارير وتشغيل** | تقارير SQL · rate limit · backups · E2E |

## فريق التنفيذ

- **Lead:** التقسيم، المعمارية، مراجعة ودمج كل تغيير.
- **Agents (Sonnet 5.5):** Backend/DB · POS/Electron · Frontend · QA/Reviewer.
- كل agent يعمل في worktree مستقل، وكل تغيير يُراجع قبل الدمج.
