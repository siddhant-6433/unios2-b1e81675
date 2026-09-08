import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const adminApplicationView = readFileSync("src/pages/AdminApplicationView.tsx", "utf8");
const migration = readFileSync(
  "supabase/migrations/20260907115839_relink_orphan_application_leads.sql",
  "utf8",
);

describe("orphan application lead relink", () => {
  it("reverse-looks up an existing lead before showing Lead has been deleted", () => {
    expect(adminApplicationView).toContain("resolveMissingApplicationLead");
    expect(adminApplicationView).toContain('.eq("application_id", appRow.application_id)');
    expect(adminApplicationView).toContain("phoneLookupCandidates");
    expect(adminApplicationView).toContain("upsertLeadForApplication");
    expect(adminApplicationView).toContain("if (!resolvedLeadId && appRow?.phone)");
  });

  it("repairs orphans via upsert_application_lead instead of a raw insert", () => {
    expect(adminApplicationView).toContain('rpc(\n          "upsert_application_lead"');
    expect(adminApplicationView).toContain("_application_id: app.application_id");
    expect(adminApplicationView).not.toMatch(/from\("leads"\)\s*\.insert\(/);
  });

  it("heals applications.lead_id from application_id or phone in get_application_lead", () => {
    expect(migration).toContain("CREATE OR REPLACE FUNCTION public.get_application_lead");
    expect(migration).toContain("VOLATILE");
    expect(migration).toContain("WHERE application_id = _application_id");
    expect(migration).toContain("right(regexp_replace(phone, '\\D', '', 'g'), 10)");
    expect(migration).toContain("SET lead_id = v_lead_id");
    expect(migration).toContain("RETURN NULL;  -- orphan application");
  });

  it("backfills orphans and prevents new applications from landing without a lead", () => {
    expect(migration).toContain("CREATE OR REPLACE FUNCTION public.fn_applications_ensure_lead");
    expect(migration).toContain("trg_applications_ensure_lead");
    expect(migration).toContain("public.upsert_application_lead");
    expect(migration).toContain("WHERE lead_id IS NULL");
    expect(migration).toContain("EXCEPTION WHEN unique_violation THEN");
    expect(migration).toContain("WHERE application_id = a.application_id");
  });
});
