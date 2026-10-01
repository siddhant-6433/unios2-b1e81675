import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";

/** Guardrails for hiring Phase A (requisitions, atomic stage/interview, comms, onboarding). */
const migrationsDir = "supabase/migrations";
const read = (rel: string) => readFileSync(rel, "utf8");
const migrationFile = (slug: string) => {
  const files = readdirSync(migrationsDir).filter((f) => /^\d{14}_.*\.sql$/.test(f) && f.endsWith(`_${slug}.sql`));
  expect(files.length, `expected exactly one migration named *_${slug}.sql`).toBe(1);
  return `${migrationsDir}/${files[0]}`;
};

describe("hiring phase A backend", () => {
  const sql = read(migrationFile("hr_hiring_phase_a"));

  it("adds atomic stage moves and assignment", () => {
    expect(sql).toMatch(/FUNCTION public\.move_job_applicant/);
    expect(sql).toMatch(/FUNCTION public\.assign_job_applicant/);
    expect(sql).toMatch(/withdrawn/);
  });

  it("schedules interviews atomically", () => {
    expect(sql).toMatch(/FUNCTION public\.schedule_job_interview/);
    expect(sql).toMatch(/status = 'interview'/);
  });

  it("moves the applicant to offered on offer generation", () => {
    expect(sql).toMatch(/FUNCTION public\.generate_hr_offer_letter/);
    expect(sql).toMatch(/SET status = 'offered'/);
  });

  it("enriches the applicant inbox view", () => {
    expect(sql).toMatch(/ja\.notes/);
    expect(sql).toMatch(/ja\.rating/);
    expect(sql).toMatch(/ja\.stage_changed_at/);
    expect(sql).toMatch(/security_invoker = true/);
  });
});

describe("hiring comms edge function", () => {
  it("ships hiring-notify with the seeded templates + send-once", () => {
    expect(existsSync("supabase/functions/hiring-notify/index.ts")).toBe(true);
    const fn = read("supabase/functions/hiring-notify/index.ts");
    expect(fn).toMatch(/hiring-acknowledgement/);
    expect(fn).toMatch(/hiring-interview-invite/);
    expect(fn).toMatch(/hiring-offer/);
    expect(fn).toMatch(/hiring_notifications/);
  });
});

describe("hiring phase A wiring", () => {
  it("registers the openings and onboarding routes", () => {
    const app = read("src/App.tsx");
    expect(app).toContain('path="/hr-job-openings"');
    expect(app).toContain('path="/hr-onboarding"');
    const sidebar = read("src/components/layout/AppSidebar.tsx");
    expect(sidebar).toContain("/hr-job-openings");
    expect(sidebar).toContain("/hr-onboarding");
  });

  it("ships the openings + onboarding panels", () => {
    expect(existsSync("src/components/hr/JobOpeningsPanel.tsx")).toBe(true);
    expect(existsSync("src/components/hr/OnboardingPipelinePanel.tsx")).toBe(true);
  });

  it("upgrades the applicant screen to the new RPCs, comms and hire conversion", () => {
    const page = read("src/pages/HrJobApplicants.tsx");
    expect(page).toMatch(/move_job_applicant/);
    expect(page).toMatch(/schedule_job_interview/);
    expect(page).toMatch(/hiring-notify/);
    expect(page).toMatch(/hire_job_applicant/);
  });
});
