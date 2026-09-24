import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";

/**
 * Guardrails for HR phase 5: team structure / reporting managers and the
 * two-stage expense approval with Zoho vendor bills. Migrations are resolved by
 * slug because the pre-commit hook restamps newly-added migrations.
 */

const migrationsDir = "supabase/migrations";
const read = (rel: string) => readFileSync(rel, "utf8");

const migrationFile = (slug: string) => {
  const files = readdirSync(migrationsDir).filter((f) => /^\d{14}_.*\.sql$/.test(f) && f.endsWith(`_${slug}.sql`));
  expect(files.length, `expected exactly one migration named *_${slug}.sql`).toBe(1);
  return `${migrationsDir}/${files[0]}`;
};

describe("team structure / reporting managers", () => {
  const sql = read(migrationFile("hr_reporting_structure"));
  it("adds a validated reporting-manager setter", () => {
    expect(sql).toMatch(/FUNCTION public\.set_reporting_manager/);
    expect(sql).toMatch(/cannot report to themselves/);
    expect(sql).toMatch(/would create a cycle/);
  });
  it("exposes the team structure and self manager reads", () => {
    expect(sql).toMatch(/FUNCTION public\.hr_team_structure/);
    expect(sql).toMatch(/FUNCTION public\.my_reporting_manager/);
  });
});

describe("expense two-stage approval + Zoho", () => {
  const sql = read(migrationFile("hr_expense_approval_workflow"));
  it("adds the full status set and stage columns", () => {
    expect(sql).toMatch(/pending_superadmin/);
    expect(sql).toMatch(/changes_requested/);
    expect(sql).toMatch(/synced_to_zoho/);
    expect(sql).toMatch(/l1_reviewer/);
    expect(sql).toMatch(/l2_reviewer/);
    expect(sql).toMatch(/zoho_bill_id/);
  });
  it("supports multiple proofs and enforces a proof on submit", () => {
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS public\.expense_claim_attachments/);
    expect(sql).toMatch(/FUNCTION public\.enforce_expense_proof/);
    expect(sql).toMatch(/trg_enforce_expense_proof/);
  });
  it("adds the two-stage review RPCs and a final-approval permission", () => {
    expect(sql).toMatch(/FUNCTION public\.submit_expense_claim/);
    expect(sql).toMatch(/FUNCTION public\.l1_decide_expense/);
    expect(sql).toMatch(/FUNCTION public\.l2_decide_expense/);
    expect(sql).toMatch(/expenses_final_approve/);
    expect(sql).toMatch(/FUNCTION public\.mark_expense_synced/);
  });
  it("keeps both reimbursement modes", () => {
    expect(sql).toMatch(/FUNCTION public\.mark_expense_reimbursed/);
    expect(sql).toMatch(/reimbursement_mode/);
  });
});

describe("zoho expense sync", () => {
  it("ships the edge function", () => {
    expect(existsSync("supabase/functions/zoho-expense-bill-sync/index.ts")).toBe(true);
    const fn = read("supabase/functions/zoho-expense-bill-sync/index.ts");
    expect(fn).toMatch(/create_bill/);
    expect(fn).toMatch(/record_payment/);
    expect(fn).toMatch(/zohoAddVendorBankAccount/);
    expect(fn).toMatch(/employee_profiles/);
  });
});

describe("phase-5 frontend wiring", () => {
  it("registers the team-structure route", () => {
    const app = read("src/App.tsx");
    expect(app).toContain('path="/hr-team"');
    const sidebar = read("src/components/layout/AppSidebar.tsx");
    expect(sidebar).toContain("/hr-team");
  });

  it("uses the two-stage RPCs and Zoho sync in the expense UI", () => {
    const review = read("src/components/hr/ExpenseReviewPanel.tsx");
    expect(review).toMatch(/l1_decide_expense|l2_decide_expense/);
    expect(review).toMatch(/zoho-expense-bill-sync/);
    const mine = read("src/components/hr/MyExpensesPanel.tsx");
    expect(mine).toMatch(/submit_expense_claim/);
    const mobile = read("mobile/app/(staff)/work/expenses.tsx");
    expect(mobile).toMatch(/submit_expense_claim/);
  });
});
