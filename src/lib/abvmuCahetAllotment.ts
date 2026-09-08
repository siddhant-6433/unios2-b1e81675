import { isBptOrBmritCourseName } from "@/lib/cahet";

/** Application flags recording the BPT/BMRIT CAHET counselling allotment answer. */
export const ABVMU_CAHET_ALLOTTED_YES = "abvmu_cahet_allotted:yes";
export const ABVMU_CAHET_ALLOTTED_NO = "abvmu_cahet_allotted:no";

export const ABVMU_CAHET_ALLOTMENT_FLAGS = [ABVMU_CAHET_ALLOTTED_YES, ABVMU_CAHET_ALLOTTED_NO] as const;

export const ABVMU_CHALLAN_FALLBACK_AMOUNT = 40_000;

export function hasAbvmuCahetAllotmentAnswer(flags: string[] | null | undefined): boolean {
  return (flags || []).some((flag) =>
    flag === ABVMU_CAHET_ALLOTTED_YES || flag === ABVMU_CAHET_ALLOTTED_NO,
  );
}

export function isAbvmuCahetAllotted(flags: string[] | null | undefined): boolean {
  return (flags || []).includes(ABVMU_CAHET_ALLOTTED_YES);
}

export function withAbvmuCahetAllotmentFlag(
  flags: string[] | null | undefined,
  allotted: boolean,
): string[] {
  const next = (flags || []).filter(
    (flag) => flag !== ABVMU_CAHET_ALLOTTED_YES && flag !== ABVMU_CAHET_ALLOTTED_NO,
  );
  next.push(allotted ? ABVMU_CAHET_ALLOTTED_YES : ABVMU_CAHET_ALLOTTED_NO);
  return next;
}

export function applicationHasBptOrBmrit(
  selections: { course_name?: string | null }[] | null | undefined,
): boolean {
  return (selections || []).some((selection) => isBptOrBmritCourseName(selection.course_name));
}

/** True when BPT/BMRIT is selected and the candidate has not yet answered the allotment question. */
export function applicationNeedsAbvmuCahetAllotment(app: {
  course_selections?: { course_name?: string | null }[] | null;
  flags?: string[] | null;
} | null | undefined): boolean {
  if (!app) return false;
  return applicationHasBptOrBmrit(app.course_selections) && !hasAbvmuCahetAllotmentAnswer(app.flags);
}

export function uniformFeeFromMetadata(metadata: Record<string, unknown> | null | undefined): number {
  const value = Number(metadata?.uniform_cost ?? 0);
  return Number.isFinite(value) && value > 0 ? value : 0;
}
