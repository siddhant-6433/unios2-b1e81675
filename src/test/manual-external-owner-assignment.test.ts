import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const originalMigration = readFileSync(
  "supabase/migrations/20260624100600_manual_external_owner_assignment.sql",
  "utf8",
);
const expandedAccessMigration = readFileSync(
  "supabase/migrations/20260713160000_assign_owner_principal_counsellor.sql",
  "utf8",
);
const sourceLockBypassMigration = readFileSync(
  "supabase/migrations/20260723120000_owner_assign_bypasses_source_lock.sql",
  "utf8",
);
const leadDetail = readFileSync("src/pages/LeadDetail.tsx", "utf8");
const externalOwnerDialog = readFileSync("src/components/admissions/ExternalOwnerDialog.tsx", "utf8");
const dashboard = readFileSync("src/pages/Dashboard.tsx", "utf8");

describe("manual external owner assignment", () => {
  it("uses a security-definer RPC for manual consultant or academic partner ownership", () => {
    expect(originalMigration).toContain("CREATE OR REPLACE FUNCTION public.assign_lead_external_owner");
    expect(originalMigration).toContain("SECURITY DEFINER");
    expect(originalMigration).toContain("GRANT EXECUTE ON FUNCTION public.assign_lead_external_owner");
    expect(expandedAccessMigration).toContain("CREATE OR REPLACE FUNCTION public.assign_lead_external_owner");
    expect(expandedAccessMigration).toContain("can_assign_lead_external_owner");
  });

  it("allows principal and consultant-access counsellors in addition to super_admin", () => {
    expect(expandedAccessMigration).toContain("CREATE OR REPLACE FUNCTION public.can_assign_lead_external_owner");
    expect(expandedAccessMigration).toContain("has_role(_user_id, 'super_admin'::app_role)");
    expect(expandedAccessMigration).toContain("has_role(_user_id, 'principal'::app_role)");
    expect(expandedAccessMigration).toContain("has_role(_user_id, 'counsellor'::app_role)");
    expect(expandedAccessMigration).toContain("'consultants:view' = ANY(public.get_user_permissions(_user_id))");
    expect(expandedAccessMigration).toContain("'leads:assign_external_owner' = ANY(public.get_user_permissions(_user_id))");
    expect(expandedAccessMigration).toContain("Not allowed to assign lead external owners");
    expect(expandedAccessMigration).toContain("module = 'leads' AND p.action = 'assign_external_owner'");
    expect(expandedAccessMigration).toContain("'principal'::app_role");
  });

  it("enforces one external owner and validates active owners", () => {
    expect(originalMigration).toContain("stage <> 'inactive'");
    expect(originalMigration).toContain("status = 'active'");
    expect(originalMigration).toContain("consultant_id = _consultant_id");
    expect(originalMigration).toContain("academic_partner_id = NULL");
    expect(originalMigration).toContain("consultant_id = NULL");
    expect(originalMigration).toContain("academic_partner_id = _academic_partner_id");
    expect(originalMigration).toContain("source = 'consultant'::lead_source");
    expect(originalMigration).toContain("source = 'academic_partner'::lead_source");
  });

  it("audits manual owner changes in the lead activity timeline", () => {
    expect(originalMigration).toContain("INSERT INTO public.lead_activities");
    expect(originalMigration).toContain("External owner changed from");
    expect(originalMigration).toContain("v_actor_profile_id");
  });

  it("keeps academic partner CRM access mapped-only while restricting fee rows to direct mapped leads", () => {
    expect(originalMigration).toContain("can_academic_partner_view_mapped_lead");
    expect(originalMigration).toContain("can_academic_partner_view_fee_student");
    expect(originalMigration).toContain("Academic partners view own leads");
    expect(originalMigration).toContain("public.can_academic_partner_view_mapped_lead(auth.uid(), id)");
    expect(originalMigration).toContain("Academic partners view mapped fee ledger");
    expect(originalMigration).toContain("public.can_academic_partner_view_fee_student(auth.uid(), student_id)");
    expect(originalMigration).not.toContain("l.course_id IS NOT NULL\n      AND public.is_academic_partner_scope(_user_id, l.course_id, NULL)");
  });

  it("exposes Assign Owner on lead detail for principal and consultant-access staff", () => {
    expect(originalMigration).toContain("'lead_consultant'");
    expect(originalMigration).toContain("'lead_academic_partner'");
    expect(leadDetail).toContain("ExternalOwnerDialog");
    expect(leadDetail).toContain("Assign Owner");
    expect(leadDetail).toContain('lead.lead_academic_partner?.organization || lead.lead_academic_partner?.name || "Assigned"');
    expect(leadDetail).toContain("canAssignExternalOwner");
    expect(leadDetail).toContain('hasPermission("leads:assign_external_owner")');
    expect(leadDetail).toContain('hasPermission("consultants:view")');
    expect(leadDetail).toContain('role === "principal"');
    expect(leadDetail).toContain('{canAssignExternalOwner &&');
    expect(externalOwnerDialog).toContain("assign_lead_external_owner");
    expect(externalOwnerDialog).toContain("A lead can have only one external owner.");
  });

  it("lets owner assignment re-stamp source past the lock trigger without unlocking manual edits", () => {
    // RPC raises a tx-local flag before its source-changing UPDATEs...
    expect(sourceLockBypassMigration).toContain("set_config('app.assign_owner_source', 'on', true)");
    // ...and the lock trigger honors that flag while still auditing.
    expect(sourceLockBypassMigration).toContain("current_setting('app.assign_owner_source', true)");
    expect(sourceLockBypassMigration).toContain("INSERT INTO public.lead_source_audit");
    // Manual edits by non-whitelisted roles remain blocked.
    expect(sourceLockBypassMigration).toContain("Lead source is locked after creation");
  });

  it("routes academic partners directly to their portal", () => {
    expect(dashboard).toContain("isAcademicPartnerPortalRole(role)");
  });
});
