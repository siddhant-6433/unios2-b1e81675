import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const CALL_SURFACES = [
  "src/pages/CloudDialer.tsx",
  "src/pages/LeadDetail.tsx",
  "src/pages/PendingFollowups.tsx",
  "src/pages/MissedCalls.tsx",
  "src/pages/CahetSprint.tsx",
  "src/pages/UpdeledSprint.tsx",
  "src/pages/AcademicPartnerPortal.tsx",
] as const;

describe("CRM cloud-call surfaces", () => {
  it.each(CALL_SURFACES)("%s routes manual-call through startCloudCall", (path) => {
    const source = readFileSync(path, "utf8");
    expect(source).toContain('from "@/lib/startCloudCall"');
    expect(source).toContain("startCloudCall(");
    expect(source).not.toContain('functions.invoke("manual-call"');
  });
});
