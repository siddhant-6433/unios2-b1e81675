# Hiring Flow — Research, Audit & Plan

Status: **Research + plan for approval**
Scope: the recruitment / ATS journey — requisition → sourcing → screening → interview → offer → hire → onboarding — as it exists in UniOS today, benchmarked against Keka Hire and PeopleStrong.

> **Research caveat:** live web access was unavailable in this environment (fetch/search blocked), so the Keka Hire and PeopleStrong capability model below is from domain knowledge, not a fresh read of their sites. Capability names should be spot-checked against the vendors before we lock scope.

---

## 1. Executive summary

UniOS has a **strong database foundation and one internal screen**, but the hiring journey has **no front door** (no careers portal in-repo, no way to create a job opening) and **no back end of the funnel** (no resume handling, no candidate comms actually send, no hire→employee conversion, no onboarding pipeline).

Concretely, today:
- **Intake is WhatsApp-only and works well** — inbound messages classified as `job_applicant` auto-create a `job_applicants` row, and the HR team reviews them in `/hr-job-applicants`.
- **Recruitment is largely read-only surface**: the DB has `job_openings`, `interviews`, offer-letter generation, `hire_job_applicant`, and a funnel report — but several are **dormant** (no UI/RPC calls).
- **Dead/duplicated pieces**: `hiring_notifications`, `hiring_venues`, and 4 seeded `hiring-*` email templates are **never used**; the `offered` and `withdrawn` statuses are orphaned; `resume_url` is never shown; notes are write-only.
- **No public careers portal exists in this repo** even though the schema (`job_openings` anon read, `applied_via='careers_portal'`, careers dedupe key) was clearly designed for one.

The plan below closes the loop first (P0: make the existing objects actually usable), then builds the front door and depth.

---

## 2. Method

- Read every recruitment migration, RPC, trigger, view, RLS policy, and the one UI screen + its wiring (deep code inventory).
- Benchmarked against a Keka-Hire / PeopleStrong capability model (§3).
- Cross-checked "schema designed for X" against "code that produces/consumes X" to find dormant objects.

---

## 3. Reference model — Keka Hire vs PeopleStrong

| Capability | Keka Hire | PeopleStrong (Recruit) | Typical ATS |
|---|---|---|---|
| Requisition / manpower planning + approval workflow | ✓ | ✓ (budget/plan-linked) | ✓ |
| Branded careers site + job pages | ✓ | ✓ | ✓ |
| Job-board syndication (Naukri, LinkedIn, Indeed) | ✓ | ✓ | ✓ |
| Sourcing channels + **employee referrals** | ✓ | ✓ | ✓ |
| Resume parsing / bulk upload / **talent pool** | ✓ | ✓ (AI) | ✓ |
| **AI screening / matching / ranking** | ✓ | ✓ (Jombay, chatbot screening) | partial |
| Configurable **pipeline stages** + kanban | ✓ | ✓ | ✓ |
| Candidate profiles, timeline, **duplicate detection** | ✓ | ✓ | ✓ |
| **Assessments** (cognitive/functional, proctored) | ✓ | ✓ | ✓ |
| Interview scheduling + **panel** + calendar + **scorecards** | ✓ | ✓ (video interviews) | ✓ |
| Automated **email/WhatsApp** candidate comms + templates | ✓ | ✓ | ✓ |
| **Offer management** + approvals + **e-sign** | ✓ | ✓ | ✓ |
| Offer **acceptance** (candidate portal) | ✓ | ✓ | ✓ |
| **Background verification (BGV)** | ✓ | ✓ | ✓ |
| **Onboarding handoff** (docs, assets, joining) | ✓ | ✓ (pre-joining engagement) | ✓ |
| TA analytics: funnel, **time-to-hire**, source effectiveness, offer-acceptance, recruiter productivity | ✓ | ✓ | ✓ |
| Recruiter **mobile** experience | ✓ | ✓ | partial |
| Compliance (DPDP/GDPR, EEO) | ✓ | ✓ | ✓ |
| Multi-entity / multi-location | ✓ | ✓ | ✓ |

---

## 4. Current state (what's built here)

### 4.1 Data model (all present)
- **`job_openings`** — slug, title, designation/department/campus, description, employment_type, experience range, salary range + `salary_visible`, location, openings_count, `status ∈ draft|open|closed`, `naukri_url`, posted/closes, `created_by`. Public read for `open`, HR manage. *Canonical slug unique index.*
- **`job_applicants`** — lead link (WhatsApp), `source_channel`, phone, name, desired_role, experience_years, `resume_url`, classification (regex/llm/manual/imported/careers_portal) + AI intent/confidence/reasoning, `status ∈ new|reviewing|shortlisted|interview|offered|rejected|hired|withdrawn`, assigned_to, notes, `job_opening_id`, email, `applied_via ∈ careers_portal|naukri|whatsapp|referral|walk_in|other`, cover_note, `stage_changed_at`, `rating`. Dedupe: unique `lead_id`; `(source_phone, job_opening_id)` for careers.
- **`job_applicant_activities`** — append-only timeline (`note`, `stage`, `interview_feedback`).
- **`interviews`** — canonical interview model (single slot): scheduled_at, mode, location, meeting_link, interviewer_id, status, notes, `panel`, `duration_mins`, and feedback (`rating`, `recommend`, `feedback_notes`, `feedback_by/at`). The parallel `interview_rounds`/`interview_feedback` pair was **dropped** (unified, §2 of `hr-module-finalization-plan`).
- **`hiring_notifications`** — send-once guard table for `whatsapp|email`. **Unused.**
- **`job_applicants_inbox`** view (security_invoker) — list fields; **omits `notes`, `rating`, `stage_changed_at`**. **`hiring_venues`** view (campuses + non-campus offices). **Unused.**
- **`hr_letters` / `hr_letter_templates`** — offer letter template (`code='offer'`), approval lifecycle `draft → pending_approval → approved → rejected → issued`, `job_applicant_id` target, append-only audit.
- **`employee_profiles`** candidate/onboarding columns — `onboarding_stage ∈ candidate|documents|offer_generated|offer_accepted|login_created|employee`, offer fields, `job_applicant_id`.
- **`designations`**, `employee_documents.uploaded_source='careers_portal'`.

### 4.2 RPCs / triggers
`hire_job_applicant` (candidate → employee; **unused by any UI**), `record_interview_feedback`, `generate_hr_offer_letter`, `generate_hr_letter`, `approve/reject/issue_hr_document`, `hr_recruitment_funnel` (report), lead→applicant sync trigger (WhatsApp), stage-stamp trigger.

### 4.3 UI / integration
- **`/hr-job-applicants`** — list/filter/search; actions: reviewing / shortlist / reject, edit role+notes, **schedule interview**, **record interview feedback**, **generate offer letter**; shows email, source badges, AI confidence, last WA message. Super-admin **offer approval** happens in `/inbox` (`hr_document_approvals`). Employee **letters** in `LettersPanel`. Recruitment **funnel** tab in Reports.
- **WhatsApp intake**: `wa-classify-message` → `leads.person_role='job_applicant'` → applicant row; `whatsapp-ai-reply` sends `hr_handoff`; HR inbox scope.
- **Permissions**: `hr:recruitment_edit`, `hr:interviews_edit`, `hr:documents_generate`, `hr:view`; roles `hr_executive` (recruiter), `admission_head`/`campus_admin`.
- **No mobile recruitment screens.**

---

## 5. Gap matrix (vs §3)

Legend: ✅ built & wired · 🟠 built but dormant/partial · ❌ absent.

| Capability | Status | Notes |
|---|---|---|
| Requisition + approval | 🟠 | `job_openings` exists, **no admin UI, no approval workflow** |
| Careers site / job pages | ❌ | schema ready (`anon` read, `applied_via`), **no page/route/edge fn in repo** |
| Job-board syndication (Naukri/LinkedIn) | ❌ | `naukri_url` column only |
| Referrals | ❌ | `applied_via='referral'` enum only |
| Resume parsing / upload / talent pool | ❌ | `resume_url` never displayed, no upload path, no pool |
| AI screening / ranking | 🟠 | WhatsApp classifier tags intent; no resume screening/ranking |
| Pipeline stages + kanban | 🟠 | fixed statuses; no configurable stages, no board |
| Duplicate detection | 🟠 | DB dedupe keys exist; no UI surfacing |
| Assessments | ❌ | — |
| Interview scheduling + panel + scorecards | 🟠 | scheduling + feedback exist; **no interviewer/panel assignment, no calendar, no map link, dual-write not atomic** |
| Automated candidate comms (email/WhatsApp) | 🟠 | templates + `hiring_notifications` seeded but **never send**; "Notify" button just opens chat |
| Offer management + approvals | ✅ | generate + super-admin approve/reject/issue |
| e-sign | ❌ | external provider (out of scope so far) |
| Offer acceptance (candidate) | ❌ | `offered` status orphaned; no accept/reject page; `offer_accepted_at` only set by unused RPC |
| BGV | ❌ | — |
| Onboarding handoff | 🟠 | `onboarding_stage` + documents exist; **no pipeline UI**, `hire_job_applicant` unused |
| TA analytics | 🟠 | funnel report only; no time-to-hire, source effectiveness, offer-acceptance, recruiter productivity |
| Recruiter mobile | ❌ | — |
| Compliance (DPDP/EEO) | ❌ | — |
| Multi-entity/location | 🟠 | openings carry campus/department |

---

## 6. Prioritised gap register

### P0 — finish the core loop (make existing objects usable)
1. **Job openings admin UI** (`/hr-job-openings`): create/edit/publish/close, designation/department/campus, employment type, experience, salary visibility, openings count, `naukri_url`, closes_at. This unlocks everything downstream.
2. **Fix the shortlist → offer → hire status path**: `generate_hr_offer_letter` should move the applicant to `offered`; add `withdrawn`; return `notes`/`rating`/`stage_changed_at` in `job_applicants_inbox`; surface `applied_via`, `job_opening_title`, `resume_url`, `assigned_to`.
3. **Resume handling** — upload path + storage bucket + view/download in the applicant dialog.
4. **Working candidate comms** — wire the seeded `hiring-acknowledgement|interview-invite|offer|regret` email templates + `hiring_notifications` send-once, and the WhatsApp hiring templates (replace the empty stub). Replace "Notify on WhatsApp" links with real sends.
5. **Hire → employee conversion UI** — "Convert to employee" calling `hire_job_applicant`, plus an **Onboarding pipeline** screen for `onboarding_stage='candidate'…`.
6. **Atomic interview scheduling RPC** (insert interview + set status + activity in one transaction), interviewer/panel assignment, duration, and venue picker (`hiring_venues`).
7. **Regenerate stale Supabase types** (dropped `interview_rounds`, missing `interviews` feedback columns).

### P1 — the front door and pipeline depth
8. **Public careers portal in-repo**: `/careers` (openings list) + `/careers/:slug` (job page + apply form) → an `apply-job` edge function (anon-safe) that uploads the resume, dedupes, and creates a `job_applicant` (`applied_via='careers_portal'`, `job_opening_id`). Reuses the existing anon read + dedupe key.
9. **Naukri / job-board ingestion** — an ingest function keyed by `naukri_url`/job id (pending API access).
10. **Applicant assignment** (recruiter/hiring manager) + **hiring-manager scoping** (RLS by department/campus).
11. **Configurable pipeline stages** (or per-opening stage sets) + a **kanban board** view with drag-drop.
12. **Candidate profile timeline** rendered from `job_applicant_activities`; @mentions/tags; duplicate warning.
13. **Offer acceptance** — candidate token page (like `apply/offer/:token`) to accept/decline → sets `offered → hired` / `withdrawn`.
14. **Referral program** basics (employee refers → `applied_via='referral'`, referrer credit).

### P2 — depth and analytics
15. **Assessments** integration (vendor) + scorecards per stage.
16. **Video interviews / calendar sync** (Google/Outlook).
17. **BGV** integration.
18. **TA analytics**: time-to-hire, stage TAT, source effectiveness, offer-acceptance rate, recruiter productivity, drop-off; funnel visualisation; CSV export.
19. **Bulk actions / CSV import-export** of applicants; talent pool (re-engage past applicants).
20. **Mobile recruiter screens** (review, move stage, schedule, feedback).

### P3 — advanced / compliance
21. AI resume parsing + ranking; chatbot pre-screening.
22. Compliance (DPDP/EEO consent & retention), audit exports.
23. Multi-entity requisition budgets.

---

## 7. Stakeholders & what "good" means

| Stakeholder | Job to be done | Test lens |
|---|---|---|
| **Candidate** | find the job, apply with resume, get timely updates, accept offer | careers portal + emails/WA + offer page |
| **Recruiter (HR Executive)** | publish openings, source, screen, schedule, move candidates, generate offers | `/hr-job-applicants` + openings UI + board |
| **Hiring manager** | see only their roles, review shortlists, give interview feedback | scoped queue + scorecards |
| **Interviewer / panel** | be assigned, get the invite, submit feedback | interview + feedback |
| **HR admin / super admin** | approve offers, configure stages, permissions | Inbox approvals + settings |
| **Leadership** | funnel, time-to-hire, source ROI | reports |
| **IT / onboarding** | candidate → employee handoff with docs/assets | onboarding pipeline |

---

## 8. Phased roadmap

- **Phase A (P0)** — openings admin UI, status-path fixes, resume upload/view, working comms, hire→employee + onboarding pipeline, atomic interview RPC, types regen.
- **Phase B (P1)** — careers portal + apply edge function, assignment/scoping, pipeline stages + kanban, offer acceptance.
- **Phase C (P2)** — assessments, video/calendar, BGV, analytics, bulk ops, mobile recruiter.
- **Phase D (P3)** — AI parsing/ranking, compliance, budgets.

---

## 9. Testing strategy

- **Unit**: stage machine (allowed transitions incl. `offered`/`withdrawn`), dedupe/normalisation, funnel/TAT maths.
- **Guard tests**: RPCs exist + permissioned, no dual-write path, communications actually send + send-once.
- **RLS tests**: recruiter vs hiring-manager scoping; anon can read `open` openings but cannot read applicants; careers apply goes through the edge function only.
- **E2E (web)**: publish opening → apply (portal) → resume visible → schedule interview → feedback → offer → approve → accept → convert to employee → onboarding.
- **Mobile**: recruiter review + stage move (when built).

---

## 10. Open questions (need decisions before building)

1. **Careers portal location** — build it in this repo (`/careers`) or is it a separate site? (Schema implies a portal exists elsewhere; nothing here produces `applied_via='careers_portal'`.)
2. **Job-board APIs** — do we have **Naukri** (and LinkedIn/Indeed) partner API access for syndication + ingestion? Without it, syndication is manual (`naukri_url` link only).
3. **e-sign** — which provider (Aadhaar eSign / DocuSign / Zoho Sign)? Needed for offer signing.
4. **Assessments / BGV vendors** — PeopleStrong-style assessments and background checks require vendor selection.
5. **Email deliverability** — the hiring templates use `from_email='hr@nimt.ac.in'`; is transactional email (Resend/SES) configured for hiring?
6. **WhatsApp hiring templates** — the `register_hiring_wa_templates` migration is an empty stub; which Meta-approved templates do we have for acknowledgement/interview/offer/regret?
7. **Pipeline stages** — do we standardise one pipeline for all roles, or per-department/per-opening stages?
8. **Hiring-manager scoping** — should hiring managers see only their department/campus requisitions (RLS), or all recruiter-managed applicants?

---

## 11. Recommendation

Do **Phase A (P0) now** — it is mostly wiring existing, already-designed objects and instantly makes the module usable end-to-end (publish a job → review → interview → offer → hire → onboard). Then take Phase B (careers portal + pipeline) once Q1/Q2 are answered, because the front door depends on decisions about portal hosting and job-board API access.
