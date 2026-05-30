import { describe, it, expect } from "vitest";
import {
  matchesSource, matchesCourse, deriveCourseOptions, deriveSourceOptions,
  type FilterableLead,
} from "@/lib/leadBucketFilters";

// Regression for the Lead Buckets empty-list bug: Meta Ads lead-form leads
// carry no course (course_id IS NULL → course_name null), so the course and
// source dropdowns must be LINKED. Selecting "Meta Ads" then any course used
// to always show blank because the unscoped course dropdown still listed
// courses that no Meta Ads lead actually had.

const lead = (source: string | null, course_name: string | null): FilterableLead => ({ source, course_name });

// Mirror of the real data: 21 Meta Ads leads with no course, plus website/web
// chat leads that DO have courses.
const sample: FilterableLead[] = [
  ...Array.from({ length: 21 }, () => lead("meta_ads", null)),
  lead("website", "B.A. LL.B (Hons)"),
  lead("website", "B.A. LL.B (Hons)"),
  lead("website", "B.Com"),
  lead("web_chat", "B.Com"),
  lead("website_chat", "BBA"),
];

describe("leadBucketFilters — linked course/source dropdowns", () => {
  it("offers NO course options when the source has no courses (Meta Ads)", () => {
    // The core fix: Meta Ads leads carry no course, so the course dropdown is
    // empty and the user can never build the Meta-Ads + course empty combo.
    expect(deriveCourseOptions(sample, "meta_ads")).toEqual([]);
  });

  it("offers course options scoped to the selected source", () => {
    const opts = deriveCourseOptions(sample, "website");
    expect(opts).toEqual([
      { name: "B.A. LL.B (Hons)", count: 2 },
      { name: "B.Com", count: 1 },
    ]);
  });

  it("lists every course when source is unfiltered", () => {
    const names = deriveCourseOptions(sample, "all").map((o) => o.name).sort();
    expect(names).toEqual(["B.A. LL.B (Hons)", "B.Com", "BBA"]);
  });

  it("scopes source options to the selected course", () => {
    // B.Com exists for both website and web_chat leads.
    const sources = deriveSourceOptions(sample, "B.Com").map((o) => o.source).sort();
    expect(sources).toEqual(["web_chat", "website"]);
    // Meta Ads must NOT appear for any real course.
    expect(sources).not.toContain("meta_ads");
  });

  it("coalesces legacy web_chat and current website_chat in matchesSource", () => {
    expect(matchesSource(lead("web_chat", null), "web_chat")).toBe(true);
    expect(matchesSource(lead("website_chat", null), "web_chat")).toBe(true);
    expect(matchesSource(lead("meta_ads", null), "web_chat")).toBe(false);
  });

  it("matchesCourse treats null course as non-matching for a specific course", () => {
    expect(matchesCourse(lead("meta_ads", null), "B.Com")).toBe(false);
    expect(matchesCourse(lead("meta_ads", null), "all")).toBe(true);
  });

  it("end-to-end: Meta Ads + any course yields zero rows (the original bug)", () => {
    const courseFilter = "B.A. LL.B (Hons)";
    const sourceFilter = "meta_ads";
    const rows = sample.filter((l) => matchesCourse(l, courseFilter) && matchesSource(l, sourceFilter));
    expect(rows).toHaveLength(0);
    // ...and because the course dropdown is now empty for Meta Ads, the UI can
    // no longer reach this state in the first place.
    expect(deriveCourseOptions(sample, sourceFilter)).toEqual([]);
  });
});
