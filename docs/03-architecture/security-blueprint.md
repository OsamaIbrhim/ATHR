# ATHR Security Blueprint v1.0

**Planning Baseline — Identity, Sessions, Authorization, Device Trust, Encryption, Secrets, Secure SDLC and Incident Response**

## 1. وظيفة الوثيقة

تحدد هذه الوثيقة التصميم الأمني المعتمد لمنصةATHR، وتشمل:

- Threat model والأصول وحدودالثقة.
- Authentication للـAdmin Web والـPOS والـAPIs والخدمات.
- Password hashing وتحويلبياناتBold الحالية.
- Sessions وAccess/Refresh tokens والإبطال.
- MFA وStep-up Authentication وRecovery.
- Runtime Authorization وربطه بالـTenant والـEntitlements.
- Device enrollment والـPOS trust والـOffline cryptography.
- Secrets وKey management والـrotation.
- Encryption أثناءالنقل وعندالتخزين وعلىمستوىالحقول.
- Browser security: Cookies, CSRF, CORS, CSP andheaders.
- API abuse, rate limiting andbot controls.
- Webhooks وExternal provider verification.
- Database, files, exports andbackup security.
- Dependency andsoftware supply-chain security.
- Secure CI/CD وRelease signing.
- Logging, detection, vulnerability management andincident response.
- Support access وBreak-glass.
- Secure migration منBold إلىATHR.
- Security tests والـacceptance gates.

هذه الوثيقة لا تحددTopology النهائية أوعددالبيئات والخوادم؛ ذلك فيDeployment Architecture. ولا تستبدلPermission Matrix أوMulti-tenancy Blueprint أوAudit Catalog، بل تحولها إلىضوابطأمنية قابلةللتنفيذ.

## 2. الأهداف الأمنية

1. منعCross-tenant data access أوreference أوside effect.
2. منعالاستيلاءعلىالحسابات والجلسات والأجهزة.
3. حمايةالأموال والمخزون والمستندات منالتغييرغيرالمصرح.
4. الحفاظعلىOffline continuity دونتحويلالـPOS إلىنقطةثقة مطلقة.
5. جعلكلقرار حساس قابلاًللتفسير والتدقيق.
6. تقليلأثر اختراقحساب أوجهاز أومزودواحد.
7. منعSecrets منالظهور فيالكود أوLogs أوBuild artifacts.
8. اكتشافالانحراف والـabuse والـtampering بسرعة.
9. ضمانإمكانيةالإبطال والدوران والاسترداد.
10. الحفاظعلىالأمان خلالتحويلBold إلىATHR، وليسفقطبعدنهايته.

## 3. المبادئ غيرالقابلة للتفاوض

1. Default deny.
2. لاAuthorization فيالواجهةفقط.
3. Authentication لا تمنحTenant access دونMembership فعالة.
4. Permission لا تتجاوزTenant Scope أوEntitlement أوResource state.
5. كلHigh-risk action يعادتقييمها علىالخادم وقتالتنفيذ.
6. Secrets لا تخزنفيGit أوDatabase plaintext أوClient bundle.
7. Passwords لا تشفرقابلةللاسترجاع؛ تخزنHash مقاومةللهجمات.
8. Session/refresh/device tokens تخزنHash أوReference آمنة فقط.
9. لاAccess/Refresh tokens في`localStorage` للـAdmin Web.
10. لاShared user أوShared support أوShared device credentials.
11. كلEnvironment لهاCredentials ومفاتيحمستقلة.
12. كلKey وSecret لهاOwner وPurpose وVersion وRotation path.
13. لاBlind retry بعدOutcome خارجيةمجهولة.
14. لاأثرمالي أوأمني يعتمدعلىوقتClient وحده.
15. كلOffline operation لهاLease وتوقيع وSequence وIdempotency.
16. Provider webhooks لا تثققبلالتحققمنالتوقيع والـreplay.
17. Logs وAudit لا تحتويPasswords أوTokens أوPrivate keys أوPayment credentials.
18. Support لا يملكStanding access إلىTenants.
19. Break-glass مؤقت ومحددومدقق ويخضعلمراجعةبعدية.
20. Backups وExports تعتبربياناتحساسةمثلSource data.
21. Security controls تفشلClosed فيالمساراتالحساسة.
22. لاتشغيلProduction أوDemo حقيقي بـdefault secrets.
23. لاكسرللتوقيع أوالتشفير منأجلتسهيلDebugging.
24. لايعتمدالأمانعلىسريةالكود أوأسماءRoutes.
25. كلSecurity bypass استثنائي صريح ومحدودويملكتاريخانتهاء.

# القسم الأول — Threat Model

## 4. الأصول عاليةالقيمة

- Tenant business data.
- Sales, payment, refund andcash records.
- Inventory andcost ledgers.
- Customer, supplier andmembership PII.
- Password hashes, MFA factors andsession families.
- Device private keys andoffline leases.
- Provider API keys andwebhook secrets.
- Signing keys forTokens, leases, updates anddocuments.
- Database, storage andbackup credentials.
- Admin/support permissions.
- Audit andsecurity evidence.
- POS release artifacts andupdate manifests.

## 5. الجهات المهددة

- مهاجمخارجي غيرمسجل.
- مستخدمTenant منخفضالصلاحية يحاولرفعصلاحياته.
- مستخدمTenant خبيث يحاولالوصوللـTenant أخرى.
- حسابمخترق عبرcredential stuffing أوphishing.
- جهازPOS مسروق أومصاب.
- موظفداخلي أوSupport operator سيئالاستخدام.
- Dependency أوCI runner أوrelease artifact مخترق.
- Provider webhook مزور أوreplayed.
- تطبيقClient قديم أوModified.
- خطأبرمجي ينسىTenant predicate.
- Misconfiguration فيRailway/Vercel/Supabase/GitHub.
- تسريبBackup أوExport أوSigned link.

## 6. التهديدات الأساسية

- Cross-tenant read/write.
- Broken object-level authorization.
- Session theft/fixation/replay.
- Password guessing andcredential stuffing.
- MFA fatigue أوrecovery abuse.
- CSRF, XSS, injection andSSRF.
- File upload malware/path abuse.
- Webhook forgery/replay/out-of-order state.
- Offline operation forgery/replay/clock manipulation.
- Device cloning andkey extraction.
- Token leakage inURLs, logs orbrowser storage.
- Supply-chain compromise.
- Privilege escalation andself-approval.
- Audit deletion أوtampering.
- Denial ofservice/noisy neighbor.
- Secret exposure throughCI أوclient bundle.
- Insecure update channel للـPOS.

## 7. Trust Zones

```
Public Internet
├── Admin Browser
├── POS Device / Electron
├── External Provider / Webhook
└── Support Operator
        ↓
Edge / Web Application Boundary
        ↓
ATHR API and Workers
        ↓
PostgreSQL / Object Storage / Secret Stores
```

كلانتقال بينZone يحتاجAuthentication, validation, authorization, encryption andlogging المناسبة.

# القسم الثاني — Identity Architecture

## 8. Platform Identity

- هويةعالميةلاتحملTenant permissions مباشرة.
- Authentication methods ترتبطبالهوية.
- Memberships مستقلةلكلTenant.
- تعطيلIdentity أمنيًا يبطلجلساتهاوعضوياتالوصولفعليًا.
- حذفMembership لا يحذفIdentity ولاAudit history.

## 9. Identity Identifiers

- Email/phone تعرضبشكلمنفصل عنNormalized value.
- Normalization ثابتةوVersioned.
- Lookup ضدقيمطبيعية آمنة، معمنعEnumeration.
- تغييرPrimary contact يحتاجRecent authentication والتحققمنالقيمةالجديدة.

## 10. Account Discovery Protection

Login, reset andinvitation endpoints لا تكشفبوضوح هلIdentity موجودة.

- Response user-facing عامة.
- Internal audit يسجلالسببالحقيقي.
- Rate limits وتوقيتاتالتنفيذ تقللEnumeration.
- Recovery لا يرسلبياناتTenant أوRoles قبلالتحقق.

## 11. Identity States

- PendingVerification.
- Active.
- Restricted.
- Suspended.
- Compromised.
- Closed.

الانتقالإلىCompromised:

- يبطلsessions والـrefresh families.
- يبطلrecovery challenges الحساسة.
- يراجعMFA/device bindings.
- لا يحذفالدليل.

# القسم الثالث — Password Security

## 12. Password Hashing Baseline

كلماتالمرور الجديدة تستخدم`Argon2id` منخلالمكتبةمراجعة، مع:

- Salt عشوائيةفريدة.
- Memory/time/parallelism parameters محفوظةمعالـhash.
- Parameters benchmarked علىبيئةالخادم لتحقيقكلفةعمليةمناسبة دونDoS.
- Pepper اختياري داخلSecret store إذااعتمد، معVersion وrotation path.
- Constant-time verification عبرالمكتبة.

لا نستخدمHash سريعةمثلSHA-256 أوMD5 لكلماتالمرور.

## 13. Password Policy

Baseline:

- يسمحPassphrases طويلة.
- Minimum length مناسبة، دونقواعدتركيب معقدة تجبرأنماطًا متوقعة.
- Maximum length كبيرومحدود لمنعDoS.
- رفضقيمشائعةأومسربة عبرقائمةمحلية/خدمةخصوصية عنداعتمادها.
- لاPeriodic rotation بلاسبب؛ التغيير عندالاشتباه أوالسياسةالخاصة.
- لاSecurity questions.
- لا ترسلPassword بالبريد أوتظهرللدعم.

## 14. Login Verification

- Progressive throttling حسبIP +identity hint +device fingerprint الآمن.
- لاPermanent lockout سهللـDoS.
- Suspicious attempts تنتجSecurity signals.
- Password comparison لا تكشففرقوجودالحساب.

## 15. Bold Password Migration

لا نفترضخوارزميةالـhash الحالية.

المسار:

1. Inventory فعليلصيغةالـhash والـparameters فيBold.
2. منعطباعةأوتصديرالـhashes خارجMigration tooling.
3. إذاالصيغةقابلةللتحقق وآمنةبحدأدنى:
    - تحققLegacy.
    - عندنجاحالدخول، Rehash فورًا بـATHR Argon2id.
    - سجّلcredential version migration.
4. إذاالصيغةضعيفةأومجهولةأوغيرمدعومة:
    - Forced reset workflow.
    - Token one-time قصيرةالعمر.
    - لا نقلPlaintext.
5. بعدنافذةالمهاجرة، إزالةLegacy verifier.
6. إبطالLegacy sessions عندcutover.

قرارالاحتفاظأوالـforced reset يحسمبعدفحصRepository/DB، وليسقبلذلك.

# القسم الرابع — Sessions and Tokens

## 16. Client-specific Model

### Admin Web

- Server-managed session أوopaque session identifier داخلCookie.
- Cookie: `HttpOnly`, `Secure`, `SameSite=Lax` أوأشدحسبالمسار.
- Prefer `__Host-` prefix عندمايسمحالنشر.
- لاTokens في`localStorage` أوquery string.
- Session data server-side أوreference قابلةللإبطال.

### POS / Electron

- Short-lived access token.
- Rotating refresh-token family.
- Refresh token داخلOS secure storage، وليسlocal database plaintext.
- Device binding وkey version داخلsession context.
- Offline operation تعتمدLease منفصلة، لاتمددAccess token ذاتيًا.

### Service / Worker

- Service principal مستقلة.
- Short-lived credentials أوplatform-issued tokens.
- No shared human account.
- Purpose وscopes ضيقة.

## 17. Access Token Contract

عندالاستخداميحملأقلقدرلازم:

- subject identity/service/device.
- session ID.
- selected tenant/membership عندTenant session.
- authentication strength.
- issued/expiry times.
- token ID.
- issuer/audience.
- authorization/policy version references.
- key ID.

لا يحملFull PII أوكلpermissions كقائمةجامدةطويلة.

## 18. Token Signing

- Asymmetric signing.
- `kid` إلزامي.
- Public verification keys قابلةللتدوير.
- Private keys خارجDatabase وRepository.
- Dual-key overlap خلالrotation.
- Unknown/retired key failsclosed.
- Exact algorithm/library تثبتفيEngineering ADR بعدCompatibility test.

## 19. Session Lifetime

Baseline policy:

- Access tokens قصيرةالعمر.
- Refresh/session absolute lifetime محدودةوقابلةللتهيئة حسبclient/risk.
- Idle timeout للـAdmin.
- أقصرلفريقPlatform Support والعملياتالحساسة.
- Offline lease لهاTTL مستقلةولاتمددSession.
- “Remember me” لا يلغيabsolute expiry أوrevocation.

القيمالنهائية تحفظكـversioned security policy، لاHard-coded موزعة.

## 20. Refresh Token Rotation

- كلRefresh ينتجToken جديدة.
- Token القديمة تصبحUsed.
- Reuse يعتبراحتمالسرقة ويبطلFamily كاملة.
- تخزنHashes فقط.
- Family ترتبطSession/device/client.
- Concurrent legitimate refresh يعالجAtomicًا دونقبولreplay.

## 21. Session Fixation Prevention

- Session ID تتغيربعدLogin وMFA وStep-up وTenant switch وPrivilege elevation.
- Pre-auth session لا تتحولبهويةثابتةكماهي.
- Logout يبطلserver-side session/family، وليسحذفCookie فقط.

## 22. Session Inventory

المستخدميرى:

- Devices/sessions النشطة.
- Created/last-used times.
- Approximate location/IP masked.
- Client type.
- Revoke action.

Security/tenant admins يرونMasked status وفقPermission، وليسTokens.

## 23. Revocation Events

إبطالالجلسات عند:

- Password reset/change حسبpolicy.
- MFA removal.
- Identity suspension/compromise.
- Membership suspension.
- Owner/role/scope high-risk change.
- Device revoke.
- Support grant expiry.
- Refresh reuse.

# القسم الخامس — MFA and Step-up Authentication

## 24. Authentication Strength Levels

- **A0:** Session موجودة ومقبولة.
- **A1:** Primary authentication حديثة.
- **A2:** MFA أوStep-up حديثة.
- **A3:** Strong MFA +independent approval أوsecurity-controlled path.

تتوافقمعPermission Matrix.

## 25. MFA Baseline

الأولوية:

1. WebAuthn/Passkeys عندمايدعمالتنفيذ والـclients.
2. TOTP كخيارMVP عملي.
3. Recovery codes أحاديةالاستخدام.

SMS لا تستخدمكعاملقوي أساسي لـA2/A3؛ يمكنقناةRecovery مقيدة عنداعتمادسياسةخاصة.

## 26. MFA Enrollment

- يتطلبRecent primary authentication.
- Secret لا يظهرإلابمرةالإنشاء.
- TOTP secret مشفرةعندالتخزين.
- Confirm challenge قبلالتفعيل.
- Recovery codes تولدوتعرضمرةواحدة وتخزنHashes.
- Enrollment/Removal Audit وإشعارأمني.

## 27. MFA Enforcement

إلزاميةعلىالأقللـ:

- Platform operators.
- Tenant owners.
- Users الذينيديرونRoles/Scopes أوBilling أوRefunds/Exports الحساسة.
- Support/Break-glass.

Exact rollout يمكنتدريجيًا، لكنHigh-risk actions لاتظلA0.

## 28. Step-up Triggers

- Owner transfer.
- Role/scope elevation.
- Add/remove MFA أوPrimary contact.
- Large refund/credit/manual payment confirmation.
- Sensitive export/download.
- Device enrollment/revoke/key rotation.
- Provider/secret configuration.
- Tenant closure/reopen.
- Support access وimpersonation.
- Legal hold changes.

## 29. Step-up Freshness

- Step-up proof قصيرةالعمر ومقيدةبالSession.
- Critical commands قدتربطproof بـaction/resource/payload hash.
- تغييرpayload بعدApproval/Step-up يبطلها.
- لا تسمحواجهةClient بتحديد`mfa=true` بنفسها.

## 30. Recovery

- Recovery code single-use.
- Lost-factor recovery لا تعتمدعاملًاواحدًا ضعيفًا.
- High-value accounts قدتحتاجmanual verified review.
- Recovery تبطلالعوامل/الجلساتالمعرضةللخطر وتنتجإشعارات.
- Support لا يتجاوزMFA دونBreak-glass موثق.

# القسم السادس — Authorization Enforcement

## 31. معادلةالسماح

```
ALLOW =
Identity active
AND Session valid
AND Membership active
AND Tenant context matches
AND Scope matches
AND Permission granted
AND Constraints pass
AND Entitlement allows
AND Resource state allows
AND Authentication strength sufficient
AND Approval satisfied
AND Device/channel trust sufficient
AND No explicit deny
```

## 32. Runtime Decision

كلCommand حساسةتعيدتقييم:

- Current membership status.
- Policy/role/scope versions.
- Tenant access mode.
- Entitlement snapshot.
- Resource tenant/state/version.
- Step-up freshness.
- Approval payload hash.
- Device/terminal/lease state.

## 33. Token Claims vsLive State

Token قدتحملReferences/versions، لكنلا تعتبرالحالةالنهائية عندHigh-risk action.

- Low-risk reads يمكنتستخدمCache قصيرة.
- Revocations الحساسة تدفعInvalidation أوLive check.
- Policy version mismatch يجبرRefresh/Reauthorization.

## 34. Resource Access

- Query by`tenant_id + resource_id`.
- Cross-tenant resource يعاملnot found/forbidden دونكشفالمالك.
- Child references تتحققComposite same-tenant.
- No mass assignment لحقولowner/status/role/tenant.

## 35. Separation of Duties

- Requester ≠Approver وفقpolicy.
- Self-approval ممنوعةفيP2/P3.
- Approval ترتبطpayload hash وresource version.
- تنفيذبعدتغيرالمورد يفشلأويحتاجApproval جديدة.

## 36. UI Responsibility

الواجهة:

- تخفي/تعطلغيرالمسموح لتحسينUX.
- لا تعتبرControl أمنيًا.
- تتعاملدائمًا معServer deny.
- لا تخزنPermission state طويلًا بلاversion.

# القسم السابع — Tenant Isolation Security

## 37. Required Controls

- TenantContext منمصدرموثوق.
- Scoped repositories فقط.
- `tenant_id` صريح.
- Composite foreign keys.
- Tenant-scoped uniqueness.
- Tenant-aware cache/jobs/events/files.
- Cross-tenant automated tests.
- RLS بعدProof.

## 38. RLS Security Gate

قبلالتفعيل:

- `SET LOCAL` داخلTransaction أوmechanism آمن.
- Fail closed عندغيابtenant setting.
- لاContext leakage عبرSupabase pooler.
- Runtime role بلا`BYPASSRLS`.
- Migration/admin role منفصلة.
- Support لا يعتمدGlobal bypass.

## 39. Tenant Enumeration

- Slug/domain public visibility لا تكشفالحالةالداخلية.
- Resource IDs opaque.
- Errors لا تكشفوجودRecords فيTenant أخرى.
- Timing differences تقللقدرالإمكان.

# القسم الثامن — Browser and Admin Web Security

## 40. Cookie Security

- `HttpOnly` لمنعقراءةJavaScript.
- `Secure` دائمًا خارجLocal development.
- `SameSite=Lax` baseline، و`Strict` للمساراتالمناسبة.
- Narrow path/domain.
- Rotation عندتغيرPrivilege.
- No auth token inURL.

## 41. CSRF

SameSite ليستالدفاعالوحيد.

- Synchronizer token أوdouble-submit pattern آمن.
- Validate Origin/Referer للطلباتالحساسة.
- State-changing routes لا تستخدمGET.
- CORS لا يعوضCSRF.

## 42. CORS

- Exact allow-list للـAdmin origins.
- لا`*` معcredentials.
- Restrict methods/headers.
- Preflight handling صريح.
- Origin values منvalidated environment configuration.
- Local development origin منفصلة.

## 43. Content Security Policy

Baseline:

- `default-src 'self'`.
- Scripts عبرnonces/hashes.
- تجنب`unsafe-inline` و`unsafe-eval`.
- `frame-ancestors 'none'` أوallow-list صريحة.
- `object-src 'none'`.
- Connect/image/font sources allow-listed.
- Report-only rollout قبلenforcement عندالحاجة.

## 44. Security Headers

- HSTS بعدتثبيتHTTPS/domain policy.
- `X-Content-Type-Options: nosniff`.
- Referrer policy مقيدة.
- Permissions Policy مقيدة.
- Frame protection عبرCSP.
- Cache-Control يمنعCaching للصفحاتالحساسة.

## 45. XSS Protection

- Output escaping bydefault.
- No raw HTML منTenant data دونsanitization.
- Rich text allow-list صغيرة.
- Template rendering strict.
- URLs validated andprotocol allow-listed.
- Sensitive tokens لاتظهرفيDOM أوclient logs.

## 46. Redirects and Deep Links

- Return URLs allow-listed أوrelative فقط.
- No open redirect.
- Deep link يعيدAuthentication/Authorization.
- External links marked andvalidated.

# القسم التاسع — API Security

## 47. Input Validation

- Strict DTO validation.
- Reject unknown fields للمساراتالحساسة.
- Canonicalize beforevalidation where defined.
- Numeric decimal strings validated.
- Size/depth/count limits.
- IDs andEnums strict.
- No dynamic SQL/field names منClient.

## 48. Injection Prevention

- Prisma/parameterized queries.
- Raw SQL onlyreviewed helpers.
- No shell execution fromrequest data.
- No template code execution.
- CSV/Spreadsheet formula escaping.
- LDAP/NoSQL/XML protections إذاأضيفتالتقنياتمستقبلًا.

## 49. Mass Assignment

DTOs لا تمررمباشرةإلىORM update.

حقولمثل:

- tenant_id.
- status.
- owner.
- role/permissions.
- amount/totals.
- created_by.
- provider outcome.

تحسبأوتحددداخلServer policies.

## 50. SSRF

- Outbound URLs منallow-listed providers/endpoints.
- Webhook endpoints validated ضدprivate/link-local/metadata networks عندالإنشاءوالإرسال.
- DNS rebinding defenses حيثيلزم.
- Timeouts/size limits/no redirects أوredirect policy محددة.

## 51. Error Handling

- Stable public error codes.
- لاstack traces/SQL/provider secrets للعميل.
- Request ID للمراجعة.
- Internal logs بهاسببآمنومقيد.
- Auth errors لا تساعدEnumeration.

## 52. Rate Limiting and Abuse

طبقات:

- IP/network.
- Identity/contact hint.
- Session.
- Tenant.
- Device/terminal.
- Endpoint/operation.
- Global safety.

أشدلـ:

- Login/MFA/reset/invitation.
- Enrollment.
- Export/report generation.
- Refund/payment retry.
- Search endpoints المعرضةللسحب.
- Webhook failures.

## 53. Security-critical Rate Limits

لا تعتمدIn-memory فقطعندتعددinstances.

- Persistent/distributed mechanism عندProduction scale.
- Demo single instance يمكنتبدأبـbounded local +database evidence، مععدمادعاءالحمايةالموزعة.
- Deployment Architecture تحددprovider/edge implementation.

## 54. Idempotency

- Required للمutations القابلةللتكرار/المالية.
- Same key +different payload =conflict.
- Keys scoped bytenant/principal/route.
- Response references محفوظة.
- لا تستخدمIdempotency كAuthorization.

# القسم العاشر — POS and Electron Security

## 55. Enrollment

- One-time enrollment token.
- قصيرةالعمر، single-use، tenant/location/terminal-bound.
- إصدارها يحتاجPermission وA2.
- Device generates local key pair.
- Server registers public key/fingerprint.
- Token لا تتحولإلىPassword دائمة.

## 56. Device Identity

- Device credential مستقلةعنUser session.
- Private key non-exportable قدرالإمكان.
- Key version وrotation.
- Revocation andretirement states.
- Device identity لا تمنحكلTenant permissions.

## 57. Local Secret Storage

- Refresh token/device private material فيOS secure storage.
- لاPlaintext داخل`sql.js` أوJSON/config files.
- Local database تستخدمper-installation data-encryption key محميةبـOS key store عندتنفيذالتشفير.
- إذاتعذرFull DB encryption فيمرحلةمبكرة، تقللPII ويشفّرOutbox/sensitive blobs ويثبتالـgap فيDelivery Log حتىإغلاقه.

## 58. Local Database Integrity

- Schema versioned وموقعة/validated migrations.
- Pending operations immutable aftercompletion.
- Operation signatures/hash chains.
- File permissions مقيدة.
- Backup/copy محلية لا تعتبرموثوقةعنداستعادتها دونintegrity validation.

## 59. Electron Hardening

Production baseline:

- `contextIsolation: true`.
- `nodeIntegration: false` للـrenderer.
- Sandbox حيثمتوافق.
- Preload API allow-list صغيرة.
- IPC channels typed/validated.
- No remote arbitrary content.
- Navigation/new-window blocked أوallow-listed.
- CSP للـrenderer.
- DevTools مقيدةفيProduction.
- No unsafe `eval`.
- File access limited.

## 60. Printing and Peripherals

- Print payload منtrusted render snapshot.
- Printer/device names ليستأوامرشِل.
- No command injection.
- Peripheral configuration requirespermission.
- Failures لا تكشفlocal paths أوsecrets.

## 61. POS Configuration

- API endpoint منvalidated enrollment/environment configuration.
- لاHard-coded Bold Railway URL.
- TLS verification لا تعطل.
- Certificate errors تفشلClosed.
- Debug endpoints غيرمفعلةفيProduction.

## 62. Auto-update Security

- Signed installer/package.
- Manifest integrity/signature.
- HTTPS only.
- Artifact checksum.
- Version monotonicity/downgrade policy.
- Release publisher identity protected.
- Update cannotoverwritepending local operations.

# القسم الحادي عشر — Offline Cryptography and Trust

## 63. Offline Lease

Server-signed وتشمل:

- Tenant/location/terminal/device/membership/shift.
- Permissions/entitlement/policy versions.
- Allowed operations andlimits.
- Snapshot bindings.
- Not-before/expiry.
- Key ID/signature.

## 64. Operation Signing

Device توقعCanonical representation تشمل:

- client operation ID.
- payload hash.
- lease ID.
- tenant/device/terminal/membership.
- local sequence.
- occurred time/clock evidence.
- previous operation hash عنداستخدامchain.

## 65. Replay Protection

- Unique client operation ID.
- Monotonic device sequence.
- Lease-bound counters.
- Server inbox/dedupe.
- Replayed payload يعيدنفسالنتيجة.
- Same ID +different payload ينتجConflict/Security signal.

## 66. Clock Trust

- Client clock evidence، لاSource of truth.
- Last server time +monotonic elapsed time.
- Excessive drift triggersreview/restriction.
- Expired lease لا تمددبتغييرساعةالجهاز.

## 67. Key Rotation and Revocation

- New device key version registered online.
- Old key overlap محدود.
- Operations تحملkey version.
- Revoked key لا تقبلعملياتجديدة.
- Offline revocation ليستفورية؛ لذلكLease قصيرة ومحدودة.

## 68. Compromised Device

- Revoke credential andleases.
- Disable refresh family.
- Flag pending operations forreview.
- Preserveevidence.
- Re-enrollment requiresnew keypair.
- No silent trust restoration.

# القسم الثاني عشر — Secrets and Key Management

## 69. Secret Classes

- Database credentials.
- Token/lease signing keys.
- Provider API keys.
- Webhook secrets.
- Encryption KEKs/DEKs.
- GitHub/Vercel/Railway/Supabase deployment credentials.
- POS signing certificate/private key.
- Email/SMS provider credentials.

## 70. Storage

- Environment/platform secret store baseline.
- لاSecrets فيRepository أوNotion أوIssue/PR text.
- لاSecrets فيclient bundles.
- No `.env` committed.
- Example files placeholders فقط.

## 71. Environment Isolation

- Local, CI, Demo andProduction secrets مستقلة.
- CI pull requests لا تحصلProduction secrets.
- Demo credentials لا تعادفيProduction.
- Service accounts بأقلصلاحية.

## 72. Rotation Contract

كلSecret/Key تعرف:

- owner.
- purpose.
- version/ID.
- created/activated/retired times.
- rotation interval/trigger.
- dependent services.
- dual-operation window.
- emergency revoke plan.

## 73. Key Hierarchy

- Root/KEK خارجapplication DB.
- Per-purpose DEKs عندfield encryption.
- Encrypted key material داخلDB فقطإنكانenvelope-encrypted.
- Signing andencryption keys منفصلة.
- Test/demo keys لاتستخدمللإنتاج.

## 74. Secret Exposure Response

- Revoke/rotate immediately.
- Identifyaccess logs andaffectedscope.
- Redeploy dependents.
- Invalidate tokens/signed artifacts حسبالمفتاح.
- Preserveevidence andincident record.
- Scan repository/history/artifacts.

# القسم الثالث عشر — Encryption and Data Protection

## 75. In Transit

- HTTPS/TLS لكلExternal traffic.
- Database connections encrypted.
- Provider/webhook calls encrypted.
- No fallback toplaintext.
- HSTS بعدDeployment validation.

## 76. At Rest

- Managed provider disk encryption baseline.
- Encrypted backups.
- Private object storage.
- Application field encryption للـRestricted data عندالحاجة.
- Local POS sensitive data encryption/OS protection.

## 77. Field-level Encryption Candidates

- MFA secrets.
- Provider tokens/secrets.
- Supplier bank details.
- High-sensitivityidentity/contact attributes عندالسياسة.
- Recovery material.
- Support/private evidence.

## 78. Searchable Sensitive Data

إذااحتجناLookup:

- Normalized value encrypted.
- Separate keyed blind index/HMAC للمقارنة.
- Key/version rotation supported.
- لاDeterministic encryption عامة لكلالبيانات.

## 79. Data Minimization

- POS cache لا يحملPII غيرضرورية.
- Logs usemasked values.
- Notifications minimal.
- Exports allow-listed.
- Provider payloads retained onlyasneeded.

# القسم الرابع عشر — Database Security

## 80. Database Roles

فصل:

- Runtime application role.
- Migration role.
- Read-only diagnostics/report role عندالحاجة.
- Backup/restore role.
- Emergency admin role.

Runtime لا تملك:

- Schema changes.
- `BYPASSRLS`.
- Unrestricted superuser.
- Direct audit deletion.

## 81. Connection Security

- Credentials rotated.
- Pool limits andtimeouts.
- TLS verification.
- No connection strings inlogs.
- Supabase direct/pooler URLs منفصلةحسبالغرض.
- Transactions resetsession-local tenant settings.

## 82. Migrations

- Committed forward-only SQL.
- Review destructive operations.
- Clean andpopulated upgrade tests.
- No production manual schema drift.
- Migration runner isolated fromruntime.
- Backup/recovery gate beforehigh-risk production migration.

## 83. Audit Protection

- Append-only application contract.
- Revoke ordinary update/delete.
- Integrity sequence/hash حسبAudit Catalog.
- Restricted query/export.
- Audit writer failure blockscritical mutation أوusesdurable guaranteed path.

# القسم الخامس عشر — Files, Uploads and Exports

## 84. Upload Security

- Server-authorized upload grant.
- Tenant/purpose/type/size/checksum bound.
- Filename treated untrusted.
- Content type verified، لاextension فقط.
- Malware scan عندتوفرالمعالجة.
- Image/document parsers sandboxed أوisolated.

## 85. Object Storage

- Private buckets.
- Tenant namespace.
- Signed URLs قصيرةالعمر.
- No directory listing.
- No public permanent invoice/export links.
- File metadata same-tenant validation.

## 86. Export Security

- Separate permission andA2 حسبالحساسية.
- Async job scoped.
- Encryption atrest.
- Expiry/download count.
- Audit create/download.
- CSV formula injection escaping.
- PII fields allow-listed.

## 87. PDF/Document Security

- Templates لا تنفذcode.
- Remote resources blocked/allow-listed.
- Render service bounded CPU/memory/time.
- Generated files checksummed.
- Re-render لا يغيرBusiness document.

# القسم السادس عشر — Webhooks and Integrations

## 88. Incoming Webhooks

- Verify signature overraw body.
- Timestamp/replay window.
- Provider event ID dedupe.
- Endpoint-specific secret/version.
- Size/content-type limits.
- Fastack thenasync processing.
- Out-of-order state prevention.
- Raw payload retention limited/redacted.

## 89. Outgoing Webhooks

- HTTPS endpoints only.
- Endpoint ownership verification.
- HMAC/asymmetric signature.
- Timestamp +event ID.
- At-least-once withdedupe expectation.
- SSRF protections.
- Retry/backoff/dead letter.
- Secret rotation overlap.

## 90. Provider Outcomes

- Normalize states.
- Timeout afterpossible acceptance =unknown.
- Query/reconcile beforeretry.
- Provider payload neveroverridesDomain invariant directly.

## 91. API Keys for Integrations

إذاأضيفت:

- Random high-entropy.
- Prefix/ID +secret.
- Hash secret atrest.
- Scopes/tenant/purpose/expiry.
- Display once.
- Rotation/revocation.
- No user-password reuse.

# القسم السابع عشر — Logging, Monitoring and Detection

## 92. Security Logging

يسجل:

- Login/MFA/reset/recovery outcomes.
- Session creation/revocation/reuse.
- Permission denials عاليةالخطر.
- Role/scope/owner changes.
- Device enrollment/revoke/key changes.
- Support/break-glass.
- Secret/provider configuration changes.
- Export/sensitive access.
- Cross-tenant mismatch attempts.
- Webhook signature/replay failures.
- Integrity/clock/offline anomalies.

## 93. Log Safety

ممنوع:

- Passwords.
- Access/refresh/reset tokens.
- MFA secrets/recovery codes.
- Private keys.
- Full card/bank/provider credentials.
- Full confidential payloads.

Use masking, hashing andstructured fields.

## 94. Detection Signals

- Credential stuffing pattern.
- Refresh token reuse.
- Impossible session behavior.
- Repeatedtenant/resource mismatch.
- Privilege elevation bursts.
- Unusual exports.
- Multipleoffline signatures/sequences invalid.
- Device key reuse/cloning.
- Provider webhook failures.
- Audit writer failures.
- Secrets scanning alerts.

## 95. Alerting

- Severity andowner.
- Deduplication/correlation.
- Tenant scope.
- Runbook link.
- Evidence references.
- No sensitive payload innotification.

Exact monitoring platform فيMonitoring & Observability document.

# القسم الثامن عشر — Support and Break-glass Security

## 96. Support Access

- No standingTenant membership.
- Grant: tenant, purpose, ticket, scopes, expiry, approver.
- Step-up required.
- UI واضحةأنهاSupport mode.
- Real actor andeffective actor recorded.
- Default read-only/masked.

## 97. Impersonation

- لا سريةعنoperator.
- لا استخدامcustomer password/session.
- Actions تحملsupport grant ID.
- High-risk actions قدتظل ممنوعةحتىمعimpersonation.
- Tenant notification حسبpolicy.

## 98. Break-glass

- للحوادثالحرجةفقط.
- A3 أوأقوىماهو متاح.
- Short TTL.
- Minimum scope.
- Reason andincident ID.
- Immediate security alert.
- Mandatory post-use review.
- Automatic revocation.

## 99. Support Workstations

Production access يتطلب:

- MFA.
- Managed/approved device policy عندالنضج.
- No shared browsers/accounts.
- Session lifetime قصيرة.
- Download restrictions.
- Audit.

# القسم التاسع عشر — Secure Development Lifecycle

## 100. Security Requirements

كلWork Package تحدد:

- Data classification.
- Threats andabuse cases.
- Authentication/authorization needs.
- Audit requirements.
- Secrets/provider interactions.
- Failure/outcome unknown handling.
- Security tests.

## 101. Code Review

مراجعةإلزاميةلـ:

- Auth/session/token code.
- Permissions/scopes/tenant context.
- Raw SQL/migrations.
- Cryptography.
- File/webhook/provider code.
- Electron preload/IPC/update.
- CI/CD andsecrets.
- Serialization/deserialization.

## 102. Dependency Security

- Committed lockfiles.
- Deterministic install (`npm ci`).
- Dependency vulnerability scanning.
- License review where needed.
- Remove unused dependencies.
- Review install scripts/native binaries.
- Pin GitHub Actions totrusted immutable versions/SHAs عندتنفيذpolicy.
- Automated update PRs withtests، لاAuto-merge blind.

## 103. Static and Dynamic Checks

Baseline CI security gates:

- Typecheck/lint.
- Unit/integration/security contract tests.
- Secret scanning.
- Dependency audit.
- SAST قواعدللـinjection/unsafe APIs.
- Migration safety.
- Build artifact inspection.
- Admin E2E auth/authorization smoke.
- POS Electron hardening tests.

## 104. SBOM and Provenance

قبلProduction paid launch:

- Generate software bill ofmaterials للـbackend/admin/POS.
- Record source commit andbuild workflow.
- Checksums لكلartifacts.
- Signed POS releases.
- Provenance metadata محفوظةمعrelease.

## 105. Branch and Release Controls

- Protected main/master.
- No direct unreviewed production merge.
- Required CI gates.
- Environment approvals للـproduction.
- Separate deploy credentials.
- PRs منforks بلاProduction secrets.
- Release tags immutable.

التفصيل فيCI/CD andRelease Strategy لاحقًا.

# القسم العشرون — CI/CD and Infrastructure Security

## 106. CI Secrets

- Least privilege.
- Environment scoped.
- Masked inlogs.
- No echo/debug dumps.
- Prefer short-lived federated credentials whenprovider supports.
- Rotate onstaff/repo incident.

## 107. Build Isolation

- Clean runners.
- No untrusted artifact reused ascode.
- Verify downloaded tools/checksums where feasible.
- Cache keys include lockfile/OS/runtime.
- Production build notfromdeveloper workstation.

## 108. Deployment

- Immutable artifact promotion.
- Configuration validated beforestart.
- Health/readiness checks.
- Rollback usesknown artifact، notunreviewed hotfix.
- Database migration separatecontrolled step.
- No secrets infrontend environment variables exposedtobrowser.

## 109. Demo vs Production

Demo الحالية:

- لاتحتويReal customer secrets/PII دونضوابطproduction.
- لهاCredentials مستقلة.
- يمكنتستخدمFree plans.
- لا تعتبرSecurity bypass مقبولًا.

أولPaid customer يفعّلProduction readiness gate وترقيةالخدماتالمطلوبة.

# القسم الحادي والعشرون — Vulnerability Management

## 110. Vulnerability Intake

مصادر:

- Dependency scanners.
- Code review/tests.
- Provider advisories.
- Internal reports.
- Customer/support reports.
- External security report channel مستقبلًا.

## 111. Triage

كلثغرة تسجل:

- affected components/versions.
- exploitability andimpact.
- tenant/data scope.
- workaround/containment.
- owner/deadline.
- fix/release evidence.
- disclosure/notification decision.

## 112. Severity Response

- Critical: containment andemergency release process.
- High: accelerated fix andtargeted monitoring.
- Medium/Low: scheduled remediation وفقrisk.

Exact SLA values تحددفيOperational policy، لا تدفنفيالكود.

## 113. Security Patches

- Regression tests إلزامية.
- No silent deletion ofevidence.
- Migration/compatibility reviewed.
- POS update adoption monitored.
- Unsupported vulnerable clients يمكنحظرهاعبرprotocol policy.

# القسم الثاني والعشرون — Incident Response

## 114. Incident Lifecycle

```
Detect
→ Triage
→ Contain
→ Preserve Evidence
→ Eradicate
→ Recover
→ Notify as required
→ Post-incident Review
```

## 115. Severity Factors

- Cross-tenant exposure.
- Authentication/key compromise.
- Financial/inventory corruption.
- PII scope.
- Active exploitation.
- Duration andaffectedTenants.
- Recovery confidence.

## 116. Containment Actions

- Revoke sessions/tokens/keys.
- Disable route/feature/provider.
- RestrictTenant أوPlatform access.
- Blockclient/protocol versions.
- Rotate secrets.
- Isolatequeue/job.
- Stopdeployments.
- PreserveDB/log/audit snapshots.

## 117. Evidence Preservation

- Server times andcorrelation IDs.
- Audit/security logs.
- Release/commit/config versions.
- Provider references.
- Database/object metadata.
- Hashes/checksums.
- Access limited andchain ofcustody recorded.

## 118. Recovery

- Restore verifiedclean state.
- Reconcileledgers/operations.
- Reissuecredentials/keys.
- ValidateTenant isolation.
- Monitor heightened signals.
- No reopening untilacceptance checklist.

## 119. Notifications

Security/Legal decide:

- Who mustbe notified.
- What facts areconfirmed.
- Scope andactions.
- Channels andtiming.
- Updates andclosure.

لا تخمينأوإخفاءعدم اليقين.

## 120. Post-incident

- Root cause.
- Detection gaps.
- Control failures.
- Corrective actions andowners.
- Tests/runbooks/docs updates.
- No blame-driven suppression ofevidence.

# القسم الثالث والعشرون — Backup and Recovery Security

## 121. Backups

- Encrypted.
- Access least-privilege.
- Separateenvironment/retention.
- Restore tested.
- Integrity checks.
- No public URLs.
- Backup credentials rotated.

## 122. Restore Security

- Restore toisolated environment.
- Access approved/audited.
- Secrets/tokens inrestored DB handled safely.
- External side effects disabled untilreconciliation.
- Restored sessions mayberevoked beforeservice.

التفصيل فيBackup andRecovery document.

# القسم الرابع والعشرون — Security Error Contract

## 123. Authentication Errors

- `AUTHENTICATION_REQUIRED`
- `AUTHENTICATION_FAILED`
- `IDENTITY_NOT_ACTIVE`
- `PASSWORD_RESET_REQUIRED`
- `SESSION_EXPIRED`
- `SESSION_REVOKED`
- `SESSION_REUSE_DETECTED`
- `TOKEN_INVALID`
- `TOKEN_AUDIENCE_INVALID`
- `TOKEN_KEY_UNKNOWN`

## 124. MFA and Step-up Errors

- `MFA_REQUIRED`
- `MFA_ENROLLMENT_REQUIRED`
- `MFA_CHALLENGE_INVALID`
- `MFA_CHALLENGE_EXPIRED`
- `STEP_UP_REQUIRED`
- `STEP_UP_EXPIRED`
- `STEP_UP_ACTION_MISMATCH`
- `RECOVERY_CODE_INVALID`

## 125. Authorization and Tenant Errors

- `AUTHORIZATION_DENIED`
- `PERMISSION_REQUIRED`
- `AUTHENTICATION_STRENGTH_INSUFFICIENT`
- `APPROVAL_REQUIRED`
- `TENANT_CONTEXT_REQUIRED`
- `TENANT_CONTEXT_MISMATCH`
- `CROSS_TENANT_REFERENCE_FORBIDDEN`
- `RESOURCE_SCOPE_FORBIDDEN`

## 126. Device and Integrity Errors

- `DEVICE_NOT_TRUSTED`
- `DEVICE_REVOKED`
- `DEVICE_KEY_INVALID`
- `DEVICE_KEY_ROTATION_REQUIRED`
- `OFFLINE_LEASE_INVALID`
- `OFFLINE_LEASE_EXPIRED`
- `OFFLINE_SIGNATURE_INVALID`
- `OFFLINE_SEQUENCE_REPLAYED`
- `LOCAL_INTEGRITY_CHECK_FAILED`

## 127. Provider and Secret Errors

- `WEBHOOK_SIGNATURE_INVALID`
- `WEBHOOK_REPLAY_DETECTED`
- `PROVIDER_OUTCOME_UNKNOWN`
- `SECRET_CONFIGURATION_INVALID`
- `SIGNING_KEY_UNAVAILABLE`
- `ENCRYPTION_KEY_UNAVAILABLE`

## 128. Abuse and File Errors

- `RATE_LIMITED`
- `SECURITY_POLICY_BLOCKED`
- `UPLOAD_TYPE_FORBIDDEN`
- `UPLOAD_SIZE_EXCEEDED`
- `UPLOAD_INTEGRITY_FAILED`
- `SECURE_LINK_INVALID`
- `SECURE_LINK_EXPIRED`

# القسم الخامس والعشرون — Failure and Recovery Rules

## 129. Authentication Store Unavailable

- Fail closed forlogin/step-up.
- Existinglow-risk sessions policy تحددGrace محدودإنأمكنالتحقق محليًا، دونHigh-risk mutations.
- Alert andincident tracking.

## 130. Signing Key Unavailable

- لا تصدرTokens/Leases/Artifacts جديدة.
- Existing signatures تتحققعبرpublic keys cached safely.
- No fallback unsigned mode.

## 131. Audit Writer Failure

- Critical mutation لا تنجحبدونdurable minimum audit evidence.
- Low-risk telemetry maybuffer حسبpolicy.
- Alert immediate.

## 132. Rate-limit Store Failure

- Auth/recovery/high-risk endpoints failclosed أوتنتقلإلىconservative local limits.
- Ordinary reads قدتستمرمعsafety caps.
- لاunlimited fail-open.

## 133. Secret Rotation Partial Failure

- Dual-version window.
- Rollback topreviousactive key ifnotcompromised.
- Do not retireold key untildependents confirmed.
- Compromised key usesemergency revoke evenwithservice impact.

## 134. POS Secure Storage Failure

- لا تخزنcredentials plaintext كfallback.
- Device entersrestricted/re-enrollment recovery.
- Pending signed operations preserved إنأمكن.

# القسم السادس والعشرون — Security Testing Contract

## 135. Authentication Tests

- Valid/invalid login withoutenumeration.
- Rate limiting/progressive delay.
- Legacy hash migration.
- Password reset expiry/single use.
- Session fixation prevention.
- Refresh rotation/reuse detection.
- Logout/revocation.

## 136. MFA Tests

- Enrollment/confirmation.
- TOTP replay/window policy.
- Recovery code single-use.
- Step-up freshness/action binding.
- Factor removal revokesessions.
- Required roles/actions enforcement.

## 137. Authorization Tests

- Default deny.
- Permission/scope/entitlement/state intersection.
- Cross-tenant object IDs.
- Self-elevation prevention.
- Separation ofduties.
- Approval payload/version mismatch.
- UI bypass attempts.

## 138. Browser Tests

- Cookie flags.
- CSRF valid/invalid/missing.
- CORS allow/deny.
- CSP violations.
- Open redirects.
- XSS payloads.
- Sensitive cache headers.

## 139. API Tests

- Unknown fields/mass assignment.
- SQL/command/template injection.
- Oversized/deep payloads.
- SSRF endpoint validation.
- Error redaction.
- Idempotency conflict.
- Rate-limit isolation pertenant/device.

## 140. POS/Electron Tests

- Context isolation/node integration.
- IPC allow-list andvalidation.
- Navigation/window blocking.
- Secure storage failure.
- Local DB tampering.
- Signed update verification.
- Modified manifest/artifact rejection.
- No hard-coded production secrets/URLs.

## 141. Offline Tests

- Lease signature/expiry/revocation.
- Wrongtenant/device/membership.
- Operation signature.
- Sequence replay/gap.
- Clock rollback.
- Key rotation.
- Duplicate operation same/different payload.
- Compromised device review path.

## 142. Secrets and Crypto Tests

- Secret scanning.
- No secrets inbundles/logs/errors.
- Key rotation overlap.
- Unknown key failure.
- Encrypted field roundtrip/rotation.
- Backup encryption/restore.

## 143. Webhook Tests

- Valid/invalid signature.
- Raw body preservation.
- Replay timestamp/event ID.
- Duplicate/out-of-order events.
- SSRF onoutgoing endpoint.
- Secret rotation.

## 144. Tenant Isolation Tests

- Concurrentrequests acrossTenants.
- Cache leakage.
- Job/event mismatch.
- File path/signed URL mismatch.
- RLS connection pooling proof.
- Support grant boundary.

## 145. Supply-chain Tests

- Lockfile integrity.
- Vulnerability scan gate.
- Build fromclean runner.
- Artifact checksum/signature.
- Release provenance/commit match.
- No production secrets inPR context.

## 146. Incident Exercises

- Stolen session.
- Leakedprovider key.
- CompromisedPOS.
- Cross-tenant bug.
- Malicioussupport access.
- Vulnerablerelease rollback.
- Database credential compromise.

# القسم السابع والعشرون — Bold to ATHR Security Migration

## 147. Current Risks to Address

- Current fixedRole/branch model لا يكفيAuthorization الجديدة.
- Existingsessions قدلاتحملTenant/Membership versions.
- POS local DB andmain process يحتاجانmodular hardening.
- Hard-coded API URL يجبإزالته.
- Audit storage الحاليةأقلمنالمطلوب.
- Existingcredential/hash formats تحتاجinventory.

## 148. Migration Sequence

### SEC-MIG-000 — Green Baseline

- WP-000 release gates green.
- لاSecurity refactor فوقCI مكسورة.

### SEC-MIG-001 — Identity and Configuration

- ATHR names/environment validation.
- Removehard-coded endpoints/secrets.
- Addsecurity config schema andstartup validation.

### SEC-MIG-002 — Session Foundation

- Introducesession/refresh families andrevocation records.
- Browser cookie model.
- POS secure token storage.
- Legacy sessions invalidated atcontrolled cutover.

### SEC-MIG-003 — Identity/Membership Split

- Mapusers toPlatform Identity +initial Tenant Membership.
- Preserveactor history.
- Addpolicy/authentication versions.

### SEC-MIG-004 — Password Migration

- Inventoryalgorithm.
- Rehash-on-login orforced reset.
- Removelegacy verifier afterwindow.

### SEC-MIG-005 — Authorization Runtime

- ReplaceRole-name guards withpermission/scope policy.
- Server-side checks for everycommand.
- AddA-level/approval enforcement.

### SEC-MIG-006 — Device Trust

- Generate/registerdevice keypairs.
- Rotateexistingdevice credentials.
- Bindterminal/tenant/location.
- HardenElectron andIPC.

### SEC-MIG-007 — Audit and Detection

- Addstructuredsecurity/audit records.
- Alerts forcross-tenant/session/device anomalies.

### SEC-MIG-008 — Security Enforcement

- Removelegacybypasses.
- Enforceclient/protocol minimum versions.
- CompleteRLS proof beforeoptional activation.

## 149. Cutover Rules

- No password export/plaintext recovery.
- No simultaneous acceptance oflegacy andnewtokens beyonddefined window.
- NoPOS credential fallback toplain files.
- Everylegacy bypass hasowner/expiry/removal test.
- Migration failures preserveevidence andfailclosed forhigh-risk access.

# القسم الثامن والعشرون — Open Decisions

## 150. OD-SEC-001 — Exact Token Signing Algorithm

**Baseline:** Asymmetric signing with`kid` androtation. Exact algorithm selectedbyEngineering ADR afterNode/Electron/library compatibility testing.

## 151. OD-SEC-002 — Browser Session Store

**Baseline:** Server-revocable opaque session. Exact backing store startsPostgreSQL/in-process-compatible design andmoves todistributed cache whenDeployment scale requires.

## 152. OD-SEC-003 — Session Lifetimes

**Baseline:** Short access tokens, boundedrefresh/absolute/idle lifetimes, stricterforSupport. Exactvalues versioned afterUX/risk testing.

## 153. OD-SEC-004 — Password Migration

**Baseline:** InspectactualBold hashes. Rehash-on-login ifacceptable؛ otherwiseforced reset.

## 154. OD-SEC-005 — MFA Rollout

**Baseline:** TOTP MVP +recovery codes، passkeys/WebAuthn preferred evolution. Mandatoryforowners/platform/high-risk roles.

## 155. OD-SEC-006 — POS Local DB Encryption

**Baseline:** Per-installation encryption key protectedbyOS secure storage. Exactsql.js persistence adapter implementation inPOS architecture WP.

## 156. OD-SEC-007 — RLS

**Baseline:** Not enabled untilPrisma/Supabase pooler proof passes. Application/composite constraints remainmandatory.

## 157. OD-SEC-008 — Distributed Rate-limit Store

**Baseline:** Security-critical design mustbeprovider-independent. Exactstore choseninDeployment Architecture، withfreeDemo fallback clearlybounded.

## 158. OD-SEC-009 — Field Encryption Scope

**Baseline:** MFA/provider/bank/recovery data first. PII expansion basedonData Classification andlegal needs.

## 159. OD-SEC-010 — External Penetration Test

**Baseline:** Required beforebroader production/customer scale، timing andscope tiedtofirstpaid/criticallaunch readiness.

## 160. OD-SEC-011 — Managed Device Requirement for Support

**Baseline:** MFA immediately؛ managed-device enforcement addedbeforelarge-scaleProduction support.

## 161. OD-SEC-012 — Security Disclosure Program

**Baseline:** Private security contact/reporting process first؛ formalbug bounty deferred.

# القسم التاسع والعشرون — Prohibited Patterns

## 162. أنماطممنوعة

- Access/refresh/reset tokens في`localStorage` أوURL.
- Password encryption قابلةللاسترجاع.
- Fast password hashes.
- Shared user/support/service/device accounts.
- Static permanent refresh token بلاrotation.
- Acceptingreused refresh token.
- JWT بلاaudience/issuer/expiry/key rotation.
- Tenant ID منClient كمصدرحقيقةمنفرد.
- Authorization فيUI فقط.
- Role-name business guards كبديلPermission policy.
- Self-approval للعملياتالمفصولة.
- Secrets فيGit/Notion/PR/log/client bundle.
- One key لكلالأغراضوالبيئات.
- Disable TLS verification.
- Wildcard CORS معcredentials.
- State-changing GET.
- CSP تعتمد`unsafe-eval` فيProduction.
- Raw HTML/SQL/shell fromuser data.
- Blind provider retry aftertimeout.
- Webhook بلاsignature/replay protection.
- Public permanent Tenant files.
- Plain POS credentials/local sensitive blobs.
- Electron renderer معunrestrictedNode.
- Unsigned POS updates.
- Audit delete/update العادي.
- Runtime DB superuser/BYPASSRLS.
- Production secrets فيPR workflows.
- Vulnerability scan failures ignored بلاrisk acceptance.
- Break-glass بلاexpiry/reason/review.
- Security incident evidence deletion.
- Demo mode كذريعةلإزالةالضوابطالأساسية.

# القسم الثلاثون — Implementation Readiness

## 163. Ready after WP-000/WP-001

- Security configuration validation.
- Removal ofhard-coded endpoints/secrets.
- Cookie/session andtoken interfaces.
- Secret registry andenvironment separation.
- Electron baseline hardening.

## 164. Ready in Shared Foundation

- Opaque IDs andTenantContext.
- Authentication strength types.
- Session/refresh family models.
- Permission decision contract.
- Audit/security event schemas.
- Crypto/provider adapters.
- Security test helpers.

## 165. Ready with Tenant/Identity Work

- Identity/Membership split.
- Password migration.
- MFA/step-up.
- Scoped authorization.
- Support grants.
- Device enrollment/key rotation.

## 166. Deferred to Deployment/Operations Documents

- Exactedge/WAF/provider.
- Network topology.
- Secret store product.
- Distributed session/rate-limit/cache product.
- Alerting/on-call platform.
- Backup storage/restore topology.
- Production environment promotion details.

# القسم الحادي والثلاثون — Acceptance Gate

## 167. بوابةالاعتماد

لا يعتبرSecurity Blueprint مكتملًا قبل:

1. تثبيتالأصول والـthreat model وحدودالثقة.
2. تثبيتIdentity/Password migration.
3. تثبيتAdmin/POS/Service session models.
4. تثبيتtoken signing/rotation/revocation.
5. تثبيتMFA/Step-up/Recovery.
6. تثبيتruntime authorization والـSoD.
7. تثبيتTenant isolation security وRLS gate.
8. تثبيتbrowser security.
9. تثبيتAPI validation/abuse/SSRF/idempotency.
10. تثبيتPOS/Electron/device/offline security.
11. تثبيتsecrets/keys/encryption.
12. تثبيتdatabase/files/exports/webhooks security.
13. تثبيتlogging/detection/support/break-glass.
14. تثبيتsecure SDLC/supply chain/CI gates.
15. تثبيتvulnerability andincident response.
16. تثبيتbackup/restore security boundaries.
17. تثبيتBold→ATHR security migration.
18. تثبيتtests/open decisions/prohibited patterns.

## 168. القرار التخطيطي الحالي

- Admin Web تستخدمHttpOnly Secure server-revocable sessions، وليسlocalStorage tokens.
- POS تستخدمshort-lived access +rotating refresh family فيOS secure storage.
- New passwords تستخدمArgon2id.
- Bold hashes تفحصثمRehash-on-login أوForced reset.
- MFA إلزاميةللـOwners وPlatform وHigh-risk roles؛ TOTP MVP وPasskeys اتجاهأفضل.
- High-risk actions تحتاجStep-up وApproval حسبPermission Matrix.
- Device keypair +signed offline leases/operations.
- Secrets منفصلةلكلEnvironment وممنوعةمنRepository/Client.
- RLS مؤجلةحتىProof، معبقاءapplication/composite protections.
- Electron renderer معزولوالـIPC allow-listed والتحديثاتموقعة.
- Security-critical audit failure يمنعالمعاملة.
- Demo تستخدمالضوابطالأساسيةنفسها، دونPaid infrastructure قبلأولعميل.

## 169. المرحلة التالية

**ATHR Deployment Architecture v1.0**

ستثبت:

- Environment topology: Local, CI, Demo, Staging andProduction.
- Railway/Vercel/Supabase responsibilities.
- Domains, TLS, networking andCORS origins.
- Backend/Admin/POS deployment flows.
- Database migration execution.
- Workers, queues, cron andscheduled jobs.
- Object storage andemail provider placement.
- Secret/config distribution.
- Scaling andhigh availability thresholds.
- Health/readiness andzero-downtime principles.
- First paid customer infrastructure upgrade gate.
- Rollback anddisaster boundaries.
- Cost-aware transition fromfreeDemo toproduction.

بعده: **ATHR Backup and Recovery v1.0**.