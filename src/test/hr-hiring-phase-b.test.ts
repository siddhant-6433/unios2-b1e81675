import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";

/** Guardrails for hiring Phase B — careers portal + offer acceptance. */
const migrationsDir = "supabase/migrations";
const read = (rel: string) => readFileSync(rel, "utf8");
const migrationFile = (slug: string) => {
  const files = readdirSync(migrationsDir).filter((f) => /^\d{14}_.*\.sql$/.test(f) && f.endsWith(`_${slug}.sql`));
  expect(files.length, `expected exactly one migration named *_${slug}.sql`).toBe(1);
  return `${migrationsDir}/${files[0]}`;
};

describe("offer acceptance backend", () => {
  const sql = read(migrationFile("hr_hiring_phase_b"));
  it("adds a tokenised acceptance flow callable by anon", () => {
    expect(sql).toMatch(/acceptance_token/);
    expect(sql).toMatch(/FUNCTION public\.redeem_offer_acceptance/);
    expect(sql).toMatch(/FUNCTION public\.get_offer_by_token/);
    expect(sql).toMatch(/TO anon, authenticated, service_role/);
  });
  it("moves the candidate into onboarding on acceptance", () => {
    expect(sql).toMatch(/onboarding_stage = 'offer_accepted'/);
    expect(sql).toMatch(/status = 'withdrawn'/);
  });
});

describe("public apply intake", () => {
  it("ships the anon apply-job edge function with dedupe", () => {
    expect(existsSync("supabase/functions/apply-job/index.ts")).toBe(true);
    const fn = read("supabase/functions/apply-job/index.ts");
    expect(fn).toMatch(/careers_portal/);
    expect(fn).toMatch(/already_applied/);
    expect(fn).toMatch(/PutObjectCommand/);
  });
  it("disables JWT verification for apply-job", () => {
    expect(read("supabase/config.toml")).toMatch(/\[functions\.apply-job\][\s\S]*verify_jwt = false/);
  });
});

describe("careers portal wiring", () => {
  it("registers the public routes", () => {
    const app = read("src/App.tsx");
    expect(app).toContain('path="/careers"');
    expect(app).toContain('path="/careers/:slug"');
    expect(app).toContain('path="/careers/offer/:token"');
  });
  it("ships the public pages", () => {
    expect(existsSync("src/pages/Careers.tsx")).toBe(true);
    expect(existsSync("src/pages/CareerJob.tsx")).toBe(true);
    expect(existsSync("src/pages/OfferAcceptance.tsx")).toBe(true);
  });
});
