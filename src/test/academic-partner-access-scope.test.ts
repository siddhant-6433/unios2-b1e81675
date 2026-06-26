import { readFileSync } from "fs";
import { describe, expect, it } from "vitest";

const app = readFileSync("src/App.tsx", "utf8");
const authContext = readFileSync("src/contexts/AuthContext.tsx", "utf8");
const sidebar = readFileSync("src/components/layout/AppSidebar.tsx", "utf8");
const protectedRoute = readFileSync("src/components/ProtectedRoute.tsx", "utf8");
const permissionContext = readFileSync("src/contexts/PermissionContext.tsx", "utf8");
const marketing = readFileSync("src/pages/Marketing.tsx", "utf8");
const leadLists = readFileSync("src/pages/LeadLists.tsx", "utf8");
const portal = readFileSync("src/pages/AcademicPartnerPortal.tsx", "utf8");
const manualCall = readFileSync("supabase/functions/manual-call/index.ts", "utf8");
const migration = readFileSync(
  "supabase/migrations/20260626082924_restrict_academic_partner_portal_permissions.sql",
  "utf8",
);

describe("academic partner access scope", () => {
  it("hides and blocks marketing surfaces for academic partners", () => {
    expect(protectedRoute).toContain('role === "academic_partner" && location.pathname !== "/academic-partner-portal"');
    expect(protectedRoute).toContain('role === "academic_partner" && `${module}:${action}` !== ACADEMIC_PARTNER_ALLOWED_PERMISSION');
    expect(permissionContext).toContain('role === "academic_partner"');
    expect(permissionContext).toContain('ACADEMIC_PARTNER_ALLOWED_PERMISSIONS.has(`${module}:${action}`)');
    expect(authContext).toContain('role === "academic_partner") return ACADEMIC_PARTNER_ALLOWED_PERMISSIONS.includes(perm)');
    expect(sidebar).toContain("const academicPartnerMenu");
    expect(sidebar).toContain('/academic-partner-portal?tab=applications');
    expect(sidebar).toContain('/academic-partner-portal?tab=fees');
    expect(sidebar).toContain('if (item.roles?.includes("academic_partner")) return true');
    expect(sidebar).toContain('role !== "academic_partner" && campuses.length > 0');
    expect(sidebar).toContain('role === "academic_partner" ? [] : marketingSubMenu.filter(canSee)');
    expect(sidebar).toContain('blockedRoles: ["academic_partner"]');
    expect(app).toContain('<BlockRole roles={["academic_partner"]}><RequirePermission module="leads" action="view"><LeadLists />');
    expect(app).toContain('<BlockRole roles={["academic_partner"]}><RequirePermission module="leads" action="view"><Marketing />');
    expect(app).toContain('<BlockRole roles={["academic_partner"]}><RequirePermission module="templates" action="view"><TemplateManager />');
    expect(marketing).toContain('role === "academic_partner"');
    expect(marketing).toContain('<Navigate to="/academic-partner-portal" replace />');
    expect(leadLists).toContain('role === "academic_partner"');
    expect(leadLists).toContain('<Navigate to="/academic-partner-portal" replace />');
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
    expect(portal).toContain('.eq("academic_partner_id", partnerId)');
    expect(portal).toContain("applicationLeads");
    expect(portal).toContain("No applications found for assigned leads");
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
