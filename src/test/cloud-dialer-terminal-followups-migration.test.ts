import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/20260618151000_fix_cloud_dialer_terminal_followups.sql",
  "utf8",
);

const idempotentMigration = readFileSync(
  "supabase/migrations/20260619120900_dialer_filter_terminal_stages.sql",
  "utf8",
);

describe("Cloud Dialer terminal follow-up migration", () => {
  it("filters terminal leads out of overdue, dialer queue, and direct dial guard", () => {
    const terminalStages = "'not_interested', 'dnc', 'rejected', 'ineligible', 'admitted', 'cold'";

    expect(migration).toContain("CREATE OR REPLACE VIEW public.overdue_followups");
    expect(migration).toContain(`l.stage NOT IN (${terminalStages})`);
    expect(migration).toContain("CREATE OR REPLACE FUNCTION public.cloud_dialer_queue");
    expect(migration).toContain("CREATE OR REPLACE FUNCTION public.counsellor_dial_guard");
    expect(migration.split(`NOT IN (${terminalStages})`).length - 1).toBeGreaterThanOrEqual(8);
  });

  it("does not count counsellor-no-answer rows as lead call attempts", () => {
    expect(migration).toContain("acr.status <> 'counsellor_no_answer'");
  });

  it("cancels existing pending followups when a lead enters a terminal stage", () => {
    expect(migration).toContain("CREATE OR REPLACE FUNCTION public.fn_cancel_followups_on_terminal_stage");
    expect(migration).toContain("DROP TRIGGER IF EXISTS trg_cancel_followups_not_interested");
    expect(migration).toContain("CREATE TRIGGER trg_cancel_followups_terminal_stage");
    expect(migration).toContain("lf.status = 'pending'");
    expect(migration).toContain("SET status = 'cancelled'");
  });
});

describe("Cloud Dialer idempotent terminal-stage filter (20260619120900)", () => {
  const terminalStages = "'not_interested', 'dnc', 'rejected', 'ineligible', 'admitted', 'cold'";

  it("re-applies terminal stage guard to cloud_dialer_queue", () => {
    expect(idempotentMigration).toContain("CREATE OR REPLACE FUNCTION public.cloud_dialer_queue");
    // 7 guards: view + b2 + b3 + b4 + b5 + b6 + enriched CTE
    expect(idempotentMigration.split(`NOT IN (${terminalStages})`).length - 1).toBeGreaterThanOrEqual(7);
  });

  it("adds terminal stage guard to post_visit_pending_followups view", () => {
    expect(idempotentMigration).toContain("CREATE OR REPLACE VIEW public.post_visit_pending_followups");
    expect(idempotentMigration).toContain(`l.stage NOT IN (${terminalStages})`);
  });

  it("backfills cancellation of pending followups for terminal leads", () => {
    expect(idempotentMigration).toContain("UPDATE public.lead_followups");
    expect(idempotentMigration).toContain("SET status = 'cancelled'");
    expect(idempotentMigration).toContain(`l.stage IN (${terminalStages})`);
  });
});
