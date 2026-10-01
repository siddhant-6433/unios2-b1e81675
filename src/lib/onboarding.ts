// Onboarding pipeline — pure types and helpers.
//
// An `employee_profiles` row is not always an employee. Rows for people still in
// the hiring funnel carry an `onboarding_stage`, default `'employee'` for the
// people who already work here. The five pre-employment stages (candidate →
// login_created) are the hiring pipeline; `employee` is the terminal handoff to
// the HR module proper.
//
// The stage order is linear and forward-only, so every label, index, badge and
// percentage is derived from ONBOARDING_STAGES instead of being hand-copied into
// the panel. Nothing here touches Supabase — the component owns the I/O, the
// rules that decide what a stage means live here so they can be unit-tested
// without a database.
//
// DB contract (employee_profiles.onboarding_stage CHECK):
//   candidate | documents | offer_generated | offer_accepted | login_created | employee

export type OnboardingStage =
  | "candidate"
  | "documents"
  | "offer_generated"
  | "offer_accepted"
  | "login_created"
  | "employee";

/** Every stage the DB CHECK allows, in linear pipeline order. Authoritative. */
export const ONBOARDING_STAGES: readonly OnboardingStage[] = [
  "candidate",
  "documents",
  "offer_generated",
  "offer_accepted",
  "login_created",
  "employee",
] as const;

const STAGE_LABELS: Record<OnboardingStage, string> = {
  candidate: "Candidate",
  documents: "Documents",
  offer_generated: "Offer Generated",
  offer_accepted: "Offer Accepted",
  login_created: "Login Created",
  employee: "Employee",
};

// Pastel pills, one hue per stage so the column colour and the card badge agree.
const STAGE_BADGES: Record<OnboardingStage, string> = {
  candidate: "bg-pastel-blue text-foreground/80",
  documents: "bg-pastel-yellow text-foreground/80",
  offer_generated: "bg-pastel-purple text-foreground/80",
  offer_accepted: "bg-pastel-green text-foreground/80",
  login_created: "bg-pastel-mint text-foreground/80",
  employee: "bg-muted text-muted-foreground",
};

const FALLBACK_BADGE = "bg-muted text-muted-foreground";

/** The minimal shape every helper needs — full rows are a superset. */
export interface OnboardingStageRow {
  onboarding_stage?: string | null;
}

/** Zero-based position in the pipeline, or -1 for an unrecognised value. */
export function stageIndex(stage: string | null | undefined): number {
  if (!stage) return -1;
  return (ONBOARDING_STAGES as readonly string[]).indexOf(stage);
}

/**
 * The next stage forward, or `null` at the end of the pipeline (and for
 * unrecognised stages, so a caller never advances out of the CHECK).
 */
export function nextStage(stage: string | null | undefined): OnboardingStage | null {
  const i = stageIndex(stage);
  if (i < 0 || i >= ONBOARDING_STAGES.length - 1) return null;
  return ONBOARDING_STAGES[i + 1];
}

/** Human label for a stage; falls back to the raw value for unknown strings. */
export function stageLabel(stage: string | null | undefined): string {
  if (!stage) return "Unknown";
  return STAGE_LABELS[stage as OnboardingStage] ?? stage.replace(/_/g, " ");
}

/** Tailwind classes for the stage pill. Always returns a usable class string. */
export function stageBadge(stage: string | null | undefined): string {
  if (!stage) return FALLBACK_BADGE;
  return STAGE_BADGES[stage as OnboardingStage] ?? FALLBACK_BADGE;
}

/** True when the row is at the very top of the funnel (`candidate`). */
export function isCandidate(row: OnboardingStageRow | null | undefined): boolean {
  return row?.onboarding_stage === "candidate";
}

/**
 * Percentage through the pipeline: candidate = 0, employee = 100. Each of the
 * six stages is 20 points apart. Unknown stages report 0 rather than throwing.
 */
export function progressPct(stage: string | null | undefined): number {
  const i = stageIndex(stage);
  if (i < 0) return 0;
  const last = ONBOARDING_STAGES.length - 1;
  return Math.round((i / last) * 100);
}
