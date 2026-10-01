import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";

/**
 * Guardrails for the HR phase-3 work: expense advances and full & final
 * settlement. Migrations are resolved by slug because the pre-commit hook
 * restamps newly-added migrations.
 */

const migrationsDir = "supabase/migrations";
const read = (rel: string) => readFileSync(rel, "utf8");

const migrationFile = (slug: string) => {
  const files = readdirSync(migrationsDir).filter((f) => /^\d{14}_.*\.sql$/.test(f) && f.endsWith(`_${slug}.sql`));
  expect(files.length, `expected exactly one migration named *_${slug}.sql`).toBe(1);
  return `${migrationsDir}/${files[0]}`;
};

describe("expense advances", () => {
  const sql = read(migrationFile("hr_expense_advances"));
  it("defines the advance table with a derived outstanding balance", () => {
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS public\.expense_advances/);
    expect(sql).toMatch(/outstanding\s+numeric\(14,2\) GENERATED ALWAYS AS/);
  });
  it("adds issue / settle / payroll-recovery RPCs", () => {
    expect(sql).toMatch(/FUNCTION public\.issue_advance/);
    expect(sql).toMatch(/FUNCTION public\.settle_advance/);
    expect(sql).toMatch(/FUNCTION public\.recover_advances_for_cycle/);
  });
  it("exposes a security_invoker inbox view", () => {
    expect(sql).toMatch(/security_invoker = true/);
    expect(sql).toMatch(/expense_advances_inbox/);
  });
});

describe("full & final settlement", () => {
  const sql = read(migrationFile("hr_fnf_settlement"));
  it("defines settlement header, lines and config defaults", () => {
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS public\.employee_settlements/);
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS public\.employee_settlement_lines/);
    expect(sql).toMatch(/fnf_encashment_divisor/);
    expect(sql).toMatch(/fnf_gratuity_min_years/);
  });
  it("computes earnings and deductions from live records", () => {
    expect(sql).toMatch(/FUNCTION public\.compute_exit_settlement/);
    expect(sql).toMatch(/employee_leave_entitlements/);
    expect(sql).toMatch(/expense_advances/);
    expect(sql).toMatch(/notice_period_days/);
  });
  it("gates finalize and pay, and clears advances on payment", () => {
    expect(sql).toMatch(/FUNCTION public\.finalize_exit_settlement/);
    expect(sql).toMatch(/FUNCTION public\.mark_exit_settlement_paid/);
    expect(sql).toMatch(/status = 'recovered'/);
  });
});

describe("phase-3 frontend wiring", () => {
  it("registers the settlement and advances routes", () => {
    const app = read("src/App.tsx");
    expect(app).toContain('path="/hr-settlements"');
    expect(app).toContain('path="/hr-advances"');
    expect(app).toContain('module="hr" action="employees_edit"');
    expect(app).toContain('module="hr" action="expenses_approve"');
  });

  it("adds the surfaces to the sidebar", () => {
    const sidebar = read("src/components/layout/AppSidebar.tsx");
    expect(sidebar).toContain("/hr-settlements");
    expect(sidebar).toContain("/hr-advances");
  });

  it("embeds the self-service settlement and advances panels in MyHr", () => {
    const myHr = read("src/pages/MyHr.tsx");
    expect(myHr).toMatch(/MySettlementPanel/);
    expect(myHr).toMatch(/MyAdvancesPanel/);
  });

  it("offers advance recovery on a payroll run", () => {
    const payroll = read("src/pages/HrPayroll.tsx");
    expect(payroll).toMatch(/recover_advances_for_cycle/);
  });
});
