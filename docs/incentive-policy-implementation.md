# Counsellor Incentive Policy — Implementation & Loophole Register

Implements the **NIMT Admission Counsellor Performance, Target & Incentive Policy v2.0** in UniOs.
Every rupee figure, percentage, band, and threshold lives in the `incentive_config` table (single
versioned JSONB row) — management can amend any of them (policy §20) by inserting a new config
version; no code change needed. Calculations snapshot the config version they used.

## How it works

1. **Accrual** — when a lead reaches `admitted` *and* a confirmed qualifying fee payment exists
   (`registration_fee` or `token_fee` by default), the system writes append-only rows to
   `incentive_ledger`: base incentive (course amount × lead-source %), speed bonus, token bonus.
   Every row carries its full calculation breakdown in `calc_inputs`.
2. **Month close** — on the 2nd of each month (03:31 IST), `incentive-month-close-cron` closes the
   previous month: achievement %, eligibility gates, multiplier repricing, volume bonus, team bonus,
   and one `incentive_statement` per counsellor in *pending approval*.
3. **Approval** — Admission Head / Accounts review statements at `/incentive-approvals`: line items,
   eligibility gates, open anti-gaming flags (approval is blocked until flags are resolved), HR
   inputs (attendance, disciplinary), then Approve → Mark paid → Payroll CSV export.
4. **Counsellor view** — the Counsellor Performance dashboard shows a live projected payout,
   achievement progress toward the next multiplier band, volume-slab proximity, and a red/green
   eligibility checklist — plus a Morning Brief of hot leads, SLA breaches, follow-ups, visits,
   and leads closest to money.
5. **Clawback** — refunding a qualifying payment within 45 days recovers the **entire** incentive
   for that admission (policy §15) as negative ledger rows netted against the next statement.
   Token refunds recover the token bonus at any time (policy §9).

## Codified interpretations (need management sign-off)

The policy leaves these ambiguous; the system enforces one specific reading:

| # | Policy gap | Codified rule | Where |
|---|-----------|---------------|-------|
| 1 | §8 "overall monthly performance" is undefined (admissions? revenue?) | **Achievement % = min(admission %, revenue %)** — you cannot ride cheap-course volume to a 2× multiplier while missing revenue | `fn_incentive_month_close` |
| 2 | §8 says "all eligible incentives shall be multiplied", but the §19 examples multiply only the base | **Multiplier applies to the base course incentive only**; speed, token, volume, team bonuses are flat (matches all four worked examples) | `fn_incentive_month_close` |
| 3 | §9 tokens "paid weekly" | Tokens **accrue immediately but pay with the monthly statement** — weekly cash-out of ₹100s invites token farming and complicates recovery | payment trigger |
| 4 | §6 B.Sc Nursing ₹0 incentive — do nursing admissions count toward targets? | **Yes** — nursing admissions count toward admission & revenue targets (they feed the multiplier), they just pay ₹0 base | accrual trigger |
| 5 | §11 volume bonus slabs | **Reduced slabs used by default** (₹1,000 / 2,500 / 5,000 / 10,000 / 20,000) per the recommendation appended to the policy — the multiplier already pays for over-achievement. Original slabs are one config edit away | `incentive_config.volume_slabs` |
| 6 | §15 "prescribed minimum qualifying fee (as notified)" | Qualifying fee = any confirmed `registration_fee`/`token_fee` payment ≥ `min_qualifying_fee` (currently ₹0 — **management should set this**) | `incentive_config` |
| 7 | §12 campus target undefined | Campus target = **sum of member counsellors' individual targets**; a counsellor's campus = campus of the majority of their admitted leads that month | `fn_incentive_month_close` |
| 8 | §3C KPI definitions unmeasurable as written | Fresh call = first outbound call ever to a lead; meaningful call = ≥120s **and** disposition recorded; CRM compliance = % of the day's calls with a disposition; daily composite = mean of (actual/target, capped at 1) across the 8 KPIs; monthly KPI compliance = average of daily composites | `fn_snapshot_daily_kpis` |
| 9 | §3 monthly attribution | An admission counts in the month its **qualifying fee is realized** (payment date — system data, not counsellor-entered) | accrual trigger |
| 10 | Lead-source → incentive-class mapping | referral → self-generated (100%) · education fair, school outreach → institutional (90%) · all portal/ads/web/dialer sources → digital (80%) · walk-in → 50% · consultant → flat ₹500 | `incentive_config.source_classes` |

## Loophole register — what the system blocks or flags

| Loophole | Exploit | Enforcement |
|----------|---------|-------------|
| Source inflation | Log a walk-in/digital lead as self-generated for 100% vs 50–80% | `leads.source` is **immutable** after creation except by super admin / admission head; every change audited in `lead_source_audit` |
| Duplicate self-gen claims | Register an existing student's number as "my referral" | Self-gen lead whose phone matches any existing lead → automatic flag on the approval screen |
| Speed-bonus farming | Hold a hot lead outside CRM, register + admit same day → ₹500 + 100% rate | Self-gen leads must exist in CRM ≥48h before the qualifying fee to earn any speed bonus; self-gen conversions under 72h are flagged for review |
| Month-end sandbagging | Hold closable admissions to stack a higher multiplier next month | Attribution by fee-realization date; counsellors with >40% of admissions in the last 3 days of the month are flagged |
| Token farming | Push cheap tokens on non-serious students for ₹100 each | One token bonus per lead ever; consultant leads earn none; refunds claw it back |
| Clawback escape | Resign or wait out the window | 45-day `hold_until` on every accrual; negative balances roll into the next statement; flags on every refund clawback |
| Consultant reclassification | Book a consultant admission as self-generated | Source immutability + consultant class pays flat ₹500 with no speed/token bonus |
| Eligibility disputes | "My attendance was fine" at payout time | Attendance % and disciplinary flags are entered by HR per counsellor-month in the approval UI, audited, and shown as explicit pass/fail gates on the statement |

## Known policy-design issues (surfaced, not silently changed)

- **Daily KPI targets vs reality**: on live data (2026-07-11), counsellor daily composites scored
  ~6–7% against the policy's original targets (80 fresh calls, 100 follow-ups/day). **Resolved in
  config v2 (2026-07-12)**: targets lowered to 60 fresh calls / 40 follow-up calls, and the KPI
  gate is now **advisory** — the score appears on every statement and the dashboard, but never
  blocks eligibility (counsellors handling campus visits legitimately make fewer calls). Part of
  the remaining gap is data capture — WhatsApp activity logging appears incomplete.
- **Visit time tracking (v2)**: `campus_visits` now records `checked_in_at` → `checked_out_at`.
  Forgotten checkouts are closed three ways: opening another lead's page redirects the counsellor
  to the Visit Center until their visitor is checked out; logging a new outbound call on the lead
  auto-checks-out the open visit; and a 6 PM IST pg_cron sweep (`visit-auto-checkout`) closes
  anything left. Walk-ins can be recorded as `walk_in` or `direct_walkin` (different incentive %).

- **The 70% cliff**: below 70% pays ₹0. A counsellor at 60% on the 25th has zero incentive to close
  anything this month — the rational move is to sandbag. The clustering flag catches the symptom;
  consider a smoother curve (e.g. 50% payout at 60–70%) in the next policy revision.
- **B.Sc Nursing dead zone**: ₹0 incentive means nursing leads risk neglect. They count toward
  targets here, but monitor nursing-lead conversion rates per counsellor.
- **10-minute lead response SLA** (§3C) is aggressive; the morning brief and existing SLA
  penalties surface breaches, but the eligibility gate uses the daily composite, not this alone.

## Operations

- **Set designations**: insert rows into `counsellor_designations` (junior/counsellor/senior/TL,
  optional per-counsellor target overrides). Counsellors without a row default to the
  `counsellor` targets (12 admissions / ₹10,00,000).
- **Enter HR inputs**: attendance % + disciplinary flag per counsellor-month on the approval page,
  then hit **Recompute**. Statements with pending gates show a dashed circle.
- **Amend the policy**: `INSERT INTO incentive_config (version, config) VALUES (2, <new jsonb>)`.
- **Recompute a month**: approval page → Recompute (safe: approved/paid statements are never touched).
- **Nightly KPI snapshots** run inside the existing `counsellor-score-cron` (10pm IST).
