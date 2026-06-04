import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/20260618140000_backfill_missing_cloud_dialer_auto_call_logs.sql",
  "utf8",
);

describe("Cloud Dialer auto call-log backfill migration", () => {
  it("only backfills real manual Cloud Dialer student-attempt dispositions", () => {
    expect(migration).toContain("acr.call_type = 'manual'");
    expect(migration).toContain("COALESCE(acr.disposition, acr.status) <> 'counsellor_no_answer'");
    expect(migration).toContain("acr.disposition IN ('not_answered', 'no_answer', 'busy', 'voicemail', 'cancelled')");
    expect(migration).toContain("acr.status IN ('no_answer', 'busy', 'voicemail')");
  });

  it("deduplicates against existing call_logs before inserting metrics rows", () => {
    expect(migration).toContain("cl.cloud_call_uuid = cr.call_uuid");
    expect(migration).toContain("cl.called_at BETWEEN cr.called_at - interval '2 minutes'");
    expect(migration).toContain("'cloud_dialer'");
    expect(migration).toContain("ON CONFLICT DO NOTHING");
  });
});
