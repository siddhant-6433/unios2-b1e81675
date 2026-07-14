import { readFileSync } from "fs";
import { describe, expect, it } from "vitest";

const panel = readFileSync("src/components/admin/PhotoDayAssigneesPanel.tsx", "utf8");
const dialog = readFileSync("src/components/admin/UserPermissionsDialog.tsx", "utf8");
const idCard = readFileSync("src/pages/IdCardCenter.tsx", "utf8");
const listRpc = readFileSync("supabase/migrations/20260713210000_photo_day_list_staff_rpc.sql", "utf8");

describe("Photo Day assign UI", () => {
  it("lists staff and toggles via assign_photo_day RPC", () => {
    expect(panel).toContain("list_photo_day_staff");
    expect(panel).toContain("assign_photo_day");
    expect(panel).toContain("can_assign_photo_day");
    expect(panel).toContain("Photo Day assignees");
  });

  it("routes photo_day:capture toggles in permissions dialog through assign_photo_day", () => {
    expect(dialog).toContain('perm?.module === "photo_day"');
    expect(dialog).toContain('perm.action === "capture"');
    expect(dialog).toContain("assign_photo_day");
  });

  it("embeds assignees panel and photo status filters in Id Card Center", () => {
    expect(idCard).toContain("PhotoDayAssigneesPanel");
    expect(idCard).toContain("Missing photo");
    expect(idCard).toContain("AI pending");
    expect(idCard).toContain("photo_original_url");
    expect(idCard).toContain("photo_processed_url");
    expect(idCard).toContain('photoFilter === "ai_pending"');
  });

  it("resolves campus via profiles.campus text join (no campus_id column)", () => {
    expect(listRpc).toContain("user_assigned_campus_ids");
    expect(listRpc).toContain("list_photo_day_staff");
    expect(listRpc).toContain("lower(c.name) = lower(pr.campus)");
  });
});
