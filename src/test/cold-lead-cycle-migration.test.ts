import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { readMigration } from "./readMigration";

// By name, not timestamp — the pre-commit hook re-stamps new migrations.
const migration = readMigration("cold_lead_revival_cycle");
const dialog = readFileSync("src/components/admissions/CallDispositionDialog.tsx", "utf8");
const pendingFollowups = readFileSync("src/pages/PendingFollowups.tsx", "utf8");

describe("cold lead revival cycle migration", () => {
  it("exempts revival rounds from the terminal-stage cancel trigger", () => {
    expect(migration).toContain("CREATE OR REPLACE FUNCTION public.fn_cancel_followups_on_terminal_stage");
    expect(migration).toContain("AND type <> 'cold_followup'");
  });

  it("opens round 1 fifteen days after the lead enters cold, from any path", () => {
    expect(migration).toContain("CREATE TRIGGER trg_start_cold_followup_cycle");
    expect(migration).toContain("WHEN (NEW.stage = 'cold' AND OLD.stage IS DISTINCT FROM NEW.stage)");
    expect(migration).toContain("now() + interval '15 days'");
    // counsellor_id is nulled in the same UPDATE by ai-call-failed-handler
    expect(migration).toContain("COALESCE(NEW.counsellor_id, OLD.counsellor_id)");
    // lead_followups.user_id is an auth.users id, not a profiles id
    expect(migration).toContain("SELECT p.user_id INTO v_user_id");
  });

  it("closes to not_interested only after two spent rounds with no response", () => {
    expect(migration).toContain("CREATE OR REPLACE FUNCTION public.fn_cold_lead_cycle");
    expect(migration).toContain("Auto-closed: no response after 2 cold follow-ups");
    expect(migration).toContain("SET stage = 'not_interested'");
    expect(migration).toContain("AND c.rounds_spent >= 2");
    expect(migration).toContain("AND c.rounds_spent < 2");
    expect(migration).toContain("NOT c.responded");
  });

  it("counts a connected call or an inbound WhatsApp as a response", () => {
    expect(migration).toContain("cl.called_at > s.cold_at AND cl.duration_seconds > 0");
    expect(migration).toContain("acr.status = 'completed' AND acr.created_at > s.cold_at");
    expect(migration).toContain("wm.direction = 'inbound' AND wm.created_at > s.cold_at");
  });

  it("spends a round the counsellor never worked so the cycle can't stall", () => {
    expect(migration).toContain("lf.scheduled_at < now() - interval '15 days'");
    expect(migration).toContain("SET status = 'cancelled'");
  });

  it("does not sweep in the pre-existing cold backlog", () => {
    // 3,188 leads were already cold at go-live; without the floor the first run
    // would open a revival task for every one of them.
    expect(migration).toContain("v_floor constant timestamptz");
    expect(migration.split("c.cold_at >= v_floor").length - 1).toBe(3);
  });

  it("schedules the daily cron", () => {
    expect(migration).toContain("cron.schedule('cold-lead-cycle'");
    expect(migration).toContain("SELECT public.fn_cold_lead_cycle()");
  });

  it("surfaces open rounds through the cold tab, which cold leads are otherwise excluded from", () => {
    expect(migration).toContain("cold_scoped_leads AS (");
    expect(migration).toContain("WHERE p_tab = 'cold'");
    expect(migration).toContain("'cold', (SELECT COUNT(*)::integer FROM cold_followups)");
    expect(pendingFollowups).toContain('key: "cold", label: "Cold Revival"');
  });
});

describe("cold call disposition", () => {
  it("offers Cold only when the call did not connect", () => {
    expect(dialog).toContain('{ value: "cold", label: "Cold — Not Reachable"');
    expect(dialog).toMatch(/value: "cold"[\s\S]*?onlyWhenNotConnected: true/);
  });

  it("shows the unanswered streak as context without gating the choice", () => {
    expect(dialog).toContain("consecutiveNotAnswered");
    expect(dialog).toContain("consecutive unanswered call");
    // No disabled attribute tied to the streak — the pill is always clickable.
    expect(dialog).not.toMatch(/disabled=\{[^}]*unansweredStreak/);
  });
});
