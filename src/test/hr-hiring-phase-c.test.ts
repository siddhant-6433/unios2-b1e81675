import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";

/** Guardrails for hiring Phase C — analytics, board/timeline, export. */
const migrationsDir = "supabase/migrations";
const read = (rel: string) => readFileSync(rel, "utf8");
const migrationFile = (slug: string) => {
  const files = readdirSync(migrationsDir).filter((f) => /^\d{14}_.*\.sql$/.test(f) && f.endsWith(`_${slug}.sql`));
  expect(files.length, `expected exactly one migration named *_${slug}.sql`).toBe(1);
  return `${migrationsDir}/${files[0]}`;
};

describe("recruitment analytics backend", () => {
  const sql = read(migrationFile("hr_hiring_phase_c"));
  it("adds TA metrics and applicant timeline RPCs", () => {
    expect(sql).toMatch(/FUNCTION public\.hr_recruitment_metrics/);
    expect(sql).toMatch(/FUNCTION public\.job_applicant_timeline/);
    expect(sql).toMatch(/offer_acceptance_pct/);
    expect(sql).toMatch(/avg_days_to_hire/);
  });
});

describe("hiring phase C wiring", () => {
  it("registers the recruitment analytics route", () => {
    const app = read("src/App.tsx");
    expect(app).toContain('path="/hr-recruitment"');
    const sidebar = read("src/components/layout/AppSidebar.tsx");
    expect(sidebar).toContain("/hr-recruitment");
  });

  it("ships the analytics panel", () => {
    expect(existsSync("src/components/hr/RecruitmentAnalyticsPanel.tsx")).toBe(true);
  });

  it("uses the timeline and export helpers in the applicant screen", () => {
    const page = read("src/pages/HrJobApplicants.tsx");
    expect(page).toMatch(/job_applicant_timeline/);
    expect(page).toMatch(/downloadCsv|toCsv/);
    expect(page).toMatch(/Board/i);
  });

  it("keeps the orb-only loading convention (no standalone spinning Loader2)", () => {
    const page = read("src/pages/HrJobApplicants.tsx");
    const offenders = [...page.matchAll(/<Loader2\s+className="([^"]*)"/g)]
      .map(([, cls]) => cls)
      .filter((cls) => cls.includes("animate-spin") && /\bh-(?:5|6|7|8|10|12)\b/.test(cls ?? ""));
    expect(offenders).toEqual([]);
  });
});
