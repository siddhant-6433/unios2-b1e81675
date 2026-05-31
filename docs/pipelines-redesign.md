# Pipelines Redesign — Spine + Engagement Tracks

**Status:** Reviewed (plan-eng-review, 2026-05-29). Ready to implement PR1.
**Supersedes:** the original demote-`visit_scheduled` proposal — the review reversed that (see D2).

## Locked decisions (plan-eng-review 2026-05-29)

| # | Decision |
|---|---|
| D1/D13 | Ship **incrementally, all in this effort**: PR1 = Visit track + scoring-farm fix, PR2 = cohort attribution, PR3 = Call funnel. (Mechanical stage-map sweep folds into PR1's follow-up or PR2.) |
| D2 | **Keep `visit_scheduled` unchanged.** Do NOT demote it. The Visit funnel reads `campus_visits` (which already records every visit independent of `leads.stage`). The risky spine/queue/scoring rework is dropped. |
| D3/D10/D13 | **PR1 is presence-based** (Visit funnel = "visited leads, and where they are now", counts). **Cohort attribution** ("applied *after* the visit") follows in **PR2**; the **Call funnel** in **PR3**. Because cohort follows, `leads.applied_at`/`admitted_at` are built **authoritatively in PR1** (correct backfill — see §4.3) so PR2 can rely on them. Caveat: cohort % stays statistically meaningless until admission volume grows (~1 admit today), even though the machinery is correct. |
| D4 | Add `lead_followups.visit_id` FK. |
| D5 | Canonical stage map in the **existing** `src/lib/leadStages.ts`. Migrate funnel-critical files in PR1; mechanical sweep of the rest in PR2. |
| D6 | **Retire `lead_followups.type='visit'`** entirely; post-visit follow-ups become `type='call'` + `visit_id`; backfill the 25 legacy rows. |
| D7 | Tests: pgTAP (`supabase test db`) for triggers/views/backfills + Vitest unit (mapping exhaustiveness, bucket rollup) + component smoke. |
| D8 | `applied_at`/`admitted_at` maintained by a **BEFORE UPDATE trigger guarded** with `WHEN (OLD.stage IS DISTINCT FROM NEW.stage)`, first-write-wins. |
| D11 | Visit funnel counts **LEADS**, deduped to each lead's **latest** `campus_visits` state (reschedule → Scheduled, repeat visits don't double-count). |
| D12 | Keep **two** documented stage sets: `FUNNEL_LEAKAGE_STAGES` (funnel exclusion) ≠ `TERMINAL_FOLLOWUP_STAGES` (followup suppression). They answer different questions. |

---

## 1. Problem

`leads.stage` is a single linear enum — a lead occupies one stage. Visits were modelled as a stage (`visit_scheduled`), so visit history and funnel position fought over one field.

**Proof (live, 2026-05-29):** 145 leads have ever had a campus visit; only 31 are still `visit_scheduled`. The other 114 are scattered (27 `counsellor_call`, 25 `not_interested`, 12 `dnc`, 10 `rejected`…). The stage funnel can't see they visited.

**Key realization (review):** `campus_visits` *already* preserves every visit permanently, independent of `leads.stage`. So we don't move visits out of the spine — we read the Visit funnel from `campus_visits` and leave the stage model alone.

## 2. Model

One canonical spine (existing `leads.stage`) + engagement tracks read from their own tables.

```
                          ┌─ CALL track  → call_logs / ai_call_records   (funnel = PR3)
LEAD ──(spine: stage)──┤
                          └─ VISIT track → campus_visits                 (funnel = PR1, cohort = PR2)

Spine funnel (all leads):  New → Contacted → Applied → Approved → Offered → Admitted   (+ leakage chip)
Visit funnel (PR1, leads): Scheduled → Confirmed → Completed → Visit Followup → Applied → Admitted
                           (+ No-show/Cancelled leakage)   [presence counts, lead deduped to latest visit]
```

A lead can appear in both the Spine and the Visit funnel — by design; they answer different questions. The Spine says "where is this lead in the admission lifecycle"; the Visit funnel says "of leads who visited, how far did they get." A `visit_scheduled` lead whose visit was cancelled correctly shows in Spine=Contacted and Visit=No-show — no contradiction, two different axes.

## 3. Canonical stage map (all 21 enum values — nothing orphaned)

Lives in `src/lib/leadStages.ts` (extend the existing module; do not collide with `admissionLifecycle.ts`, which is the application/document lifecycle).

### Spine buckets — `STAGE_TO_BUCKET`

| Spine bucket | Stage values |
|---|---|
| **New** | `new_lead` |
| **Contacted** | `ai_called`, `counsellor_call`, `priority_interested`, `visit_scheduled` |
| **Applied** | `application_in_progress`, `application_submitted`, `application_fee_paid` |
| **Approved** | `application_approved`, `interview` |
| **Offered** | `offer_sent`, `token_paid`, `pre_admitted`, `waitlisted` |
| **Admitted** | `admitted` |
| **Leakage** (chip) | `not_interested`, `dnc`, `rejected`, `ineligible`, `deferred`, `cold` |

Fixes vs current code: `waitlisted` + `cold` were unmapped and silently dropped; `interview` moves from "hot" to "Approved".

### Two documented stage sets (D12)

```
FUNNEL_LEAKAGE_STAGES   = not_interested, dnc, rejected, ineligible, deferred, cold   // hidden from funnel
TERMINAL_FOLLOWUP_STAGES (existing TERMINAL_LEAD_STAGES, kept as-is) // stop following up
```
They differ on purpose: `deferred` is funnel-leakage but NOT followup-terminal (revisit next session); `cold` is both. Document the why inline.

### Visit funnel boxes (D11 — lead-centric, latest `campus_visits` per lead)

| Box | Rule |
|---|---|
| Scheduled | latest visit `status='scheduled'` |
| Confirmed | latest `status='confirmed'` |
| Completed | latest `status='completed'` (incl. `visit_type='walk_in'`) |
| Visit Followup | latest visit completed AND an open `lead_followups` with that `visit_id` (status='pending') |
| Applied | visited lead currently at a stage in {Applied bucket}+ (presence) |
| Admitted | visited lead currently `admitted` (presence) |
| Leakage: No-show / Cancelled | latest `status IN ('no_show','cancelled')` |

## 4. Schema changes (PR1)

1. `lead_followups.visit_id uuid NULL REFERENCES campus_visits(id) ON DELETE SET NULL`; index `(visit_id)`.
2. Retire `type='visit'`: remove the dialog pill; post-visit completion writes `type='call'` + `visit_id`; backfill the 25 legacy `type='visit'` rows → `type='call'` + `visit_id` where a matching `campus_visit` exists.
3. `leads.applied_at timestamptz NULL`, `leads.admitted_at timestamptz NULL` (**load-bearing** — PR2 cohort attribution depends on them).
   - **Trigger** `trg_stamp_lead_lifecycle` BEFORE UPDATE ON leads `WHEN (OLD.stage IS DISTINCT FROM NEW.stage)`: set `applied_at = now()` when entering an Applied-bucket stage and `applied_at IS NULL`; set `admitted_at = now()` when entering `admitted` and `admitted_at IS NULL`. First-write-wins.
   - **Backfill (authoritative):** `applied_at` = earliest timestamp across (`lead_activities` where `type IN ('stage_change','conversion')` and `new_stage` in the Applied bucket) **and** the linked `applications.created_at` (fallback for the DB-side stage transitions that write no activity row). `admitted_at` = earliest across `lead_activities` `type IN ('stage_change','conversion')` with `new_stage='admitted'` **and** the conversion event. *(Outside-voice findings 1+2: the admit event is logged as `type='conversion'` not `'stage_change'`, and several stage transitions are DB-side with no activity row — a stage_change-only backfill is silently wrong. pgTAP must assert the known-admitted lead gets a non-null `admitted_at`.)*
4. **No** new `campus_visits` columns for v1 (no `outcome`/`converted_at` — those were for cohort attribution, deferred).
5. **No** stage-enum changes. **No** RLS changes.

## 5. Dashboard

- `LeadPipeline` (Spine) — fed by canonical `STAGE_TO_BUCKET` (fixes the silent drops).
- New `VisitPipeline` — same visual pattern, fed by a lead-centric `visit_funnel` source (latest visit state per lead + presence counts for Applied/Admitted). Renders as the second pipeline, visually branching from "Leads".
- Funnel counts: single grouped query per funnel (replacing `Admissions.tsx:750` N serial HEAD counts). Prefer ONE combined RPC returning spine + visit counts to avoid extra dashboard round-trips (outside-voice finding 5). Supporting indexes: `campus_visits(lead_id, status, visit_date)`.

## 6. PR plan (all in this effort — D13)

- **PR1 — Visit track + scoring fix**: canonical `leadStages.ts` + migrate funnel-critical files (LeadPipeline, Admissions, Dashboard, callDisposition, CounsellorDashboard); `visit_id` FK + retire `type='visit'` + backfill 25; `applied_at`/`admitted_at` + guarded trigger + authoritative backfill; lead-centric `visit_funnel` (presence) + `VisitPipeline`; **fix the `visit_scheduled` scoring-farm exploit** (PendingFollowups reschedule re-sets stage → 5pt trigger fires repeatedly); pgTAP + unit + component tests.
- **PR2 — Cohort attribution**: event-time conversion (applied/admitted *after* visit) on top of PR1's `applied_at`/`admitted_at`; handle applied-then-visited, repeat visits, admitted-before-visit; combined funnel RPC. + mechanical stage-map sweep of remaining ~19 files.
- **PR3 — Call funnel**: `call_funnel` source + `CallPipeline` (Dialed → Connected → Interested → Applied → Admitted) off `call_logs`/`ai_call_records` + the `source` column.

## 7. NOT in scope

- Demoting/removing `visit_scheduled` (D2 — unnecessary; ~52-file blast radius avoided).
- Dialer-queue RPC changes (confirmed not dependent on `visit_scheduled`).
- `campus_visits.outcome`/`converted_at` columns — only add in PR2 if cohort attribution needs them beyond `applied_at`/`admitted_at`.
- Any RLS change (separate, explicitly-approved if ever).

(Cohort attribution, the Call funnel, and the scoring-farm fix were considered for deferral but pulled into this effort per D13 — see §6.)

## 8. What already exists (reuse, don't rebuild)

- `campus_visits` + views `visits_needing_confirmation`, `visits_unclosed_today`, `post_visit_pending_followups` + `visit-reminders` edge fn — the Visit track's data + ops layer.
- `LeadPipeline.tsx` — the funnel UI pattern (VisitPipeline reuses it).
- `src/lib/leadStages.ts` — already holds `TERMINAL_LEAD_STAGES`; extend it (don't create a new module).
- `src/lib/callDisposition.ts` — `STAGE_ORDER`/`STAGE_LABELS`/`shouldAutoAdvance` (move into leadStages.ts).
- `call_logs`/`ai_call_records` + `source` column (shipped this session) — the Call track's data layer, ready for the deferred Call funnel.
- `fn_visit_no_show_followup` trigger — already creates `type='call'` post-visit followups; extend to set `visit_id`.

## 9. Failure modes (PR1 codepaths)

| Codepath | Failure | Test? | Error handling | Visible? |
|---|---|---|---|---|
| `STAGE_TO_BUCKET` missing a future enum value | new stage silently dropped from funnel | **YES — exhaustiveness unit test (mandated)** | n/a | would be silent → test is the guard |
| `applied_at`/`admitted_at` backfill gaps | undercounted timestamps | pgTAP asserts known admitted lead gets a value | best-effort + fallback | non-load-bearing, acceptable |
| `visit_id` not set on one of 3 write paths | "Visit Followup" box undercounts | pgTAP per write path | n/a | silent → pgTAP is the guard |
| `visit_funnel` not deduping repeat visits | lead double-counted | pgTAP with a 2-visit lead | n/a | visible wrong totals → pgTAP guard |
| legacy `type='visit'` backfill mismatches a lead with no campus_visit | row left as orphan | pgTAP counts pre/post | leave `type='call'` w/ null visit_id | acceptable |

No critical gaps (no path that is silent AND untested AND unhandled).

## 10. Parallelization

PR1 is mostly one workstream (leadStages.ts is a dependency of LeadPipeline + migrations + VisitPipeline). Lanes:
- **Lane A (foundation, blocks B/C):** `leadStages.ts` canonical map + exhaustiveness test.
- **Lane B (DB, independent of UI):** `visit_id` FK, `applied_at`/`admitted_at` + trigger + backfills, `type='visit'` retirement migration, `visit_funnel` source + pgTAP.
- **Lane C (UI, depends on A):** LeadPipeline migration + VisitPipeline + dashboard wiring + component tests.
Execution: A first → then B and C in parallel. B and C touch disjoint modules (supabase/ vs src/components, src/pages) — low conflict risk.

## 11. Visit funnel UI (plan-design-review 2026-05-29)

Design completeness 5/10 → 9/10. No DESIGN.md — calibrated against `LeadPipeline.tsx` (the de-facto funnel pattern). VisitPipeline clones LeadPipeline structurally; these decisions cover what the clone leaves unspecified.

| # | Decision |
|---|---|
| Dz1 (IA) | Group the two **funnels** as a "Pipelines" zone — Spine row + Visit row, the Visit row sublabeled to show it branches from Leads — placed **above** the existing `VisitActionCenter`. Funnels = "where things stand"; Action Center = "what to do now". Resolves the 3-stacked-widget redundancy. |
| Dz2 (States) | **Empty state:** when there are no campus visits, replace the funnel with a one-line "No campus visits scheduled yet" + a "Schedule a visit" affordance (not an all-zeros funnel, which reads as broken). **No-show/cancelled:** a rose "N no-show" header chip mirroring LeadPipeline's "dropped" chip — not a funnel box. |
| Dz3 (Emotional arc) | **Suppress the between-box conversion %** when the prior box count is below a threshold (~20); show counts only (muted "—"). Auto-enable %s once volume crosses the threshold. Prevents "14% admitted (=1 lead)" from reading as failure. Matches the eng review's presence-based / defer-cohort stance. |
| Dz4 (Color) | Visit funnel uses a **single-hue ramp** (teal/emerald light→dark) so it reads as one coherent track, visually distinct from the spine's multi-hue stage colors. No-show chip stays rose. Tokens defined in the shared module, not per-box. |
| Dz5 (Responsive/a11y) | Inherit LeadPipeline's `overflow-x-auto` + button semantics (keyboard/focus already correct). Add: (1) count text ≥4.5:1 contrast across the teal ramp's light end; (2) a subtle right-edge scroll affordance on mobile so the funnel doesn't look truncated. |
| Dz6 (Click behavior) | **Click-to-filter in PR1.** Visit-funnel boxes are clickable like LeadPipeline's; clicking a box (e.g. "Completed") filters the lead list to leads in that visit state. Requires adding a **visit-state filter dimension** to the lead list (leads joined to their latest `campus_visits` state) — this is now PR1 scope. Mirror LeadPipeline's `onStageClick` + `leadStagesForBucket` with a `leadsForVisitState` equivalent. |

**NOT in scope (design):** mobile-specific vertical funnel redesign (inherit horizontal scroll); a formal DESIGN.md (recommend `/design-consultation` separately).

**What already exists (design):** `LeadPipeline.tsx` (clone target), `VisitActionCenter.tsx` (operational visit cards — kept, distinct role), the rose "dropped" chip pattern, the conversion-% chevron pattern.

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | — | not run |
| Codex Review | `/codex review` | Independent 2nd opinion | 0 | — | not run (diff-stage) |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 1 | CLEAR (PLAN) | 8 issues, 0 critical gaps |
| Design Review | `/plan-design-review` | UI/UX gaps | 1 | CLEAR (FULL) | score 5/10 → 9/10, 6 decisions |
| DX Review | `/plan-devex-review` | Developer experience | 0 | — | n/a (internal CRM) |

- **OUTSIDE VOICE:** Claude subagent (Codex rate-limited). Found 3 verified landmines the review missed — admitted_at backfill used type='conversion' not stage_change; applied_at undercounts on DB-side transitions; leadStages.ts already exists with terminal/leakage set conflict. All folded into the plan.
- **DESIGN:** 7 passes, no mockups (VisitPipeline clones LeadPipeline). Key calls: group both funnels above VisitActionCenter (Dz1), empty state + no-show chip (Dz2), suppress conversion % at low volume (Dz3), single-hue teal ramp (Dz4), click-to-filter + visit-state filter dimension in PR1 (Dz6).
- **UNRESOLVED:** 0.
- **VERDICT:** ENG + DESIGN CLEARED — ready to implement PR1.
