import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const adminPanel = readFileSync("src/pages/AdminPanel.tsx", "utf8");
const deleteUserFunction = readFileSync("supabase/functions/delete-user/index.ts", "utf8");
const softDeleteMigration = readFileSync("supabase/migrations/20260619111000_soft_deleted_profiles.sql", "utf8");
const archiveMigration = readFileSync("supabase/migrations/20260619112000_archive_user_profiles.sql", "utf8");

describe("admin user deletion", () => {
  it("soft-deletes users without hard-deleting referenced profiles", () => {
    expect(deleteUserFunction).toContain("deleteUser(user_id, true)");
    expect(deleteUserFunction).toContain("deleted_at: new Date().toISOString()");
    expect(deleteUserFunction).toContain("admin_revoke_user_sessions");
    expect(deleteUserFunction).not.toContain('from("profiles").delete()');
  });

  it("hides soft-deleted profiles from active user management", () => {
    expect(softDeleteMigration).toContain("ADD COLUMN IF NOT EXISTS deleted_at");
    expect(softDeleteMigration).toContain("ADD COLUMN IF NOT EXISTS deleted_by");
    expect(adminPanel).toContain('.is("deleted_at", null)');
    expect(adminPanel).toContain("removed from active user management");
  });

  it("archives disabled users separately from deletion", () => {
    expect(archiveMigration).toContain("ADD COLUMN IF NOT EXISTS archived_at");
    expect(archiveMigration).toContain("ADD COLUMN IF NOT EXISTS archived_by");
    expect(adminPanel).toContain("showArchivedUsers");
    expect(adminPanel).toContain('profileQuery.not("archived_at", "is", null)');
    expect(adminPanel).toContain('profileQuery.is("archived_at", null)');
    expect(adminPanel).toContain("Disable login before archiving a user.");
    expect(adminPanel).toContain("Archive inactive user");
    expect(adminPanel).toContain("Restore to main user list");
  });
});
