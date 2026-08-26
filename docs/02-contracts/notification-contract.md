# ATHR Notification Contract v1.0

**Planning Baseline — Notification Intents, Recipients, Channels, Templates, Consent, Delivery, Retries and Secure Communication**

## 1. وظيفة الوثيقة

تحدد هذه الوثيقة العقد المعتمد لكل إشعار أو رسالة يرسلها ATHR، وتشمل:

- Notification intents والـContext المالك.
- تصنيف Security وTransactional وOperational وMarketing.
- Recipient resolution.
- In-app وEmail وSMS وWhatsApp وPush.
- Templates وLocalization وVersioning.
- Preferences وConsent وQuiet hours.
- Notification requests وDelivery attempts.
- Provider abstraction وStatus normalization.
- Deduplication وRate limits وDigesting.
- Retry وOutcome unknown وReconciliation.
- Fallback channels وEscalation.
- Secure links والبيانات الحساسة.
- Document delivery.
- Customer-facing وStaff-facing notifications.
- Webhook delivery كقناةتكامل منفصلة.
- Audit وRetention وErrors وTesting.

هذه الوثيقة لا تجعل الإشعار مصدرًا للحقيقة. نجاح Sale أوPayment أوReturn أوSubscription لا يعتمد علىنجاحEmail أوSMS إلاإذافرضقانون أوWorkflow صريح التزامتسليم مستقلًا بحالةخاصة.

## 2. حدودالملكية

### الـDomain Context يملك

- سببالإشعار.
- الحدثالتجاري.
- متى يصبحالإشعار مطلوبًا.
- بياناتالعقد المسموح تمريرها.
- أولويةالغرض.
- الإجراءالمطلوب منالمستلم.

### Notification Context يملك

- Recipient resolution execution.
- Preference/consent evaluation.
- Template selection andrendering.
- Channel routing.
- Delivery attempts.
- Provider normalization.
- Retry, fallback andescalation.
- Delivery audit andretention.

### Notification Context لا يملك

- Sale أوPayment أوSubscription state.
- Membership أوCustomer master truth.
- Business document content source.
- Permission decisions.
- Provider secrets.

## 3. المبادئ غيرالقابلة للتفاوض

1. Notification intent ثابتةوVersioned.
2. لا ترسلرسالة بلاOwner Context وSource reference.
3. الإشعار ليسDomain event خامًا يرسل مباشرةللمستخدم.
4. كلرسالة لهاPurpose وAudience وClassification.
5. Template المنشورة لا تعدلصامتًا.
6. Recipient resolution تتموقتالإرسال منمصدرموثوق، معSnapshot مناسب.
7. Marketing تحتاجConsent صالحًا وقابلسحب.
8. Security/Critical قدتتجاوزQuiet hours والـmarketing preferences.
9. Transactional لا تستخدمكغطاءلرسائلتسويقية.
10. Unsubscribe منMarketing لا يمنعSecurity أوLegal notices المطلوبة.
11. Delivery success لا يثبتأنالمستلم قرأ أوفهمالرسالة.
12. Provider accepted لا يساويDelivered.
13. Timeout بعدإرسال محتمل لا يعنيFailure No Effect.
14. Retry يحافظعلىنفسNotification identity ولا يخلقBusiness action جديدة.
15. Duplicate domain events لا تنتجDuplicate notification.
16. Sensitive data تقللإلىالحدالضروري.
17. Secure links قصيرةالعمر وأحاديةالغرض.
18. لا Tokens أوSecrets فيLogs أوAnalytics.
19. Fallback لا يغيرالمحتوىالمعتمد أويوسعنطاقالبيانات.
20. Notification failure لا يعيدتنفيذالمعاملةالتجارية.
21. Document delivery لا يعيدإصدارDocument.
22. كلChannel لهاPolicy مستقلة للحدودوالـconsent.
23. Tenant branding لا يمكنهإخفاءهويةرسالةأمنيةمنATHR عندالحاجة.
24. كلTenant معزولفيTemplates, preferences, contacts anddeliveries.
25. لا تعتمدCritical notifications علىقناةواحدة فقطدونRecovery path.

# القسم الأول — Notification Classification

## 4. Security Critical

أمثلة:

- Password reset.
- MFA/security challenge.
- New login أوdevice enrollment.
- Credential/role/owner change عاليالمخاطر.
- Device revoked.
- Suspicious activity.
- Data export عاليالحساسية.

القواعد:

- تتجاوزQuiet hours.
- لا يمكنتعطيلها كفئة عامة.
- ترسلإلىVerified contact فقط.
- محتواهاMinimal ولا يكشفتفاصيل تساعدمهاجمًا.
- قدتستخدمMulti-channel عنددرجةخطر مرتفعة.

## 5. Legal / Mandatory

أمثلة:

- Terms/privacy change عندالحاجةالقانونية.
- Invoice أوCredit note delivery.
- Subscription suspension/cancellation notice.
- Data retention/export closure notice.

القواعد:

- Consent marketing غيرمطلوب إذاالغرض قانوني أوتعاقدي.
- يجبوجودLegal basis وRetention class.
- Delivery failure قدتفتحCompliance task مستقلة.

## 6. Transactional

مرتبطةبعمليةطلبهاالمستخدم أوحدثتله مباشرة:

- Receipt/invoice ready.
- Payment/refund outcome.
- Order/return status.
- Invitation.
- Subscription activation/renewal/payment failure.
- Export ready.

القواعد:

- لا تتضمنPromotional content غيرضروري.
- Preferences قدتسمحبقنواتبديلة، لكنلا تسقطالرسالةالإلزامية إذاهناكقناةصالحة.
- Quiet hours قدتطبقعلىغيرالعاجل.

## 7. Operational

موجهةلموظفيTenant لدعمالعمل:

- Low stock.
- Transfer discrepancy.
- Cash difference.
- Terminal offline/sync lag.
- Approval required.
- Reconciliation failure.

القواعد:

- تعتمدRole/Scope/Assignment، وليسكلالموظفين.
- يمكنDigesting وEscalation.
- لا ترسلPII أوFinancial details لمستلم خارجScope.

## 8. Reminder

- Pending approval.
- Upcoming renewal.
- Expiring lease/certificate/token.
- Unresolved reconciliation.

القواعد:

- لهCadence وMax reminders.
- يتوقفعندحلSource condition.
- لا يستمرإلىمالانهاية.

## 9. Marketing

- Product announcements.
- Offers.
- Educational campaigns.
- Feature promotion.

القواعد:

- Explicit consent أوLegal basis حسبالقناة/المنطقة.
- Easy unsubscribe.
- Suppression list.
- Quiet hours.
- Frequency caps.
- لا يخلطبـSecurity/Transactional templates.

# القسم الثاني — Notification Intent Contract

## 10. Intent Definition

كلIntent تحفظ:

- stable intent key.
- version.
- owner context.
- classification.
- default priority.
- audience type.
- allowed channels.
- required/optional channels.
- preference bypass policy.
- quiet-hours policy.
- dedupe strategy.
- expiration/TTL.
- retry policy reference.
- fallback policy reference.
- escalation policy reference.
- template family.
- required data contract.
- sensitive fields classification.
- audit/retention class.

أمثلةKeys:

- `security.password_reset_requested`
- `security.new_device_enrolled`
- `billing.invoice_issued`
- `billing.collection_failed`
- `sales.receipt_ready`
- `returns.refund_completed`
- `inventory.low_stock_detected`
- `cash.shift_reconciliation_required`
- `sync.terminal_offline`
- `reporting.export_ready`

## 11. Intent Versioning

- Published intent version immutable.
- Breaking payload/template behavior يحتاجVersion جديدة.
- Source event يحددمقصدالإشعار، ولا يمررTemplate HTML خام.
- Historical notification تحفظintent/template versions.

## 12. Source Reference

كلNotification request ترتبطبـ:

- tenant_id.
- source context.
- source type/id/version.
- source event ID.
- correlation/causation IDs.
- occurred/recorded time.

## 13. Payload Contract

- Schema versioned.
- Named fields فقط.
- No arbitrary database row serialization.
- No secrets.
- IDs داخلية لاتظهرللمستخدم إلاإذاReference آمنة.
- Money/quantity/time typed andlocalized at render.
- PII fields classified.

# القسم الثالث — Recipient Resolution

## 14. Recipient Types

- Platform identity.
- Tenant membership.
- Tenant owner(s).
- Role/permission-scoped recipients.
- Location/warehouse/terminal assignees.
- Approval assignees.
- Customer.
- Supplier contact.
- Billing contact.
- Explicit external recipient approved byworkflow.
- Webhook endpoint.

## 15. Resolution Time

Baseline:

- Recipient eligibility تحسبوقتإنشاءNotification request.
- Delivery attempt تعيدالتحققمنحالةالقناة/consent/suppression قبلالإرسال.
- High-risk/security messages تتحققمنlatest verified contact.
- Historical recipient snapshot يحفظللتدقيق.

## 16. Membership Recipients

يجبتقاطع:

```
Active membership
AND required permission
AND required scope
AND notification assignment/preference
```

Role name وحده لا يكفي.

## 17. Ownership Recipients

- Last owner safeguards تطبق.
- Suspended identity لا تستخدمكقناةوحيدة.
- Multiple owners قديتلقونSecurity/Commercial critical notices حسبPolicy.

## 18. Customer/Supplier Recipients

- Contact purpose verified/allowed.
- Channel consent عندالحاجة.
- Preferred language/timezone.
- Data minimized.
- Duplicate contacts deduped وفقnormalized destination + purpose.

## 19. Invalid or Missing Recipient

النتيجة:

- `NoEligibleRecipient` أو`RecipientUnreachable`.
- Critical intent قدتفتحEscalation task.
- لا تخترعEmail/phone أوتستخدمContact غيرمتحقق.

# القسم الرابع — Contact Points and Verification

## 20. Contact Point

يحفظ:

- type: email/phone/push endpoint.
- normalized value/hash.
- masked display.
- verification state/time/method.
- owner identity/customer/supplier.
- allowed purposes.
- effective period.
- bounce/complaint/suppression state.

## 21. Verification

- Security actions تحتاجVerified destination.
- OTP verification لهاTTL ومحاولاتمحدودة.
- تغييرDestination عاليالمخاطر يحتاجStep-up.
- Verification token one-time وpurpose-bound.

## 22. Suppression

أسباب:

- Hard bounce.
- Spam complaint.
- Invalid number.
- User unsubscribe.
- Legal suppression.
- Security block.

Suppression لا تحذفالتاريخ، وتطبقحسبPurpose/Channel.

# القسم الخامس — Preferences, Consent and Quiet Hours

## 23. Preference Layers

Effective preference ناتجةمن:

1. Mandatory platform policy.
2. Legal/consent restrictions.
3. Tenant notification policy.
4. Membership/customer preference.
5. Intent-specific override المسموح.
6. Channel health/suppression.

## 24. Preference Types

- Enabled/disabled byintent family.
- Preferred channel order.
- Digest vsimmediate.
- Language.
- Timezone.
- Quiet hours.
- Frequency preference.

## 25. Consent Record

يحفظ:

- subject/contact.
- purpose.
- channel.
- status.
- legal basis.
- captured at/source.
- policy text/version.
- expiry where applicable.
- withdrawn at/source.

## 26. Consent Withdrawal

- Effective فورًا للرسائلغيرالمرسلة.
- Queued marketing تلغى.
- لا يحذفDelivery history.
- لا يمنعMandatory security/transactional notices ضمنالغرضالمشروع.

## 27. Quiet Hours

- تعتمدRecipient timezone.
- Default tenant policy +personal preference.
- Security critical تتجاوزها.
- Transactional urgent قدتتجاوزوفقintent policy.
- Deferred message تحفظ`not_before`.
- DST handled عبرIANA timezone.

## 28. No Channel Available

إذاكلالقنواتمغلقة/غيرصالحة:

- تسجلSkipped/NoChannel.
- Critical intents تصعدIn-app/admin task/support workflow.
- لا يتمتجاهلهاصامتًا.

# القسم السادس — Templates and Localization

## 29. Template Family

تحدد:

- intent/version.
- channel.
- locale.
- tenant/platform scope.
- subject/title/body.
- required variables.
- sensitive variable policy.
- link policy.
- branding version.
- lifecycle.

## 30. Template States

`Draft → Reviewed → Published → Deprecated → Retired`

Published immutable.

## 31. Template Precedence

Baseline:

1. Tenant-specific published template عندمايسمحالغرض.
2. Platform localized template.
3. Platform default locale.

Security-critical messages قدتمنعTenant override أوتسمحBranding محدود فقط.

## 32. Localization

- Locale منRecipient preference ثمTenant default ثمPlatform fallback.
- Money/date/quantity formatting عندrender.
- Source values لا تتحوللغويًا بطريقةتغيرالمعنىالقانوني.
- RTL مدعوم للعربية.
- Template tests لكلLocale منشورة.

## 33. Variables

- Strict schema.
- Missing required variable تفشلrender قبلprovider call.
- HTML escaping bydefault.
- URL allow-list/builders.
- No arbitrary template code execution.
- No raw SQL/HTML fromuser input.

## 34. Branding

- Tenant logo/name/colors حيثمسموح.
- Platform/security identity تبقىواضحة.
- Untrusted external image URLs ممنوعة أوproxied.
- Accessibility: plain-text fallback وsemantic content.

# القسم السابع — Notification Request Lifecycle

## 35. Request States

```
Created
→ Suppressed | Scheduled | Ready
→ Rendering
→ Dispatching
→ PartiallyDelivered | Delivered | Failed | Expired | Cancelled
```

Request متعددةالقنوات تجمعنتائجAttempts؛ لا تعنيDelivery لكلRecipient تلقائيًا.

## 36. Creation

داخلنفسDomain transaction:

- Domain writes Outbox event.
- Notification consumer ينشئRequest idempotently.
- لاNetwork call داخلDomain transaction.

## 37. Scheduling

- `not_before` و`expires_at` صريحان.
- Reminder condition يعادفحصه قبلالإرسال.
- Cancelled/resolved source يلغيالـreminder.

## 38. Expiry

بعدTTL:

- لا ترسلرسالةقديمة مضللة.
- Security token/message may expire أسرع.
- Expiry تسجلولا تعتبرProvider failure.

## 39. Cancellation

مسموح قبلالتسليم لبعضالفئات:

- Marketing campaign cancelled.
- Reminder condition resolved.
- Wrong recipient discovered.

لا يمكنإلغاءAttempt تمقبولها منProvider؛ يمكنفقطمنعالمحاولاتالتالية.

# القسم الثامن — Delivery Attempt Contract

## 40. Attempt Identity

كلAttempt تحفظ:

- notification request ID.
- recipient snapshot.
- channel.
- provider namespace.
- template version.
- content hash.
- idempotency/dedupe key.
- attempt number.
- timestamps.
- normalized state.
- provider references.
- outcome certainty.
- safe error details.

## 41. Attempt States

- Pending.
- Deferred.
- Submitted.
- ProviderAccepted.
- Delivered.
- Read/Open observed غيرسلطوي.
- FailedNoEffect.
- OutcomeUnknown.
- Bounced.
- Complained.
- Rejected.
- Expired.
- Cancelled.

## 42. Provider Accepted vs Delivered

- Accepted يعنيProvider استلمالطلب.
- Delivered يعنيProvider أعادEvidence بالتسليم.
- Open/Click tracking اختياري وPrivacy-sensitive وغيرموثوق كإثباتقراءة.

## 43. Outcome Unknown

عندTimeout بعدإمكانيةقبولProvider:

- لا Retry فوريblind.
- Query provider إذايدعم.
- انتظرWebhook/receipt window.
- بعدpolicy decision قديرسلRetry بنفسprovider idempotency key أوChannel fallback معDuplicate warning policy.

## 44. Content Immutability per Attempt

- نفسAttempt/content hash لا يتغير.
- Retry قدتنشئAttempt جديدةمرتبطةبالأصل، بنفسNotification request.
- تغييرTemplate يحتاجRe-render موثق وسبب.

# القسم التاسع — Provider Abstraction

## 45. Provider Interface

لكلقناة:

- Send.
- Query status where supported.
- Cancel where supported.
- Verify webhook.
- Normalize status/error.
- Health/capability metadata.

## 46. Provider Independence

Core لا يعتمدأسماءحالاتResend/Twilio/Meta/FCM أوغيرهم. Provider adapter يحولإلىNormalized states.

## 47. Provider Configuration

- Tenant-level provider مستقبلًا أوPlatform shared provider.
- Secrets فيSecret manager/environment، ليستفيTemplates أوDatabase payload.
- Key rotation وWebhook secret versioning.
- Sender identity/domain/number verification state.

## 48. Provider Health

- Circuit breaker.
- Error-rate/latency monitoring.
- Temporary unavailable classification.
- Fallback policy activation.
- لا تحولHard recipient bounce إلىProvider outage.

# القسم العاشر — Channel Contracts

## 49. In-app

Baseline channel الأساسيةللموظفين:

- Notification inbox.
- Unread/read/acknowledged/dismissed states.
- Deep link إلىResource داخلScope.
- Badge counts projection.
- Read state perrecipient.
- Expiry/archive.

Read لا تعنيBusiness action completed.

## 50. Email

- Verified sender domain.
- Plain text +HTML.
- Unsubscribe headers للـmarketing.
- Bounce/complaint processing.
- Safe subject لا يكشفPII عاليةعلىlock screen.
- Attachments baseline عبرSecure links، وليسملفاتكبيرةمباشرة.

## 51. SMS

- محتوىقصير ومحدودالحساسية.
- لاFull invoice/financial detail.
- Country/number validation.
- Segment count/cost awareness.
- STOP/unsubscribe handling للـmarketing حسبالقانون/provider.
- Secure short-lived link عندالحاجة.

## 52. WhatsApp

- Provider-approved templates عندالحاجة.
- Conversation/session window rules فيAdapter.
- Consent/purpose tracking.
- Template status/version mapping.
- لا يفترضAvailability عالميًا.

## 53. Push

- Device endpoint/token lifecycle.
- Token invalidation.
- Minimal lock-screen content.
- Deep link requiresauthentication/authorization.
- Push delivery ليستSecurity proof.

## 54. Webhook

Webhook delivery قناةتكامل B2B مستقلة:

- Endpoint ownership/verification.
- Signed payload.
- Timestamp/replay protection.
- Versioned event contract.
- At-least-once delivery.
- Retry/backoff/dead letter.
- Endpoint-specific secret rotation.
- No browser/customer template semantics.

# القسم الحادي عشر — Deduplication, Rate Limits and Digests

## 55. Dedupe Key

تشتقمن:

- tenant.
- intent version.
- source event/resource.
- recipient.
- channel orchannel group.
- dedupe window/version.

Same key +same payload يعيدنفسRequest/نتيجة. Different payload conflict أوnewversion حسبintent.

## 56. Natural Duplicate Examples

- Payment webhook repeated.
- Sync event replayed.
- Reminder scheduler rerun.
- User double-click.
- Worker crash afterprovider acceptance.

## 57. Rate Limits

Per:

- Tenant.
- Intent.
- Recipient/destination.
- Channel/provider.
- Platform global safeguard.

Security throttling لا يمنعRecovery بالكامل؛ يوفرalternative verified path.

## 58. Notification Storm Protection

- Correlated events aggregated.
- Cooldown.
- Threshold crossing only.
- State-change notification بدلكلheartbeat.
- Maximum burst.
- Escalation بعداستمرارالحالة.

## 59. Digests

للـOperational non-urgent:

- Fixed window/timezone.
- Items deduped.
- Max items +summary count.
- Critical item لا ينتظرDigest.
- Digest source links تحترمScope وقتالفتح.

# القسم الثاني عشر — Retry, Backoff and Dead Letters

## 60. Retry Classes

### Retryable No Effect

مثلConnection failure قبلProvider acceptance.

### Retryable Unknown

يحتاجQuery/Wait قبلRetry.

### Non-retryable Recipient

Invalid address, hard bounce, blocked number.

### Non-retryable Policy

No consent, suppressed, expired, forbidden.

### Configuration Failure

Missing template/sender/provider config؛ يحتاجOperator action.

## 61. Backoff

- Exponential withjitter.
- Perintent max attempts/time window.
- Respect provider retry-after.
- No infinite retry.

## 62. Dead Letter

بعدنفادالمحاولات:

- سجلDeadLetter reason.
- Alert/operator queue حسبseverity.
- Manual retry createsnewcontrolled attempt.
- Original evidence preserved.

# القسم الثالث عشر — Fallback and Escalation

## 63. Fallback Policy

مثال:

```
In-app immediate
→ Email
→ SMS only if critical and email unavailable
```

ليستكلIntent متعددةالقنوات.

## 64. Fallback Preconditions

- Channel allowed forintent.
- Consent/legal basis valid.
- Recipient verified.
- Payload مناسبةللقناة.
- Not expired.
- Duplicate risk acceptable.

## 65. Escalation

Operational escalation قدتنتقل:

- Assigned operator.
- Supervisor.
- Location manager.
- Tenant owner.
- Platform support/security.

كلخطوة لهاDeadline وAck condition.

## 66. Acknowledgement

- In-app `acknowledged_at` مستقلعنRead.
- Acknowledgement لا تكملBusiness workflow إلاإذاCommand منفصلةمصرح بها.
- Escalation تتوقفوفقack/resolution policy.

# القسم الرابع عشر — Secure Links and Actions

## 67. Secure Link Properties

- Opaque random token.
- Hashed at rest.
- Purpose-bound.
- Recipient/identity-bound عندالحاجة.
- Single-use أوlimited-use.
- Short TTL.
- Revocable.
- No sensitive data inURL.

## 68. Authentication

- Receipt public verification قدتستخدمLimited public token.
- Billing/payment method changes تحتاجLogin وStep-up.
- Password reset token لا ينشئSession واسعة تلقائيًا دونpolicy.
- Deep links تعيدAuthorization evaluation وقتالفتح.

## 69. Link Logging

- لا تسجلtoken كاملًا.
- Referer leakage minimized.
- HTTPS only.
- Token removed/rotated afterconsumption.

## 70. Action Buttons

Email/SMS CTA لا تنفذHigh-risk mutation مباشرة. تفتحواجهةمؤمنة ثمCommand واضحةمعconfirmation/idempotency.

# القسم الخامس عشر — Document Delivery

## 71. Document Notification

ترتبطبـDocument ID/Version/Render reference.

- لا تحملBusiness document كـsource truth داخلNotification payload.
- Delivery retry تستخدمنفسDocument version.
- Template notification منفصلةعنDocument render template.

## 72. Attachment vs Secure Link

Baseline:

- Secure link للـPDF/Export.
- Direct attachment فقطللملفاتالصغيرة والمسموح بها.
- Link expiry يمكنتجديدهابـauthorized request دونإعادةإصدارDocument.

## 73. Re-send

- Re-send createsnewDelivery Attempt.
- يحفظoriginal document/version.
- لا يغيرissued time/number.
- Audit السببوالActor.

## 74. Delivery Evidence

يحفظ:

- recipient/channel.
- content/document hash.
- provider references.
- submitted/delivered/bounced times.
- attempts.

لا يدعيLegal receipt acknowledgment إلاإذاالقانون/القناة توفرEvidence معتمدة.

# القسم السادس عشر — Business Notification Catalog

## 75. Identity and Security

- Invitation issued/expiring.
- Password reset.
- MFA challenge.
- New device/session.
- Membership suspended.
- Role/scope/owner changed.
- Data export created/downloaded.

## 76. Sales and Payments

- Receipt/invoice ready.
- Payment completed/failed/unknown.
- Refund requested/completed/failed/unknown.
- Correction/void document issued.

## 77. Inventory and Purchasing

- Low/out-of-stock threshold.
- Negative stock/cost reconciliation.
- Purchase order approval.
- Goods receipt discrepancy.
- Supplier invoice mismatch.
- Transfer approval/shipment/receipt/discrepancy.

## 78. Returns and Customers

- Return approved/rejected.
- Refund method action required.
- Exchange ready.
- Receivable due/overdue.
- Store credit expiry إذاقانونيًا مسموح.
- Loyalty expiry/adjustment.

## 79. Shift, Cash and Devices

- Shift close pending.
- Cash difference.
- Approval/escalation required.
- Terminal offline.
- Sync queue aging/conflict.
- Offline lease near expiry.
- Unsupported client/protocol version.

## 80. Billing

- Trial ending.
- Subscription activated.
- Renewal upcoming.
- Invoice issued.
- Collection failed/outcome unknown.
- Grace/read-only/suspension transition.
- Plan change scheduled/completed.
- Cancellation/reactivation.

## 81. Reporting and Exports

- Report/export ready.
- Export expiring.
- Scheduled report failed.
- Projection/reconciliation failure foroperators.

# القسم السابع عشر — Storage Model

## 82. Core Records

Baseline tables fromDatabase Blueprint:

- `documents.notification_requests`
- `documents.notification_recipients`
- `documents.notification_attempts`
- `documents.notification_templates`
- `documents.notification_template_versions`
- `documents.notification_preferences`
- `documents.notification_consents`
- `documents.notification_suppressions`
- `documents.notification_schedules`
- `documents.notification_escalations`
- `documents.secure_link_grants`
- `documents.webhook_endpoints`
- `documents.webhook_deliveries`

## 83. Content Storage

- Template variables structured JSON withschema/version.
- Rendered content maystorehash +encrypted/retention-limited snapshot حسبclassification.
- Full sensitive body لا يحتفظبلاسبب.
- Provider raw payload محدودومقيد أوObject Storage.

## 84. Append-only Evidence

Delivery attempts وprovider receipts لا تعدلصامتًا؛ status progression/evidence محفوظة.

# القسم الثامن عشر — Permissions and Administration

## 85. Permission Keys

- `notifications.inbox.read`
- `notifications.preference.manage_self`
- `notifications.tenant_policy.read`
- `notifications.tenant_policy.manage`
- `notifications.template.read`
- `notifications.template.manage`
- `notifications.delivery.read`
- `notifications.delivery.retry`
- `notifications.suppression.manage`
- `notifications.campaign.manage`
- `notifications.provider.configure`
- `notifications.webhook.manage`
- `notifications.security_delivery.read`

## 86. Tenant Template Management

- محدودIntent families.
- Draft/review/publish workflow.
- Variable/schema validation.
- Preview withsynthetic data only.
- No real customer data inpreview logs.

## 87. Provider Administration

- Step-up required.
- Secrets masked.
- Test send usesapproved destination andmarked test.
- Sender/domain verification status visible.

# القسم التاسع عشر — Audit and Retention

## 88. Audit Actions

- Intent/template/policy published.
- Consent captured/withdrawn.
- Preference changed.
- Suppression added/removed.
- Notification requested/cancelled.
- Critical delivery failed/escalated.
- Manual retry/resend.
- Secure link generated/revoked/used.
- Provider configuration changed.
- Webhook endpoint/secret changed.

## 89. Retention Classes

- Security/Legal delivery evidence: long-lived حسبpolicy.
- Transactional attempts: policy-retained.
- Marketing campaign detail: consent/legal retention.
- In-app read state: operational TTL/archive.
- Provider telemetry/raw payload: short-lived.
- Secure link tokens: expire thenminimal evidence.

## 90. Privacy Requests

Anonymization/deletion:

- لا تكسرDocument/financial legal evidence.
- Destination may be masked/anonymized وفقpolicy.
- Consent/complaint evidence يحتفظبالحدالقانوني.
- Legal hold تتغلبعلىdisposition.

# القسم العشرون — Error Catalog

## 91. Intent and Template Errors

- `NOTIFICATION_INTENT_NOT_FOUND`
- `NOTIFICATION_INTENT_VERSION_UNSUPPORTED`
- `NOTIFICATION_TEMPLATE_NOT_FOUND`
- `NOTIFICATION_TEMPLATE_NOT_PUBLISHED`
- `NOTIFICATION_TEMPLATE_VARIABLE_MISSING`
- `NOTIFICATION_TEMPLATE_RENDER_FAILED`
- `NOTIFICATION_LOCALE_NOT_SUPPORTED`

## 92. Recipient and Policy Errors

- `NOTIFICATION_NO_ELIGIBLE_RECIPIENT`
- `NOTIFICATION_RECIPIENT_UNVERIFIED`
- `NOTIFICATION_CHANNEL_NOT_ALLOWED`
- `NOTIFICATION_CONSENT_REQUIRED`
- `NOTIFICATION_SUPPRESSED`
- `NOTIFICATION_QUIET_HOURS_DEFERRED`
- `NOTIFICATION_RATE_LIMITED`
- `NOTIFICATION_EXPIRED`

## 93. Delivery Errors

- `NOTIFICATION_PROVIDER_UNAVAILABLE`
- `NOTIFICATION_PROVIDER_REJECTED`
- `NOTIFICATION_DELIVERY_OUTCOME_UNKNOWN`
- `NOTIFICATION_DELIVERY_BOUNCED`
- `NOTIFICATION_DELIVERY_COMPLAINT`
- `NOTIFICATION_DELIVERY_FAILED`
- `NOTIFICATION_RETRY_EXHAUSTED`
- `NOTIFICATION_FALLBACK_UNAVAILABLE`

## 94. Secure Link and Webhook Errors

- `SECURE_LINK_INVALID`
- `SECURE_LINK_EXPIRED`
- `SECURE_LINK_ALREADY_USED`
- `SECURE_LINK_RECIPIENT_MISMATCH`
- `WEBHOOK_ENDPOINT_UNVERIFIED`
- `WEBHOOK_SIGNATURE_INVALID`
- `WEBHOOK_DELIVERY_FAILED`
- `WEBHOOK_RETRY_EXHAUSTED`

# القسم الحادي والعشرون — Failure and Recovery

## 95. Worker Crash Before Provider Call

Inbox/outbox state allows safe retry; noattempt markedSubmitted.

## 96. Crash After Provider Acceptance

- Attempt mayremainOutcomeUnknown.
- Query/wait provider evidence.
- Same idempotency key.
- لا إرسالنسخةجديدةفوريًا.

## 97. Template Misconfiguration

- Request staysFailed/Blocked.
- Alert template owner.
- Source transaction unaffected.
- Publishing gate preventsknown invalid template.

## 98. Provider Outage

- Circuit breaker.
- Queue withTTL.
- Fallback ifpolicy allows.
- Critical operator alert.
- Non-urgent messages deferred.

## 99. Recipient Hard Bounce

- Mark destination suppressed.
- Stop retries.
- Try allowed verified fallback.
- Prompt contact correction throughsafe channel.

## 100. Duplicate Source Event

Unique source/intent/recipient dedupe preventsduplicate request.

## 101. Consent Changed While Queued

Reevaluate immediately beforedispatch؛ marketing request cancelled/suppressed.

## 102. Message Delivered AfterSource Changed

Templates avoidvolatile claims whenpossible. Reminder checkscondition beforedispatch. Already-provider-accepted message cannot bewithdrawn؛ correction notification may beissued whenneeded.

# القسم الثاني والعشرون — Testing Contract

## 103. Intent Tests

- Stable keys/versioning.
- Payload schema.
- Classification/policy.
- Required source reference.
- Dedupe behavior.

## 104. Recipient Tests

- Membership permission/scope.
- Owner fallback.
- Suspended user.
- Verified/unverified contact.
- Customer/supplier consent.
- Cross-tenant isolation.

## 105. Preference and Consent Tests

- Marketing opt-in/out.
- Mandatory security bypass.
- Transactional preference.
- Quiet hours/DST.
- Withdrawal whilequeued.
- Suppression precedence.

## 106. Template Tests

- All locales.
- Missing variables.
- HTML/script injection.
- RTL.
- Money/time formatting.
- Tenant override boundaries.
- Security template cannot beunsafe-overridden.

## 107. Delivery Tests

- Success/accepted/delivered.
- Temporary failure.
- Hard bounce.
- Outcome unknown.
- Duplicate webhook.
- Out-of-order status.
- Provider retry-after.
- Dead letter.

## 108. Fallback and Escalation Tests

- Email→SMS allowed.
- Consent blocksfallback.
- Critical bypass quiet hours.
- Ack stopsescalation.
- Resolution cancelsreminder.
- Storm digest/rate caps.

## 109. Secure Link Tests

- Expiry.
- Single use.
- Recipient binding.
- Revocation.
- No token inlogs.
- Authorization reevaluation.

## 110. Document Delivery Tests

- Retry doesnotreissue document.
- Same document version/hash.
- Link regeneration.
- Attachment size/type restrictions.
- Delivery evidence/audit.

## 111. Security Tests

- Webhook signature/replay.
- Provider secret masking.
- Tenant template isolation.
- PII minimization.
- Unauthorized delivery history access.
- CSV/URL/HTML injection vectors.

## 112. Performance Tests

- Notification burst.
- Queue throughput.
- Provider outage backlog.
- Digest generation.
- Tenant fairness.
- Delivery processing doesnotincreasePOS transaction latency.

# القسم الثالث والعشرون — Open Decisions

## 113. OD-NOT-001 — Initial channels

**Baseline:** In-app +Email أولًا. SMS/WhatsApp/Push adapters لاحقًا دونتغييرCore.

## 114. OD-NOT-002 — Initial email provider

**Baseline:** Provider abstraction؛ الاختيارعندالتنفيذ وفقfree/demo limits, deliverability andregion.

## 115. OD-NOT-003 — SMS/WhatsApp cost

**Baseline:** Disabled untilpaid plan/business need. Tenant/plan entitlement andcost controls required.

## 116. OD-NOT-004 — Tenant custom templates

**Baseline:** Transactional/operational selected families فقط؛ security/legal templates platform-controlled.

## 117. OD-NOT-005 — Marketing campaigns

**Baseline:** Contract supportsها، لكنImplementation مؤجلعنcritical transactional notifications.

## 118. OD-NOT-006 — Open/click tracking

**Baseline:** Disabled أوminimal bydefault بسببprivacy/unreliability؛ لا يستخدمكإثباتقراءة.

## 119. OD-NOT-007 — Quiet hours default

**Baseline:** Tenant-configurable؛ security critical bypass. القيمالنهائية فيProduct configuration.

## 120. OD-NOT-008 — Direct attachments

**Baseline:** Secure links default؛ attachments only forsmall approved document types.

## 121. OD-NOT-009 — Customer receipt delivery

**Baseline:** Print remainsPOS baseline؛ Email/secure link whenverified contact andconsent/purpose allow.

## 122. OD-NOT-010 — In-app persistence

**Baseline:** Operational inbox witharchive/retention; exact TTL afterData Retention/Security review.

## 123. OD-NOT-011 — Webhook tenant self-service

**Baseline:** Later entitlement؛ endpoint verification, signing andrate limits mandatory.

## 124. OD-NOT-012 — Provider per tenant

**Baseline:** Platform-managed providers first. Bring-your-own provider deferred.

# القسم الرابع والعشرون — Prohibited Patterns

## 125. أنماطممنوعة

- إرسالDomain event الخام مباشرةلمستخدم.
- Template بلاVersion/Review.
- Marketing داخلSecurity/Transactional message.
- إرسالMarketing بلاConsent.
- استخدامRole name فقطلتحديدالمستلمين.
- Hard-coded provider داخلCore.
- Blind retry بعدTimeout.
- اعتبارProvider Accepted = Delivered.
- إعادةتنفيذSale/Payment عندفشلNotification.
- إعادةإصدارInvoice لأنEmail فشل.
- تخزينTokens/Secrets فيLogs أوURLs قابلةللتسريب.
- رابطHigh-risk ينفذAction دونAuth/Step-up.
- PII كاملةفيSMS/Push lock screen.
- Unlimited retry أوreminders.
- Ignoring hard bounce/complaint.
- Cross-tenant template أوrecipient leakage.
- Quiet hours تمنعSecurity critical.
- Unsubscribe marketing يمنعLegal/security notices.
- Export/document public permanent link.
- Webhook بلاsignature/replay protection.
- Notification storm لكلheartbeat/event صغير.
- Open tracking كإثباتقانوني للقراءة.

# القسم الخامس والعشرون — Implementation Readiness

## 126. Ready after Shared Foundation

- Notification intent registry.
- Request/recipient/attempt contracts.
- In-app notification inbox.
- Email provider adapter interface.
- Template versioning/render validation.
- Preference/consent/suppression model.
- Outbox consumer anddedupe.

## 127. First Implementation Priority

1. Security identity emails.
2. Tenant invitations.
3. Billing invoice/payment failure notices.
4. Report/export ready.
5. POS receipt Email/secure link.
6. Operational approvals/reconciliation.
7. SMS/WhatsApp/Push.
8. Marketing campaigns.

## 128. Free Demo Strategy

- In-app available withoutexternal cost.
- Email usesfree provider tier onlywhenconfigured.
- Development useslocal/fake provider sink.
- SMS/WhatsApp disabled untilcommercial need.
- NoPaid notification service required beforefirstcustomer.

# القسم السادس والعشرون — Acceptance Gate

## 129. بوابةالاعتماد

لا يعتبرNotification Contract مكتملًا قبل:

1. تثبيتclassification والـownership.
2. تثبيتintent/payload/source contracts.
3. تثبيتrecipient resolution.
4. تثبيتcontact verification/suppression.
5. تثبيتpreferences/consent/quiet hours.
6. تثبيتtemplate/localization/versioning.
7. تثبيتrequest/attempt states.
8. تثبيتprovider abstraction/normalization.
9. تثبيتchannel contracts.
10. تثبيتdedupe/rate limit/digest.
11. تثبيتretry/outcome unknown/dead letters.
12. تثبيتfallback/escalation/acknowledgement.
13. تثبيتsecure links.
14. تثبيتdocument delivery.
15. تثبيتbusiness notification catalog.
16. تثبيتstorage/permissions/audit/retention.
17. تثبيتerrors/recovery/tests.
18. تثبيتfree-demo implementation priority.

## 130. القرار التخطيطي الحالي

- In-app +Email هماBaseline الأولى.
- SMS/WhatsApp/Push مؤجلة ومغلقةحتىاحتياجتجاري.
- Security critical تتجاوزQuiet hours ولا يمكنتعطيلهاعامًا.
- Marketing منفصلةوتحتاجConsent.
- Provider Accepted ليستDelivered.
- Outcome unknown لا يعادإرسالهblind.
- Secure links هيBaseline للمستنداتوالـexports.
- Notification failure لا يعيدBusiness transaction أوDocument issuance.
- Tenant custom templates محدودة؛ Security/Legal platform-controlled.
- Development يستخدمFake/local sink، والـDemo يستخدمFree email tier عندالتوفر.

## 131. المرحلة التالية

**ATHR Multi-tenancy Blueprint v1.0**

سيثبت:

- Tenant boundary عبرApplication وDatabase وJobs وCaches وFiles.
- Tenant resolution andcontext propagation.
- Organization/LegalEntity/Location/Warehouse hierarchy.
- Identity vsMembership.
- Tenant-scoped uniqueness andIDs.
- Cross-tenant reference prevention.
- Background jobs andevent isolation.
- Storage paths andsigned links.
- Support/platform access.
- RLS decision andconnection pooling.
- Tenant provisioning, suspension, export andclosure.
- Noisy-neighbor controls.
- Migration fromsingle Bold tenant.

بعده: **ATHR Security Blueprint v1.0**.