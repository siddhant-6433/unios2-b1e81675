import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sidebar = readFileSync("src/components/layout/AppSidebar.tsx", "utf8");
const globalActionBar = readFileSync("src/components/layout/GlobalActionBar.tsx", "utf8");
const accessPolicy = readFileSync("src/lib/accessPolicy.ts", "utf8");
const campusContext = readFileSync("src/contexts/CampusContext.tsx", "utf8");

describe("AppSidebar access policy wiring", () => {
  it("uses the shared access policy for settings visibility", () => {
    expect(sidebar).toContain("canViewSettings");
    expect(sidebar).toContain('permission: "user_management:view"');
    expect(sidebar).toContain("canSeePolicyItem(accessState");
    expect(sidebar).not.toContain("can(\"user_management\", \"view\")");
  });

  it("does not let anyPermission widen role-restricted sidebar items", () => {
    expect(accessPolicy).toContain("if (roles) return roles.includes(state.role as AppRole);");
    expect(accessPolicy.indexOf("if (roles) return roles.includes")).toBeLessThan(
      accessPolicy.indexOf("if (anyPermission && canUseAnyPermission"),
    );
  });

  it("hides all-campus selection for campus-scoped non-super-admins", () => {
    expect(campusContext).toContain("Any non-super-admin with profile.campus set is branch-scoped");
    expect(sidebar).toContain('{role === "super_admin" || !profile?.campus ? <option value="all">All Campuses</option> : null}');
  });

  it("shows the global lead pendency bar only to counsellor, admission head and super admin", () => {
    expect(globalActionBar).toContain('role === "super_admin" || role === "admission_head" || role === "counsellor"');
    expect(globalActionBar).toContain("if (!canUseLeadPendency) return null;");
    expect(globalActionBar).not.toContain('role === "campus_admin"');
    expect(globalActionBar).not.toContain("useIsTeamLeader");
  });
});
