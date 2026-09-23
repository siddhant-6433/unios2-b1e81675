import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const appSidebar = readFileSync("src/components/layout/AppSidebar.tsx", "utf8");
const pendingApprovalsPanel = readFileSync("src/components/dashboard/PendingApprovalsPanel.tsx", "utf8");

describe("principal pending approval badges", () => {
  it("counts actionable approval rows instead of the raw pending approvals RPC", () => {
    expect(appSidebar).not.toContain('supabase.rpc("count_pending_approvals"');
    expect(appSidebar).toContain('.from("pending_approvals" as any)');
    expect(appSidebar).toContain('if (item.kind === "pending_an") return false;');
    expect(appSidebar).toContain("setPendingApprovals(actionableCount)");
  });

  it("keeps the home pending approvals panel aligned with the inbox authorization", () => {
    expect(pendingApprovalsPanel).toContain('"pending_an"');
    expect(pendingApprovalsPanel).toContain('if (item.kind === "pending_an") return false;');
    expect(pendingApprovalsPanel).toContain('if (role === "principal") return item.pending_role === "principal";');
  });
});
