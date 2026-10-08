import { describe, expect, it } from "vitest";
import { readMigration } from "./readMigration";

const migration = readMigration("grant_cleanup_phone_anon_execute");

describe("application insert phone index permissions", () => {
  it("grants anon execute on the phone normalizer used by the application expression index", () => {
    // Regression: ISSUE-001 — Mirai application creation failed on cleanup_phone permission
    // Found by /qa on 2026-10-06
    // Report: .gstack/qa-reports/qa-report-localhost-2026-10-06.md
    expect(migration).toContain(
      "GRANT EXECUTE ON FUNCTION public.cleanup_phone(text) TO anon;",
    );
  });
});
