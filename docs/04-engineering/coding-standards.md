# ATHR Coding Standards v1.0

**Status:** Approved engineering-design baseline

**Applies to:** TypeScript, NestJS Backend, Next.js Admin, Electron POS, Prisma/SQL, shared packages, scripts, tests and documentation.

## 1. Purpose

هذه الوثيقة تحدد كيف يُكتب كود ATHR بصورة موحدة وآمنة وقابلة للمراجعة. الهدف ليس فرض style شكلي فقط، بل حماية حدود الـDomain، العزل بين Tenants، الدقة المالية والمخزنية، وسهولة الاختبار والتشغيل.

## 2. Core Principles

1. الوضوح قبل الاختصار.
2. correctness وsecurity قبل الأداء الشكلي.
3. Business rules فيDomain/Application، لا فيcontrollers أوUI.
4. public API صغير وواضح.
5. لا implicit behavior فيالأمور المالية والمخزنية.
6. كل side effect ظاهر فياسم الدالة أوالعقد.
7. لا magic values أوsilent fallbacks.
8. errors مستقرة وقابلةللتشخيص.
9. كلtenant-scoped operation يحملTenantContext صريحًا.
10. لا merge بدونtests مناسبة وحالةCI خضراء.

## 3. Language and Formatting

- TypeScript هواللغة الافتراضية لكلالتطبيقات والـpackages.
- Bash/Node فقط للـautomation؛ لاPowerShell.
- formatter/linter موحدان منالجذر.
- UTF-8 فقط.
- line endings وindentation موحدة عبرEditorConfig.
- لاmanual formatting مختلف داخلpackage بعينه.

## 4. TypeScript Rules

- `strict: true` هدف إلزامي.
- يمنع `any` إلافيadapter boundary موثق ومحدود، ويفضل `unknown` معvalidation.
- لاnon-null assertion `!` إلابعدinvariant مثبتة أوwrapper آمن.
- لاtype assertions متعددة لإجبارcompiler.
- use `readonly` للقيم التيلا تتغير.
- discriminated unions للحالات المركبة.
- enums المرسلة عبرwire تستبدل غالبًاstring unions ثابتة.
- `import type` للأنواع فقط.
- لاbarrel exports عشوائية تؤديcycles.

## 5. Naming

- Classes/Types/Interfaces: `PascalCase`.
- variables/functions: `camelCase`.
- constants: `UPPER_SNAKE_CASE` فقطللقيم الثابتة العامة.
- files: `kebab-case`.
- test files: `*.spec.ts`, `*.test.ts`, `*.contract.test.*` بحسبالنوع.
- Commands بصيغةفعل: `CreateSaleCommand`.
- Events بصيغةماضٍ: `SalePosted`.
- Queries تصفالمطلوب: `GetSaleByIdQuery`.
- لااختصارات غامضة مثل `mgr`, `svc2`, `tmpData`.

## 6. Function and Class Design

- function واحدة تؤدي مسؤولية واضحة.
- الدوال الطويلة تُفصل حسبbusiness step وليسلمجردعددالأسطر.
- constructor لاينفذIO أوbusiness action.
- dependency injection صريح.
- لاservice locator أوglobal mutable state.
- methods التيتغير state تكونواضحة وتعيدresult أوfact مفيد.
- queries لاتغير state.
- side-effecting functions لايسمى اسمًا يوحي بأنهاpure.

## 7. Domain Code

- Domain لايستوردNestJS أوPrisma أوHTTP أوprovider SDKs.
- Aggregate Root تطبقinvariants.
- Value Objects تتحقق عندالإنشاء ولا تسمحinvalid state.
- لاprimitive obsession فيMoney, Quantity, IDs, Rates, Timezone, EffectivePeriod.
- Domain events حقائق ماضية.
- لاlog أوprocess.env داخلDomain.
- status transitions تمرعبرmethods، لاdirect assignment.

## 8. Application Code

- كلuse case لهCommand/Query واضح.
- handler ينسق، ولايعيدتنفيذdomain logic.
- ports تعرفاحتياجاتInfrastructure.
- authorization وtenant context يتمفحصهما قبلmutation.
- idempotency وexpectedVersion ضمنالعقد عندالحاجة.
- network/provider calls خارجDB transaction.
- cross-context operations عبرpublic facade/event/process manager.

## 9. Infrastructure Code

- adapters تحولprovider/ORM shapes إلىdomain/app contracts.
- raw Prisma/SQL/provider errors لا تتسربللخارج.
- repositories لا تعيدPrisma models كأنهاdomain objects.
- لاgeneric repository شامل لكلmodels.
- transaction boundaries واضحة.
- retry policy موثقة ولا تطبقblind retry علىOutcomeUnknown.

## 10. Delivery and API Code

- controllers thin.
- DTO validation علىboundary.
- لاbusiness logic فيdecorators/controllers.
- لااعتماد علىbody/header tenant غيرموثوق.
- error mapping يستخدمATHR Error Catalog.
- response contracts مستقرة ومversioned عندالحاجة.
- pagination إلزامية للقوائم.
- لاreturn لraw exceptions أوstack traces.

## 11. Admin Code

- UI لايمتلكbusiness authority.
- permission-based presentation لا تستبدلserver authorization.
- server/client components boundaries واضحة.
- no secret env inclient bundle.
- query keys تشملtenant/scope/resource dimensions.
- forms تستخدمschema validation ورسائلخطأ مفهومة.
- long lists تستخدمpagination/virtualization حسبالحاجة.

## 12. POS Code

- Main owns filesystem, local DB, secure state, networking, sync, printing, updater.
- Preload exposes narrow typed IPC only.
- Renderer لايستوردNode/Electron main/local DB driver.
- offline operation durable beforeuser success acknowledgement.
- retries idempotent.
- money calculations لاتستخدمJS float مباشرة.
- startup/config/local migration failures واضحةوقابلةللاستعادة.

## 13. Numeric Standards

- money/quantity/rate عبرapproved value objects أوdecimal strings.
- يمنع `number` للحسابات المالية الحساسة.
- rounding policy صريحة ومعروفة.
- currency/UOM جزءمنالقيمة أوالسياق.
- لاconversion صامت.
- totals تُحسب منline snapshots وتُراجع invariants.

## 14. Date and Time

- UTC للتخزين والتبادل.
- IANA timezone للعرض/business-day logic.
- distinguish `occurredAt`, `recordedAt`, `effectiveAt` عندالحاجة.
- لاlocal system timezone assumptions.
- لاdate arithmetic يدوي بmilliseconds للحالاتالمعقدة.
- business dates منفصلة عنtimestamps حيثيلزم.

## 15. IDs and Tenant Scope

- IDs typed/opaque قدرالإمكان.
- لاglobal uniqueness assumption بدونcontract.
- كلtenant-owned record يحملtenant identity.
- resource lookup يستخدمtenant + resource ID.
- composite same-tenant constraints عندDB level.
- لاunscoped repository methods.

## 16. Error Handling

- errors تحملstable code, retry mode, outcome certainty, correlation ID.
- catch only whenadding context, translating, compensating orrecovering.
- لاempty catch.
- لاreturn `null` وthrow لنفسالحالة بشكلعشوائي.
- expected business failure ليست500.
- provider unknown outcome يبقىUnknown حتىreconciliation.

## 17. Logging and Telemetry

- structured logs فقط.
- no secrets, tokens, raw credentials, payment data orfull PII.
- correlation/request/causation IDs حيثمناسب.
- route templates لاraw IDs.
- logs ليستaudit source oftruth.
- business events لا تستبدلmetrics والعكس.

## 18. Security Coding Rules

- validate input attrust boundary.
- parameterized SQL فقط.
- no dynamic eval/Function.
- safe path handling andresource ID validation.
- SSRF-sensitive URLs allowlist/validate.
- crypto عبرapproved library/adapter، لاcustom crypto.
- secrets منvalidated runtime config فقط.
- constant-time comparison عندsecret/signature checks حيثيلزم.

## 19. Database and Migration Code

- applied migrations immutable.
- forward-only expand/backfill/constrain/contract.
- no startup heavy migrations.
- no destructive reset outsideisolated dev/test.
- raw SQL migration واضحة، idempotent فقطحيثالمعنى صحيح.
- indexes مبنية علىmeasured access patterns.
- no manual edits to `_prisma_migrations`.
- migration comments تشرحnon-obvious safety decisions.

## 20. Concurrency and Idempotency

- external/client operation IDs unique withindeclared scope.
- optimistic concurrency عندaggregate versioning.
- duplicate commands returnprior outcome أوstable conflict.
- race-prone check-then-write يحلداخلtransaction/constraint.
- locks محدودة ومبررة.
- no in-memory lock لحمايةcross-instance state.

## 21. Collections and Pagination

- no unbounded `findMany` فيruntime paths.
- explicit ordering forpagination.
- cursor/keyset عندdeep pages أوlarge tables.
- maximum page/batch sizes declared.
- bulk commands chunked andrestartable.

## 22. Comments and Documentation

- comments تشرحwhy/invariant/risk، لا تعيدقراءةالكود.
- public package APIs موثقة.
- ADR لأيقرار معماري غيرواضح.
- TODO يحتاجowner/issue/WP أوسبب واضح.
- لاcommented-out dead code.
- runbooks للأوامر التشغيلية الحساسة.

## 23. Testing Expectations in Code Changes

كلتغيير يضيفأوحدث tests حسبنوعه:

- domain invariant → unit.
- public contract → contract test.
- DB/provider adapter → integration.
- user journey → E2E/hard smoke عندالحاجة.
- bug fix → regression test يثبتالسبب.
- migration → clean + populated upgrade + drift.

## 24. Code Review Checklist

- scope مطابقWP/PR.
- source oftruth والowner صحيحان.
- tenant/auth checks موجودة.
- no forbidden dependency.
- numeric/time/error handling صحيح.
- tests تثبتhappy/failure/idempotency/recovery.
- migrations forward-only.
- observability بدونتسريب.
- performance impact معلوم.
- no unrelated refactor.

## 25. Static Enforcement

CI يجب أنيفرض تدريجيًا:

- formatter/linter.
- typecheck.
- dependency rules.
- forbidden imports.
- no `bold-*` names afterWP-002.
- no `any`/non-null assertions خارجallowlist المحدودة.
- package export validation.
- secret scanning anddependency audit.

## 26. Legacy Exception Policy

أيlegacy exception يتطلب:

- exact file/rule.
- reason.
- owner.
- removal WP/date.
- no expansion.
- CI reports count/trend.

## 27. Definition of Done

الكود يعتبرمكتملًا عندما:

- يحققbusiness contract.
- يبنيويختبرمنclean checkout.
- لايكسرarchitecture rules.
- tests المناسبة تمر.
- errors/telemetry موثقة.
- migration/release impact مسجل.
- Delivery Log يحدث بالنتائجالفعلية.

## 28. Prohibited Patterns

- business logic incontroller/UI/SQL trigger withoutapproved ownership.
- floats formoney.
- unscoped DB query.
- swallowed errors.
- magic retries.
- giant shared utils.
- circular modules hidden with`forwardRef`.
- direct cross-context writes.
- hard-coded production URLs orsecrets.
- tests thatpass onlywithspecific local state.

## 29. WP-002 Acceptance Mapping

WP-002 يطبق من هذهالوثيقة:

- root formatting/typecheck conventions.
- shared package naming/exports.
- nolegacy package imports.
- dependency/static checks.
- one clean root workflow.
- test utilities separated fromruntime.

## 30. Approval Outcome

هذه الوثيقة هيالمعيار الافتراضي لكلcode review وتنفيذ لاحق فيATHR. أيخروج يحتاجADR أوexception محددة ومؤقتة.