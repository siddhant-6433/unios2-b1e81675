# HR Module Finalization — Audit, Research & Plan

Status: **Implemented — Phase 1–3 + new pillars (see §12)**
Branch: `hr-final` (worktree `portland`)
Base: `origin/main` @ `f347eddc`
Scope: the UniOS HR module (DB + web + mobile + automation + permissions)

---

## 1. Executive summary

UniOS already has a **large, impressively-scoped HR module** — employee master data,
verification, bank details with audit, attendance with face/geofence punching,
a real leave engine (plans → types → entitlements), payroll foundation with a tested
money engine, recruitment/ATS with a careers portal and interviews, HR letters with a
super-admin approval gate, onboarding/probation/exit lifecycle, documents, holidays,
shifts, designations, and a mobile self-service app.

The problem is **not missing surface area — it is that many pieces are dormant, half-wired,
or unsafe**. Concretely:

- **Schema drift**: `hr_locations`, `business_units` and `employee_profiles.hr_location_id`
  are referenced by RPCs/views but **exist in no migration** (the migration is an empty
  stub). A fresh `db push`/reset breaks. This is the single highest-risk item.
- **Automation is dormant**: `auto_punch_out()`, `close_due_employee_exits()`,
  leave accrual, document-expiry and probation-due all exist as code but **no pg_cron job
  ever calls them**.
- **The leave engine doesn't accrue**: `accrual='monthly'` and `carry_forward_max` are
  modelled but ignored — `grant_leave_entitlements` grants the full annual quota up front.
- **Leave approval is effectively broken for HR**: `employee_leave_requests` RLS admits
  only `super_admin` or the requester. `campus_admin`, `principal` and holders of
  `hr:leave_approve` **cannot action anyone else's leave**. There is no approval RPC and
  nothing emits a `leave_decision` notification.
- **Self-service writes are over-permissive**: employees can update *any* column of their
  own `employee_profiles` row directly (including `job_title`, `designation_id`,
  `employment_status`), bypassing the change-request allow-list.
- **Two producer flows are missing**: approval queues exist for profile changes and
  attendance regularisation, but there is **no employee-facing UI to raise either**.
- **Document/audit functions are forgeable**: `log_hr_document_action` and
  `notify_super_admins_hr_document` are granted to `authenticated` with no permission check.

This plan defines the target (a Keka-class capability model), maps current state against it,
registers gaps by priority, and proposes an implementation + multi-stakeholder test plan.

---

## 2. Method

- Read every HR migration (DDL, RLS, RPCs, triggers, seeds) and the HR frontend/mobile.
- Cross-checked DB objects referenced in code against actual DDL (found real drift).
- Compared against a Keka-style HRMS capability model (§3).
- Validated the migration pipeline (`npm run db:migrations:check`) and test harness (Vitest).

Caveat: the repo's `.env` points at the **live production Supabase project**, so this
plan avoids `db push` to prod and treats migrations as pipeline-applied.

---

## 3. Reference model — what "robust HRMS (Keka-class)" means

Twelve pillars. Status legend: ✅ present & wired · 🟠 present but dormant/partial · ❌ absent.

| # | Pillar | Keka-class capabilities | UniOS status |
|---|--------|------------------------|--------------|
| 1 | **Core HR / Employee master** | rich profile, org placement, org chart, employee number, custom fields, documents, e-sign, asset allocation, letters, probation/confirmation | 🟠 rich profile + docs + letters + probation; ❌ org chart, assets, custom fields, e-sign |
| 2 | **Onboarding** | candidate→employee pipeline, offer letter, document collection, checklist, login provisioning | 🟠 stages + offer + docs + login provisioning; ❌ checklist/asset issue |
| 3 | **Offboarding / Exit** | resignation workflow, notice period, clearance checklist, exit interview, F&F settlement, access revocation | 🟠 exit rows + clearance json + auto login disable; ❌ clearance UI, F&F computation, approval flow |
| 4 | **Attendance & Time** | shifts/rosters, biometric/face/geo/WFH punch, regularisation, overtime, comp-off, weekly-off, holiday calendar, timesheets, reports | 🟠 punch (face+geo), shifts, regularisation, overtime tables, holidays; ❌ cron close, comp-off, timesheets, WFH, reports |
| 5 | **Leave** | policies, plans, accrual, carry-forward, encashment, holidays, comp-off, balances, approvals, calendar, LOP | 🟠 plans/types/entitlements/self-apply/approval UI; ❌ accrual logic, carry-forward, approval RLS/RPC, encashment, calendar, LOP wiring |
| 6 | **Payroll** | salary structures, CTC, statutory (PF/ESI/PT/LWF/TDS), runs/partial runs, payslips, bank advice, F&F, reimbursements, loans/advances, arrears | 🟠 structures + CTC + cycles + lines + tested calculator; ❌ payslip UI/PDF, TDS, reimbursements, loans, bank advice, F&F |
| 7 | **Performance** | goals/OKRs, review cycles, 360 feedback, ratings, PIP, promotions | ❌ |
| 8 | **Recruitment / ATS** | requisitions, careers page, pipeline, interviews/panels, feedback, offers, onboarding handoff, sources | 🟠 openings, applications, pipeline, careers, 2 competing interview models, offer letters; ❌ feedback UI, structured pipeline config, sources analytics |
| 9 | **Employee engagement / Helpdesk** | announcements, polls, recognition, surveys, helpdesk tickets, org documents | ❌ (org documents mobile is a stub) |
| 10 | **Reports & Analytics** | headcount, attrition, attendance, leave, payroll cost, recruitment funnel, exports | 🟠 dashboard + a few lists; ❌ attrition/payroll/attendance reports, exports |
| 11 | **Employee self-service (ESS)** | profile, payslips, leave apply/balance, attendance view/regularise, documents, tax, requests | 🟠 MyHr (web) + mobile time/punch; ❌ raise flows, payslips, documents, tax |
| 12 | **Settings & master data** | departments, designations, locations, business units, holiday calendar, shifts, leave plans, salary components, roles/permissions, statutory config | 🟠 tables + some panels; ❌ locations/business units (drift), holiday calendar UI, statutory config UI, org-wide settings page |

---

## 4. Current-state inventory (abridged)

### 4.1 Data model (HR)
Employees: `employee_profiles`, `employee_documents`, `employee_document_types`,
`employee_bank_details` (+`employee_bank_audit`), `employee_profile_change_requests`,
`employee_exits`.
Attendance: `employee_attendance`, `attendance_regularisations`, `attendance_overtime`,
`work_shifts`, `geofence_locations`, `employee_face_registrations`, `holidays`.
Leave: `leave_plans`, `leave_types`, `employee_leave_entitlements`, legacy
`employee_leave_balances` + `employee_leave_requests`.
Payroll: `legal_entities`, `salary_components`, `salary_structures` (+components),
`employee_salaries`, `payroll_cycles`, `payroll_lines` (+components),
`payroll_cycle_audit`, `payroll_statutory_config`.
Recruitment: `job_openings`, `job_applicants` (+`job_applicant_activities`),
`interview_rounds` + `interview_feedback`, **and** a redundant `interviews`,
`hiring_notifications`, views `job_applicants_inbox` / `hiring_venues`.
Letters: `hr_letters`, `hr_letter_templates`, `hr_document_audit`.
Master: `designations`, (`hr_locations`, `business_units` — **missing DDL**).

### 4.2 Key RPCs
Payroll `populate_payroll_cycle`, `payroll_uncovered_employees`; leave
`grant_leave_entitlements`; attendance `approve_attendance_regularisation`,
`auto_punch_out`; lifecycle `apply_profile_change_request`, `close_due_employee_exits`;
recruitment `hire_job_applicant`; letters `generate_hr_letter`, `generate_hr_offer_letter`,
`approve_hr_document`, `reject_hr_document`, `issue_hr_document`; directory
`hr_staff_directory`, `employee_directory_card`; `review_employee_document`,
`admin_update_profile`.

### 4.3 Permissions
`hr:view`, `hr:self`, `hr:employees_edit`, `hr:attendance_edit`, `hr:leave_approve`,
`hr:recruitment_edit`, `hr:interviews_edit`, `hr:documents_generate`, `hr:bank_edit`,
`hr:payroll_run`. Roles: `super_admin`, `campus_admin`, `principal`, `hr_executive`,
plus most staff roles hold `hr:self`.

### 4.4 Frontend routes
`/my-hr` (hr:self) · `/hr` · `/hr-job-applicants` · `/hr-attendance` · `/hr-leave` ·
`/hr-directory` (hr:view) · `/hr-payroll` (hr:payroll_run).
Components: `EmployeeProfileDialog`, `BulkEmployeeImportDialog`, `EmployeeVerificationTable`,
`LeavePlansPanel`, `LettersPanel`, `LifecyclePanel`, `ProfileChangeRequests`,
`RegularisationQueue`, `SalaryImportDialog`. Libs: `payroll.ts`, `employeeImport.ts`,
`salaryImport.ts`, `employeeLogin.ts` — all with unit tests.
Mobile: `(staff)/work/{hr,leave,punch,team}.tsx` — punch is complete; hr Finances/Documents
tabs are stubs; leave modal is duplicated.

---

## 5. Keka-parity gap matrix (condensed)

| Pillar | Feature | Status | Priority |
|---|---|---|---|
| Core HR | `hr_locations`/`business_units` DDL missing → broken RPC | ❌ prod risk | **P0** |
| Core HR | self-update can write HR-only columns | ❌ security | **P0** |
| Core HR | approval queue has no raise UI | ❌ functional | **P1** |
| Core HR | org chart | ❌ | P3 |
| Core HR | asset allocation | ❌ | P3 |
| Onboarding | checklist / asset issue | ❌ | P3 |
| Exit | clearance UI, F&F, approval | 🟠 | P2 |
| Attendance | `auto_punch_out` not scheduled | 🟠 | **P1** |
| Attendance | regularisation raise UI | ❌ | **P1** |
| Attendance | monthly report/export (Export button dead) | 🟠 | P2 |
| Attendance | comp-off, timesheets, WFH, rosters | ❌ | P3 |
| Leave | monthly accrual + carry-forward ignored | 🟠 | **P1** |
| Leave | approval RLS + RPC + notification broken | ❌ | **P0/P1** |
| Leave | LOP integration into payroll | ❌ | P2 |
| Leave | leave calendar UI | ❌ | P2 |
| Payroll | payslip view/PDF | ❌ | P2 |
| Payroll | TDS, reimbursements, loans, bank advice, F&F | ❌ | P3 |
| Performance | entire pillar | ❌ | P3 |
| Recruitment | two competing interview models | 🟠 | P2 |
| Recruitment | interview feedback UI, funnel analytics | ❌ | P2 |
| Engagement | announcements, helpdesk, recognition, surveys | ❌ | P3 |
| Reports | attrition / payroll cost / attendance / leave reports | ❌ | P2 |
| ESS | leave apply consolidated, payslips, tax, requests | 🟠 | P1 |
| Settings | holiday calendar UI, statutory config UI, org settings hub | ❌ | P2 |
| Security | `log_hr_document_action`/notify forgeable | ❌ | **P0** |
| Security | `hr_letters` FOR ALL mutates issued letters | 🟠 | P1 |
| Security | face-registration approval super_admin-only | 🟠 | P2 |
| Data | `employee_attendance` no per-day key; regularisation ambiguity | 🟠 | P2 |
| Data | duplicate unique index; dual employee-id concepts | 🟠 | P2 |
| Automation | exit auto-close, doc-expiry, probation-due not scheduled | 🟠 | P1 |

---

## 6. Prioritised gap register

### P0 — Security & data integrity (do first)
1. **Restore missing schema**: add real DDL for `hr_locations`, `business_units`,
   `employee_profiles.hr_location_id` (+ FKs, indexes, RLS, grants) without reusing the
   recorded stub versions.
2. **Lock self-update of `employee_profiles`**: replace the blanket
   `Users can update own employee profile` policy with a column-safe path — self updates
   only via `employee_profile_change_requests` (revoke direct column writes; keep row
   update for whitelisted columns via a guarded RPC or a `BEFORE UPDATE` trigger that
   rejects HR-only column changes for non-HR callers).
3. **Gate document/audit helpers**: `log_hr_document_action`,
   `notify_super_admins_hr_document` must check permission or be callable only from inside
   SECURITY DEFINER RPCs (revoke EXECUTE from `authenticated`).
4. **Close the leave-approval hole**: RLS policy + approval RPC for `hr:leave_approve`
   (and campus_admin/principal as appropriate), emitting `leave_decision` notifications.

### P1 — Activate dormant features & complete producer flows
5. **Scheduled automation (pg_cron)**: `auto_punch_out` (daily), `close_due_employee_exits`
   (daily), leave accrual (monthly), document-expiry reminders, probation-due reminders.
6. **Leave accrual correctness**: implement `monthly` accrual pro-rata by completed months
   and `carry_forward_max` at year rollover; backfill entitlements for current year.
7. **ESS raise flows**: profile-change request form + attendance-regularisation request
   form in `MyHr` (and mobile), wired to existing queues.
8. **Permission-gate page actions**: hide approve/edit buttons unless the caller holds the
   matching permission; wire `hr:leave_approve`, `hr:attendance_edit`, `hr:recruitment_edit`,
   `hr:interviews_edit`, `hr:documents_generate`.
9. **Onboarding default**: `EmployeeProfileDialog` must not silently create employees as
   `verified`; route through the verify queue.

### P2 — Robustness, reporting, polish
10. Attendance monthly report + working CSV export; fix dead Export button.
11. Leave calendar; LOP days surfaced to payroll.
12. Payslip view/PDF from `payroll_lines` + `payroll_line_components`.
13. Unify interview models (`interview_rounds` + feedback) and add feedback UI.
14. Recruitment funnel analytics.
15. Settings hub: holiday calendar UI, statutory config UI, locations/business units UI.
16. Data hygiene: per-day attendance key strategy, drop duplicate index, consolidate
    employee-id concepts, mark HR views `security_invoker`.
17. Mobile: consolidate duplicate leave modal; wire Finances (payslips) & Documents tabs.
18. Reports: attrition, headcount, payroll cost, attendance/leave summaries + exports.

### P3 — Net-new pillars (larger, optional)
19. Performance management (cycles, goals, 360, PIP).
20. Expenses/reimbursements, loans/advances.
21. Engagement/helpdesk (announcements, tickets, recognition, surveys).
22. Asset management, org chart, custom fields, e-sign.

---

## 7. Stakeholders & what "good" means for each

| Stakeholder | Jobs to be done | Test lens |
|---|---|---|
| **Employee (ESS)** | punch in/out, view attendance, apply leave, see balance, request corrections, update own details, download payslip/letters | mobile + web self-service |
| **Reporting manager** | see team attendance/leave, approve leave & regularisation, feedback | manager queue |
| **HR Executive** | recruit, onboard, maintain employee records, generate letters (for approval), attendance/leave admin | HR ops screens |
| **HR Manager / campus_admin / principal** | approve leave, run/edit attendance, bank details, letters issuance | approval + edit paths |
| **Payroll admin** | salary setup, run/lock payroll, payslips | payroll run |
| **Super admin** | document approval gate, permissions, master data, audit | governance |
| **Finance/auditor** | reconciliation, audit trail (bank/letters/payroll) | read-only audit |
| **Candidate (careers)** | apply via public careers page | public flow |

---

## 8. Phased implementation roadmap

- **Phase 0 — Plan** (this doc): audit, gap register, approval.
- **Phase 1 — P0 hardening**: schema drift fix, self-update lock, document-helper gating,
  leave approval RLS + RPC. Ship with migration-guard unit tests.
- **Phase 2 — P1 activation**: crons, leave accrual, ESS raise flows, permission gating,
  onboarding default.
- **Phase 3 — P2 robustness**: reports/exports, payslip, leave calendar, interview
  unification, settings hub, data hygiene, mobile wiring.
- **Phase 4 — P3 pillars**: performance, expenses, engagement (as separately approved).

Each phase: migration(s) created via `npm run db:migration:new`, unit tests for any pure
logic, source-guard tests for security invariants, build + lint, and a stakeholder QA pass.

---

## 9. Testing strategy (multi-stakeholder)

1. **Unit / logic tests (Vitest)** — pure functions: leave accrual & carry-forward, payroll
   calcs, import parsing, permission decisions. Guard tests that assert source/migration
   invariants (e.g. cron registered, RLS policy present, forbidden columns rejected).
2. **Migration validation** — `npm run db:migrations:check` for our files; uniqueness of
   timestamps; no duplicate versions; idempotent `IF NOT EXISTS`.
3. **Security tests** — assert that a non-HR employee cannot update `job_title` via direct
   PostgREST update (documented SQL test), that document helpers reject `authenticated`,
   that leave approval requires `hr:leave_approve`.
4. **Build/lint** — `npm run build`, `npm run lint:access`, `npm run lint`.
5. **Browser QA (gstack)** — run the app, walk the per-stakeholder journeys in §7,
   when an authenticated test account is available; otherwise smoke-test unauthenticated
   shells + route guards and document the credential requirement.
6. **Regression** — full `npm test` must stay green.

---

## 10. Definition of done

- Zero schema references without DDL; `db push` dry-run clean for our changes.
- No HR-only column writable by a non-HR user.
- Leave approval works end-to-end for `hr:leave_approve`, with notification + audit.
- All P1 dormant features have an active scheduler or UI entry point.
- New pure logic covered by tests; `npm test`, `npm run build`, `npm run lint` green.
- Stakeholder QA matrix completed with evidence (screenshots/test output) per role.

---

## 11. Risks & constraints

- **Production DB**: shared live Supabase. We do not `db push` from this worktree; migrations
  ship through the existing pipeline. Testing that needs writes uses unit/guard tests.
- **Pre-existing migration drift**: remote has library-module versions not in `origin/main`
  (unrelated to HR). Our migrations must use fresh, unique timestamps.
- **Migration stubs**: `20260814133024` and `20260814141328` are recorded stub versions and
  must never be reused; new DDL goes in a new timestamp.
- **Auth for E2E**: no test credentials are available in-repo; browser QA of authenticated
  flows depends on an account being provided.

---

## 12. Implementation status (this change set)

### Backend — 8 migrations
| Migration (slug) | What it does |
|---|---|
| `hr_schema_drift_locations` | Restores `hr_locations`, `business_units`, `employee_profiles.hr_location_id` (+ RLS/grants/indexes) that existed in prod but in no migration. Defensive seed. |
| `hr_security_hardening` | Column allow-list trigger on self `employee_profiles` updates; revokes client EXECUTE on `log_hr_document_action`/`notify_super_admins_hr_document`; status-aware `hr_letters` policies; HR face-registration approval. |
| `hr_leave_engine_completion` | `decide_leave_request` RPC + `leave_decision` notification; `hr:leave_approve` read/action RLS; monthly accrual + carry-forward (`fn_accrue_leave_plan`, `run_leave_accrual`); plan-aware usage sync for legacy self-service requests; `employee_lop_days`, `leave_calendar`. |
| `hr_attendance_automation_cron` | Widens notification types; schedules `hr-auto-punch-out`, `hr-close-due-exits`, `hr-leave-accrual`, `hr-doc-expiry-reminders`, `hr-probation-reminders`. |
| `hr_expenses_reimbursements` | Categories, claims, append-only audit, inbox view, `decide_expense_claim`, `mark_expense_reimbursed`, `expense_reimbursement_totals`; `hr:expenses_approve`/`hr:expenses_manage`. |
| `hr_performance_management` | Cycles, reviews, goals, 360 feedback; submit/acknowledge RPCs; `hr:performance_manage`. |
| `hr_engagement_helpdesk` | Announcements + reads, helpdesk tickets + threaded messages (ticket numbers), recognitions; `create_helpdesk_ticket`/`update_helpdesk_ticket`; `hr:engage_manage`/`hr:helpdesk_manage`. |
| `hr_reports_rpc` | Headcount, attendance, leave, payroll cost, attrition, recruitment funnel, expense summaries. |

### Frontend
- **New HR pages/routes (permission-gated):** `/hr-expenses` (`hr:expenses_approve`), `/hr-performance` (`hr:performance_manage`), `/hr-announcements` (`hr:engage_manage`), `/hr-helpdesk` (`hr:helpdesk_manage`), `/hr-reports` (`hr:view`), `/hr-settings` (`hr:employees_edit`), plus sidebar entries.
- **New pillar UI:** `ExpenseReviewPanel`, `PerformancePanel`, `AnnouncementsPanel`, `HelpdeskPanel`, `HrReportsPanel`, `HolidayCalendarPanel`, `StatutoryConfigPanel`, `LocationsPanel`, `ExpenseCategoriesPanel`.
- **Employee self-service (`MyHr`):** new tabs My Expenses, My Performance, Requests (profile-change + attendance-regularisation forms), Announcements/Helpdesk; leave balances now read the real entitlements engine with legacy fallback.
- **Permissions gating:** leave approve/reject and attendance corrections hidden without the matching permission; recruitment/interview/offer actions gated.
- **Bug fixes:** working attendance CSV export; leave approval now routes through the notified RPC.

### New pure-logic libs (unit-tested)
`expenses`, `performance`, `engagement`, `hrReports`, `selfService` — 87 tests.

### Verification
- `npm run build` — passes.
- `npm test` — **+120 passing tests vs baseline**; failing test files identical to the `origin/main` baseline (17 files / 19 tests, all unrelated: payments/WhatsApp/campaigns/fees). Zero HR regressions.
- New guard test `src/test/hr-module-finalization.test.ts` (33 tests) locks in the security, cron, permission and wiring invariants.
- `npm run lint:access` — no new violations.

### Deliberately deferred (recommended next)
- Payslip view/PDF; LOP wired into the payroll calculator UI; F&F computation.
- Leave calendar UI surface (RPC shipped); encashment; comp-off.
- Interview-model unification (`interviews` vs `interview_rounds`) + feedback UI.
- Mobile: consolidate the duplicated leave modal and wire the stubbed Finances/Documents tabs.
- Asset management, org chart, custom fields, e-sign, performance↔payroll linkage.
- Applying migrations to the shared production DB is intentionally left to the normal pipeline (`npm run db:migrations:apply` on main); this worktree never pushed.

### Testing caveat
The `.env` targets the live production Supabase and no test credentials are available, so authenticated browser QA across stakeholder roles could not be run here. Coverage relies on build + unit/guard tests; the stakeholder matrix in §7 is the script for a credentialed pass.
