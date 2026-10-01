import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";

/** Guardrails for hiring Phase D — AI resume parsing/ranking, Google Meet/Calendar, referrals. */
const migrationsDir = "supabase/migrations";
const read = (rel: string) => readFileSync(rel, "utf8");
const migrationFile = (slug: string) => {
  const files = readdirSync(migrationsDir).filter((f) => /^\d{14}_.*\.sql$/.test(f) && f.endsWith(`_${slug}.sql`));
  expect(files.length, `expected exactly one migration named *_${slug}.sql`).toBe(1);
  return `${migrationsDir}/${files[0]}`;
};

describe("hiring phase D backend", () => {
  const sql = read(migrationFile("hr_hiring_phase_d"));
  it("adds AI parse/rank fields and a ranking RPC", () => {
    expect(sql).toMatch(/ai_rank_score/);
    expect(sql).toMatch(/parsed_profile/);
    expect(sql).toMatch(/FUNCTION public\.rank_job_applicants/);
  });
  it("adds Google Meet/Calendar fields on interviews", () => {
    expect(sql).toMatch(/meet_link/);
    expect(sql).toMatch(/calendar_event_id/);
    expect(sql).toMatch(/calendar_html_link/);
  });
  it("adds referrals with a summary RPC", () => {
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS public\.job_referrals/);
    expect(sql).toMatch(/FUNCTION public\.job_referral_summary/);
    expect(sql).toMatch(/referrer_user_id/);
  });
});

describe("hiring phase D edge functions", () => {
  it("ships resume-parse using Gemini", () => {
    expect(existsSync("supabase/functions/resume-parse/index.ts")).toBe(true);
    const fn = read("supabase/functions/resume-parse/index.ts");
    expect(fn).toMatch(/generativelanguage\.googleapis\.com/);
    expect(fn).toMatch(/parsed_profile/);
    expect(fn).toMatch(/ai_rank_score/);
  });
  it("ships interview-meet with Meet/Calendar + a manual fallback", () => {
    expect(existsSync("supabase/functions/interview-meet/index.ts")).toBe(true);
    const fn = read("supabase/functions/interview-meet/index.ts");
    expect(fn).toMatch(/conferenceData/);
    expect(fn).toMatch(/hangoutsMeet/);
    expect(fn).toMatch(/calendar\.google\.com\/calendar\/render/);
    expect(fn).toMatch(/meet\.google\.com\/new/);
  });
});

describe("hiring phase D wiring", () => {
  it("registers the referrals route", () => {
    const app = read("src/App.tsx");
    expect(app).toContain('path="/hr-referrals"');
    const sidebar = read("src/components/layout/AppSidebar.tsx");
    expect(sidebar).toContain("/hr-referrals");
  });

  it("uses AI parse, Meet, bulk move and export in the applicant screen", () => {
    const page = read("src/pages/HrJobApplicants.tsx");
    expect(page).toMatch(/resume-parse/);
    expect(page).toMatch(/interview-meet/);
    expect(page).toMatch(/bulkMove/);
    expect(page).toMatch(/ai_rank_score/);
  });

  it("ships the mobile recruiter screen", () => {
    expect(existsSync("mobile/app/(staff)/work/recruitment.tsx")).toBe(true);
    expect(read("mobile/app/(staff)/work/_layout.tsx")).toContain('name="recruitment"');
  });

  it("ships the referrals panel + lib", () => {
    expect(existsSync("src/components/hr/ReferralsPanel.tsx")).toBe(true);
    expect(existsSync("src/lib/referrals.ts")).toBe(true);
  });
});
