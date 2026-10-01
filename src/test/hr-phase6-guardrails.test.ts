import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";

/**
 * Guardrails for HR phase 6 — cleanup & hygiene. Migrations are resolved by
 * slug because the pre-commit hook restamps newly-added migrations.
 */

const migrationsDir = "supabase/migrations";
const read = (rel: string) => readFileSync(rel, "utf8");
const migrationFile = (slug: string) => {
  const files = readdirSync(migrationsDir).filter((f) => /^\d{14}_.*\.sql$/.test(f) && f.endsWith(`_${slug}.sql`));
  expect(files.length, `expected exactly one migration named *_${slug}.sql`).toBe(1);
  return `${migrationsDir}/${files[0]}`;
};

describe("HR cleanup & hygiene", () => {
  const sql = read(migrationFile("hr_cleanup_hygiene"));

  it("drops the redundant employee_documents unique index", () => {
    expect(sql).toMatch(/DROP INDEX IF EXISTS public\.employee_documents_employee_key_idx/);
  });

  it("adds a multi-punch-safe daily attendance view", () => {
    expect(sql).toMatch(/CREATE OR REPLACE VIEW public\.employee_attendance_daily/);
    expect(sql).toMatch(/security_invoker = true/);
    expect(sql).toMatch(/first_punch_in/);
    expect(sql).toMatch(/last_punch_out/);
  });

  it("makes regularisation approval multi-punch correct", () => {
    expect(sql).toMatch(/FUNCTION public\.approve_attendance_regularisation/);
    expect(sql).toMatch(/ORDER BY punch_in NULLS FIRST/);
  });

  it("adds asset depreciation", () => {
    expect(sql).toMatch(/depreciation_rate/);
    expect(sql).toMatch(/FUNCTION public\.hr_asset_depreciation/);
    expect(sql).toMatch(/book_value/);
  });

  it("reconciles the employee-id concepts", () => {
    expect(sql).toMatch(/tg_sync_profile_employee_id/);
    expect(sql).toMatch(/SET employee_id = e\.employee_number/);
  });

  it("unifies the interview models", () => {
    expect(sql).toMatch(/DROP TABLE IF EXISTS public\.interview_feedback/);
    expect(sql).toMatch(/DROP TABLE IF EXISTS public\.interview_rounds/);
  });
});

describe("phase-6 wiring", () => {
  it("shows depreciation on the assets page", () => {
    expect(read("src/pages/HrAssets.tsx")).toMatch(/AssetDepreciationPanel/);
  });
});
