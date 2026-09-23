import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";

/**
 * Guardrails for the HR phase-2 work: payslips + payroll adjustments, interview
 * feedback, and the asset register / org chart. Migrations are resolved by slug
 * because the pre-commit hook restamps newly-added migrations.
 */

const migrationsDir = "supabase/migrations";
const read = (rel: string) => readFileSync(rel, "utf8");

const migrationFile = (slug: string) => {
  const files = readdirSync(migrationsDir).filter((f) => /^\d{14}_.*\.sql$/.test(f) && f.endsWith(`_${slug}.sql`));
  expect(files.length, `expected exactly one migration named *_${slug}.sql`).toBe(1);
  return `${migrationsDir}/${files[0]}`;
};

describe("payroll payslips + adjustments", () => {
  const sql = read(migrationFile("hr_payroll_payslips_adjustments"));
  it("adds self and admin payslip read RPCs", () => {
    expect(sql).toMatch(/FUNCTION public\.my_payslips\(\)/);
    expect(sql).toMatch(/FUNCTION public\.payslip_detail\(_line_id uuid\)/);
  });
  it("adds the leave + expense adjustment worker", () => {
    expect(sql).toMatch(/FUNCTION public\.apply_payroll_adjustments\(_cycle_id uuid\)/);
    expect(sql).toMatch(/employee_lop_days/);
    expect(sql).toMatch(/expense_claims/);
  });
  it("only exposes released (locked/paid) payslips to employees", () => {
    expect(sql).toMatch(/Employees read own released payslips/);
    expect(sql).toMatch(/status IN \('locked', 'paid'\)/);
  });
});

describe("interview feedback", () => {
  const sql = read(migrationFile("hr_interview_feedback"));
  it("extends interviews with feedback columns", () => {
    expect(sql).toMatch(/ALTER TABLE public\.interviews/);
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS rating/);
    expect(sql).toMatch(/recommend/);
  });
  it("records feedback through a permissioned RPC", () => {
    expect(sql).toMatch(/FUNCTION public\.record_interview_feedback/);
    expect(sql).toMatch(/hr:interviews_edit|hr:recruitment_edit/);
  });
  it("marks the unused round model deprecated rather than deleting it", () => {
    expect(sql).toMatch(/COMMENT ON TABLE public\.interview_rounds/);
    expect(sql).toMatch(/Deprecated/);
  });
});

describe("assets + org chart", () => {
  const sql = read(migrationFile("hr_assets_and_org"));
  it("defines the asset register and assignments", () => {
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS public\.assets/);
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS public\.asset_assignments/);
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS public\.asset_categories/);
    expect(sql).toMatch(/asset_assignments_active_uniq/);
  });
  it("adds assign/return/summary RPCs and the org chart read model", () => {
    expect(sql).toMatch(/FUNCTION public\.assign_asset/);
    expect(sql).toMatch(/FUNCTION public\.return_asset/);
    expect(sql).toMatch(/FUNCTION public\.hr_asset_summary/);
    expect(sql).toMatch(/FUNCTION public\.hr_org_chart/);
  });
  it("gates asset management on hr:assets_manage", () => {
    expect(sql).toMatch(/hr:assets_manage/);
  });
});

describe("phase-2 frontend wiring", () => {
  it("registers the new HR routes behind permission gates", () => {
    const app = read("src/App.tsx");
    expect(app).toContain('path="/hr-org"');
    expect(app).toContain('module="hr" action="view"');
    expect(app).toContain('path="/hr-assets"');
    expect(app).toContain('module="hr" action="assets_manage"');
  });

  it("adds the new surfaces to the sidebar", () => {
    const sidebar = read("src/components/layout/AppSidebar.tsx");
    expect(sidebar).toContain("/hr-org");
    expect(sidebar).toContain("/hr-assets");
  });

  it("embeds the self-service payslip / assets / calendar panels in MyHr", () => {
    const myHr = read("src/pages/MyHr.tsx");
    expect(myHr).toMatch(/MyPayslipsPanel/);
    expect(myHr).toMatch(/MyAssetsPanel|MyLeaveCalendarPanel/);
  });

  it("wires the payroll adjustments action", () => {
    const payroll = read("src/pages/HrPayroll.tsx");
    expect(payroll).toMatch(/apply_payroll_adjustments/);
  });
});
