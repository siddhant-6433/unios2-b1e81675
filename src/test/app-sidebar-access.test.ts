import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sidebar = readFileSync("src/components/layout/AppSidebar.tsx", "utf8");

describe("AppSidebar access policy wiring", () => {
  it("uses the shared access policy for settings visibility", () => {
    expect(sidebar).toContain("canViewSettings");
    expect(sidebar).toContain('permission: "user_management:view"');
    expect(sidebar).toContain("canSeePolicyItem(accessState");
    expect(sidebar).not.toContain("can(\"user_management\", \"view\")");
  });
});
