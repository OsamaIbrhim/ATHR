# ATHR Dependency Rules v1.0

**Status:** Approved engineering-design baseline

**Applies to:** npm workspaces, TypeScript imports, NestJS modules, Admin, POS, shared packages, database adapters, tests, scripts andCI enforcement.

## 1. Purpose

تحدد هذهالوثيقة اتجاهاتالاعتماد المسموحة والممنوعة داخل ATHR، وكيف تُفرضآليًا. الهدف هوإبقاءالنظام قابلًا للتغيير والاختبار دوندوائر، coupling خفي أوتسربframework/ORM إلىDomain.

## 2. Dependency Layers

الاتجاه الأساسي:

```
Shared Pure Foundations
        ↑
Domain
        ↑
Application
        ↑
Infrastructure
        ↑
Delivery / Runtime Composition
```

الأسهم تعني أنالطبقة العليا قدتعتمد علىالأدنى، وليسالعكس.

## 3. Workspace Dependency Graph

```
@athr/domain-core
@athr/error-registry
        ↑
@athr/contracts
@athr/testing (dev/test only)
        ↑
@athr/api   @athr/admin   @athr/pos
```

Rules:

- applications لا تعتمد علىبعضها.
- shared packages لا تعتمد علىapplications.
- `@athr/testing` لايظهر فيproduction dependencies.
- root workspace ليسruntime package.
- no `file:..` pseudo-dependencies.

## 4. Shared Package Rules

### `@athr/domain-core`

May import:

- standard library.
- tiny pure dependencies onlyafterreview.

Must not import:

- NestJS, Prisma, React, Next.js, Electron.
- provider SDKs.
- application packages.
- contracts transport DTOs.

### `@athr/error-registry`

May import:

- pure shared identifiers/types.

Must not import:

- HTTP framework exceptions.
- UI translation bundles.
- business services.

### `@athr/contracts`

May import:

- pure value/identifier representations approved forwire use.
- error registry public metadata.

Must not import:

- ORM models.
- Nest decorators/controllers.
- application handlers.
- React/Electron code.

### `@athr/testing`

May import:

- public APIs ofpackages under test.
- test-only dependencies.

Must not:

- beimported byproduction runtime paths.
- containsecrets orProduction endpoints.
- bypass tenant/auth rules bydefault.

## 5. Backend Layer Rules

### Domain

Allowed:

- own domain files.
- `@athr/domain-core`.
- selected pure error/value primitives.

Forbidden:

- NestJS.
- Prisma.
- HTTP/Swagger.
- filesystem/network/provider SDK.
- anothercontext infrastructure/application internals.

### Application

Allowed:

- own domain.
- own ports.
- public interfaces/contracts ofothermodules.
- shared contracts/error/value primitives.

Forbidden:

- direct Prisma Client.
- controller/request/response objects.
- UI/runtime code.
- anothermodule internal repositories/services.

### Infrastructure

Allowed:

- own application ports/domain mappings.
- Prisma/provider SDKs.
- messaging/storage/logging adapters.

Forbidden:

- exportingORM entities aspublic domain/API types.
- invokinganothercontext DB adapter directly.

### Delivery

Allowed:

- application public APIs.
- transport contracts.
- authentication/tenant context adapters.

Forbidden:

- embeddingbusiness rules.
- direct Prisma writes.
- leakingraw provider/ORM errors.

## 6. Cross-Module Rules

Allowed:

- import from`<module>/public` only.
- invoke publiccommand/query interface.
- consumeversioned integration event.
- readapproved projection.

Forbidden:

- deep import intoanothermodule.
- direct repository/table access.
- import anothermodule aggregate/entity forownership mutation.
- circular service calls.
- `forwardRef` usedtohide architecture cycle.

## 7. NestJS Module Rules

- Eachcontext exports onlyapplication/public facade andrequired tokens.
- Infrastructure providers remainprivate unlessshared adapter isexplicit.
- Global modules arelimited toconfiguration, observability andrequest context.
- Domain modules neverdepend onNest module metadata.
- Cycles must beredesigned viaevents, ports ororchestrator.
- `forwardRef` requiresADR, owner andremoval date.

## 8. Database Dependency Rules

- Prisma Client isowned byBackend infrastructure composition.
- Domain/Application do notimportgenerated Prisma types.
- Repository implementations mapbetweenpersistence records anddomain objects.
- Cross-context FK doesnotpermitcross-context writes.
- No shared repository thataccepts arbitrary model name.
- Transaction interface exposedtoapplication iscapability-based, notrawPrisma escape hatch.

## 9. Transaction Dependency Rules

- Application handler declarestransaction need.
- Infrastructure providestransaction scope.
- Network/provider calls cannotrun insideDB transaction.
- Cross-context process usesoutbox/Saga, notoneDB transaction bydefault.
- Tests failwhenexternal calls occurinsideannotated transaction path whereinstrumentable.

## 10. Events and Messaging Dependencies

- Domain emitsinternal event types.
- Application/infrastructure maps tointegration contract.
- Consumers depend onversioned event contract, notpublisher internals.
- Messaging adapter depends onapplication ports.
- Publisher domain doesnotdepend onconsumer.
- Consumer failure cannotrollbackpublisher commit.

## 11. Admin Dependency Rules

Allowed:

- `@athr/contracts` browser-safe exports.
- browser-safe error registry.
- approvedUI tokens.
- Admin-ownedclients/hooks/components.

Forbidden:

- Backend source imports.
- Prisma types/client.
- POS source/components.
- server secrets inclient bundles.
- direct database access.

Server Components/BFF mayholdserver-only API credentials butstill useBackend API, notDB.

## 12. POS Dependency Rules

### Main Process

May depend on:

- Electron/Node APIs.
- local storage adapter.
- secure storage.
- API/sync/printing/updater adapters.
- browser-neutral contracts.

### Preload

May depend on:

- typedIPC contract only.
- serialization/validation primitives.

### Renderer

May depend on:

- React/UI state.
- typed preload bridge.
- browser-safe contracts.

Renderer must notdepend on:

- Node filesystem/process.
- Electron main internals.
- local DB driver.
- secrets/tokens.

## 13. Runtime-Specific Export Rules

Shared packages separateexports whenneeded:

```json
{
  "exports": {
    ".": "./dist/index.js",
    "./browser": "./dist/browser.js",
    "./node": "./dist/node.js"
  }
}
```

Browser consumers cannotresolveNode-only exports. CI validatesbundle boundaries.

## 14. Type-Only Dependencies

- `import type` isrequired whendependency iscompile-time only.
- Type-only imports stillcount forarchitecture ownership andcannotbypass forbidden module edges.
- Runtime circularity andtype circularity arebothreported.

## 15. Public API Rules

Eachpackage/module definesexplicit exports.

Forbidden:

- wildcard export ofentireinternal tree.
- importing from`src/*` ofanotherworkspace.
- depending onbuild output paths.
- undocumented deep imports.

Breaking public export changes requireconsumer update inthesamechange orcompatibility window.

## 16. Dependency Declaration Rules

- Everyruntime import appears in`dependencies`.
- build/test-only tools appear in`devDependencies`.
- peerDependencies onlyforintentional host-provided framework contracts.
- noimplicit hoisting reliance.
- CI runsundeclared-dependency detection.
- package manager lockfile isauthoritative.

## 17. Version Rules

- One repository doesnotjustifyunbounded `*` versions.
- Internal workspace dependencies useworkspace-compatible semver policy.
- release-critical tools maybepinned exactly.
- major upgrades areseparate reviewed scope.
- protocol/API compatibility isnotrepresented onlybypackage version.

## 18. Cyclic Dependency Rules

Anycycle isfailure unlessexplicitlydocumented temporarymigration exception.

Resolution order:

1. move pure shared concept toapproved shared kernel.
2. invert dependency throughport.
3. introduceorchestrator/process manager.
4. publish/consume event.
5. split mixed-responsibility module.

Do notsolve by:

- barrel-file tricks.
- dynamic `require`.
- service locator.
- `forwardRef` withoutdesign correction.

## 19. Dependency Boundary Enforcement

WP-002 must implementmachine checks for:

- workspace cycles.
- forbidden package edges.
- deep imports.
- `bold-*` dependency/import names.
- root runtime dependency.
- application-to-application imports.
- domain imports offramework/ORM/provider packages.
- production imports from`@athr/testing`.
- browser imports ofNode-only modules.

## 20. Suggested Enforcement Configuration

Tool selection remainsimplementation choice, butminimumoutputs are:

- human-readable graph.
- machine-readable JSON.
- nonzero exit onviolation.
- clear source/target/rule name.
- allowlist withowner, reason andexpiry only.

A small custom Node checker ordependency-cruiser ispreferred overheavy platform adoption unlessmeasured need exists.

## 21. Rule Naming

Stable rule identifiers:

- `DEP_NO_CYCLES`
- `DEP_NO_BOLD_PACKAGES`
- `DEP_NO_ROOT_RUNTIME_DEP`
- `DEP_NO_APP_TO_APP`
- `DEP_DOMAIN_NO_FRAMEWORK`
- `DEP_DOMAIN_NO_ORM`
- `DEP_NO_CROSS_MODULE_INTERNAL`
- `DEP_NO_TESTING_IN_RUNTIME`
- `DEP_BROWSER_NO_NODE`
- `DEP_NO_UNDECLARED_PACKAGE`
- `DEP_PUBLIC_EXPORTS_ONLY`

CI errors reportthese identifiers.

## 22. Legacy Violation Policy

Existing violations mayreceivetemporary allowlist onlywhen:

- exactfile/edge listed.
- owner assigned.
- removal WP identified.
- expiry date orcommit milestone set.
- no newviolations allowed.

Allowlist size mustdecrease; CI reports trend.

## 23. Shared Kernel Admission Rule

A concept enters`@athr/domain-core` onlyif:

- at leasttwo contexts needidentical semantics.
- ownership isnotcommercially disputed.
- no context-specific state machine/policy.
- stable name andprecision exist.
- tests proveinvariants.

Forbidden candidates includeSaleStatus, PaymentStatus, MovementType, SubscriptionState, Role policy andtax/promotion logic.

## 24. Error Dependency Rules

- Domain returnsdomain failure/error code, notHTTP exception.
- Delivery maps toHTTP/IPC response.
- Provider errors aretranslated inadapter.
- UI consumesstable error contract andlocalization key.
- RawSQL/Prisma/provider messages nevercrosspublic boundary.

## 25. Configuration Dependencies

- Runtime config validated atcomposition root.
- Domain neverreadsprocess.env.
- Application receivesconfiguration/policy viaexplicit ports/value objects.
- Admin client code accessesonlypublic variables.
- POS renderer receivesnonsecret configuration throughpreload.

## 26. Observability Dependencies

- Domain doesnotdepend onlogger/tracer SDK.
- Application mayemitstructured telemetry throughport whennecessary.
- Infrastructure/delivery implementslogging/tracing.
- correlation metadata mayliveinpure shared contract.
- telemetry cannotbeused asbusiness source oftruth.

## 27. Security Dependencies

- crypto implementation remainsadapter/main/server side.
- domain maydepend onhash/signature verification port, notlibrary.
- secret storage neverimported byrenderer/browser packages.
- authorization facade isrequired beforeowner commands; UI checks areadvisory only.

## 28. Test Dependency Rules

- Unit tests importowner module internals asallowed withinmodule.
- Contract tests importpublic API only.
- Integration tests mayuseinfrastructure test harness.
- E2E interacts throughdelivery boundaries.
- Fixtures fromanothercontext usepublic builders/contracts, notprivate entities.
- Tests cannotintroducearchitecture edge absent inproduction.

## 29. Generated Code Dependencies

- Generated Prisma code remainsBackend infrastructure.
- generated API clients maydepend oncontracts.
- generated outputs haveexplicit owner andexports.
- manual code cannotimportgenerator internals.
- regeneration mustbedeterministic.

## 30. Script and CI Dependencies

- Root scripts orchestrate; they arenotimported byapplications.
- Bash/Node scripts useexplicit package entrypoints.
- CI jobs installfromroot lockfile.
- provider build commands cannotdepend ondeveloper-global tools.
- migration runner depends onBackend schema/tooling only.

## 31. Deployment Dependency Rules

- Railway Backend build includesrequired workspace packages butdoesnotbuildAdmin/POS unnecessarily.
- Vercel Admin build resolvesbrowser-safe packages only.
- POS packaging includesexact tested workspace outputs.
- deployment config cannotpointtoanotherbranch's stale artifacts.
- release artifact recordscommit SHA andprotocol compatibility.

## 32. Review Requirements

Changes requirearchitecture review whenadding:

- newshared package.
- newcross-context dependency.
- `forwardRef`.
- direct provider SDK inapplication/domain.
- cross-context transaction.
- public package export.
- allowlist exception.

## 33. Acceptance Gate for WP-002

WP-002 passes dependency portion onlywhen:

- graph generated fromclean checkout.
- zero cycles.
- zero `bold-*` dependency/import.
- no app-to-app source imports.
- no root runtime dependency.
- no domain framework/ORM imports.
- no runtime use oftesting package.
- public exports validated.
- violations produceclear CI failure.
- temporary exceptions areexplicit andbounded.

## 34. Open Decisions

- exacttool: custom checker vsdependency-cruiser.
- whetherESLint import-boundary rules joinWP-002 orCoding Standards.
- exactworkspace semver notation supported bycurrentnpm version.
- whetherTypeScript project references areused immediately.

## 35. Prohibited Patterns

- dependency cycle hidden bybarrel.
- `forwardRef` asnormal architecture.
- root package imported byapps.
- `file:..` dependency.
- app importinganotherapp.
- domain importingPrisma/Nest/provider.
- UI importingDB model.
- runtime importingtest utilities.
- blanket allowlist withoutowner/expiry.
- movingbusiness logic into`common` tosolvecycle.

## 36. Implementation Mapping

- WP-002 enforcesworkspace/package graph.
- WP-003 enforcescontract/error boundaries.
- WP-004 hardenspure value-object dependencies.
- laterWPs removelegacy cross-context violations incrementally.

## 37. Approval Outcome

هذهالوثيقة تصبحالعقد التنفيذي لكلimport وpackage edge فيATHR. أيdependency جديدة يجب أنتمر منالاتجاهاتوالقواعد المعلنة، وليسمنسهولةالوصول إلىالكود.