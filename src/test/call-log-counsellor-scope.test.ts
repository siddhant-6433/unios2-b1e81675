import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/20260618161000_tighten_call_logs_counsellor_rls.sql",
  "utf8",
);
const metricsMigration = readFileSync(
  "supabase/migrations/20260618212900_call_log_metrics_rpc.sql",
  "utf8",
);
const callLogPage = readFileSync("src/pages/CallLog.tsx", "utf8");

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

  it("renders a self-only calls chart for counsellor sessions", () => {
    expect(metricsMigration).toContain("SECURITY INVOKER");
    expect(metricsMigration).toContain("p_counsellor_id IS NULL OR cl.user_id = p_counsellor_id");
    expect(callLogPage).toContain('isCounsellor ? "My Calls" : "Calls by Counsellor"');
    expect(callLogPage).toContain("disabled={isCounsellor}");
    expect(callLogPage).not.toContain("!isCounsellor && counsellorStats.length > 0");
  });

  it("keeps call-log cards and counsellor chart on the same exact aggregate", () => {
    expect(callLogPage).toContain('rpc("call_log_metrics"');
    expect(callLogPage).not.toContain('count: "planned"');
    expect(metricsMigration).toContain("COUNT(*) FILTER (WHERE disposition = 'interested')");
    expect(metricsMigration).toContain("'counsellors', counsellors.rows");
  });
});
