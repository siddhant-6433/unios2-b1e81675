import { readFileSync } from "fs";
import { describe, expect, it } from "vitest";
import {
  canSeePolicyItem,
  canUsePermission,
  decideBlockedRoleAccess,
  decidePermissionAccess,
  decideStaffAppAccess,
  type AccessState,
} from "@/lib/accessPolicy";

const portal = readFileSync("src/pages/AcademicPartnerPortal.tsx", "utf8");
const manualCall = readFileSync("supabase/functions/manual-call/index.ts", "utf8");
const migration = readFileSync(
  "supabase/migrations/20260626082924_restrict_academic_partner_portal_permissions.sql",
  "utf8",
);
const leadAssociationMigration = readFileSync(
  "supabase/migrations/20260619121300_lead_association_approval_requests.sql",
  "utf8",
);

describe("academic partner access scope", () => {
  it("hides and blocks marketing surfaces for academic partners", () => {
    const academicPartner: AccessState = {
      isAuthenticated: true,
      role: "academic_partner",
      realRole: "academic_partner",
      permissions: ["academic_partner_portal:view"],
    };

    expect(decideStaffAppAccess(academicPartner, "/academic-partner-portal")).toEqual({ allowed: true });
    expect(decideStaffAppAccess(academicPartner, "/marketing")).toEqual({
      allowed: false,
      reason: "academic_partner_scope",
      redirectTo: "/academic-partner-portal",
    });
    expect(decidePermissionAccess(academicPartner, "leads:view")).toEqual({
      allowed: false,
      reason: "academic_partner_scope",
      redirectTo: "/academic-partner-portal",
    });
    expect(decideBlockedRoleAccess(academicPartner, ["academic_partner"])).toEqual({
      allowed: false,
      reason: "wrong_role",
      redirectTo: "/forbidden",
    });
    expect(canUsePermission(academicPartner, "academic_partner_portal:view")).toBe(true);
    expect(canUsePermission(academicPartner, "templates:view")).toBe(false);
    expect(canSeePolicyItem(academicPartner, { url: "/academic-partner-portal?tab=applications" })).toBe(true);
    expect(canSeePolicyItem(academicPartner, { url: "/academic-partner-portal?tab=fees" })).toBe(true);
    expect(canSeePolicyItem(academicPartner, { url: "/lists", permission: "leads:view", blockedRoles: ["academic_partner"] })).toBe(false);
    expect(canSeePolicyItem(academicPartner, { url: "/marketing", permission: "leads:view", blockedRoles: ["academic_partner"] })).toBe(false);
    expect(canSeePolicyItem(academicPartner, { url: "/template-manager", permission: "templates:view", blockedRoles: ["academic_partner"] })).toBe(false);
  });

  it("keeps academic partners inside their dedicated portal instead of full CRM lead detail", () => {
    expect(portal).not.toContain('navigate(`/admissions/${lead.id}`)');
    expect(portal).not.toContain('useNavigate');
  });

  it("shows student-wise fee collection and academic attendance records inside the partner portal", () => {
    expect(portal).toContain("useSearchParams");
    expect(portal).toContain("PORTAL_TABS");
    expect(portal).toContain("setSearchParams");
    expect(portal).toContain('label: "Fee Collection", value: "fees"');
    expect(portal).toContain('label: "Academic Record", value: "attendance"');
    expect(portal).toContain("feeByStudent");
    expect(portal).toContain("attendanceByStudent");
    expect(portal).toContain("No fee collection found for assigned candidates");
  });

  it("shows application status and a direct login link action for assigned leads", () => {
    expect(portal).toContain("ApplyMagicLinkButton");
    expect(portal).toContain('label: "Applications", value: "applications"');
    expect(portal).toContain('<TabsContent value="applications"');
    expect(portal).toContain("Application Stage");
    expect(portal).toContain("application_status");
    expect(portal).toContain("application_payment_status");
    expect(portal).toContain("View Application");
    expect(portal).toContain("directOpen");
    expect(portal.match(/ApplyMagicLinkButton/g)?.length || 0).toBeGreaterThanOrEqual(3);
  });

  it("keeps leads and applications scoped to the mapped academic partner", () => {
    expect(portal).toContain("LeadPipeline");
    expect(portal).toContain("ApplicationFunnelStrip");
    expect(portal).toContain("ACADEMIC_PARTNER_PIPELINE_LEAD_SELECT");
    expect(portal).toContain("source, academic_partner_id");
    expect(portal).toContain("scopePartnerPipelineLeads");
    expect(portal).toContain("lead.academic_partner_id === partnerId");
    expect(portal).toContain('.eq("academic_partner_id", partnerId)');
    expect(portal).toContain("Partner-created new leads are mapped on insert");
    expect(portal).toContain("duplicate existing CRM leads");
    expect(portal).toContain("applicationLeads");
    expect(portal).toContain("No applications found for assigned leads");
    expect(leadAssociationMigration).toContain("v_existing_lead_id IS NULL");
    expect(leadAssociationMigration).toContain("CASE WHEN _requester_type = 'academic_partner' THEN _academic_partner_id ELSE NULL END");
    expect(leadAssociationMigration).toContain("'status', 'pending'");
  });

  it("allows cloud calls from the portal only through scoped manual-call authorization", () => {
    expect(portal).toContain('supabase.functions.invoke("manual-call"');
    expect(portal).toContain("placeCloudCall(lead)");
    expect(portal).toContain("Cloud Call");
    expect(manualCall).toContain('callerDb.auth.getUser()');
    expect(manualCall).toContain('callerRole === "academic_partner"');
    expect(manualCall).toContain("can_academic_partner_view_mapped_lead");
    expect(manualCall).toContain("You can call only leads assigned to your academic partner account.");
  });

  it("lets academic partners set their own cloud call agent number in portal settings", () => {
    expect(portal).toContain('label: "Settings", value: "settings"');
    expect(portal).toContain("Cloud Call Settings");
    expect(portal).toContain("Calling agent number");
    expect(portal).toContain("saveCallingAgentPhone");
    expect(portal).toContain('.from("profiles")');
    expect(portal).toContain(".update({ phone: normalized })");
    expect(portal).toContain('.eq("user_id", user.id)');
  });

  it("removes broad role permissions while preserving the portal grant", () => {
    expect(migration).toContain("DELETE FROM public.role_permissions");
    expect(migration).toContain("('leads', 'view')");
    expect(migration).toContain("('finance', 'view')");
    expect(migration).toContain("('students', 'view')");
    expect(migration).toContain("('academic_partner_portal', 'view')");
  });

  it("scopes students by batch and financial rows by mapped lead ownership", () => {
    expect(migration).toContain("public.is_academic_partner_scope(auth.uid(), course_id, batch_id)");
    expect(migration).toContain("public.can_academic_partner_view_fee_student(auth.uid(), student_id)");
    expect(migration).toContain("public.can_academic_partner_view_mapped_lead(auth.uid(), lead_id)");
  });
});
