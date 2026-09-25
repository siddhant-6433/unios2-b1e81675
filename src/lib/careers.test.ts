import { describe, it, expect } from "vitest";
import {
  employmentTypeLabel,
  experienceLabel,
  formatCloses,
  formatPosted,
  isLive,
  salaryLabel,
  type PublicJob,
} from "./careers";

describe("employmentTypeLabel", () => {
  it("returns the canonical Title Case label", () => {
    expect(employmentTypeLabel("Full Time")).toBe("Full Time");
    expect(employmentTypeLabel("Part Time")).toBe("Part Time");
    expect(employmentTypeLabel("Contract")).toBe("Contract");
    expect(employmentTypeLabel("Intern")).toBe("Intern");
  });

  it("normalises snake_case, kebab-case and odd casing", () => {
    expect(employmentTypeLabel("full_time")).toBe("Full Time");
    expect(employmentTypeLabel("part-time")).toBe("Part Time");
    expect(employmentTypeLabel("INTERNSHIP")).toBe("Intern");
  });

  it("passes unknown values through and handles blanks", () => {
    expect(employmentTypeLabel("Gig")).toBe("Gig");
    expect(employmentTypeLabel("")).toBe("");
    expect(employmentTypeLabel(null)).toBe("");
    expect(employmentTypeLabel(undefined)).toBe("");
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

  it("never leaks the band when salary_visible is false", () => {
    expect(salaryLabel(50000, 80000, false)).toBe("Not disclosed");
    expect(salaryLabel(null, null, false)).toBe("Not disclosed");
  });

  it("coerces numeric-as-string columns", () => {
    expect(salaryLabel("50000.50", "80000", true)).toBe("₹50,000.5 – ₹80,000");
  });
});

describe("isLive", () => {
  const now = new Date("2026-06-01T00:00:00Z");

  it("is true for an open opening with no deadline", () => {
    expect(isLive({ status: "open", closes_at: null }, now)).toBe(true);
  });

  it("is true only while closes_at is in the future", () => {
    expect(isLive({ status: "open", closes_at: "2026-06-02T00:00:00Z" }, now)).toBe(true);
    expect(isLive({ status: "open", closes_at: "2026-05-31T00:00:00Z" }, now)).toBe(false);
  });

  it("treats closes_at exactly equal to now as closed", () => {
    expect(isLive({ status: "open", closes_at: "2026-06-01T00:00:00Z" }, now)).toBe(false);
  });

  it("is false for draft and closed openings regardless of deadline", () => {
    expect(isLive({ status: "draft", closes_at: null }, now)).toBe(false);
    expect(isLive({ status: "closed", closes_at: "2999-01-01T00:00:00Z" }, now)).toBe(false);
  });

  it("accepts a now as string or timestamp and tolerates nullish/invalid input", () => {
    expect(isLive({ status: "open", closes_at: "2026-06-02T00:00:00Z" }, "2026-06-01T00:00:00Z")).toBe(true);
    expect(isLive({ status: "open", closes_at: "2026-06-02T00:00:00Z" }, now.getTime())).toBe(true);
    expect(isLive(null, now)).toBe(false);
    expect(isLive(undefined, now)).toBe(false);
    expect(isLive({ status: "open", closes_at: "not-a-date" }, now)).toBe(true);
  });
});

describe("formatPosted / formatCloses", () => {
  it("renders an IST calendar date with its verb", () => {
    expect(formatPosted("2026-06-12T00:00:00Z")).toBe("Posted 12 Jun 2026");
    expect(formatCloses("2026-06-30T00:00:00Z")).toBe("Closes 30 Jun 2026");
  });

  it("stays on the correct IST day for a late-UTC timestamp", () => {
    // 22:30 UTC on 11 Jun is 04:00 IST on 12 Jun.
    expect(formatPosted("2026-06-11T22:30:00Z")).toBe("Posted 12 Jun 2026");
  });

  it("returns an empty string when there is no usable date", () => {
    expect(formatPosted(null)).toBe("");
    expect(formatPosted(undefined)).toBe("");
    expect(formatCloses("")).toBe("");
    expect(formatCloses("not-a-date")).toBe("");
  });
});

describe("PublicJob", () => {
  it("accepts the selected row shape", () => {
    const job: PublicJob = {
      id: "1",
      slug: "dean-hod",
      title: "Dean / HOD",
      description: null,
      employment_type: "Full Time",
      experience_min_years: 5,
      experience_max_years: null,
      salary_min: null,
      salary_max: null,
      salary_visible: false,
      location: "Greater Noida",
      openings_count: 1,
      department_id: null,
      campus_id: null,
      posted_at: "2026-06-12T00:00:00Z",
      closes_at: null,
      status: "open",
    };
    expect(isLive(job)).toBe(true);
  });
});
