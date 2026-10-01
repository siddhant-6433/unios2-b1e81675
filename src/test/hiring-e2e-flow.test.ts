import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";

/**
 * End-to-end hiring flow wiring test.
 *
 * This walks the whole journey — careers portal → apply → applicant inbox →
 * AI screen → interview (+Meet) → feedback → offer → acceptance → hire →
 * onboarding → analytics → referrals — and asserts that every hop exists and is
 * connected in the code. It is the closest verification possible without a
 * deployed database (no Docker for a local Supabase, and the migrations are not
 * pushed to production from this worktree).
 */

const migrationsDir = "supabase/migrations";
const read = (rel: string) => readFileSync(rel, "utf8");
const allMigrations = () =>
  readdirSync(migrationsDir).filter((f) => /^\d{14}_.*\.sql$/.test(f));

// Some recruitment objects predate the hiring phases (hire_job_applicant,
// hr_recruitment_funnel, record_interview_feedback), so search every migration
// for DB-object assertions.
const hiringSql = allMigrations().map((f) => read(`${migrationsDir}/${f}`)).join("\n");

describe("hiring flow — front door (careers portal)", () => {
  it("ships the public pages and routes", () => {
    for (const f of ["src/pages/Careers.tsx", "src/pages/CareerJob.tsx", "src/pages/OfferAcceptance.tsx"]) {
      expect(existsSync(f), f).toBe(true);
    }
    const app = read("src/App.tsx");
    expect(app).toContain('path="/careers"');
    expect(app).toContain('path="/careers/:slug"');
    expect(app).toContain('path="/careers/offer/:token"');
  });

  it("applies through the anon apply-job function with a resume + dedupe", () => {
    expect(existsSync("supabase/functions/apply-job/index.ts")).toBe(true);
    const fn = read("supabase/functions/apply-job/index.ts");
    expect(fn).toMatch(/job_openings/);
    expect(fn).toMatch(/careers_portal/);
    expect(fn).toMatch(/PutObjectCommand/);
    expect(fn).toMatch(/already_applied/);
    expect(read("supabase/config.toml")).toMatch(/\[functions\.apply-job\][\s\S]*verify_jwt = false/);
    // The careers form posts multipart to apply-job.
    expect(read("src/pages/CareerJob.tsx")).toMatch(/apply-job/);
  });
});

describe("hiring flow — applicant inbox & AI screening", () => {
  it("exposes the enriched inbox view with AI + referrer fields", () => {
    expect(hiringSql).toMatch(/CREATE OR REPLACE VIEW public\.job_applicants_inbox/);
    for (const col of ["ai_rank_score", "ai_summary", "parsed_profile", "referrer_name", "job_opening_title"]) {
      expect(hiringSql, col).toContain(col);
    }
  });

  it("parses resumes with Gemini and stores the rank score", () => {
    expect(existsSync("supabase/functions/resume-parse/index.ts")).toBe(true);
    const fn = read("supabase/functions/resume-parse/index.ts");
    expect(fn).toMatch(/generativelanguage\.googleapis\.com/);
    expect(fn).toMatch(/ai_rank_score/);
    const page = read("src/pages/HrJobApplicants.tsx");
    expect(page).toMatch(/resume-parse/);
    expect(page).toMatch(/Parse with AI/);
  });

  it("moves applicants through stages via RPCs and offers list + board views", () => {
    expect(hiringSql).toMatch(/FUNCTION public\.move_job_applicant/);
    const page = read("src/pages/HrJobApplicants.tsx");
    expect(page).toMatch(/move_job_applicant/);
    expect(page).toMatch(/bulkMove/);
    expect(page).toMatch(/viewMode/);
  });
});

describe("hiring flow — interviews (scheduling, Meet/Calendar, feedback)", () => {
  it("schedules atomically and attaches Google Meet/Calendar", () => {
    expect(hiringSql).toMatch(/FUNCTION public\.schedule_job_interview/);
    expect(hiringSql).toMatch(/meet_link/);
    expect(existsSync("supabase/functions/interview-meet/index.ts")).toBe(true);
    const fn = read("supabase/functions/interview-meet/index.ts");
    expect(fn).toMatch(/hangoutsMeet/);
    expect(fn).toMatch(/calendar\.google\.com\/calendar\/render/);
    expect(read("src/pages/HrJobApplicants.tsx")).toMatch(/interview-meet/);
  });

  it("records structured feedback", () => {
    expect(hiringSql).toMatch(/FUNCTION public\.record_interview_feedback/);
    expect(read("src/pages/HrJobApplicants.tsx")).toMatch(/record_interview_feedback/);
  });
});

describe("hiring flow — offer, acceptance, hire, onboarding", () => {
  it("generates an offer and moves the applicant to offered", () => {
    expect(hiringSql).toMatch(/FUNCTION public\.generate_hr_offer_letter/);
    expect(hiringSql).toMatch(/SET status = 'offered'/);
  });

  it("sends hiring emails with a send-once guard", () => {
    expect(existsSync("supabase/functions/hiring-notify/index.ts")).toBe(true);
    const fn = read("supabase/functions/hiring-notify/index.ts");
    expect(fn).toMatch(/hiring-offer/);
    expect(fn).toMatch(/hiring_notifications/);
  });

  it("accepts/declines the offer by token and moves the candidate into onboarding", () => {
    expect(hiringSql).toMatch(/FUNCTION public\.get_offer_by_token/);
    expect(hiringSql).toMatch(/FUNCTION public\.redeem_offer_acceptance/);
    expect(hiringSql).toMatch(/TO anon, authenticated, service_role/);
    expect(hiringSql).toMatch(/onboarding_stage = 'offer_accepted'/);
    expect(read("src/pages/OfferAcceptance.tsx")).toMatch(/redeem_offer_acceptance/);
  });

  it("converts a hired applicant to an employee and shows the onboarding pipeline", () => {
    expect(hiringSql).toMatch(/FUNCTION public\.hire_job_applicant/);
    expect(read("src/pages/HrJobApplicants.tsx")).toMatch(/hire_job_applicant/);
    expect(existsSync("src/components/hr/OnboardingPipelinePanel.tsx")).toBe(true);
    expect(read("src/App.tsx")).toContain('path="/hr-onboarding"');
  });
});

describe("hiring flow — analytics, referrals, mobile", () => {
  it("exposes recruitment metrics + funnel on a page", () => {
    expect(hiringSql).toMatch(/FUNCTION public\.hr_recruitment_metrics/);
    expect(hiringSql).toMatch(/FUNCTION public\.hr_recruitment_funnel/);
    expect(read("src/App.tsx")).toContain('path="/hr-recruitment"');
    expect(existsSync("src/components/hr/RecruitmentAnalyticsPanel.tsx")).toBe(true);
  });

  it("supports referrals end to end", () => {
    expect(hiringSql).toMatch(/CREATE TABLE IF NOT EXISTS public\.job_referrals/);
    expect(hiringSql).toMatch(/FUNCTION public\.job_referral_summary/);
    expect(read("src/App.tsx")).toContain('path="/hr-referrals"');
    expect(existsSync("src/components/hr/ReferralsPanel.tsx")).toBe(true);
  });

  it("ships a mobile recruiter screen wired into the Work stack", () => {
    expect(existsSync("mobile/app/(staff)/work/recruitment.tsx")).toBe(true);
    expect(read("mobile/app/(staff)/work/_layout.tsx")).toContain('name="recruitment"');
    expect(read("mobile/app/(staff)/(tabs)/index.tsx")).toContain("/work/recruitment");
  });

  it("exposes job openings admin + requisition → applicant linkage", () => {
    expect(existsSync("src/components/hr/JobOpeningsPanel.tsx")).toBe(true);
    expect(read("src/App.tsx")).toContain('path="/hr-job-openings"');
    expect(hiringSql).toMatch(/job_opening_id/);
  });
});

describe("hiring flow — permissions on every surface", () => {
  const access = read("src/lib/accessPolicy.ts");
  const sidebar = read("src/components/layout/AppSidebar.tsx");
  it("gates each HR hiring route + sidebar entry", () => {
    for (const [route, perm] of [
      ["/hr-job-openings", "hr:view"],
      ["/hr-job-applicants", "hr:view"],
      ["/hr-onboarding", "hr:view"],
      ["/hr-recruitment", "hr:view"],
      ["/hr-referrals", "hr:self"],
    ] as const) {
      expect(access, route).toContain(`path: "${route}", permission: "${perm}"`);
      expect(sidebar, route).toContain(route);
    }
  });
});
