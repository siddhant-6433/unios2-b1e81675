import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/20260619094000_admitted_stage_guard_and_audit.sql",
  "utf8",
);

describe("admitted-stage guard migration", () => {
  it("repairs AN leads whose stage drifted away from admitted", () => {
    expect(migration).toContain("WITH to_repair AS");
    expect(migration).toContain("admission_no IS NOT NULL");
    expect(migration).toContain("SET stage = 'admitted'::public.lead_stage");
    expect(migration).toContain("Stage repaired by admitted-stage guard");
  });

  it("blocks future admitted-lead stage downgrades at the database boundary", () => {
    expect(migration).toContain("CREATE OR REPLACE FUNCTION public.fn_guard_admitted_lead_stage");
    expect(migration).toContain("NEW.admission_no IS NOT NULL");
    expect(migration).toContain("NEW.stage IS DISTINCT FROM 'admitted'::public.lead_stage");
    expect(migration).toContain("CREATE TRIGGER trg_guard_admitted_lead_stage");
    expect(migration).toContain("BEFORE INSERT OR UPDATE OF admission_no, stage ON public.leads");
  });

  it("writes a centralized Activity-tab audit row for every accepted stage change", () => {
    expect(migration).toContain("CREATE OR REPLACE FUNCTION public.fn_audit_lead_stage_change");
    expect(migration).toContain("SECURITY DEFINER");
    expect(migration).toContain("INSERT INTO public.lead_activities");
    expect(migration).toContain("'Stage changed from '");
    expect(migration).toContain("CREATE TRIGGER trg_audit_lead_stage_change");
    expect(migration).toContain("AFTER UPDATE OF stage ON public.leads");
  });
});
