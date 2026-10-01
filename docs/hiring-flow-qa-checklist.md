# Hiring Flow — End-to-End QA Checklist

## ✅ Automated run result — 2026-09-25 (production, 24/24 passed)

The flow was executed against the deployed project via a scripted API walk
(`/tmp/e2e-hiring.mjs`) using a **temporary** super-admin user + one test
opening/applicant, **all cleaned up afterwards** (verified 0 leftover rows).

Passed: create/publish opening → **public careers list** → **anon apply-job**
(resume → R2) → applicant row (`careers_portal`) → enriched inbox view →
`move_job_applicant` → `assign_job_applicant` → **AI resume parse** (Gemini,
fit score 40 + summary) → **atomic `schedule_job_interview`** → applicant →
**`interview-meet`** (Meet link + Calendar template) → `record_interview_feedback`
→ **`generate_hr_offer_letter`** → applicant `offered` + acceptance token →
**anon `get_offer_by_token`** → **anon `redeem_offer_acceptance`** → onboarding
`offer_accepted` → **`hire_job_applicant`** → `hired` → **`hr_recruitment_metrics`**
(16 rows) → referral insert + `job_referral_summary`.

Three real bugs were found and fixed during the run (all deployed):
1. `DO $$` cron blocks with inner `$$` strings → SQLSTATE 42601 (fixed with `$sched$`).
2. `CREATE OR REPLACE VIEW` reordering inbox columns → 42P16 (fixed: drop+create).
3. `has_permission` was granted only to `authenticated`, so every edge function
   using the service client returned **Forbidden** (fixed: grant to `service_role`).

Remaining manual/visual pass (needs a connected browser + an HR login): the
in-page rendering of the screens below.

## ✅ WhatsApp hiring templates — tested 2026-09-26

The four hiring templates are **APPROVED on the WABA** and were sent from
`hiring-notify` for real:

| Stage | Template | Result |
|---|---|---|
| acknowledgement | `hiring_application_received` | sent |
| interview_invite | `hiring_interview_invite` | sent |
| offer | `hiring_offer_extended` | sent |
| regret | `hiring_not_proceeding` | sent |

**Two findings:**
1. **HR sender blocked by Meta.** Sending from the HR number
   (`970526789470416`) returns `#200 You do not have the necessary permissions
   to send messages on behalf of this WhatsApp Business Account`, while the
   **default** sender delivers. `hiring-notify` therefore prefers the HR sender
   and **falls back to the default** (recorded as `via default` in
   `hiring_notifications`). Fix the HR number's WABA/token link in Meta and it
   will use the HR number automatically.
2. **Comms suppression.** The test number was blocked by
   `phone_comms_suppressed` because an archived student's lead holds that phone
   (the same root cause as the earlier "login disabled" message). The send path
   correctly refused while suppressed; un-archiving (temporarily) allowed the
   four sends, then the record was restored.


Use this after the migrations are applied and the edge functions deployed
(see `hr-deploy-notes.md`). It walks the funnel **from the careers portal to
every end**, and lists what each stakeholder should see.

> Automated wiring check: `npx vitest run src/test/hiring-e2e-flow.test.ts`
> (16 assertions across every hop). A live run needs a deployed database —
> there is no local Supabase in this environment (no Docker) and the browser
> session is not connected.

---

## 0. Prep

```bash
npm run db:migrations:apply                                  # on main
supabase functions deploy apply-job hiring-notify resume-parse interview-meet
```

Env: `GEMINI_API_KEY` (resume parse), `R2_*` (resumes), `RESEND_API_KEY` (emails),
and optionally `GOOGLE_SERVICE_ACCOUNT_JSON` + `GOOGLE_CALENDAR_ID` (real Meet).
Add the careers origin to Supabase Auth redirect URLs if using Google sign-in.

---

## 1. Candidate — careers portal → application

| # | Step | Expected |
|---|---|---|
| 1 | Open `/careers` (logged out) | Open roles list; search works; no auth prompt |
| 2 | Open a role `/careers/<slug>` | Role detail; apply form |
| 3 | Submit without name/email/phone | Blocked with a clear error |
| 4 | Submit with a **resume** | Success screen; a `job_applicants` row is created with `applied_via='careers_portal'`, `status='new'`, resume stored in R2 |
| 5 | Submit the **same phone** again for the same role | `already_applied` (no duplicate) |
| 6 | Try a closed/expired opening URL | "No longer accepting applications" |

## 2. HR / recruiter — `/hr-job-applicants`

| # | Step | Expected |
|---|---|---|
| 7 | The applicant from §1 appears (All / New) | Name, role, source `careers_portal`, opening title |
| 8 | Open the detail | Resume link + **Parse with AI** |
| 9 | **Parse with AI** | AI screen panel: fit score, summary, skills/gaps; `ai_rank_score` set |
| 10 | Toggle **AI rank** | List sorts by fit score |
| 11 | **Move** to Reviewing → Shortlisted (single + bulk multi-select) | Status updates; activity logged |
| 12 | **Assign** a recruiter | Assignee shows |
| 13 | Switch **List / Board** | Board columns match statuses |

## 3. Interviewer — scheduling + Meet + feedback

| # | Step | Expected |
|---|---|---|
| 14 | Schedule an interview (mode/location/venue/interviewer/panel/duration) | Interview created **atomically**; applicant → `interview` |
| 15 | Click **Meet & Calendar** | With Google creds: a real Meet link + Calendar invite; without: opens a Google Calendar "add event" page + a Meet link; interview stores the links |
| 16 | Send **Interview invite** email | Candidate receives it; `hiring_notifications` records it; re-send is a no-op (`already_sent`) |
| 17 | **Record feedback** (rating + recommendation + notes) | Interview → `completed`; activity logged |

## 4. Offer + candidate acceptance

| # | Step | Expected |
|---|---|---|
| 18 | **Generate offer letter** | Letter `pending_approval`; applicant → **offered** |
| 19 | Super admin approves it in `/inbox` | Letter `approved`; `acceptance_token` present |
| 20 | Open `/careers/offer/<token>` (logged out) | Offer shown; Accept / Decline |
| 21 | **Accept** | Recorded; a candidate `employee_profiles` row moves to `onboarding_stage='offer_accepted'` |
| 22 | Re-open the same link | "already responded" |
| 23 | (Separate applicant) **Decline** | Applicant → `withdrawn` |

## 5. HR — hire + onboarding `/hr-onboarding`

| # | Step | Expected |
|---|---|---|
| 24 | **Convert to employee** (joining date, CTC, title, dept, campus) | `hire_job_applicant` creates/updates the employee; applicant → `hired` |
| 25 | Onboarding pipeline | Candidate appears; **Advance** through documents → offer_generated → … → employee |
| 26 | Employee directory / profile | New employee visible; "Reports to" resolves once set on `/hr-team` |

## 6. Analytics, referrals, employee

| # | Step | Expected |
|---|---|---|
| 27 | `/hr-recruitment` | Pipeline funnel by source, offers, acceptance %, avg days-to-offer/hire; CSV export |
| 28 | `/hr-referrals` (as any employee) | Raise a referral; see your own list |
| 29 | `/hr-referrals` (as HR) | See all referrals, referral leaderboard, update status → hired |
| 30 | `/hr-job-openings` | Create → publish → close a requisition; public URL works |

## 7. Mobile recruiter

| # | Step | Expected |
|---|---|---|
| 31 | Me tab → **Recruitment** | Applicant list; status filter; search |
| 32 | Tap the chevron on a row | Move-stage picker (`move_job_applicant`) |
| 33 | Tap the file icon | Opens the résumé |

---

## Regression guard (already green)

```bash
npm test                         # full suite (baseline failures unrelated)
npx vitest run src/test/hiring-e2e-flow.test.ts src/test/hr-hiring-phase-*.test.ts
cd mobile && npx tsc --noEmit    # mobile type-check
```

## Known limitations to verify around

- **Google Meet** is a **service-account** integration. Without
  `GOOGLE_SERVICE_ACCOUNT_JSON`/`GOOGLE_CALENDAR_ID` the flow falls back to a
  Calendar template + manual Meet link — confirm which mode production uses.
- **Resume PDFs** are sent to Gemini inline; very large PDFs may hit token limits
  (verify with a 5–10 page CV).
- **WhatsApp hiring templates** are not registered yet, so candidate comms are
  **email only** today.
- **Job-board syndication** (Naukri) is **link-out only** (no API).
