# ATHR Git and Branching Strategy v1.0

**Status:** Approved engineering-design baseline

**Applies to:** Repository `OsamaIbrhim/bold_system`, Work Packages, pull requests, releases, hotfixes, migrations, documentation and automation.

## 1. Purpose

تحدد هذه الوثيقة كيف يتحرك الكود من فكرة أوWork Package إلىتغيير قابلللمراجعة والدمج والنشر، بدونخلط مراحل أوفقدان traceability.

## 2. Core Principles

1. `master` هيالـintegration/release branch المحمية.
2. لاpush مباشر إلى`master`.
3. كلتغيير عبرPR مربوط بـWP أوincident أوADR.
4. branch قصيرةالعمر قدرالإمكان.
5. commit history واضحةوقابلةللتتبع.
6. migration وrelease artifact مرتبطان بنفسSHA المختبر.
7. لاforce-push بعدبدءالمراجعة إلاعندضرورة موثقة.
8. لاخلطfeature وrefactor وdependency upgrade غيرمرتبطين.

## 3. Branch Model

- `master`: canonical releasable branch.
- `feat/wp-<id>-<slug>`: Work Package implementation.
- `fix/<incident-or-defect>-<slug>`: defect repair.
- `hotfix/<incident>-<slug>`: urgent production repair.
- `chore/<slug>`: tooling, dependencies, docs withoutdomain change.
- `release/<version>`: optional stabilization branch onlywhenrelease train requires it.

Long-lived transformation branches ممنوعة بعدنهايةالمرحلة الانتقالية، إلابقرارADR واضح.

## 4. Current Transformation Exception

`feat/athr-transformation` كانbranch انتقالية لتجميعWP-000 وWP-001. ابتداءًمنWP-002:

- كلWP جديدة تعمل علىchild branch مستقلة.
- لايضافscope جديد إلىPR قديمة.
- بعددمجالتحولات الأساسية، يعودالنظام لbranches قصيرة.

## 5. Branch Creation

قبلإنشاءbranch:

- fetch أحدثremote refs.
- تأكدمنclean working tree.
- حددbase SHA.
- أنشئbranch منbase المعتمد فيExecution Plan.
- سجلbranch/base فيDelivery Log عندبدءالتنفيذ.

## 6. One Work Package per Branch

كلbranch تمتلك:

- WP واحدة أوhotfix واحد.
- acceptance gate محددة.
- migration set مترابطة.
- test impact معلوم.

يمنعإضافةWP-003 مثلًا داخلbranch WP-002 قبلإغلاقها.

## 7. Commit Standard

الصيغة المفضلة:

```
<type>(<scope>): <imperative summary>
```

Types:

- `feat`
- `fix`
- `refactor`
- `test`
- `docs`
- `chore`
- `perf`
- `build`
- `ci`
- `revert`

Examples:

- `feat(workspace): add athr shared packages`
- `fix(migrations): guard single production runner`
- `test(sync): cover duplicate offline replay`

## 8. Commit Content

- commit واحدة تمثلخطوة منطقية قابلةللمراجعة.
- لا`WIP` فيالـfinal history.
- لاgenerated artifacts إلاالمطلوبة.
- migration commit تشملschema/migration/tests المرتبطة.
- formatting-only changes منفصلة عندحجم كبير.

## 9. Commit Signing and Identity

- author identity ثابتة وصحيحة.
- signed commits/tags مطلوبة عندتفعيلالحماية.
- automation commits تستخدمbot identity معروفة.
- لاshared personal credentials.

## 10. Pull Request Requirements

PR يجب أنتحتوي:

- WP/issue/ADR reference.
- scope implemented.
- base/head SHA.
- files/areas changed.
- migration impact.
- test commands/results.
- deployment/config impact.
- risks/deviations.
- rollback/forward-fix notes.

## 11. Draft PR Policy

- Draft عندالعمل الجاري أوعدمجاهزية review.
- Draft لايدمج ولايعتبرrelease evidence.
- Ready for review بعداكتمالscope والـrequired local gates.

## 12. Review Policy

Minimum:

- architecture review للتغييرات الحدودية.
- database review للمigrations.
- security review للauth/tenant/secrets/payment/offline trust.
- product/business rule review عندتغييرالسلوك.

Self-approval غيركافٍ للتغييراتالحرجة عندمايوجد reviewer متاح.

## 13. Merge Strategy

Default: **Squash merge** للbranches الصغيرة المرتبطة بـWP واحدة، معرسالة نهائية واضحة.

Use merge commit onlywhen:

- preserving multiple audited commits لهقيمة.
- release branch integration.
- large migration sequence تحتاجhistory مستقلة.

Rebase merge ليسالافتراضي إذاكان سيخفيcontext المراجعة.

## 14. Branch Protection

`master` تتطلب:

- PR only.
- required status checks.
- branch up to date أوmerge queue.
- conversation resolution.
- no force push.
- no deletion.
- optional signed commits/tags.
- restricted bypass.

## 15. Required Checks

قبلالدمج، حسبimpact:

- workspace/static architecture.
- Backend/Admin/POS soft gates.
- migration gate.
- Admin E2E.
- hard-smoke.
- Windows installer.
- security/audit.
- release gate.

## 16. Merge Queue

عندتعددPRs:

- استخدمmerge queue أوآخرbase verification.
- لايفترض نجاحCI علىbase قديمة.
- migration conflicts تحلقبلالدخول للqueue.

## 17. Keeping Branches Current

- prefer merge/rebase fromlatest `master` قبلfinal review حسبteam policy.
- لاrewrite history بعدreviews بدونتنبيه.
- rerun required gates بعدbase update.

## 18. Migration Branch Rules

- migration names monotonic وفريدة.
- applied migration لا تعدل.
- conflict بينmigration timestamps يحل بforward migration جديدة عندالحاجة.
- branch لا تعتمدعلىmigration غيرمدموجة منbranch أخرى إلابتسلسل معلن.

## 19. Contract and Protocol Changes

API/Sync/POS protocol breaking change:

- ADR أوapproved contract update.
- compatibility window.
- client/server deployment order.
- version bump.
- contract tests.

## 20. Hotfix Flow

1. branch منproduction SHA/master release point.
2. minimal root-cause fix.
3. regression tests.
4. expedited butnot skipped review.
5. required critical gates.
6. production deployment.
7. merge/cherry-pick back toactive development line.
8. incident/RCA update.

## 21. Revert Policy

- revert عبرnew commit/PR.
- لاhistory rewriting.
- migrations لا ترتجع بحذفhistory؛ تستخدمforward corrective migration.
- define data compatibility beforecode revert.

## 22. Release Tags

- immutable annotated tags.
- Backend/Admin release tag حسبrelease policy.
- POS tag `athr-pos-vX.Y.Z`.
- tag يشيرإلىtested SHA فقط.
- لاretag لنفسversion.

## 23. Versioning

Track independently:

- product release.
- API contract version.
- Sync/POS protocol version.
- POS application version.
- local schema version.
- database migration state.

SemVer يستخدمللartifacts التيينطبقعليها، ولايستبدلprotocol compatibility.

## 24. Secrets and Sensitive Data

- لاsecrets فيcommit/PR/log/screenshot.
- leaked secret يتدوّر فورًا.
- history cleanup ليسبديلًا عنrotation.
- secret scanning required.

## 25. Large Refactors

- split intoenabling steps.
- behavior-preserving commits قبلbehavior change.
- no big-bang rewrite.
- temporary compatibility layers لهاowner/expiry.

## 26. Documentation Changes

- architectural change تحدّثADR/Hub/contracts فينفسPR أوPR مرتبطة قبلالتنفيذ.
- Delivery Log لايستبدلPR description.
- runbook change معoperational behavior change.

## 27. Branch Cleanup

بعدالدمج أوالإغلاق:

- delete remote branch بعدالتأكد منعدموجودعمل مطلوب.
- preserve tag/PR/history.
- abandoned branches تسجلسببالإغلاق.

## 28. Automation Rules

Bots may:

- opendependency PRs.
- updategenerated artifacts.
- publishrelease notes.

Bots must not:

- bypass required checks.
- merge critical changes withoutpolicy.
- mutateapplied migrations.

## 29. WP-002 Mapping

WP-002 يجب أن:

- يعملعلىbranch مستقلة.
- لايلوثPR #44.
- يسجلbase/head.
- يفتحPR واحدةمركزة.
- يحافظعلىكلrequired gates.

## 30. Acceptance Gate

الاستراتيجية مطبقة عندما:

- master protected.
- no direct pushes.
- each WP hastraceable branch/PR.
- required checks enforced.
- release tags immutable.
- hotfix/revert path documented.
- Delivery Log يحتفظبـbase/head/results.

## 31. Prohibited Patterns

- direct push to master.
- multiple unrelated WPs inonePR.
- force push بعدreview بدونتنبيه.
- editing applied migration.
- release fromuntested SHA.
- secrets inGit history.
- branch تستخدمكbackup دائم.

## 32. Approval Outcome

هذهالوثيقة هيالعقد المعتمد لإدارةGit والـbranches والـPRs والإصدارات فيATHR.