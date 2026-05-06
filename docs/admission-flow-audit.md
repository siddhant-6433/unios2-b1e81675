# Admission Flow Audit

_Written 2026-05-04, after a single session that surfaced 17 distinct issues across the admission journey._

## Why this doc exists

Tonight we hit a long sequence of small bugs in the admission funnel. Each one was tactical to fix, but the pattern is what matters: the system grew fast, and the defaults — silent fire-and-forget edge calls, free-text fields where dropdowns belong, deletes-on-failure that erase audit history, gates that check the wrong fields — kept biting different users in slightly different ways.

This audit is a structured pass over the admission flow as a system, not a feature. It catalogues every weak point we hit (and a few we didn't trip over yet), groups them by category, and proposes a remediation plan in priority order. The goal: stop firefighting, start hardening.

## The seven-stage admission journey

Authoritative state lives in different tables for each stage. The stages should advance only via explicit triggers; tonight we saw multiple cases where they drift.

| # | Stage | Authoritative state | Transition fired by |
|---|-------|---------------------|---------------------|
| 1 | **Submitted** | `applications.status != 'draft'` | Applicant clicks "Submit" in apply portal |
| 2 | **Fee paid** | `lead_payments` row with `type='application_fee' AND status='confirmed'` (or `applications.payment_status='paid'` legacy) | Gateway success callback or reconciliation cron |
| 3 | **Docs reviewed** | every `application_doc_reviews` row has `status IN ('verified','rejected')` | Admin clicks Verify/Reject per doc |
| 4 | **Approved** | `applications.status='approved'`, `applications.approved_at` set | Admin clicks Approve in `AdminApplicationView` |
| 5 | **Offer issued** | `offer_letters` row with `approval_status='approved' AND letter_url IS NOT NULL` | Admin issues offer + `generate-offer-letter` succeeds |
| 6 | **Token paid → PAN** | `leads.pre_admission_no` set | `lead_payments` trigger when token threshold met |
| 7 | **Admitted → AN** | `leads.admission_no` set | `lead_payments` trigger when 25% threshold met |

Lateral state (`leads.stage`) shadows the application-side state. This duplication is one of the root causes of the "why is this CTA disabled?" confusion.

---

## Findings, by category

### A. Backend robustness

#### A1. Schema drift not caught at build time
**What:** `generate-offer-letter` queried `courses.duration` after the column was renamed to `courses.duration_years`. The function compiled, deployed, ran — and silently 500'd on every offer letter generation.

**Why it bites:** The frontend invokes this function with `.catch(() => {})` (fire-and-forget), so the failure was invisible. `letter_url` stayed null on every offer; the applicant dashboard hid the offer button (because of A2 + B3 below); nobody knew until a user complained.

**Fix:** Generate Supabase types regularly (`supabase gen types typescript`) and check them into the repo. Add a CI step that fails when the generated types diverge from the committed copy. Edge functions importing from `Database` types catch column renames at build time.

**Effort:** ~30 min one-time setup, then permanent.

---

#### A2. Fire-and-forget edge function calls swallow errors
**What:** Three different call sites invoked `generate-offer-letter` with `.catch(() => {})`. Same pattern in older versions of the AI-call queue.

**Why it bites:** When the function fails, no toast, no log, no alert — just a missing `letter_url`. The applicant sees no offer; the admin sees the modal showing "issued" status. Nobody knows the PDF wasn't generated.

**Fix:** Replace fire-and-forget with the poll-and-confirm pattern we shipped tonight in `OfferLetterDialog.regeneratePdf` — call the function, poll the row for the expected side-effect (up to N seconds), surface a toast either way. Or move to a queue + cron pattern (already used by `ai_call_queue` and now the new `wa_classification_queue`).

**Effort:** Audit all `supabase.functions.invoke(...).catch(() => {})` sites and convert. ~3-4h.

---

#### A3. Default `verify_jwt = true` on public endpoints
**What:** `redeem-apply-link` is hit by anonymous applicants opening a magic link. The Supabase Edge gateway returns 401 `UNAUTHORIZED_LEGACY_JWT` when the browser carries a stale session JWT — _before_ the function even runs. The applicant sees the cryptic "Edge Function returned a non-2xx status code".

**Fix:** Audit every function in `supabase/config.toml`. Public-by-design endpoints (anything called without a Supabase session) need `verify_jwt = false`. We added it for `redeem-apply-link` tonight; the same logic applies to any future "apply portal calls without auth" endpoint.

**Effort:** 15 min audit + redeploy each affected function.

---

#### A4. Initiate-fail deleted audit rows (now fixed)
**What:** ICICI `lead_payments` row was deleted on initiate-fail. After 30 failed attempts in UAT, our DB had _zero_ icici rows — so we couldn't tell if the integration was even being exercised.

**Fix shipped tonight:** Mark `status='failed'` instead of delete; write the bank's response code/desc to `notes`. Apply the same pattern to Easebuzz / Cashfree / Razorpay if/when added.

---

#### A5. No reconciliation crons for stuck states
**What:** When the user closes the bank popup before ICICI fires the success callback, `lead_payments.status` is stuck at `'pending'` forever. Same risk for any external-callback flow: WhatsApp delivery status, email open events, document upload completions.

**Fix shipped tonight:** `fn_reconcile_icici_pending` cron + `icici-payment` action `reconcile-pending`. Apply the same pattern to:
- **Token-fee payments** (same gateway, same risk)
- **WhatsApp template delivery confirmations** (some `whatsapp_messages` rows stay at `status='sent'` forever even though the user opted out)
- **`generate-offer-letter` retries** when the call dispatched but never updated the row

**Effort per cron:** ~1h each.

---

#### A6. Storage upserts need cache-busting on the read side
**What:** Supabase storage upserts overwrite the file at the same URL path. Browsers (especially Chrome's PDF viewer) cache the old bytes aggressively. We hit this with offer letter regeneration — server had v2, browser kept showing v1.

**Fix shipped tonight:** Iframe `key` bump forces React to remount, plus the upload sets `cache-control: no-cache`. _Don't_ use `?v=<timestamp>` in the URL — Chrome's PDF viewer refuses inline render of `application/pdf` URLs with query strings unless `Content-Disposition: inline` is also set.

**Lesson:** Any time we upsert a file that's displayed in an iframe, document the cache-busting strategy in the code comment, because this trap is non-obvious.

---

### B. State machine / lifecycle

#### B1. Status fields drift between tables
**What:** A single application's state lives across:
- `applications.status` (draft → submitted → approved/rejected)
- `applications.payment_status` (pending → paid)
- `leads.stage` (new_lead → application_in_progress → … → admitted)
- `offer_letters.approval_status` (pending_principal → approved/rejected)
- `offer_letters.status` (issued → accepted/rejected)
- `lead_payments.status` (pending → confirmed/failed)

Triggers _try_ to keep these in sync, but several edge cases drift: `applications.status='approved'` without `leads.stage='application_approved'`, etc. Each drift produces a different "why is X disabled?" question.

**Fix:** Pick `applications` as the system of record for application-level state. Generate `leads.stage` as a derived view. Every state-changing edge function writes to one place; triggers project to others. Add an integrity-check cron that reports drifts.

**Effort:** Significant — ~2 days. But it eliminates a whole class of bugs.

---

#### B2. Lifecycle stages computed in two places
**What:** `src/lib/admissionLifecycle.ts` exists as the single source of truth for stage computation. But the `applications` page list also derives a similar shape independently (`MiniLifecycleStepper`), and a few places (`Applications.tsx` filter, `ApplyPortal` dashboard gating) re-derive stage state inline.

**Fix:** Audit every place that asks "what stage is this application/lead in?" and route through `computeStages()` from the lib. Tonight we shipped two _new_ inline checks (`hasApprovedOffer` vs `hasLetterPdf` in `ApplyPortal.tsx`); those should also flow through the central computation.

**Effort:** ~3h refactor.

---

#### B3. Gates check derived fields instead of authoritative state
**What:** The applicant's "Pay Token Fee" button gated on `offer.letter_url` (a derived artifact) instead of `offer.approval_status === 'approved'` (authoritative state). When PDF generation failed (A1), the button vanished — even though the offer was real and the applicant could have paid.

**Fix shipped tonight:** Split `hasApprovedOffer` (authoritative) vs `hasLetterPdf` (display).

**Generalised lesson:** Every CTA's enabled/disabled predicate should be expressed as a function of authoritative state, not derived artifacts. Code-review checklist item.

---

#### B4. Triggers don't fire reliably for back-population
**What:** `leads.application_id` is supposed to be written by a trigger when an application is inserted. We saw test/legacy applications where `lead.application_id` was null even though the application clearly existed. Result: the offer-letter PDF's top-right badge was missing.

**Fix shipped tonight:** Query `applications` directly by `lead_id` and use that as the source of truth for the offer letter generator. Apply the same defensive pattern wherever code reads denormalised fields.

**Long-term:** Add an integrity check that flags `applications WHERE lead_id IS NOT NULL AND lead.application_id IS NULL` as drift.

---

### C. Operator UX (admin)

#### C1. Disabled CTAs don't explain why
**What:** "Issue Offer Letter" disabled? Could be: wrong role, no lead linked, application not approved, rejected docs, … the user has no way to know.

**Fix:** Every disabled action button must surface its reason via `title=` tooltip OR inline below the button. We started this in `AdminApplicationView` for the offer button. Generalise to:
- All bulk actions on lists (Applications, LeadBuckets, etc.)
- All payment / send-offer / approve buttons
- The seven-stage stepper's "next action" hint should always tell the operator the unblocking step, never just "blocked".

**Effort:** Low per button, but spread across ~25 sites. ~4h sweep.

---

#### C2. Misleading button labels
**What:** Eye icon on Applications row labeled "Open Student Application View" — but actually opens `AdminApplicationView` (the staff page). Fixed tonight. Worth a quick label audit on every action icon.

**Fix shipped:** Replaced eye icon with prominent "Process" button for actionable statuses; small `ClipboardCheck` icon for others, with corrected tooltip.

---

#### C3. Generic "fill all required fields" without naming them
**What:** Personal details form said "Please fill all required fields marked with *" — without listing which fields were empty. User stared at a (cropped-screenshot) page and thought everything was filled.

**Fix shipped tonight:** Banner now lists exact missing field labels; every empty required field's label turns red.

**Generalise:** Apply the same pattern to ParentDetails, AcademicDetails, every multi-field form. We have ~6 sections — all benefit from named-field validation.

**Effort:** ~30 min per section.

---

#### C4. PDF preview at bottom of list page
**What:** Application list expand-row showed the PDF preview at the bottom of the page. User had to scroll. Fixed tonight by inlining as a `<tr>` directly under the clicked row.

---

#### C5. No PDF preview before issuing
**What:** Old offer letter modal showed status + Generate-PDF button but no inline preview. Operator had no way to verify the letter before sending. Fixed tonight by widening modal to 6xl with a side-by-side iframe preview pane.

---

#### C6. Visual quality of generated PDFs varies
**What:** The application form PDF is well-styled (letterhead, navy section bars, KV grid, page numbers). The offer letter PDF was a basic pdf-lib draw. Fixed tonight by porting the application-form's helper system (`Ctx`, `COLORS`, `newPage`, `drawSection`, `drawKVGrid`) to the offer letter generator.

**Generalise:** All institutional documents (application form, offer letter, fee receipt, transfer certificate, marksheet, ID card, joining letter) should share one styling library. Extract `Ctx + helpers` into `supabase/functions/_shared/pdfStyle.ts` and import from each generator.

**Effort:** ~1 day refactor; pays back the next time we add a new doc type.

---

### D. Applicant UX (apply portal)

#### D1. Three login paths with conflicting failure modes
**What:** OTP login, magic link, and Google OAuth all converge on the same apply portal but produce subtly different errors. Tonight's magic-link gateway 401 surfaced as "Edge Function returned a non-2xx status code", which the applicant could only interpret as "broken site".

**Fix shipped:** Magic-link `verify_jwt = false`; ApplyPortal switched from `supabase.functions.invoke` to raw `fetch` so it can read the actual server response body.

**Generalise:** Audit every `functions.invoke` call in user-facing paths. The SDK consumes the response body when constructing errors, so the human-readable message gets lost. Use `fetch` directly for any user-visible error.

**Effort:** 1-2h audit.

---

#### D2. Fresh app shown instead of submitted app
**What:** Applicant logged in via magic link, expected to see their submitted application. Instead saw a "Welcome / Select your course" fresh-application screen.

**Root cause:** `ApplyPortal` filtered apps by `flags.includes('portal:nimt')` flag. Test/legacy applications inserted without that flag were filtered out; the dashboard fell through to "no existing app → start new".

**Fix shipped tonight:** Permissive filter that includes apps without _any_ `portal:*` flag (legacy fallback) + self-heal that tags them on first view.

**Generalise:** Anywhere we filter on "must have flag X" — consider whether legacy data exists that doesn't carry the flag. Permissive-with-self-heal is the right default.

---

#### D3. Free-text fields where dropdowns belong
**What:** State and Country were free-text inputs. Applicants entered "Test", "U.P.", "Up", "Uttar Pradesh", "Uttarpradesh" — same state, five values, useless for analytics.

**Fix shipped tonight:** State + Country dropdowns in PersonalDetails (28 states + 8 UTs from `indianStates.ts`; full country list from `countries.ts`).

**Generalise:** Audit all free-text fields in ParentDetails, AcademicDetails, school details. Standardise wherever a finite set exists (boards, universities, occupations, religions).

---

#### D4. No "what next" notification after offer
**What:** When an offer is issued the applicant has to log in to the portal to see it. No SMS, no WhatsApp template, no email auto-send (currently the email is _generated_ but not always _sent_).

**Fix:** On `offer_letters.letter_url` set, fire a WhatsApp template + email with the link. We have the templates (`whatsapp-send` function exists); just wire the trigger.

**Effort:** ~2h.

---

### E. Data quality

#### E1. State + country free-text → dropdowns (now fixed for personal-details)
See D3.

#### E2. `course_selections` JSON has names but no IDs
**What:** Applications store `course_selections` as `[{course_name, campus_name, program_category}]` — no `course_id` or `campus_id`. So when the offer letter generator needs the course ID, it has to read from `leads.course_id` (a denormalised field that's not always set on legacy rows).

**Fix:** Migration — backfill `course_id`/`campus_id` into each `course_selections` element by matching name. Update the apply portal's submission to write IDs going forward.

**Effort:** ~3h (migration + frontend update + a careful match script for legacy rows where names don't match exactly).

#### E3. Portal flag missing on legacy apps (now self-healing)
See D2.

#### E4. `lead.application_id` sometimes null (now defensively handled)
See B4.

---

### F. Third-party integrations

#### F1. ICICI no reconciliation (now fixed)
See A5. Same risk applies to Easebuzz and Cashfree if/when they hit production scale.

#### F2. ICICI no UX timer (now fixed)
See PaymentSection.tsx changes tonight.

#### F3. Plivo number split env vars not propagated
**What:** Cloud Run service had only the legacy `PLIVO_PHONE_NUMBER` set. The three new DIDs (`PLIVO_AI_PHONE_NUMBER`, `PLIVO_AI_BACKUP_PHONE_NUMBER`, `PLIVO_DIALER_PHONE_NUMBER`) were referenced in code but unset in production. Result: every inbound call missed the AI fast-path and rang the counsellor.

**Fix shipped earlier:** `gcloud run services update --update-env-vars=…`.

**Generalise:** When a code change introduces new env vars on a Cloud Run service, the deploy step must set them. Without a CI-driven config pipeline, this is easy to forget. Move env vars to Secret Manager refs (`--set-secrets=KEY=secret:latest`) so values can be rotated without redeploy and missing keys fail loudly at startup.

#### F4. Gemini Live model swap was code-only, not deploy
**What:** Memory note from 2026-04-19 said "use `gemini-2.5-flash-native-audio-latest`, drop `gemini-3.1-flash-live-preview`". The swap never landed in code — the live-preview model was still being used in production. Result: every AI call connected, returned `setupComplete`, then closed with WS 1008 the moment Gemini was asked to generate audio.

**Generalise:** Memory notes that flag a code change should always have a paired commit-tracking item. We'd benefit from a "TODO from memory" surface that compares memory's "this should be true" notes against the current code state.

---

### G. Testing / CI

#### G1. No E2E test for the seven-stage flow
**What:** Most of tonight's bugs would have been caught by a single Playwright test that runs:
1. Apply portal → fill personal/parent/academic/docs → submit
2. Pay application fee (mocked gateway)
3. Admin → review docs → approve
4. Issue offer → verify PDF generation succeeds
5. Token-fee payment (mocked)
6. Verify PAN issued
7. Verify AN issued at 25% threshold

**Fix:** Write it. ~1 day. Then run on every PR.

#### G2. No alerts on partial states
**What:** A row with `offer.approval_status='approved' AND letter_url IS NULL` for >5 minutes is _always_ a bug. Same for `application_doc_reviews` rows that never get adjudicated, `lead_payments` stuck pending >24h, `leads` with `pre_admission_no` set but `admission_no` null after 30 days.

**Fix:** Daily cron that scans for these patterns, posts to a Slack/WhatsApp ops channel.

**Effort:** ~3h to wire each detector + channel.

#### G3. Generated types not refreshed in CI
See A1.

---

## Remediation plan (prioritised)

### P0 — fix this week (root-cause prevention)

1. **E2E Playwright test for the seven-stage admission flow.** Single test, runs on PR. Catches >70% of what we hit tonight.
2. **Generated-types CI check.** Catches schema-drift bugs like A1 before they ship.
3. **Audit every `functions.invoke(...).catch(() => {})`** call site. Convert to poll-and-confirm OR queue+cron. Currently easy to grep — _will_ regress without code review pressure.
4. **Audit every `verify_jwt`** in `supabase/config.toml`. Public endpoints must be `false`.
5. **Centralise stage computation.** Every "is this stage done?" predicate flows through `computeStages` in `src/lib/admissionLifecycle.ts`.

### P1 — fix this month (operational maturity)

6. **Reconciliation crons** for token-fee payments, WhatsApp delivery status, offer-letter PDF generation. Same pattern as ICICI.
7. **Disabled-CTA audit.** Every disabled button surfaces its reason. Code-review checklist item.
8. **Named-field validation** across every multi-field form (ParentDetails, AcademicDetails, etc.) — same pattern as PersonalDetails tonight.
9. **State + country dropdowns** in remaining sections (parent address, school address).
10. **Backfill `course_id`/`campus_id`** into `course_selections` JSON. Update apply portal to write IDs going forward.
11. **Daily integrity-drift report.** Scan for `letter_url IS NULL after approval`, stale pendings, missing AN/PAN, etc. Post to ops channel.
12. **Auto-send offer letter via WhatsApp + email** the moment `letter_url` lands. Currently passive (applicant has to log in).

### P2 — architectural shifts (next quarter)

13. **One state of record per concept.** `applications.status` is the application's state; `leads.stage` becomes a generated view. Removes the entire B1 drift class.
14. **Shared PDF styling library.** Extract `Ctx + helpers` from application-form into `_shared/pdfStyle.ts`. All institutional documents look the same.
15. **Migrate cache-control + iframe rendering pattern** into a shared `<PdfPreview>` component so we never re-derive cache-busting strategy per use site.
16. **Realtime instead of polling** for post-payment status updates and inbox unread counts.

---

## What landed tonight (delta)

Each line is a concrete fix shipped during this session.

### Backend / data
- ✅ `redeem-apply-link` — `verify_jwt = false` (public endpoint)
- ✅ `generate-offer-letter` — column rename fix (`duration` → `duration_years`); full restyle to mirror application form (green pill, navy bars, KV grid, signature row, page numbers); `applicationId` resolved from applications table when `lead.application_id` is null
- ✅ `auto_categorize_lead_from_message` — already had hybrid regex + (new) LLM classifier via `wa-classify-message` queue; webhook defers AI reply behind classification for ambiguous messages
- ✅ `wa_classification_queue` migration + cron; `enqueue_wa_classification` RPC; `wa_message_might_be_non_admission` helper
- ✅ `job_applicants` table + `job_applicants_inbox` view + sync trigger + AI-call-queue role guard
- ✅ `icici-payment` — initiate-fail no longer deletes audit row; new `reconcile-pending` action; `fn_reconcile_icici_pending` cron
- ✅ Voice-agent — `gemini-2.5-flash-native-audio-latest` model swap; `languageCode` removed from speechConfig; deployed to Cloud Run
- ✅ Cloud Run env vars — `PLIVO_AI_PHONE_NUMBER` + backup + dialer DIDs propagated

### Frontend
- ✅ Apply portal — magic-link redeem via raw fetch (real error surfaces); permissive portal-flag filter with self-heal; State + Country dropdowns; named-field validation banner with red labels; offer-letter button + token-fee CTA split (no longer gated on `letter_url`)
- ✅ Applications list — eye icon → Process button; expanded details inline below clicked row; Fragment-keyed rows
- ✅ AdminApplicationView — back button history fallback; OfferLetterDialog wired with role/lead gating; SectionErrorBoundary wraps lifecycle stepper; refresh() try/catch + retry UI
- ✅ OfferLetterDialog — full redesign with side-by-side PDF preview pane (max-w-6xl, 90vh); Regenerate button with poll-and-confirm; clickable offer cards switch the preview
- ✅ HR Job Applicants page + sidebar nav + dashboard stat
- ✅ PaymentSection — popup elapsed-time card + Cancel & Retry button after 90s
- ✅ Cloud Dialer — duplicate `PhoneMissed` import fixed (was bundle-blocking)

### Memory / docs
- ✅ `feedback_gemini_live_audio.md` — updated with model-swap landing date + correction that `languageCode` is model-specific (rejected by native-audio model, required by half-cascade)
- ✅ This audit doc

---

## What did NOT change tonight

These are open items from the audit. None block live operations, all worth doing.

- E2E Playwright suite (G1)
- Generated-types CI check (G3)
- Centralised stage computation (B2)
- Daily integrity-drift report (G2)
- Token-fee reconciliation cron (A5)
- Auto-send offer-letter notification (D4)
- `course_selections` IDs backfill (E2)
- Shared PDF styling library (C6)
- Disabled-CTA reason audit (C1)
- Free-text → dropdown for parent/school address fields (D3)

---

## Next steps

When you're ready to start P0:
1. Pick one item from the P0 list.
2. Open it as a discrete task — it'll likely turn into a 1-3 day mini-project, not an afternoon.
3. Ship it with the tests/alerts that would have caught the bug it prevents.

The goal isn't to do everything in this audit. It's to stop the rate of new bugs by hardening the patterns that produced them.
