import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/20260624100600_manual_external_owner_assignment.sql",
  "utf8",
);
const leadDetail = readFileSync("src/pages/LeadDetail.tsx", "utf8");
const externalOwnerDialog = readFileSync("src/components/admissions/ExternalOwnerDialog.tsx", "utf8");
const dashboard = readFileSync("src/pages/Dashboard.tsx", "utf8");

describe("manual external owner assignment", () => {
  it("uses a superadmin-only RPC for manual consultant or academic partner ownership", () => {
    expect(migration).toContain("CREATE OR REPLACE FUNCTION public.assign_lead_external_owner");
    expect(migration).toContain("SECURITY DEFINER");
    expect(migration).toContain("NOT public.has_role(v_uid, 'super_admin'::app_role)");
    expect(migration).toContain("Only super admins can assign lead external owners");
    expect(migration).toContain("GRANT EXECUTE ON FUNCTION public.assign_lead_external_owner");
  });

  it("enforces one external owner and validates active owners", () => {
    expect(migration).toContain("stage <> 'inactive'");
    expect(migration).toContain("status = 'active'");
    expect(migration).toContain("consultant_id = _consultant_id");
    expect(migration).toContain("academic_partner_id = NULL");
    expect(migration).toContain("consultant_id = NULL");
    expect(migration).toContain("academic_partner_id = _academic_partner_id");
    expect(migration).toContain("source = 'consultant'::lead_source");
    expect(migration).toContain("source = 'academic_partner'::lead_source");
  });

  it("audits manual owner changes in the lead activity timeline", () => {
    expect(migration).toContain("INSERT INTO public.lead_activities");
    expect(migration).toContain("External owner changed from");
    expect(migration).toContain("v_actor_profile_id");
  });

  it("keeps academic partner CRM access mapped-only while restricting fee rows to direct mapped leads", () => {
    expect(migration).toContain("can_academic_partner_view_mapped_lead");
    expect(migration).toContain("can_academic_partner_view_fee_student");
    expect(migration).toContain("Academic partners view own leads");
    expect(migration).toContain("public.can_academic_partner_view_mapped_lead(auth.uid(), id)");
    expect(migration).toContain("Academic partners view mapped fee ledger");
    expect(migration).toContain("public.can_academic_partner_view_fee_student(auth.uid(), student_id)");
    expect(migration).not.toContain("l.course_id IS NOT NULL\n      AND public.is_academic_partner_scope(_user_id, l.course_id, NULL)");
  });

  it("exposes current external owner on lead detail and only lets superadmins assign it", () => {
    expect(migration).toContain("'lead_consultant'");
    expect(migration).toContain("'lead_academic_partner'");
    expect(leadDetail).toContain("ExternalOwnerDialog");
    expect(leadDetail).toContain("Assign Owner");
    expect(leadDetail).toContain('lead.lead_academic_partner?.organization || lead.lead_academic_partner?.name || "Assigned"');
    expect(leadDetail).toContain("{isSuperAdmin &&");
    expect(externalOwnerDialog).toContain("assign_lead_external_owner");
    expect(externalOwnerDialog).toContain("A lead can have only one external owner.");
  });

  it("routes academic partners directly to their portal", () => {
    expect(dashboard).toContain("isAcademicPartnerPortalRole(role)");
  });
});
