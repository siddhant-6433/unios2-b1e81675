# Lead backlog cleanup

Super admins can open **Lead Lists → Archive old leads**. Deployment alone does
not archive or reassign records; the administrator must review and apply a
preview. Cleanup never deletes leads or sends messages.

## Rules

One cutoff is frozen at the first preview. Refreshing retains that cutoff.
Application links (including drafts), students, admission identifiers/stages,
non-lead person roles, payment records and payment links are protected. Normalized
applicant/student/parent-phone matches, mirror relationships, private partner
leads, active calls and ambiguous classifications are left for review.

Closed old prospects are archived first. Remaining old nursing/GNM leads go to
Ashish; interested or human-follow-up school prospects go to Payal; Mirai prospects
alternate between Reema and Harsh Verma in created-at/ID order, with the extra
record going to Reema. Completed work and stages remain unchanged. Active owners
must resolve uniquely through the assignable-counsellor directory. Missing or
ambiguous staff identities or missing canonical nursing/GNM courses stop preview
creation; uncertain mappings on individual leads are left for review.

Future leads enter the unassigned bucket. If an automatic assignment occurred
between the cutoff and policy activation, the preview can include it as `bucket`.
An explicit allocation, or unclear assignment provenance, is left for review.
The policy takes effect with the first applied batch; preview itself is read-only.

## Review, apply, and recover

1. Build and download the preview. Review protected/review records and assignments.
2. Confirm the preview checkbox, then apply. A changed preview cannot be prepared.
3. Each 100-record batch is atomic. Admission protection and complete lead/task/
   calling/assignment snapshots are checked again. Changed records are skipped.
4. Closing the dialog or pressing Pause stops after the current batch. Reopen a
   recent run and Resume to process the existing approved snapshot.
5. Download the reconciliation report. Review skips/conflicts and the Mirai balance
   warning; do not force skipped records into the split.
6. Rollback restores archive/owner/pending-task values only if the applied snapshot
   still matches and the lead has not gained admission protection. Conflicts are
   left unchanged and reported. Original assignment history remains; rollback
   appends its own audit event. A run can be rolled back before finishing.

Short database table locks serialize each batch against admissions creation and
concurrent task writes. Failed batches roll back completely and can be retried.
The future-routing policy is restored on rollback only if it is still this run's
policy; a newer policy is never overwritten.

## Marketing archive

The dated archive is a static **marketing** list visible through All lists and the
cleanup report link. Lead stages and prior owners remain available for history.
Archived records and calling-list memberships cannot enter calling queues, SLA
pendency/reclaim or cold revival. Pending follow-ups and scheduled WhatsApp outreach are cancelled with an audit reason.

Campaign creation deduplicates normalized phone/email destinations. Existing DNC,
opt-out, visibility and sender suppression checks remain. Email and WhatsApp send
workers additionally recheck archived leads immediately before sending; new
application/student/payment protection or an eligibility-check error withholds
that recipient. Marketing remains an explicit campaign action.

## Deployment and validation

Apply the `lead_archive_cleanup` migration and deploy changed functions:
`ai-call-batch`, `ai-call-failed-handler`, `ai-first-call`, `automation-engine`,
`manual-call`, `voice-call`, `email-campaign-send`, `whatsapp-campaign-send`,
`whatsapp-scheduled-flush`, `whatsapp-send`, `whatsapp-reply`.
Deploy the frontend after the database and functions. The branch includes the
already-deployed receipt-scope migration from `main`; do not repair or revert
production migration history.

The migration creates metadata and controls but performs no backlog cleanup.
Tests execute its PostgreSQL functions through PGlite, including migration reruns,
stale previews, admission links, cutoff behavior, rollback conflicts, small-batch
resumption and injected transaction failure. UI tests cover review gating, stale
preview errors and saved-run resumption.
