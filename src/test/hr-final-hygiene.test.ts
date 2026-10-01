import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";

/** Guardrails for the final HR hygiene migration. */
const migrationsDir = "supabase/migrations";
const read = (rel: string) => readFileSync(rel, "utf8");
const migrationFile = (slug: string) => {
  const files = readdirSync(migrationsDir).filter((f) => /^\d{14}_.*\.sql$/.test(f) && f.endsWith(`_${slug}.sql`));
  expect(files.length, `expected exactly one migration named *_${slug}.sql`).toBe(1);
  return `${migrationsDir}/${files[0]}`;
};

describe("final HR hygiene", () => {
  const sql = read(migrationFile("hr_final_hygiene"));

  it("reconciles legacy leave balances and makes the table read-only", () => {
    expect(sql).toMatch(/INSERT INTO public\.employee_leave_entitlements/);
    expect(sql).toMatch(/FROM public\.employee_leave_balances b/);
    expect(sql).toMatch(/REVOKE INSERT, UPDATE, DELETE ON public\.employee_leave_balances FROM authenticated/);
    expect(sql).toMatch(/COMMENT ON TABLE public\.employee_leave_balances/);
  });

  it("revokes the stale anon geofence grant", () => {
    expect(sql).toMatch(/REVOKE SELECT ON public\.geofence_locations FROM anon/);
  });

  it("drops the duplicate employee_profiles policies", () => {
    expect(sql).toMatch(/DROP POLICY IF EXISTS "HR reads employee profiles"/);
    expect(sql).toMatch(/DROP POLICY IF EXISTS "HR writes employee profiles"/);
    expect(sql).toMatch(/DROP POLICY IF EXISTS "HR staff can view all employee profiles"/);
  });

  it("enforces canonical job_openings slug uniqueness", () => {
    expect(sql).toMatch(/job_openings_slug_uniq/);
  });
});
