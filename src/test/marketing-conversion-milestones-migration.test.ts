import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/20260619132000_marketing_conversion_milestones.sql",
  "utf8",
);

describe("marketing conversion milestone migration", () => {
  it("emits visit completion as a zero-value GA and Meta conversion", () => {
    expect(migration).toContain("CREATE OR REPLACE FUNCTION public.fn_emit_visit_completed_marketing");
    expect(migration).toContain("NEW.status IS DISTINCT FROM 'completed'");
    expect(migration).toContain("OLD.status IS NOT DISTINCT FROM 'completed'");
    expect(migration).toContain("'visit_completed'");
    expect(migration).toContain("'VisitCompleted'");
    expect(migration).toContain("v_event_id := 'visit_' || NEW.id::text");
    expect(migration).toContain("AFTER INSERT OR UPDATE OF status ON public.campus_visits");
  });

  it("emits application fee paid with matching browser Pixel dedupe id", () => {
    expect(migration).toContain("NEW.type = 'application_fee'");
    expect(migration).toContain("v_event_id   := 'reg_' || COALESCE(v_application_id, NEW.id::text)");
    expect(migration).toContain("v_ga_event   := 'application_fee_paid'");
    expect(migration).toContain("v_meta_event := 'CompleteRegistration'");
    expect(migration).toContain("NEW.amount");
  });

  it("emits token fee submitted as the higher-value paid milestone", () => {
    expect(migration).toContain("NEW.type NOT IN ('application_fee', 'token_fee')");
    expect(migration).toContain("v_event_id   := 'token_' || NEW.id::text");
    expect(migration).toContain("v_ga_event   := 'token_fee_submitted'");
    expect(migration).toContain("v_meta_event := 'TokenFeeSubmitted'");
    expect(migration).toContain("'funnel_rank', v_rank");
  });

  it("uses server-side GA and Meta relay helpers with metadata payloads", () => {
    expect(migration).toContain("CREATE OR REPLACE FUNCTION public.fn_ga_relay_post_with_params");
    expect(migration).toContain("'/functions/v1/ga-conversions'");
    expect(migration).toContain("CREATE OR REPLACE FUNCTION public.fn_capi_relay_post_with_custom");
    expect(migration).toContain("'/functions/v1/meta-capi-events'");
    expect(migration).toContain("'content_category', 'admissions_funnel'");
  });
});
