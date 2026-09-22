import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const campusContext = readFileSync("src/contexts/CampusContext.tsx", "utf8");
const appSidebar = readFileSync("src/components/layout/AppSidebar.tsx", "utf8");
const studentsPage = readFileSync("src/pages/Students.tsx", "utf8");

describe("campus assignment scoping", () => {
  it("only lets org-wide roles select all campuses", () => {
    expect(campusContext).toContain("const ORG_WIDE_CAMPUS_ROLES = new Set([\"super_admin\", \"admission_head\", \"principal\"])");
    expect(campusContext).toContain("const canSelectAllCampuses = role !== null && ORG_WIDE_CAMPUS_ROLES.has(role)");
    expect(campusContext).toContain('if (id === "all" && !canSelectAllCampuses) return;');
    expect(campusContext).toContain("visibleCampuses = matches");
    expect(campusContext).toContain("setSelectedCampusId(NO_ASSIGNED_CAMPUS_ID)");
  });

  it("scopes only non-org-wide roles by their assigned campuses", () => {
    expect(campusContext).toContain("if (role && !ORG_WIDE_CAMPUS_ROLES.has(role)) {");
    expect(campusContext).not.toContain('role !== "super_admin"');
  });

  it("does not render the All Campuses selector option for scoped users", () => {
    expect(appSidebar).toContain("canSelectAllCampuses");
    expect(appSidebar).toContain('{canSelectAllCampuses && <option value="all">All Campuses</option>}');
    expect(appSidebar).toContain("NO_ASSIGNED_CAMPUS_ID");
  });

  it("keeps the students query scoped by the selected campus", () => {
    expect(studentsPage).toContain('if (selectedCampusId !== "all") query = query.eq("campus_id", selectedCampusId);');
  });
});
