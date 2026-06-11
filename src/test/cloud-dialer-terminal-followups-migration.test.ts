import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/20260618151000_fix_cloud_dialer_terminal_followups.sql",
  "utf8",
);
const requeueMigration = readFileSync(
  "supabase/migrations/20260619104500_harden_cloud_dialer_terminal_requeue.sql",
  "utf8",
);
const cloudDialer = readFileSync("src/pages/CloudDialer.tsx", "utf8");

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

  it("blocks terminal leads from re-entering Cloud Dialer through direct dial and pins", () => {
    expect(requeueMigration).toContain("CREATE OR REPLACE FUNCTION public.is_terminal_dialer_stage");
    expect(requeueMigration).toContain("CREATE OR REPLACE FUNCTION public.fn_reject_terminal_cloud_dialer_pin");
    expect(requeueMigration).toContain("CREATE TRIGGER trg_reject_terminal_cloud_dialer_pin");
    expect(requeueMigration).toContain("DELETE FROM public.cloud_dialer_pins");
    expect(requeueMigration).toContain("CREATE OR REPLACE FUNCTION public.dialer_claim_existing_lead");
    expect(requeueMigration).toContain("CREATE OR REPLACE FUNCTION public.dialer_create_lead");
    expect(requeueMigration.split("Lead is closed and cannot be called from Cloud Dialer").length - 1).toBeGreaterThanOrEqual(2);
  });

  it("keeps non-smart Cloud Dialer list queues defensive against terminal stages", () => {
    expect(requeueMigration).toContain("CREATE OR REPLACE FUNCTION public.cloud_dialer_list_queue");
    expect(requeueMigration).toContain("AND NOT public.is_terminal_dialer_stage(l.stage::text)");
  });

  it("filters terminal leads client-side and passes the computed next lead to auto-dial", () => {
    expect(cloudDialer).toContain("const TERMINAL_DIALER_STAGES = new Set");
    expect(cloudDialer).toContain("isTerminalDialerStage(lead.stage)");
    expect(cloudDialer).toContain("isTerminalDialerDisposition(disposition)");
    expect(cloudDialer).toContain("const nextLead = nextQueue[nextIdx] || null");
    expect(cloudDialer).toContain("setTimeout(() => placeCall(nextLead), 1000)");
  });
});
