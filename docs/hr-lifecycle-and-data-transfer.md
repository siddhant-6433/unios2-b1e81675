# HR lifecycle and employee data transfer

## Hiring and onboarding

1. Create and publish a job opening, then receive or enter the candidate in HR recruitment.
2. Move the candidate through review and shortlisting. Schedule the interview and record the panel's feedback; feedback marks the interview complete.
3. Generate the offer letter. A super admin issuer auto-approves the HR letter; other authorized HR users submit it for super-admin approval. HR letters currently have no candidate-facing acceptance link or acceptance workflow.
4. The HR **Convert to employee** action is the current administrative hire/acceptance step: it creates or reuses one employee profile, records `offer_accepted_at`, and marks the applicant hired. This records HR's conversion action; it does not capture candidate consent. Confirm acceptance outside UniOS before using this for a real hire.
5. The converted profile enters **Needs verification**. Verify the employee after assigning a campus, then set a work email and provision or link the login from the employee profile. The hire RPC fills personal email but does not fill work email, which the login-provisioning screen requires.
6. Login provisioning can send a welcome email/invitation and a WhatsApp message. Initial invitation sends the `nimt_new_staff` template directly; the resend path uses the `staff_welcome` key through `whatsapp-send`. Check the result for the path actually exercised; creating/linking the login and sending the notification are separate outcomes.

## Exit

In **HR → Employee Directory → Probation & exits**, HR can now record a resignation, termination, retirement, contract end, or abscondment. The intake captures the employee, notice/resignation date, last working day, reason, notice waiver, and clearance notes. New exits start `in_progress`.

When HR completes the exit, the database trigger writes the last working day to the employee profile and marks employment as resigned or terminated. The daily `hr-close-due-exits` job completes exits whose last working day is due and disables the linked login. Payroll uses the exit date when populating payroll. HR should still process final settlement in **HR → Settlements**; clearance notes are recorded, but they are not a per-owner sign-off workflow.

The exit record and welcome/hiring flows do not currently send an exit WhatsApp message. Offer acceptance also has no documented WhatsApp event. The hiring-notify action covers four candidate messages only: application acknowledgement, interview invite, offer, and regret.

## WhatsApp coverage

The four hiring templates are documented in `hiring-flow-qa-checklist.md` as approved and successfully sent during the 2026-09-26 check. Initial employee invitations use `nimt_new_staff`; the resend path uses `staff_welcome`. These records demonstrate configured paths, not current delivery health. Production checks must verify the intended recipient, template approval, chosen WhatsApp sender, provider result, and the corresponding notification/message log. No hiring, onboarding, or exit WhatsApp should be sent to an employee's personal number during QA; use a dedicated test number.

## Existing employee transfer

1. Export a read-only source roster and supporting documents. Agree on canonical employee number, work email, phone, joining date, department, location, reporting manager, legal entity, employment status, and salary fields before importing.
2. Normalize dates and phone numbers, map source headings in **Import employees**, review the preview and validation errors, and import a small pilot batch first.
3. The current bulk importer creates new employee profiles in `pending` verification. It detects duplicate employee numbers and work emails and skips those rows; it does not update existing records. Resolve duplicates against the UniOS directory before import and route corrections to HR for controlled updates.
4. Reconcile imported counts and key fields against the source roster, then verify employee records and link existing logins where appropriate. Importing a profile does not itself create a login.
5. Offer letters are not part of the bulk employee sheet. Preserve each historical signed offer as a document associated with the correct employee, with its original date and source filename retained. The `employee_documents` table supports employee-linked files, but this review did not find an HR document-upload screen. Until one is available, do not claim historical letters have been transferred through the UI; keep a controlled source-to-employee manifest and use an approved document-ingestion path.
6. Reconcile bank details separately with restricted HR/payroll access. Do not include credentials, full bank numbers, or identity numbers in general QA reports.

## Production end-to-end check

Use one explicitly designated QA email and WhatsApp number. Tag test candidate/profile records with a QA marker in the name or notes; capture statuses and notification outcomes without storing secrets or unnecessary personal data. Remove the operational test employee and auth account after the full check, but retain minimal tagged audit evidence and note any provider logs that cannot be removed.

### Production run: 2026-10-09

- Candidate `087d3d59-cb38-4714-99e8-8c7d5598d675` was created as an internal QA candidate; no public opening was published. It moved through reviewing, shortlisted, interview, and offered, with stage events in the activity timeline.
- Interview scheduling persisted a 15-minute in-person slot with no interviewer assigned. Feedback recorded a 5/5 `yes`, and the interview status became completed. Feedback explicitly labels this a workflow simulation; no real interview took place.
- The super-admin generated a QA-marked, non-binding offer. Production auto-approved the HR letter because the issuer is super-admin. Offer acceptance was not candidate-driven; conversion to employee is the only current acceptance proxy.
- Conversion created one QA employee profile with a future joining date. It entered the verification queue. HR assigned the test campus and verified it, then set the designated work email and created a linked Office Assistant login. The provision flow reported success and the profile then showed a linked login. A test sign-in was not completed: provisioning creates an activation/password-setup invite rather than exposing a known password, and the connected Gmail tool required reauthentication. WhatsApp/email notification was requested, but provider-level delivery confirmation was not visible in the production UI during this check; do not count it as delivered.
- Exit initiation could not be exercised in production: the deployed **Probation & exits** tab showed existing exits only and exposed no intake action. The new exit form in this workspace is not deployed. Keep the QA employee and login until the exit path is deployed and the test can be completed; do not mark cleanup complete yet.
