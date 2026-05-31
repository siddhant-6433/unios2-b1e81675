import type { Database } from "@/integrations/supabase/types";

export type LeadStage = Database["public"]["Enums"]["lead_stage"];

// ============================================================================
// Canonical lead-stage model — single source of truth.
//
// Previously the stage label/order/bucket maps were hand-copied into ~24
// files, which is how `waitlisted` and `cold` silently fell out of the funnel
// (each copy drifted). This module is the one place stages are defined.
//
// NOTE: the generated TS enum (Database["public"]["Enums"]["lead_stage"]) lags
// the live DB — it is missing `application_approved` and `priority_interested`.
// ALL_LEAD_STAGES below is the authoritative list of the 21 live values; the
// exhaustiveness unit test asserts every one maps to a bucket or leakage.
// ============================================================================

/** Every live `leads.stage` enum value (pg_enum order). Authoritative — do not
 *  rely on the generated TS enum, which lags the DB. */
export const ALL_LEAD_STAGES = [
  "new_lead",
  "application_in_progress",
  "application_submitted",
  "application_fee_paid",
  "ai_called",
  "counsellor_call",
  "visit_scheduled",
  "interview",
  "offer_sent",
  "token_paid",
  "pre_admitted",
  "admitted",
  "waitlisted",
  "cold",
  "rejected",
  "not_interested",
  "ineligible",
  "dnc",
  "deferred",
  "application_approved",
  "priority_interested",
] as const;

// ── Spine funnel buckets ────────────────────────────────────────────────────

export type LeadFunnelStage =
  | "untouched" | "contacted" | "hot" | "applied"
  | "approved" | "offered" | "admitted";

export const LEAD_FUNNEL_ORDER: LeadFunnelStage[] = [
  "untouched", "contacted", "hot", "applied", "approved", "offered", "admitted",
];

// Maps each lead_stage to its funnel bucket. Stages NOT present here are
// leakage (see FUNNEL_LEAKAGE_STAGES) and surface in the "dropped" chip.
//
// `priority_interested` / `visit_scheduled` sit in Contacted (engaged,
// pre-application); the component promotes a "hot" sub-state separately.
// `interview` is Approved (post-application admission gate), not Hot.
// `waitlisted` is Offered (decision-pending near offer).
export const STAGE_TO_BUCKET: Record<string, LeadFunnelStage> = {
  new_lead:                "untouched",
  ai_called:               "contacted",
  counsellor_call:         "contacted",
  priority_interested:     "hot",
  visit_scheduled:         "hot",
  interview:               "approved",
  application_in_progress: "applied",
  application_submitted:   "applied",
  application_fee_paid:    "applied",
  application_approved:    "approved",
  offer_sent:              "offered",
  token_paid:              "offered",
  pre_admitted:            "offered",
  waitlisted:              "offered",
  admitted:                "admitted",
};

// Funnel-leakage = stages hidden from the active funnel and shown in the
// "dropped" chip. DISTINCT from TERMINAL_LEAD_STAGES below: this answers
// "should this lead clutter the pipeline chart?" — `deferred` (revisit next
// session) is funnel-leakage but NOT followup-terminal.
export const FUNNEL_LEAKAGE_STAGES = [
  "not_interested", "dnc", "rejected", "ineligible", "deferred", "cold",
] as const;
export type FunnelLeakageStage = typeof FUNNEL_LEAKAGE_STAGES[number];

export const FUNNEL_LEAKAGE_LABEL: Record<FunnelLeakageStage, string> = {
  not_interested: "not interested",
  dnc:            "DNC",
  rejected:       "rejected",
  ineligible:     "ineligible",
  deferred:       "deferred",
  cold:           "cold",
};

/** Raw lead_stage values for a funnel bucket — converts a funnel click into a
 *  stage filter (used by the dashboard). */
export function leadStagesForBucket(bucket: LeadFunnelStage | "leakage"): string[] {
  if (bucket === "leakage") return [...FUNNEL_LEAKAGE_STAGES];
  return Object.entries(STAGE_TO_BUCKET)
    .filter(([, b]) => b === bucket)
    .map(([s]) => s);
}

// ── Terminal-for-followup (≠ funnel leakage) ────────────────────────────────
// Stages where outreach should stop. Used by PendingFollowups to suppress
// rows whose lead has exited the funnel. `cold` is included (went silent);
// `deferred` is NOT (we revisit it next session). This is a DIFFERENT question
// than FUNNEL_LEAKAGE_STAGES — keep them separate by design.
export const TERMINAL_LEAD_STAGES: LeadStage[] = [
  "not_interested",
  "dnc",
  "rejected",
  "ineligible",
  "cold",
];

export const isTerminalLeadStage = (s: string | null | undefined): boolean =>
  !!s && (TERMINAL_LEAD_STAGES as string[]).includes(s);

// ── Stage progression (linear) — labels + auto-advance ──────────────────────
// Moved here from callDisposition.ts (which now re-exports for compat).

export const STAGE_LABELS: Record<string, string> = {
  new_lead: "New Lead",
  application_in_progress: "Application In Progress",
  application_submitted: "Application Submitted",
  ai_called: "AI Called",
  counsellor_call: "In Follow Up",
  visit_scheduled: "Visit Scheduled",
  interview: "Interview",
  offer_sent: "Offer Sent",
  token_paid: "Token Paid",
  pre_admitted: "Pre-Admitted",
  admitted: "Admitted",
  not_interested: "Not Interested",
  ineligible: "Ineligible",
  dnc: "Do Not Contact",
  deferred: "Deferred (Next Session)",
  rejected: "Rejected",
  cold: "Cold",
  waitlisted: "Waitlisted",
  application_fee_paid: "Application Fee Paid",
  application_approved: "Application Approved",
  priority_interested: "Priority Interested",
};

/** Linear progression order for forward-only auto-advance. */
export const STAGE_ORDER = [
  "new_lead", "application_in_progress", "application_submitted",
  "ai_called", "counsellor_call", "visit_scheduled", "interview",
  "offer_sent", "token_paid", "pre_admitted", "admitted",
];

const stageIndex = (s: string) => {
  const i = STAGE_ORDER.indexOf(s);
  return i === -1 ? -1 : i;
};

/** Forward-only auto-advance — never rolls a lead backwards or out of a
 *  terminal state. */
export const shouldAutoAdvance = (currentStage: string, newStage: string) => {
  if (["rejected", "not_interested", "ineligible", "dnc", "deferred"].includes(currentStage)) return false;
  return stageIndex(newStage) > stageIndex(currentStage);
};

// ── Visit funnel (lead-centric, latest campus_visit state per lead) ─────────
// Single-hue teal/emerald ramp so the visit track reads as visually distinct
// from the spine's multi-hue stage colors (design review Dz4).

export type VisitFunnelStage =
  | "scheduled" | "confirmed" | "completed"
  | "visit_followup" | "applied" | "admitted";

export const VISIT_FUNNEL_ORDER: VisitFunnelStage[] = [
  "scheduled", "confirmed", "completed", "visit_followup", "applied", "admitted",
];

export const VISIT_FUNNEL_LABEL: Record<VisitFunnelStage, string> = {
  scheduled:      "Scheduled",
  confirmed:      "Confirmed",
  completed:      "Completed",
  visit_followup: "Visit Follow-up",
  applied:        "Applied",
  admitted:       "Admitted",
};

/** campus_visits.status values that count as funnel leakage (the "dropped"
 *  chip on the visit funnel). */
export const VISIT_LEAKAGE_STATUSES = ["no_show", "cancelled"] as const;

/** Below this denominator the visit funnel hides between-box conversion %
 *  (a single lead would swing it wildly) — design review Dz3. */
export const VISIT_CONV_MIN_DENOMINATOR = 20;
