import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const adminApplicationView = readFileSync("src/pages/AdminApplicationView.tsx", "utf8");
const migration = readFileSync(
  "supabase/migrations/20260723130000_admission_view_resolve_private_lead.sql",
  "utf8",
);

// Bug: academic-partner PRIVATE leads (shared_with_nimt=false) are hidden from
// non-super_admin staff by the "Staff can view leads" RLS, so the admission view
// read returns null and the UI falsely shows "Lead has been deleted" — and issuing
// an offer would create a DUPLICATE lead. Writes already allow these roles; only
// the SELECT is blocked, so a role-gated definer RPC resolves the lead.
describe("admission view resolves RLS-hidden private partner leads", () => {
  it("falls back to the definer RPC when the direct lead read is blocked", () => {
    expect(adminApplicationView).toContain('rpc("get_application_lead"');
    // Only when the direct read came back empty but a lead is actually linked —
    // so genuinely-orphan applications still take the create-lead path.
    expect(adminApplicationView).toContain("if (!baseLeadRow && appRow.lead_id)");
  });

  it("gates the definer RPC to admission-processing staff and never invents a lead", () => {
    expect(migration).toContain("CREATE OR REPLACE FUNCTION public.get_application_lead");
    expect(migration).toContain("SECURITY DEFINER");
    expect(migration).toContain("has_role(v_uid, 'principal'::app_role)");
    expect(migration).toContain("has_role(v_uid, 'admission_head'::app_role)");
    // Counsellors are excluded to preserve partner-lead pool privacy.
    expect(migration).not.toContain("has_role(v_uid, 'counsellor'::app_role)");
    // Returns NULL (not a fabricated row) when the lead is genuinely gone.
    expect(migration).toContain("RETURN NULL;  -- orphan application");
    expect(migration).toContain("GRANT EXECUTE ON FUNCTION public.get_application_lead(text) TO authenticated");
  });
});
