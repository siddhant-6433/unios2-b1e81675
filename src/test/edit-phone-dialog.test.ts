import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  adminUserCategoryForRole,
  adminUserCategoryLabel,
  adminUserProfileHref,
  formatRoleLabel,
  phoneMatchKey,
} from "@/components/admin/EditPhoneDialog";

const source = readFileSync("src/components/admin/EditPhoneDialog.tsx", "utf8");
const adminPanel = readFileSync("src/pages/AdminPanel.tsx", "utf8");

describe("EditPhoneDialog phone uniqueness UX", () => {
  it("normalizes match keys to last 10 digits", () => {
    expect(phoneMatchKey("+919717554419")).toBe("9717554419");
    expect(phoneMatchKey("9717554419")).toBe("9717554419");
    expect(phoneMatchKey("91 97175 54419")).toBe("9717554419");
    expect(phoneMatchKey(null)).toBe("");
  });

  it("maps roles to admin directory tabs (no role → leads, not employees)", () => {
    expect(adminUserCategoryForRole(null)).toBe("leads");
    expect(adminUserCategoryForRole("consultant")).toBe("consultants");
    expect(adminUserCategoryForRole("counsellor")).toBe("employees");
    expect(adminUserCategoryLabel("leads")).toBe("Leads & Applicants");
    expect(formatRoleLabel("academic_partner")).toBe("Academic Partner");
    expect(formatRoleLabel(null)).toBe("No role");
    expect(adminUserProfileHref("abc-123", { category: "leads", search: "9717554419" })).toBe(
      "/admin?tab=users&user=abc-123&category=leads&q=9717554419",
    );
  });

  it("pre-checks owners, shows tab location, and focuses directory on open", () => {
    expect(source).toContain("findPhoneOwners");
    expect(source).toContain("profiles_phone_unique");
    expect(source).toContain("Reassign number to");
    expect(source).toContain("Number already in use");
    expect(source).toContain("Find under");
    expect(source).toContain("Go to user");
    expect(source).toContain("Leads & Applicants");
    // AdminPanel is reached through a full-page deep link rather than an
    // onOpenProfile callback, so it must honour the params in that URL.
    expect(source).toContain("window.location.assign(adminUserProfileHref(");
    expect(adminPanel).toContain('searchParams.get("category")');
    expect(adminPanel).toContain('searchParams.get("q")');
    expect(adminPanel).toContain("setUserSubTab(category as typeof userSubTab)");
    expect(adminPanel).toContain("USER_SUB_TABS");
  });
});


