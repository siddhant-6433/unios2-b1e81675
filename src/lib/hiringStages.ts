// The hiring funnel, defined once.
//
// Do not redefine these in a component. src/components/admissions/LeadPipeline.tsx
// carries the same warning about lead stages for the same reason: five different
// files disagreeing about who counts as a counsellor is how departed staff kept
// getting leads, and a funnel is exactly the kind of thing that gets copied.
//
// job_applicants.status is finer-grained than Keka's funnel — reviewing and
// shortlisted are both "Screening" — so the stage is derived rather than stored.
// That keeps the existing 405 rows valid and avoids a rename across the codebase.

export type ApplicantStatus =
  | "new" | "reviewing" | "shortlisted" | "interview"
  | "offered" | "hired" | "rejected" | "withdrawn";

export type HiringStage =
  | "sourced" | "screening" | "interview" | "preboarding" | "hired" | "archived";

export const STAGE_OF: Record<ApplicantStatus, HiringStage> = {
  new: "sourced",
  reviewing: "screening",
  shortlisted: "screening",
  interview: "interview",
  offered: "preboarding",
  hired: "hired",
  rejected: "archived",
  withdrawn: "archived",
};

export const STAGE_LABEL: Record<HiringStage, string> = {
  sourced: "Sourced",
  screening: "Screening",
  interview: "Interview",
  preboarding: "Preboarding",
  hired: "Hired",
  archived: "Archived",
};

/** The funnel proper. Hired and Archived are outcomes and sit apart from it. */
export const FUNNEL_STAGES: HiringStage[] = ["sourced", "screening", "interview", "preboarding"];
export const OUTCOME_STAGES: HiringStage[] = ["hired", "archived"];
export const ALL_STAGES: HiringStage[] = [...FUNNEL_STAGES, ...OUTCOME_STAGES];

/** The status written when a candidate is moved INTO a stage from the UI. */
export const STATUS_FOR_STAGE: Record<HiringStage, ApplicantStatus> = {
  sourced: "new",
  screening: "reviewing",
  interview: "interview",
  preboarding: "offered",
  hired: "hired",
  archived: "rejected",
};

export function stageOf(status: string | null | undefined): HiringStage {
  return STAGE_OF[(status ?? "new") as ApplicantStatus] ?? "sourced";
}

export interface StageCountable { status: string | null }

/** Every stage present in the result, including the zeroes — a funnel with gaps lies. */
export function stageCounts(rows: StageCountable[]): Record<HiringStage, number> {
  const counts = Object.fromEntries(ALL_STAGES.map((s) => [s, 0])) as Record<HiringStage, number>;
  for (const r of rows) counts[stageOf(r.status)]++;
  return counts;
}

/**
 * Whole days a candidate has sat where they are. Keka shows this because it is the
 * number that reveals a stalled pipeline — 262 days in Sourced is the finding.
 */
export function daysInStage(stageChangedAt: string | null | undefined, now = new Date()): number | null {
  if (!stageChangedAt) return null;
  const then = new Date(stageChangedAt).getTime();
  if (Number.isNaN(then)) return null;
  return Math.max(0, Math.floor((now.getTime() - then) / 86_400_000));
}

/** Forward moves offered on a candidate in this stage, in funnel order. */
export function nextStages(current: HiringStage): HiringStage[] {
  if (current === "hired") return [];
  if (current === "archived") return ["sourced"];
  const i = FUNNEL_STAGES.indexOf(current);
  const forward = i >= 0 ? FUNNEL_STAGES.slice(i + 1) : [];
  return [...forward, "hired", "archived"];
}
