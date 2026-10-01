import { describe, it, expect } from "vitest";
import {
  CAREERS_BASE_URL,
  JOB_OPENING_FILTERS,
  JOB_OPENING_STATUSES,
  employmentTypeLabel,
  experienceLabel,
  isOpen,
  openingStatusBadge,
  openingStatusLabel,
  publicOpeningUrl,
  salaryLabel,
  slugify,
} from "./jobOpenings";

describe("JOB_OPENING_STATUSES", () => {
  it("covers the full set the DB CHECK allows, with 'all' in front for filters", () => {
    expect([...JOB_OPENING_STATUSES].sort()).toEqual(["closed", "draft", "open"]);
    expect(JOB_OPENING_FILTERS[0]).toBe("all");
    expect([...JOB_OPENING_FILTERS].slice(1).sort()).toEqual(["closed", "draft", "open"]);
  });
});

describe("slugify", () => {
  it("lowercases and hyphenates", () => {
    expect(slugify("Assistant Professor (Nursing)")).toBe("assistant-professor-nursing");
  });

  it("collapses runs of punctuation and whitespace", () => {
    expect(slugify("  Dean / HOD  ")).toBe("dean-hod");
    expect(slugify("A&B -- C")).toBe("a-b-c");
    expect(slugify("Multiple   spaces")).toBe("multiple-spaces");
  });

  it("trims edge hyphens and drops non-ascii letters", () => {
    expect(slugify("Hindi हिंदी")).toBe("hindi");
    expect(slugify("--leading and trailing--")).toBe("leading-and-trailing");
  });

  it("handles empty and nullish input", () => {
    expect(slugify("")).toBe("");
    expect(slugify(null)).toBe("");
    expect(slugify(undefined)).toBe("");
  });
});

describe("publicOpeningUrl", () => {
  it("appends the slug to the careers base", () => {
    expect(publicOpeningUrl("dean-hod")).toBe(`${CAREERS_BASE_URL}/dean-hod`);
  });

  it("falls back to the careers root for a blank slug", () => {
    expect(publicOpeningUrl("")).toBe(CAREERS_BASE_URL);
    expect(publicOpeningUrl(null)).toBe(CAREERS_BASE_URL);
  });
});

describe("employmentTypeLabel", () => {
  it("returns the canonical Title Case label", () => {
    expect(employmentTypeLabel("Full Time")).toBe("Full Time");
    expect(employmentTypeLabel("Part Time")).toBe("Part Time");
    expect(employmentTypeLabel("Contract")).toBe("Contract");
    expect(employmentTypeLabel("Intern")).toBe("Intern");
  });

  it("normalises snake_case and odd casing", () => {
    expect(employmentTypeLabel("full_time")).toBe("Full Time");
    expect(employmentTypeLabel("part-time")).toBe("Part Time");
    expect(employmentTypeLabel("internship")).toBe("Intern");
  });

  it("passes unknown values through and handles blanks", () => {
    expect(employmentTypeLabel("Gig")).toBe("Gig");
    expect(employmentTypeLabel("")).toBe("");
    expect(employmentTypeLabel(null)).toBe("");
  });
});

describe("openingStatusBadge", () => {
  it("maps each known status to a pastel pill", () => {
    expect(openingStatusBadge("draft")).toContain("bg-pastel-yellow");
    expect(openingStatusBadge("open")).toContain("bg-pastel-green");
    expect(openingStatusBadge("closed")).toContain("bg-muted");
  });

  it("never returns undefined for an unexpected status", () => {
    expect(openingStatusBadge("mystery")).toContain("bg-muted");
  });
});

describe("openingStatusLabel", () => {
  it("capitalises the status for display", () => {
    expect(openingStatusLabel("draft")).toBe("Draft");
    expect(openingStatusLabel("open")).toBe("Open");
    expect(openingStatusLabel("closed")).toBe("Closed");
    expect(openingStatusLabel("")).toBe("");
  });
});

describe("isOpen", () => {
  const now = new Date("2026-06-01T00:00:00Z");

  it("is true for an open opening with no deadline", () => {
    expect(isOpen({ status: "open", closes_at: null }, now)).toBe(true);
  });

  it("is true only while closes_at is in the future", () => {
    expect(isOpen({ status: "open", closes_at: "2026-06-02T00:00:00Z" }, now)).toBe(true);
    expect(isOpen({ status: "open", closes_at: "2026-05-31T00:00:00Z" }, now)).toBe(false);
  });

  it("treats closes_at exactly equal to now as closed", () => {
    expect(isOpen({ status: "open", closes_at: "2026-06-01T00:00:00Z" }, now)).toBe(false);
  });

  it("is false for draft and closed openings regardless of deadline", () => {
    expect(isOpen({ status: "draft", closes_at: null }, now)).toBe(false);
    expect(isOpen({ status: "closed", closes_at: "2999-01-01T00:00:00Z" }, now)).toBe(false);
  });

  it("accepts a now as string or timestamp and tolerates nullish/invalid input", () => {
    expect(isOpen({ status: "open", closes_at: "2026-06-02T00:00:00Z" }, "2026-06-01T00:00:00Z")).toBe(true);
    expect(isOpen({ status: "open", closes_at: "2026-06-02T00:00:00Z" }, now.getTime())).toBe(true);
    expect(isOpen(null, now)).toBe(false);
    expect(isOpen(undefined, now)).toBe(false);
    expect(isOpen({ status: "open", closes_at: "not-a-date" }, now)).toBe(true);
  });
});

describe("experienceLabel", () => {
  it("formats a range, a single value and open-ended bands", () => {
    expect(experienceLabel(2, 5)).toBe("2–5 yrs");
    expect(experienceLabel(3, 3)).toBe("3 yrs");
    expect(experienceLabel(2, null)).toBe("2+ yrs");
    expect(experienceLabel(null, 5)).toBe("Up to 5 yrs");
  });

  it("says 'Not specified' when both ends are missing", () => {
    expect(experienceLabel(null, null)).toBe("Not specified");
    expect(experienceLabel(undefined, undefined)).toBe("Not specified");
    expect(experienceLabel("", "")).toBe("Not specified");
  });

  it("coerces numeric-as-string columns and keeps decimals crisp", () => {
    expect(experienceLabel("2", "5")).toBe("2–5 yrs");
    expect(experienceLabel("1.5", "2.5")).toBe("1.5–2.5 yrs");
    expect(experienceLabel("3.0", null)).toBe("3+ yrs");
  });

  it("shows a fresher band as 0–N", () => {
    expect(experienceLabel(0, 2)).toBe("0–2 yrs");
  });
});

describe("salaryLabel", () => {
  it("formats ranges in the Indian numbering system", () => {
    expect(salaryLabel(50000, 80000, true)).toBe("₹50,000 – ₹80,000");
    expect(salaryLabel(60000, 60000, true)).toBe("₹60,000");
  });

  it("formats open-ended bands", () => {
    expect(salaryLabel(50000, null, true)).toBe("From ₹50,000");
    expect(salaryLabel(null, 80000, true)).toBe("Up to ₹80,000");
    expect(salaryLabel(null, null, true)).toBe("Not specified");
  });

  it("hides the band entirely when salary_visible is false", () => {
    expect(salaryLabel(50000, 80000, false)).toBe("Not disclosed");
    expect(salaryLabel(null, null, false)).toBe("Not disclosed");
  });

  it("coerces numeric-as-string columns", () => {
    expect(salaryLabel("50000.50", "80000", true)).toBe("₹50,000.5 – ₹80,000");
  });
});
