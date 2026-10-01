import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sidebar = readFileSync("src/components/layout/AppSidebar.tsx", "utf8");

// Every HR page that must remain reachable from the sidebar, with the exact
// permission it is gated by. HR is grouped by function (nested collapsibles),
// so this guards both "did any page get dropped?" and "did a permission drift?".
const HR_ITEMS: Array<[route: string, permission: string]> = [
  // Pinned
  ["/hr", "hr:view"],
  ["/my-hr", "hr:self"],
  // People
  ["/hr-directory", "hr:view"],
  ["/hr-onboarding", "hr:view"],
  ["/hr-team", "hr:employees_edit"],
  ["/hr-org", "hr:view"],
  ["/hr-assets", "hr:assets_manage"],
  // Time & Attendance
  ["/hr-attendance", "hr:view"],
  ["/hr-leave", "hr:view"],
  ["/hr-comp-off", "hr:attendance_edit"],
  ["/hr-encashment", "hr:leave_approve"],
  // Payroll & Finance
  ["/hr-payroll", "hr:payroll_run"],
  ["/hr-expenses", "hr:expenses_approve"],
  ["/hr-advances", "hr:expenses_approve"],
  ["/hr-settlements", "hr:employees_edit"],
  // Hiring
  ["/hr-job-openings", "hr:view"],
  ["/hr-job-applicants", "hr:view"],
  ["/hr-recruitment", "hr:view"],
  ["/hr-referrals", "hr:self"],
  ["/whatsapp-inbox?scope=hr", "hr:view"],
  // Performance & Engagement
  ["/hr-performance", "hr:performance_manage"],
  ["/hr-announcements", "hr:engage_manage"],
  ["/hr-helpdesk", "hr:helpdesk_manage"],
  // Reports & Setup
  ["/hr-reports", "hr:view"],
  ["/hr-custom-fields", "hr:employees_edit"],
  ["/hr-settings", "hr:employees_edit"],
];

const HR_GROUPS = [
  "People",
  "Time & Attendance",
  "Payroll & Finance",
  "Hiring",
  "Performance & Engagement",
  "Reports & Setup",
];

describe("HR sidebar is grouped by HR function", () => {
  it("keeps every HR page with its permission", () => {
    for (const [route, permission] of HR_ITEMS) {
      expect(sidebar, route).toContain(`url: "${route}"`);
      expect(sidebar, `${route} permission`).toContain(`permission: "${permission}"`);
    }
  });

  it("exposes the function groups", () => {
    expect(sidebar).toContain("const hrNavGroups");
    for (const label of HR_GROUPS) {
      expect(sidebar, label).toContain(`label: "${label}"`);
    }
  });

  it("renders HR groups as nested collapsibles, not a flat list", () => {
    expect(sidebar).toContain("const hrPinnedItems");
    expect(sidebar).toContain("visibleHrGroups");
    expect(sidebar).toContain("group/hrgroup");
    // The old flat HR list is gone.
    expect(sidebar).not.toContain("hrSubMenu");
  });
});
