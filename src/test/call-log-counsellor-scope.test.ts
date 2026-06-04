import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/20260618160000_tighten_call_logs_counsellor_rls.sql",
  "utf8",
);

describe("call_logs counsellor data scope", () => {
  it("does not grant counsellors broad call_logs select access", () => {
    const selectPolicy = migration.match(
      /CREATE POLICY "Staff can select call logs"[\s\S]*?;\n/,
    )?.[0];

    expect(selectPolicy).toBeTruthy();
    expect(selectPolicy).toContain("has_role((SELECT auth.uid()), 'counsellor'::app_role)");
    expect(selectPolicy).toContain("AND user_id = (SELECT auth.uid())");
    expect(selectPolicy).not.toMatch(
      /OR\s+has_role\(\(SELECT auth\.uid\(\)\), 'counsellor'::app_role\)\s*(?:\)|OR)/,
    );
  });
});
