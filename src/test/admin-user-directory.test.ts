import { readFileSync } from "fs";
import { describe, expect, it } from "vitest";
import { ALL_APP_ROLES, ROLE_LABELS } from "@/lib/accessPolicy";

const migration = readFileSync("supabase/migrations/20260712000000_admin_user_directory_paginated.sql", "utf8");
const phoneRecovery = readFileSync(
  "supabase/migrations/20260713170000_admin_directory_phone_search_recovery.sql",
  "utf8",
);
const adminPanel = readFileSync("src/pages/AdminPanel.tsx", "utf8");

describe("admin user directory", () => {
  it("exposes a guarded server-side directory for Admin Panel users", () => {
    expect(migration).toContain("CREATE OR REPLACE FUNCTION public.admin_user_directory");
    expect(migration).toContain("SECURITY DEFINER");
    expect(migration).toContain("public.has_role(auth.uid(), 'super_admin'::public.app_role)");
    expect(migration).toContain("'user_management:view' = ANY(public.get_user_permissions(auth.uid()))");
    expect(migration).toContain("LEFT JOIN auth.users au ON au.id = p.user_id");
  });

  it("paginates and filters server-side so counts survive past the 1000-row API cap", () => {
    // The directory returns one page plus a window count, filtered by category
    // in SQL — not the whole table filtered in the browser.
    expect(migration).toContain("count(*) OVER() AS total_count");
    expect(migration).toContain("LIMIT NULLIF(_limit, 0) OFFSET GREATEST(_offset, 0)");
    expect(migration).toContain("_category = 'consultants' AND ur.role::text = 'consultant'");
    expect(migration).toContain("_category = 'leads' AND ur.role IS NULL");
    expect(adminPanel).toContain('supabase.rpc("admin_user_directory" as any');
    expect(adminPanel).toContain("_offset: onPublishers ? 0 : page * PAGE_SIZE");
  });

  it("derives one primary role per user so multi-role users are not duplicated", () => {
    expect(migration).toContain("SELECT DISTINCT ON (u.user_id)");
    expect(migration).toContain("array_position(");
  });

  it("reads badge and stat-card counts from a server-side aggregate RPC", () => {
    expect(migration).toContain("CREATE OR REPLACE FUNCTION public.admin_user_directory_counts");
    expect(migration).toContain("'consultants', count(*) FILTER (WHERE role::text = 'consultant')");
    expect(migration).toContain("'admins', count(*) FILTER (WHERE role::text IN ('super_admin','campus_admin'))");
    expect(adminPanel).toContain('supabase.rpc("admin_user_directory_counts" as any');
    expect(adminPanel).toContain("value={c?.consultants ?? 0}");
    expect(adminPanel).toContain("{counts?.total ?? 0} total users");
  });

  it("keeps the counsellor role in the panel role list and its read-model guards", () => {
    expect(migration).toContain("p.deleted_at IS NULL");
    expect(migration).toContain("p.archived_at IS NULL");
    // The role dropdown is derived from accessPolicy's single source of truth
    // rather than a hand-maintained copy in AdminPanel, so assert against that.
    expect(adminPanel).toContain("ALL_APP_ROLES.map((value) => ({ value, label: ROLE_LABELS[value] }))");
    expect(ALL_APP_ROLES).toContain("counsellor");
    expect(ROLE_LABELS.counsellor).toBe("Counsellor");
  });

  it("surfaces soft-deleted/archived phone holders via digit-normalized recovery search", () => {
    expect(phoneRecovery).toContain("phone_lookup");
    expect(phoneRecovery).toContain("right(regexp_replace(COALESCE(p.phone, ''), '\\D', '', 'g'), 10) = pl.key10");
    expect(phoneRecovery).toContain("deleted_at timestamptz");
    expect(phoneRecovery).toContain("Phone recovery");
    expect(adminPanel).toContain("Soft-deleted · still holds phone");
  });

  it("does not stitch the user list from separate client-side profile and role queries", () => {
    expect(adminPanel).not.toContain('supabase.from("user_roles").select("id, user_id, role")');
    expect(adminPanel).not.toContain('supabase.rpc("get_user_auth_info" as any)');
  });
});

