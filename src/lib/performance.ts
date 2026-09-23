// Performance management — pure helpers.
//
// The screens in this pillar are mostly lists, but three things repeatedly need
// the same arithmetic and deserve to be testable without a database: turning a
// numeric rating into words, reading how far a review cycle has got, and
// summarising a set of reviews as a whole. All three are deterministic functions
// of the rows handed in, so they live here rather than inside a component.

export type CycleStatus = "draft" | "active" | "closed";
export type ReviewStatus = "pending" | "in_progress" | "submitted" | "acknowledged";
export type GoalStatus = "active" | "achieved" | "missed" | "cancelled";
export type FeedbackRelationship = "manager" | "peer" | "report" | "self" | "external";

export interface PerformanceCycle {
  id: string;
  name: string;
  period_start: string;
  period_end: string;
  status: CycleStatus;
  description: string | null;
}

export interface PerformanceReview {
  id: string;
  cycle_id: string;
  employee_profile_id: string;
  reviewer_user_id: string | null;
  status: ReviewStatus;
  overall_rating: number | null;
  strengths: string | null;
  improvements: string | null;
  comments: string | null;
  submitted_at: string | null;
  acknowledged_at: string | null;
}

export interface PerformanceGoal {
  id: string;
  employee_profile_id: string;
  cycle_id: string | null;
  title: string;
  description: string | null;
  weight: number | null;
  target: string | null;
  progress: number;
  status: GoalStatus;
  due_date: string | null;
}

export interface PerformanceFeedback {
  id: string;
  cycle_id: string | null;
  employee_profile_id: string;
  reviewer_user_id: string | null;
  relationship: FeedbackRelationship;
  rating: number | null;
  comments: string | null;
  is_anonymous: boolean;
}

/** The five-point scale, worded once so the UI never invents its own. */
const RATING_LABELS: Record<number, string> = {
  1: "Needs improvement",
  2: "Below expectations",
  3: "Meets expectations",
  4: "Exceeds expectations",
  5: "Outstanding",
};

export const RATING_VALUES = [1, 2, 3, 4, 5] as const;

/** Words for a rating, or "Not rated" when there isn't a usable one. */
export function ratingLabel(rating: number | null | undefined): string {
  const numeric = rating == null ? NaN : Number(rating);
  if (!Number.isFinite(numeric)) return "Not rated";
  return RATING_LABELS[Math.round(numeric)] ?? "Not rated";
}

export interface RatingBucket {
  rating: number;
  label: string;
  count: number;
}

/**
 * A 1–5 distribution. Every bucket is always present so the caller can render a
 * stable chart/legend — a rating nobody received is a zero, not a missing row.
 * Unrated reviews are ignored.
 */
export function ratingBuckets(
  reviews: Array<Pick<PerformanceReview, "overall_rating">>,
): RatingBucket[] {
  const buckets: RatingBucket[] = RATING_VALUES.map((rating) => ({
    rating,
    label: RATING_LABELS[rating],
    count: 0,
  }));
  for (const review of reviews) {
    const numeric = review.overall_rating == null ? NaN : Number(review.overall_rating);
    if (!Number.isFinite(numeric)) continue;
    const bucket = buckets[Math.round(numeric) - 1];
    if (bucket) bucket.count += 1;
  }
  return buckets;
}

export interface CycleProgress {
  total: number;
  completed: number;
  submitted: number;
  acknowledged: number;
  pending: number;
  /** Whole-number completion of the cycle, 0–100. */
  percent: number;
}

/** How far a cycle has got: a review counts as done once submitted or acknowledged. */
export function cycleProgress(
  reviews: Array<Pick<PerformanceReview, "status">>,
): CycleProgress {
  let submitted = 0;
  let acknowledged = 0;
  let pending = 0;
  for (const review of reviews) {
    if (review.status === "submitted") submitted += 1;
    else if (review.status === "acknowledged") acknowledged += 1;
    else pending += 1;
  }
  const total = reviews.length;
  const completed = submitted + acknowledged;
  return {
    total,
    completed,
    submitted,
    acknowledged,
    pending,
    percent: total === 0 ? 0 : Math.round((completed / total) * 100),
  };
}

/** Clamp a goal percentage into the 0–100 the schema allows. */
export function clampProgress(progress: number | null | undefined): number {
  const numeric = progress == null ? 0 : Number(progress);
  if (!Number.isFinite(numeric)) return 0;
  return Math.min(100, Math.max(0, Math.round(numeric)));
}

/**
 * The one-line status for a goal. A closed status wins over the percentage —
 * a goal marked missed is missed even if someone left the number at 60.
 */
export function goalProgressLabel(goal: Pick<PerformanceGoal, "progress" | "status">): string {
  if (goal.status === "achieved") return "Achieved";
  if (goal.status === "missed") return "Missed";
  if (goal.status === "cancelled") return "Cancelled";
  const percent = clampProgress(goal.progress);
  if (percent <= 0) return "Not started";
  if (percent >= 100) return "Complete";
  return `${percent}% complete`;
}

export interface OverallSummary extends CycleProgress {
  ratedCount: number;
  /** Mean of submitted/acknowledged ratings, to one decimal; null when none. */
  averageRating: number | null;
}

/**
 * The numbers shown above a cycle: progress plus the average rating. Only
 * submitted and acknowledged reviews carry a meaningful rating, so a draft
 * rating never drags the average down.
 */
export function overallSummary(
  reviews: Array<Pick<PerformanceReview, "status" | "overall_rating">>,
): OverallSummary {
  const progress = cycleProgress(reviews);
  const rated = reviews
    .filter((review) => review.status === "submitted" || review.status === "acknowledged")
    .map((review) => (review.overall_rating == null ? NaN : Number(review.overall_rating)))
    .filter((value) => Number.isFinite(value));

  const average =
    rated.length === 0
      ? null
      : Math.round((rated.reduce((sum, value) => sum + value, 0) / rated.length) * 10) / 10;

  return { ...progress, ratedCount: rated.length, averageRating: average };
}
