import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const routingMigration = readFileSync("supabase/migrations/20260620113000_ai_call_interest_assignment_and_cold_bucket.sql", "utf8");
const callback = readFileSync("supabase/functions/voice-call-callback/index.ts", "utf8");
const failedHandler = readFileSync("supabase/functions/ai-call-failed-handler/index.ts", "utf8");
const applications = readFileSync("src/pages/Applications.tsx", "utf8");

describe("AI call interest routing", () => {
  it("assigns interested or high-conversion AI call outcomes through round robin", () => {
    expect(routingMigration).toContain("v_disposition IN ('interested', 'callback_requested')");
    expect(routingMigration).toContain("COALESCE(NEW.conversion_probability, 0) >= 60");
    expect(routingMigration).toContain("public.fn_round_robin_assign_counsellor(NEW.lead_id)");
    expect(routingMigration).toContain("'priority_interested'::public.lead_stage");
    expect(routingMigration).toContain("INSERT INTO public.lead_followups");
  });

  it("assigns all existing and future priority interested leads through team routing", () => {
    expect(routingMigration).toContain("CREATE OR REPLACE FUNCTION public.fn_assign_priority_interested_lead");
    expect(routingMigration).toContain("public.fn_round_robin_assign_counsellor(_lead_id)");
    expect(routingMigration).toContain("trg_assign_priority_interested_on_stage");
    expect(routingMigration).toContain("stage = 'priority_interested'::public.lead_stage");
    expect(routingMigration).toContain("existing priority_interested backfill");
  });

  it("backs up edge callback assignment with the same high-intent rule", () => {
    expect(callback).toContain("disposition === \"interested\"");
    expect(callback).toContain("disposition === \"callback_requested\"");
    expect(callback).toContain("conversionProb >= 60");
    expect(callback).toContain("fn_round_robin_assign_counsellor");
  });

  it("returns max-failed AI calls to bucket instead of assigning them", () => {
    expect(failedHandler).not.toContain("get_leads_for_counsellor_assignment");
    expect(failedHandler).toContain("stage: \"cold\"");
    expect(failedHandler).toContain("counsellor_id: null");
    expect(failedHandler).toContain("returned to bucket after 3 failed AI calls");
  });

  it("adds created-date filtering to Applications", () => {
    expect(applications).toContain('const [fromDate, setFromDate] = useState("")');
    expect(applications).toContain('const [toDate, setToDate] = useState("")');
    expect(applications).toContain('new Date(`${fromDate}T00:00:00`)');
    expect(applications).toContain('new Date(`${toDate}T23:59:59.999`)');
  });
});
