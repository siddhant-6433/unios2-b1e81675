import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Found by suffix: the pre-commit stamper rewrites new migration timestamps to
// the real commit time, so a hardcoded version would rot immediately.
const migrationFile = readdirSync("supabase/migrations").find((f) =>
  f.endsWith("_deleted_students_stop_suppressing_numbers.sql"),
);
if (!migrationFile) throw new Error("suppression migration not found");
const migration = readFileSync(`supabase/migrations/${migrationFile}`, "utf8");

describe("deleted students stop suppressing numbers", () => {
  it("no longer treats a set deleted_at as a suppression trigger", () => {
    // Guards against regressing to the old "disabled OR archived OR deleted"
    // predicate, which kept a deleted student's (often shared) number blocked.
    expect(migration).not.toContain("s.deleted_at IS NOT NULL");
    expect(migration).not.toContain("st.deleted_at IS NOT NULL");
  });

  it("excludes deleted students in every suppression function", () => {
    const guards = migration.match(/deleted_at IS NULL/g) || [];
    // lead + phone + email (s.*) plus the two student arms of wa_suppressed_phones
    expect(guards.length).toBeGreaterThanOrEqual(5);

    expect(migration).toContain("CREATE OR REPLACE FUNCTION public.lead_comms_suppressed");
    expect(migration).toContain("CREATE OR REPLACE FUNCTION public.phone_comms_suppressed");
    expect(migration).toContain("CREATE OR REPLACE FUNCTION public.email_comms_suppressed");
    expect(migration).toContain("CREATE OR REPLACE FUNCTION public.wa_suppressed_phones");
  });

  it("keeps suppressing login-disabled and archived students", () => {
    expect(migration).toContain("COALESCE(s.login_disabled, false)");
    expect(migration).toContain("s.archived_at IS NOT NULL");
    expect(migration).toContain("COALESCE(st.login_disabled, false)");
    expect(migration).toContain("st.archived_at IS NOT NULL");
    // Still matches the linked lead's phone so archived applicants stay blocked.
    expect(migration).toContain("public.wa_normalize_phone(l.phone)");
  });

  it("keeps phone/whatsapp matching and the grants", () => {
    expect(migration).toContain("public.wa_normalize_phone(s.phone)");
    expect(migration).toContain("public.wa_normalize_phone(s.whatsapp_no)");
    expect(migration).toContain(
      "GRANT EXECUTE ON FUNCTION public.phone_comms_suppressed(text) TO authenticated, service_role;",
    );
  });
});
