import { describe, expect, it } from "vitest";
import {
  canSeePolicyItem,
  decidePermissionAccess,
  type AccessState,
} from "@/lib/accessPolicy";

/**
 * Stakeholder-POV access matrix for the HR surfaces added by the finalization.
 * Each row mirrors the grants seeded in the migrations, so a permission that is
 * widened or dropped in SQL without updating the UI (or vice versa) fails here.
 */

const state = (overrides: Partial<AccessState>): AccessState => ({
  isAuthenticated: true,
  role: "campus_admin",
  realRole: "campus_admin",
  permissions: [],
  ...overrides,
});

const HR_ROUTES: Array<[string, string]> = [
  ["/my-hr", "hr:self"],
  ["/hr", "hr:view"],
  ["/hr-attendance", "hr:view"],
  ["/hr-leave", "hr:view"],
  ["/hr-directory", "hr:view"],
  ["/hr-reports", "hr:view"],
  ["/hr-payroll", "hr:payroll_run"],
  ["/hr-expenses", "hr:expenses_approve"],
  ["/hr-performance", "hr:performance_manage"],
  ["/hr-announcements", "hr:engage_manage"],
  ["/hr-helpdesk", "hr:helpdesk_manage"],
  ["/hr-settings", "hr:employees_edit"],
];

const allowed = (s: AccessState, perm: string) => decidePermissionAccess(s, perm).allowed;

const CAMPUS_ADMIN_PERMS = [
  "hr:self", "hr:view", "hr:employees_edit", "hr:attendance_edit", "hr:leave_approve",
  "hr:recruitment_edit", "hr:bank_edit", "hr:payroll_run", "hr:documents_generate",
  "hr:interviews_edit", "hr:expenses_approve", "hr:expenses_manage",
  "hr:performance_manage", "hr:engage_manage", "hr:helpdesk_manage",
];

describe("HR stakeholder access matrix", () => {
  it("a plain employee (hr:self) reaches only My HR, none of the management surfaces", () => {
    const employee = state({ role: "non_teaching", realRole: "non_teaching", permissions: ["hr:self"] });
    expect(allowed(employee, "hr:self")).toBe(true);
    for (const [route, perm] of HR_ROUTES) {
      if (perm === "hr:self") continue;
      expect(allowed(employee, perm), `${route} should be blocked for an employee`).toBe(false);
    }
  });

  it("an HR executive reaches HR views and reports but not payroll administration", () => {
    const hrExec = state({
      role: "hr_executive",
      realRole: "hr_executive",
      permissions: [
        "hr:self", "hr:view", "hr:recruitment_edit", "hr:documents_generate", "hr:interviews_edit",
      ],
    });
    expect(allowed(hrExec, "hr:view")).toBe(true);
    expect(allowed(hrExec, "hr:recruitment_edit")).toBe(true);
    expect(allowed(hrExec, "hr:documents_generate")).toBe(true);
    // Not granted to hr_executive in SQL.
    expect(allowed(hrExec, "hr:payroll_run")).toBe(false);
    expect(allowed(hrExec, "hr:employees_edit")).toBe(false);
    expect(allowed(hrExec, "hr:expenses_approve")).toBe(false);
  });

  it("a campus admin reaches every HR surface", () => {
    const admin = state({ permissions: CAMPUS_ADMIN_PERMS });
    for (const [route, perm] of HR_ROUTES) {
      expect(allowed(admin, perm), `${route} (${perm}) should be allowed for campus_admin`).toBe(true);
    }
  });

  it("a super admin passes every HR gate", () => {
    const superAdmin = state({ role: "super_admin", realRole: "super_admin", permissions: ["*"] });
    for (const [route, perm] of HR_ROUTES) {
      expect(allowed(superAdmin, perm), `${route} should be allowed for super_admin`).toBe(true);
    }
  });

  it("sidebar items only appear for the matching permission", () => {
    const employee = state({ role: "non_teaching", realRole: "non_teaching", permissions: ["hr:self"] });
    const admin = state({ permissions: CAMPUS_ADMIN_PERMS });

    const sidebarItems = HR_ROUTES.map(([url, permission]) => ({ url, permission }));

    expect(canSeePolicyItem(employee, sidebarItems.find((i) => i.url === "/my-hr")!)).toBe(true);
    expect(canSeePolicyItem(employee, sidebarItems.find((i) => i.url === "/hr-expenses")!)).toBe(false);
    expect(canSeePolicyItem(employee, sidebarItems.find((i) => i.url === "/hr-payroll")!)).toBe(false);

    for (const item of sidebarItems) {
      expect(canSeePolicyItem(admin, item), `${item.url} should be visible to campus_admin`).toBe(true);
    }
  });
});
