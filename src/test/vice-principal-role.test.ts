import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ALL_APP_ROLES, ROLE_LABELS } from "@/lib/accessPolicy";

const enumMigration = readFileSync("supabase/migrations/20261005134017_add_vice_principal_role_access.sql", "utf8");
const grantsMigration = readFileSync("supabase/migrations/20261005134101_add_vice_principal_permissions.sql", "utf8");
const inviteDialog = readFileSync("src/components/admin/InviteUserDialog.tsx", "utf8");
const employeeLogin = readFileSync("src/lib/employeeLogin.ts", "utf8");

describe("Vice Principal role", () => {
  it("is a first-class independently configurable staff role", () => {
    expect(ALL_APP_ROLES).toContain("vice_principal");
    expect(ROLE_LABELS.vice_principal).toBe("Vice Principal");
    expect(inviteDialog).toContain('{ value: "vice_principal", label: "Vice Principal" }');
    expect(employeeLogin).toContain('{ value: "vice_principal", label: "Vice Principal" }');
  });

  it("starts with Principal grants and inherits Principal database capability checks", () => {
    expect(enumMigration).toContain("ADD VALUE IF NOT EXISTS 'vice_principal'");
    expect(grantsMigration).toContain("SELECT 'vice_principal'::public.app_role, permission_id");
    expect(grantsMigration).toContain("role = 'vice_principal' AND _role = 'principal'");
  });
});
