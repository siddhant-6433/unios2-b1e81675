import { readFileSync, readdirSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";

const readMigration = (suffix: string) => {
  const dir = join(process.cwd(), "supabase/migrations");
  const file = readdirSync(dir).find((f) => f.endsWith(`_${suffix}.sql`));
  if (!file) throw new Error(`No migration found ending in _${suffix}.sql`);
  return readFileSync(join(dir, file), "utf8");
};

const readSrc = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

const policyBlock = (sql: string, name: string) => {
  const start = sql.indexOf(`CREATE POLICY "${name}"`);
  if (start === -1) return "";
  const rest = sql.slice(start + 1);
  const next = rest.indexOf("CREATE POLICY ");
  return next === -1 ? rest : rest.slice(0, next);
};

describe("user data access grants migration", () => {
  const migration = readMigration("user_data_access_grants");

  it("creates the institution and course grant tables with admin + self policies", () => {
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS public.user_institution_access");
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS public.user_course_access");
    expect(migration).toContain('"Admins manage user institution access"');
    expect(migration).toContain('"Admins manage user course access"');
    expect(migration).toContain('"Users read own institution access"');
    expect(migration).toContain('"Users read own course access"');
  });

  it("defines campus/institution/course scope helpers", () => {
    expect(migration).toContain("FUNCTION public.user_can_access_course_scope");
    expect(migration).toContain("FUNCTION public.user_can_access_lead_scope");
    // Course scope must consider both an explicit course grant and an institution grant.
    expect(migration).toContain("FROM public.user_course_access uca");
    expect(migration).toContain("FROM public.user_institution_access uia");
  });

  it("scopes principal by campus OR institution/course, not campus alone", () => {
    const leadsPolicy = policyBlock(migration, "Principal can view scoped leads");
    expect(leadsPolicy).toContain("'principal'::app_role");
    expect(leadsPolicy).toContain("public.user_can_access_lead_scope(auth.uid(), id)");

    // The lead-scope helper is the union of campus + course/institution, which is
    // what makes a principal with only course/institution grants visible.
    const helper = migration.slice(
      migration.indexOf("FUNCTION public.user_can_access_lead_scope"),
      migration.indexOf("GRANT EXECUTE ON FUNCTION public.user_can_access_course_scope"),
    );
    expect(helper).toContain("public.user_can_access_assigned_campus(_user_id, l.campus_id)");
    expect(helper).toContain("public.user_can_access_course_scope(_user_id, l.course_id)");
  });

  it("covers the CRM tables a principal needs", () => {
    for (const name of [
      "Principal can manage scoped visits",
      "Principal can manage scoped followups",
      "Principal can manage scoped lead notes",
      "Principal can view scoped applications",
      "Principal can view scoped students",
      "Principal can view scoped offers",
    ]) {
      expect(migration).toContain(`CREATE POLICY "${name}"`);
    }
  });
});

describe("DataAccessDialog wiring", () => {
  const dialog = readSrc("src/components/admin/DataAccessDialog.tsx");
  const adminPanel = readSrc("src/pages/AdminPanel.tsx");

  it("persists all three access axes", () => {
    expect(dialog).toContain('supabase.from("profiles").update({ campus: campusValue })');
    expect(dialog).toContain('from("user_institution_access" as any)');
    expect(dialog).toContain('from("user_course_access" as any)');
  });

  it("reads the org unit lists and existing grants", () => {
    expect(dialog).toContain("useOrgUnits()");
    expect(dialog).toContain('select("institution_id")');
    expect(dialog).toContain('select("course_id")');
  });

  it("is reachable from Admin → Users", () => {
    expect(adminPanel).toContain("DataAccessDialog");
    expect(adminPanel).toContain("setAccessUser(");
  });
});

describe("principal campus context", () => {
  const campusContext = readSrc("src/contexts/CampusContext.tsx");

  it("treats a principal as not filtered by the campus dropdown", () => {
    expect(campusContext).toContain(
      'const ORG_WIDE_CAMPUS_ROLES = new Set(["super_admin", "admission_head", "principal"])',
    );
  });
});
