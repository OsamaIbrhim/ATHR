# 🛡️ Engineering Principles & Development Guidelines

This document is the absolute standard and constitution for all code generation, architecture design, documentation, and code reviews. It applies to every feature, refactor, Work Package (WP), and planning/report document — not only when writing code.

## 1. 🔒 Security & Data Protection

* **Zero-Trust Input Validation**: All incoming payloads, query parameters, and route parameters must be validated and sanitized using strict schema validation (e.g., Zod or Joi) before reaching business logic.
* **Strict Authentication & Authorization**: Every protected endpoint must explicitly enforce authentication and role-based access control (RBAC) middleware. Authorization context (tenant, user, scope) must always be resolved from trusted server-side state (session/token claims) — never from client-supplied request fields.
* **Secret & Sensitive Data Isolation**: Never hardcode credentials, API keys, or JWT secrets. Never expose sensitive fields (e.g., password hashes, internal IDs) in API responses or logs.
* **Injection & XSS Prevention**: Sanitize database queries to block NoSQL/SQL injections and sanitize user-generated inputs to prevent Cross-Site Scripting (XSS).

## 2. 🧱 Architecture, Scalability & Extensibility

* **SOLID & Clean Architecture**: Keep controllers light and HTTP-focused. Encapsulate core business logic within dedicated services/use-cases and database access within repositories/models.
* **Modular Independence**: Each Work Package (WP) must maintain clean boundaries. Code from one module must not directly mutate or tightly couple with another module's internal implementation. Dependency direction between shared packages/modules must be explicit and enforced (tooling should catch a violation, not just documentation).
* **Extensible Patterns**: Design interfaces and schema models to be flexible for future feature iterations without requiring breaking changes.
* **DRY with Prudence**: Abstract repetitive patterns cleanly, but avoid premature over-engineering. Prioritize clarity over complex abstractions.

## 3. ⚡ Performance & Resource Efficiency

* **Database Optimization**: Ensure proper indexing on queried, filtered, or foreign key fields. Prevent N+1 query problems using efficient joins, aggregations, or populated fields.
* **Payload Control**: Always implement pagination, sorting, and field projection (`select`) on list endpoints to avoid returning unnecessarily large payloads.
* **Non-Blocking Async Operations**: Handle all asynchronous operations gracefully. Avoid blocking the main execution thread with heavy computational loops inside request cycles.

## 4. 🛡️ Robustness & Error Handling

* **Standardized Error Management**: Use custom, centralized operational error classes (e.g., `AppError`, `ValidationError`, `UnauthorizedError`).
* **Predictable API Responses**: Ensure all API responses follow a uniform JSON structure for both success and error states (including HTTP status codes, error codes, and human-readable messages).
* **No Silent Failures**: Catch blocks must never fail silently or suppress errors without structured logging and appropriate error propagation.
* **Edge Case Coverage**: Explicitly guard against `null`, `undefined`, empty collections, race conditions, and malformed inputs.

## 5. 🧼 Code Quality & Maintenance

* **Strict Type Safety**: Avoid using implicit `any`. Explicitly type all parameters, return types, interfaces, and state objects.
* **Self-Documenting Code**: Write intention-revealing variable and function names. Use comments only to explain why a complex business decision was made, not what standard code does.
* **Consistent Naming Conventions**:
   * `camelCase` for variables, functions, and object properties.
   * `PascalCase` for classes, interfaces, types, and components.
   * `UPPER_SNAKE_CASE` for global constants and environment variables.
   * `kebab-case` for file names and route paths.

## 6. 📄 Documentation, Work Packages & Verification Discipline

* **Stable, deployable state at every step**: Every WP/change must leave the repository in a state that builds, tests, and deploys cleanly. Never hand off a half-finished state as if it were complete.
* **Branch discipline**: Always branch from the main/production branch with a task-specific name; never commit directly to the main branch. One focused PR per WP or logical unit of work — do not mix unrelated fixes into a scoped change.
* **Never claim success without evidence.** A test, build, or deploy is only "passed" if it actually ran and its output was observed. If an environment cannot run a required check (no Docker, no database, no network), report that explicitly as **unverified** — never silently treat unavailability as a pass, and never assume CI will "probably" catch it without confirming that it did.
* **Prove it across every real consumer, not just one.** A shared package, schema, or dependency change is not "done" because it builds on one machine. It must be proven with a clean install and build across every consumer that uses it (backend, frontend/admin, mobile/desktop client, and a real container build+run where applicable) before it's considered complete.
* **Root-cause before patching.** Reproduce and diagnose a failure before attempting a fix. Never retry blindly or guess-and-check against a real environment, especially production.
* **Migrations are forward-only and non-destructive by default.** Follow expand → backfill → validate → constrain. Never combine a schema change with data-destructive operations in the same step without an explicit, separately reviewed decision. Applied migrations are immutable — fix forward, never edit or delete an applied migration.
* **Documentation and governance decisions are authored deliberately, not freelanced.** When implementing a specification (a WP, an ADR, a design doc), implement precisely what is specified. If something is ambiguous or a cited reference doesn't say what the spec assumed, stop and flag the discrepancy rather than silently resolving it your own way. Report factual results (test counts, row counts, what changed) in PR descriptions; leave authorship of formal planning documents, decision records, and status reports to the process step designated for it.
* **Fail loud on ambiguous data.** When a data migration or transformation encounters a row/record that cannot be unambiguously handled, stop and report it with specifics — never default-assign or guess silently to make a count match.
