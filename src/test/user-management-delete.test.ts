import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const adminPanel = readFileSync("src/pages/AdminPanel.tsx", "utf8");
const deleteUserFunction = readFileSync("supabase/functions/delete-user/index.ts", "utf8");
const softDeleteMigration = readFileSync("supabase/migrations/20260619111600_soft_deleted_profiles.sql", "utf8");
const archiveMigration = readFileSync("supabase/migrations/20260619112000_archive_user_profiles.sql", "utf8");
const adminUserDirectoryMigration = readFileSync("supabase/migrations/20260629010000_admin_user_directory.sql", "utf8");

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
    expect(adminUserDirectoryMigration).toContain("WHERE p.deleted_at IS NULL");
    expect(adminPanel).toContain('supabase.rpc("admin_user_directory" as any');
    expect(adminPanel).toContain("removed from active user management");
  });

  it("archives disabled users separately from deletion", () => {
    expect(archiveMigration).toContain("ADD COLUMN IF NOT EXISTS archived_at");
    expect(archiveMigration).toContain("ADD COLUMN IF NOT EXISTS archived_by");
    expect(adminPanel).toContain("showArchivedUsers");
    expect(adminPanel).toContain("_show_archived: showArchivedUsers");
    expect(adminUserDirectoryMigration).toContain("(_show_archived AND p.archived_at IS NOT NULL)");
    expect(adminUserDirectoryMigration).toContain("(NOT _show_archived AND p.archived_at IS NULL)");
    expect(adminPanel).toContain("Disable login before archiving a user.");
    expect(adminPanel).toContain("Archive inactive user");
    expect(adminPanel).toContain("Restore to main user list");
  });
});
