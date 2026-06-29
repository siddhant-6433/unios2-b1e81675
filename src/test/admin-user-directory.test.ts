import { readFileSync } from "fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync("supabase/migrations/20260629010000_admin_user_directory.sql", "utf8");
const adminPanel = readFileSync("src/pages/AdminPanel.tsx", "utf8");

describe("admin user directory", () => {
  it("exposes a guarded server-side directory for Admin Panel users", () => {
    expect(migration).toContain("CREATE OR REPLACE FUNCTION public.admin_user_directory");
    expect(migration).toContain("SECURITY DEFINER");
    expect(migration).toContain("public.has_role(auth.uid(), 'super_admin'::public.app_role)");
    expect(migration).toContain("'user_management:view' = ANY(public.get_user_permissions(auth.uid()))");
    expect(migration).toContain("LEFT JOIN public.user_roles ur ON ur.user_id = p.user_id");
    expect(migration).toContain("LEFT JOIN auth.users au ON au.id = p.user_id");
  });

  it("keeps counsellors with profile rows in the employees list read model", () => {
    expect(migration).toContain("p.deleted_at IS NULL");
    expect(migration).toContain("p.archived_at IS NULL");
    expect(adminPanel).toContain('supabase.rpc("admin_user_directory" as any');
    expect(adminPanel).toContain('if (userSubTab === "employees") return u.role && !["student", "parent", "consultant", "academic_partner", "publisher"].includes(u.role);');
    expect(adminPanel).toContain('{ value: "counsellor", label: "Counsellor" }');
  });

  it("does not stitch the user list from separate client-side profile and role queries", () => {
    expect(adminPanel).not.toContain('supabase.from("user_roles").select("id, user_id, role")');
    expect(adminPanel).not.toContain('supabase.rpc("get_user_auth_info" as any)');
  });
});
