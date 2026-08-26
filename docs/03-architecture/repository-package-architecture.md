# ATHR Repository and Package Architecture v1.0

**Status:** Approved engineering-design baseline

**Applies to:** Repository `OsamaIbrhim/bold_system`, transformation branch, npm packages, Backend, Admin, POS, database, scripts, CI and release entrypoints.

## 1. Purpose

تحدد هذهالوثيقة الشكل المعتمد للـrepository والـpackages والاعتماديات أثناءتحويل النظام إلىATHR. الهدف هو modular monolith منظم، وليسإعادةكتابة أوتقسيم مبكر إلىmicroservices.

## 2. Current Repository Evidence

الحالة الحالية على `feat/athr-transformation`:

- Root package اسمه `athr-operations-workspace` لكنه لايعلن `workspaces`; يعمل فقطكمشغل scripts عبر `npm --prefix`.
- Backend package: `athr-operations-api`.
- Admin package: `athr-operations-admin`.
- POS package: `athr-pos-electron`.
- Backend وAdmin مازالا يعتمدان على `bold-system-workspace: file:..`.
- POS يعتمد علىكل من `athr-operations-workspace: file:..` و`bold-system-workspace: file:..`.
- هذاارتباط دائري/اسمي غيرصحيح ويجب إزالته فيWP-002، وليسإخفاؤه عبرaliases إضافية.

## 3. Architecture Decision

ATHR يستخدم:

- One repository.
- npm workspaces.
- One root lockfile.
- NestJS modular monolith forbackend.
- Separate deployable entrypoints forAPI, worker, scheduler andmigration runner whenintroduced.
- Next.js Admin application.
- Electron POS withstrict main/preload/renderer boundaries.
- Shared packages onlyforstable cross-application contracts andfoundations.

## 4. Incremental Migration Decision

لن ننقل المجلدات الحالية إلى`apps/*` داخلWP-002 لمجردالتجميل؛ هذايخلقchurn فيCI/deployment/imports بدونقيمةتشغيلية فورية.

الهيكل المعتمد للمرحلة الحالية:

```
/
├── backend/
├── admin-web/
├── pos-electron/
├── packages/
├── scripts/
├── docs/
│   └── adr/
├── infra/
├── package.json
└── package-lock.json
```

يجوز نقل التطبيقات لاحقًا إلى`apps/*` فقط عبرADR يثبت فائدةتفوقتكلفةالتغيير. المسارات الحالية تعدcanonical v1 paths.

## 5. Root Workspace Contract

Root `package.json` يجب أنيحتوي:

- `private: true`.
- `workspaces`: `backend`, `admin-web`, `pos-electron`, `packages/*`.
- Node engine policy المتوافقة معالتطبيقات وCI.
- package manager/version policy.
- orchestration scripts forbuild, typecheck, test, lint, hard-smoke andaffected checks.
- noapplication runtime dependencies.

الجذر ليسpackage يتم استيراده منالتطبيقات. يمنع `file:..` أوdependency علىroot package.

## 6. Package Naming

كلpackage داخلي يستخدمscope موحدًا:

- `@athr/contracts`
- `@athr/domain-core`
- `@athr/error-registry`
- `@athr/testing`
- packages مستقبلية تحتاجقرارًا واضحًا مثل `@athr/config`, `@athr/observability` و`@athr/authz`.

Applications:

- `@athr/api`
- `@athr/admin`
- `@athr/pos`

لايستخدم أيpackage اسم `bold-*` بعدWP-002.

## 7. Initial Shared Packages

### `@athr/contracts`

Owns:

- API request/response contract types.
- command/query envelopes.
- pagination andcursor shapes.
- sync protocol DTOs andversion identifiers.
- stable public enum/string unions whenapproved.

Does not own:

- NestJS decorators/controllers.
- Prisma models.
- UI components.
- domain behavior.
- provider SDK objects.

### `@athr/domain-core`

Owns pure, framework-independent foundations:

- Result anddomain failure primitives whereapproved.
- opaque ID foundations.
- aggregate version/idempotency primitives.
- date/time andnumeric value-object interfaces.
- domain event metadata interfaces.

Does not importNestJS, Prisma, React, Electron orprovider SDKs.

### `@athr/error-registry`

Owns:

- stable error codes.
- retry mode.
- outcome certainty.
- HTTP/transport mapping metadata wherecontractual.
- localization keys, notlocalized sentences.

### `@athr/testing`

Owns:

- deterministic IDs/clocks/builders.
- contract assertions.
- API/sync fixtures withoutproduction secrets.
- database test helpers thatdo nothide transactions ortenant context.
- performance dataset/profile metadata.

Production applications must notimport heavy test runtime fromthispackage outside test/dev boundaries.

## 8. Future Shared Packages

Created onlywhenat leasttwo consumers andstable ownership exist:

- `@athr/config`
- `@athr/observability`
- `@athr/authz`
- `@athr/crypto`
- `@athr/ui-tokens`
- `@athr/eslint-config`
- `@athr/tsconfig`

No package iscreated solely toreduce file length.

## 9. Dependency Direction

Approved direction:

```
Domain Core
    ↑
Application / Use Cases
    ↑
Infrastructure Adapters
    ↑
Delivery (HTTP, Worker, Scheduler, IPC, UI)
```

Rules:

- Domain imports onlypure foundations.
- Application imports domain andports.
- Infrastructure implementsports andmay importPrisma/provider SDKs.
- Delivery invokesapplication interfaces andmaps transport contracts.
- UI consumescontracts/client adapters, notbackend internals.
- Shared contracts neverimportapplication implementations.

## 10. Forbidden Dependency Directions

- Domain → NestJS/Prisma/Next.js/React/Electron/provider SDK.
- Contracts → Backend service orPrisma model.
- Admin/POS → Backend source files.
- Backend → Admin/POS source.
- Shared package → application package.
- One bounded context directlymutating anothercontext repository.
- Root workspace asruntime dependency.
- Circular workspace dependencies.

## 11. Backend Structure

NestJS remains modular monolith. Eachbounded context follows:

```
backend/src/<context>/
├── domain/
├── application/
├── infrastructure/
├── delivery/
└── index.ts
```

Incremental compatibility isallowed; existing modules migrate context-by-context.

Responsibilities:

- `domain`: entities, value objects, policies anddomain events.
- `application`: commands, queries, handlers, orchestration andports.
- `infrastructure`: Prisma repositories, provider adapters andpersistence mapping.
- `delivery`: controllers, DTO mapping, workers andtransport concerns.

Do notcreate generic `services/`, `helpers/` or`utils/` dumping grounds.

## 12. Bounded Contexts

Initial backend contexts followapproved Domain Model:

- platform/tenant.
- identity/authorization.
- devices/terminals.
- catalog.
- pricing/tax/promotions.
- sales.
- payments.
- inventory/costing.
- purchasing.
- returns/exchanges.
- customers/receivables/store-credit/loyalty.
- shifts/cash.
- documents.
- reporting.
- notifications.
- billing.
- audit.
- integration/sync/offline.

Exact module boundaries aredefined inthenext `ATHR Module Boundaries v1.0` document.

## 13. Database Ownership

Database assets remainunderBackend initially:

```
backend/prisma/
├── schema.prisma
├── migrations/
├── seed.ts
└── recovery/validation scripts
```

Rules:

- Prisma client ownership iscentralized.
- Migration runner andruntime use differententrypoints/credentials.
- Shared packages neverimportgenerated Prisma types aspublic contracts.
- SQL constraints/migrations areauthoritative fordatabase invariants.
- Applied migrations immutable.
- A future `@athr/database` extraction requiresADR andmust notexposePrisma models asdomain/API types.

## 14. API, Worker and Scheduler Entrypoints

The repository supports separateprocess entrypoints withoutcreatingmicroservices:

```
backend/src/main.ts          # API
backend/src/worker.ts        # durable jobs/outbox consumers
backend/src/scheduler.ts     # business schedule wake-up
backend/scripts/migrate.*    # migration runner
```

They mayshare compiled modules buthaveindependent config, readiness anddeployment commands.

## 15. Admin Architecture

`admin-web` owns:

- Next.js routes/layouts.
- server-side Backend client/BFF concerns.
- tenant-aware navigation.
- permission-driven presentation.
- Admin-specific components andquery hooks.

It mayimport:

- `@athr/contracts`.
- browser-safe portions oferror registry.
- approved UI tokens.

It must notimport:

- Prisma/generated DB types.
- Backend services.
- POS components.
- server-only secrets intoClient Components.

## 16. POS Architecture

`pos-electron` isdivided into:

```
pos-electron/electron/main/
pos-electron/electron/preload/
pos-electron/src/renderer/
pos-electron/src/shared/
```

Long-term services fromWP-018:

- bootstrap/config.
- secure state.
- local storage/migrations.
- API/auth/enrollment.
- sync engine/operation queue.
- sales/shifts/printing/updater/diagnostics.
- narrow typed IPC.

Renderer cannotaccessNode, filesystem, DB orsecrets directly.

## 17. UI Sharing Policy

Admin andPOS have differentruntime andinteraction constraints.

May share:

- design tokens.
- icons/assets withclear licensing.
- pure formatting helpers.
- contract types.

Should notshare bydefault:

- complex React components.
- state managers.
- network clients.
- storage/session code.
- page-level workflows.

Duplication ispreferred towrong coupling untilstable common behavior exists.

## 18. TypeScript Configuration

Use aroot base configuration plusruntime-specific extensions:

- `tsconfig.base.json` forstrict shared rules.
- backend config forNode/Nest decorators.
- Admin config forNext.js/DOM.
- POS renderer config forDOM/Vite.
- POS Electron config forNode/Electron.
- package configs withcomposite/declaration output wherepublished internally.

Required direction:

- `strict: true` target.
- noimplicit unsafe path aliases.
- no`skipLibCheck` asblanket fix unlessADR documents reason/expiry.
- shared package public APIs emitdeclarations.

## 19. Module Resolution and Exports

- Use workspace package names, notdeep relative imports acrosspackages.
- Everyshared package declares explicit `exports`.
- Internal files arenotpublic unlessexported.
- Avoidruntime TypeScript path aliases thatdisagree withNode/bundler resolution.
- CJS/ESM choice isexplicit perpackage; do notmix implicitly.
- Browser-safe andNode-only exports areseparate.

## 20. Build Outputs

- Application outputs remainwithin app-specific ignored directories.
- Shared packages produce `dist/` withJS, declarations andsource maps asrequired.
- Generated outputs arenot manuallyedited.
- CI builds fromclean checkout.
- Release artifacts arecreated fromtheexact tested SHA.
- No package depends onanother package's source path orstale local build accidentally.

## 21. Lockfile and Dependency Policy

- One root `package-lock.json` afterworkspace migration.
- Child lockfiles areremoved onlyafterclean install andCI proof.
- Exact versions forrelease-critical tooling wherecompatibility matters.
- Dependency overrides arecentralized anddocumented.
- No duplicate root/runtime pseudo-dependencies.
- Security updates passfull gates; major upgrades getseparate scope.
- `npm install` runs atthe root forworkspace development/CI unlessanisolated packaging step explicitlyrequires otherwise.

## 22. Scripts and Commands

Root scripts provide stable commands:

- `npm run build`
- `npm run typecheck`
- `npm run test:soft`
- `npm run test:hard:smoke`
- `npm run test:all`
- `npm run lint` whenstandardized.
- `npm run workspace:graph`
- `npm run workspace:cycles`

All custom automation isBash/Node cross-platform asapproved; noPowerShell requirement.

## 23. Dependency Graph Enforcement

WP-002 must addmachine-enforced rules:

- detect workspace cycles.
- forbid `bold-*` packages/imports.
- forbid application-to-application source imports.
- forbid Domain imports offramework/provider packages.
- validate package export boundaries.
- failCI onundeclared dependency use.

Tool choice may beMadge, dependency-cruiser, Nx graph, custom TypeScript/Node analysis oranotherapproved option; choose thesmallest reliable tool anddocument it.

## 24. Configuration Ownership

- Root provides schemas/tooling, notruntime secrets.
- Eachdeployable application ownsanexplicit environment schema.
- Shared config package mayprovide validators andcommon primitives only.
- Browser-exposed variables areseparate andpublic bydesign.
- Backend/POS secrets neverenterAdmin client bundle.
- Tests useexplicit fixtures; nofallback toProduction endpoints.

## 25. Observability Ownership

- Shared observability package maydefine interfaces, correlation metadata andredaction rules.
- Backend adapter integrateslogger/tracer/metrics provider.
- Admin/POS adapters respectruntime constraints.
- Domain emitsfacts/events butdoes notcalllogging providers.
- Metric names androute fingerprints arecentral contracts; rawtenant/resource IDs arenotlabels.

## 26. Security Boundaries

- Crypto, secure storage andtoken handling remainserver/main-process only.
- Contracts nevercarrysecret implementation details.
- POS preload exposesnarrow typed capabilities.
- Provider webhooks liveinBackend delivery/infrastructure, notdomain package.
- Test utilities cannotshipproduction credentials orbypass authorization bydefault.

## 27. Generated Code

Generated locations areexplicit:

- Prisma client generated byBackend tooling.
- API clients/types maybegenerated intoowned `generated/` directories.
- Generated files containheader andarenot manuallyedited.
- Generator version islocked.
- CI verifies regeneration causesnodiff whenrequired.

## 28. Testing Architecture

- Unit tests colocate withowner code.
- Contract tests validatepackage public APIs.
- Integration tests crossadapter/DB boundaries.
- E2E liveswithowning application/harness.
- `@athr/testing` suppliesdeterministic builders, clocks andassertions.
- No test importsprivate internals fromanotherpackage merely tomake testing easier.
- Performance profiles followATHR Performance Strategy v1.0.

## 29. Versioning and Compatibility

Track fourcompatibility dimensions:

- API contract version.
- POS protocol version.
- local POS schema version.
- database migration state.

Rules:

- Shared package version insideone repository doesnotreplaceprotocol versioning.
- POS supportsdeclared server compatibility window.
- Deployment order followsapproved Deployment Architecture.
- Breaking contract changes useversioned adapters/migration window.

## 30. CI Architecture

CI stages:

1. clean root install.
2. workspace metadata/dependency validation.
3. typecheck/build shared packages.
4. Backend/Admin/POS soft gates.
5. migration clean/populated gates whenaffected.
6. Admin E2E andhard smoke.
7. dependency/cycle/security checks.
8. release gate andartifact build.

Affected-package optimization mayreduce noncritical work later, butglobal contract, migration andrelease gates remainmandatory whenrelevant.

## 31. Deployment Boundaries

- Vercel builds `admin-web` withworkspace dependencies available.
- Railway builds Backend API/worker entrypoints fromroot-compatible workspace install.
- POS builder packages `pos-electron` andrequired workspace outputs.
- Migration runner isexplicit andnot application startup side effect.
- Build roots andcommands aredocumented afterWP-002 toavoidprovider-specific implicit installs.

## 32. Code Ownership

Everypackage/context has:

- owner responsibility.
- public API.
- allowed consumers.
- tests.
- security/data classification notes whereapplicable.
- ADR link fornon-obvious decisions.

Changes tocontracts/domain-core/error registry requirecross-application review becauseblast radius ishigh.

## 33. Documentation Structure

```
docs/
├── adr/
├── architecture/
├── runbooks/
├── protocols/
└── development/
```

Notion remainsproduct/system planning source; repository docs ownversion-coupled implementation decisions, commands, ADRs andrunbooks. Important decisions linkboth directions withoutcopying secrets.

## 34. Migration Plan for WP-002

1. Freeze exactWP-001 green SHA.
2. Addroot npm workspaces usingcurrent app paths and`packages/*`.
3. Normalize package names to`@athr/*`.
4. Remove all `bold-system-workspace` androot runtime dependencies.
5. Createinitial fourshared packages withminimal stable APIs.
6. Addroot base TypeScript/tooling configs.
7. Consolidate toone lockfile throughclean install.
8. Updateimports/scripts/CI/provider build commands.
9. Addcycle/boundary tests.
10. Runall quality gates andcompare installer/deploy behavior.
11. Record exactdependency graph andDelivery Log evidence.

## 35. Backward Compatibility

- No business behavior change isintended inWP-002.
- API, DB andPOS protocols remaincompatible.
- Package paths maychange internally throughadapters.
- Build/install commands maychange onlywithCI/provider validation.
- No remote DB migration isrequired unlessunexpected tooling data change isproven andseparately approved.

## 36. Failure and Recovery

Ifworkspace conversion fails:

- keepchanges ontransformation branch.
- revertforward throughnew commit; noforce push.
- restore previous lockfiles/scripts fromknown SHA ifrequired.
- do noteditremote DB.
- verifyBackend/Admin/POS individually beforechanging provider build commands.
- preserveWP-001 release identity/config behavior.

## 37. Acceptance Gate for WP-002

WP-002 passes onlywhen:

- root isreal npm workspace.
- one clean root install succeeds.
- one root lockfile isauthoritative.
- no `bold-*` package/dependency/import remains inruntime ortooling scope.
- no app depends onroot package.
- fourinitial shared packages build andtest.
- dependency graph hasno cycles orforbidden edges.
- Backend/Admin/POS typecheck, test andbuild pass.
- migration, Admin E2E, hard-smoke andrelease gate pass whereaffected.
- Vercel preview andWindows installer build pass.
- Railway build/deploy command isvalidated againstworkspace install withoutintroducingautomatic production mutation.
- Delivery Log records exact SHA andresults.

## 38. Open Decisions

- Exact dependency graph enforcement tool.
- Whether ESLint/package-boundary tooling joinsWP-002 orCoding Standards stage.
- Whether worker/scheduler entrypoints arecreated noworwhenfirst durable job isimplemented.
- Whether shared packages buildwith`tsc` references orbundler; default isplain `tsc` unlessneed disproves it.
- When, ifever, application folders move to`apps/*`.
- Exact publishability policy; baseline isprivate workspace packages.

## 39. Prohibited Patterns

- Big-bang repository rewrite.
- Cosmetic directory moves withnooperational value.
- Root workspace asruntime dependency.
- `file:..` pseudo-packages.
- `bold-*` compatibility aliases retained indefinitely.
- Giant `shared`, `common` or`utils` package.
- Domain importingframework/ORM/provider.
- Sharing Prisma models asAPI types.
- Cross-app source imports.
- Circular packages.
- Duplicated lockfiles afterworkspace acceptance.
- Build depending onstale local `dist`.
- Provider-specific secrets inpackage configs.

## 40. Implementation Mapping

- WP-002 implements thisrepository foundation.
- WP-003 expandscontracts/error registry intoapproved API model.
- WP-004 expandsdomain-core value objects.
- WP-005 onward builds bounded contexts underthese dependency rules.
- WP-018 appliesPOS internal process boundaries.
- WP-024/025 addsecurity andobservability packages onlywhenownership isstable.

## 41. Approval Outcome

هذهالوثيقة هيالعقد المعتمد لـWP-002. التنفيذ يجب أنيكونincremental، يحافظ علىgreen baseline، يزيل legacy package coupling، ويمنعإنشاءshared-code monolith جديد.