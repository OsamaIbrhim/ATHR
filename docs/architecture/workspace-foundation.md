# ATHR Workspace Foundation

WP-002 keeps the existing application directories and establishes one npm
workspace. It does not change business behavior, API contracts, database
schema, or POS protocol.

## Package ownership

| Package | Responsibility | Allowed consumers |
| --- | --- | --- |
| `@athr/contracts` | Stable transport and protocol types | API, Admin, POS |
| `@athr/domain-core` | Pure framework-independent foundations | Backend domain/application packages |
| `@athr/error-registry` | Error metadata types and registry primitives | API, Admin, POS |
| `@athr/testing` | Deterministic test-only builders and clocks | Test and development code |

The shared packages expose only their root export. They cannot import
application packages. `@athr/domain-core` cannot import NestJS, Prisma, React,
Next.js, or Electron.

## Dependency enforcement

`npm run workspace:validate` fails on:

- child lockfiles or a missing root lockfile;
- `bold-*`, `file:..`, or root-package dependencies;
- undeclared external imports;
- application-to-application dependencies;
- missing shared-package exports;
- forbidden domain framework imports;
- workspace dependency cycles.

The validator is tested independently and is a required CI release gate.

## TypeScript policy

`tsconfig.base.json` is strict and is mandatory for every new shared package.
The POS already compiles in strict mode. Backend and Admin retain explicit
legacy exceptions during this behavior-neutral package migration; those
exceptions are visible rather than inherited silently and must be removed
incrementally by owning work packages.

## Deployment roots

- Railway source/root directory: repository root.
- Railway config file: `/backend/railway.toml`.
- Railway Dockerfile: `backend/Dockerfile`.
- Vercel project root: repository root.
- Vercel config: `/vercel.json`.
- POS installer: root install, then `athr-pos-electron` build/dist scripts.

Provider dashboards must not add duplicate custom install, build, start, or
migration commands that compete with committed configuration.
