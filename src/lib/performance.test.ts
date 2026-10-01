import { describe, it, expect } from "vitest";
import {
  ratingLabel,
  ratingBuckets,
  cycleProgress,
  goalProgressLabel,
  overallSummary,
  clampProgress,
  RATING_VALUES,
  type PerformanceReview,
} from "./performance";

const review = (
  over: Partial<Pick<PerformanceReview, "status" | "overall_rating">> = {},
) => ({ status: "pending" as const, overall_rating: null, ...over });

describe("ratingLabel", () => {
  it("names every point on the 1–5 scale", () => {
    expect(ratingLabel(1)).toBe("Needs improvement");
    expect(ratingLabel(3)).toBe("Meets expectations");
    expect(ratingLabel(5)).toBe("Outstanding");
  });

  it("rounds fractional ratings to the nearest whole point", () => {
    expect(ratingLabel(3.4)).toBe("Meets expectations");
    expect(ratingLabel(3.6)).toBe("Exceeds expectations");
  });

  it("falls back to \"Not rated\" for missing or out-of-range input", () => {
    expect(ratingLabel(null)).toBe("Not rated");
    expect(ratingLabel(undefined)).toBe("Not rated");
    expect(ratingLabel(0)).toBe("Not rated");
    expect(ratingLabel(6)).toBe("Not rated");
  });
});

describe("ratingBuckets", () => {
  it("always returns all five buckets, even when empty", () => {
    const buckets = ratingBuckets([]);
    expect(buckets.map((b) => b.rating)).toEqual([...RATING_VALUES]);
    expect(buckets.every((b) => b.count === 0)).toBe(true);
  });

  it("counts rounded ratings and ignores unrated reviews", () => {
    const buckets = ratingBuckets([
      review({ overall_rating: 5 }),
      review({ overall_rating: 5 }),
      review({ overall_rating: 4 }),
      review({ overall_rating: 3.4 }),
      review({ overall_rating: null }),
    ]);
    const byRating = Object.fromEntries(buckets.map((b) => [b.rating, b.count]));
    expect(byRating[5]).toBe(2);
    expect(byRating[4]).toBe(1);
    expect(byRating[3]).toBe(1);
    expect(byRating[2]).toBe(0);
    expect(byRating[1]).toBe(0);
  });
});

describe("cycleProgress", () => {
  it("is empty but well-formed with no reviews", () => {
    expect(cycleProgress([])).toEqual({
      total: 0,
      completed: 0,
      submitted: 0,
      acknowledged: 0,
      pending: 0,
      percent: 0,
    });
  });

  it("counts submitted and acknowledged as complete and rounds the percent", () => {
    const progress = cycleProgress([
      review({ status: "submitted" }),
      review({ status: "acknowledged" }),
      review({ status: "pending" }),
    ]);
    expect(progress.total).toBe(3);
    expect(progress.completed).toBe(2);
    expect(progress.submitted).toBe(1);
    expect(progress.acknowledged).toBe(1);
    expect(progress.pending).toBe(1);
    expect(progress.percent).toBe(67);
  });
});

describe("clampProgress", () => {
  it("clamps and rounds into the 0–100 range", () => {
    expect(clampProgress(-12)).toBe(0);
    expect(clampProgress(140)).toBe(100);
    expect(clampProgress(42.6)).toBe(43);
    expect(clampProgress(null)).toBe(0);
  });
});

describe("goalProgressLabel", () => {
  it("lets a closed status win over the percentage", () => {
    expect(goalProgressLabel({ status: "achieved", progress: 80 })).toBe("Achieved");
    expect(goalProgressLabel({ status: "missed", progress: 90 })).toBe("Missed");
    expect(goalProgressLabel({ status: "cancelled", progress: 10 })).toBe("Cancelled");
  });

  it("describes an active goal by how far it has got", () => {
    expect(goalProgressLabel({ status: "active", progress: 0 })).toBe("Not started");
    expect(goalProgressLabel({ status: "active", progress: 42 })).toBe("42% complete");
    expect(goalProgressLabel({ status: "active", progress: 100 })).toBe("Complete");
  });
});

describe("overallSummary", () => {
  it("averages only submitted and acknowledged ratings", () => {
    const summary = overallSummary([
      review({ status: "submitted", overall_rating: 5 }),
      review({ status: "acknowledged", overall_rating: 4 }),
      review({ status: "pending", overall_rating: 1 }),
    ]);
    expect(summary.averageRating).toBe(4.5);
    expect(summary.ratedCount).toBe(2);
    expect(summary.completed).toBe(2);
    expect(summary.percent).toBe(67);
  });

  it("returns a null average when nothing has been rated yet", () => {
    const summary = overallSummary([review({ status: "pending" })]);
    expect(summary.averageRating).toBeNull();
    expect(summary.ratedCount).toBe(0);
  });

  it("keeps the average to one decimal place", () => {
    const summary = overallSummary([
      review({ status: "submitted", overall_rating: 5 }),
      review({ status: "submitted", overall_rating: 5 }),
      review({ status: "submitted", overall_rating: 4 }),
    ]);
    expect(summary.averageRating).toBe(4.7);
  });
});
