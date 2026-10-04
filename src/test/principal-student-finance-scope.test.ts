// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readMigration } from "./readMigration";

const sql = readMigration("principal_student_finance_scope");
const grants = readMigration("user_data_access_grants");
const campuses = readMigration("campus_scope_concession_nav_guards");
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
let db: PGlite;

function helper(source: string, name: string) {
  const start = source.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
  return source.slice(start, source.indexOf("$$;", start) + 3);
}

async function readAs(user: number, table: string) {
  await db.exec(`RESET ROLE; SELECT set_config('request.jwt.claim.sub', '${id(user)}', false); SET ROLE authenticated;`);
  return (await db.query<{ id: string }>(`SELECT id FROM public.${table} ORDER BY id`)).rows.map((r) => r.id);
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    CREATE ROLE authenticated;
    CREATE SCHEMA auth;
    CREATE TYPE public.app_role AS ENUM ('super_admin','principal','accountant','teacher');
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
      SELECT current_setting('request.jwt.claim.sub', true)::uuid;
    $$;
    CREATE TABLE user_roles(user_id uuid, role app_role);
    CREATE FUNCTION public.has_role(_user_id uuid, _role app_role) RETURNS boolean
      LANGUAGE sql STABLE SECURITY DEFINER AS $$
      SELECT EXISTS(SELECT 1 FROM user_roles WHERE user_id=_user_id AND role=_role);
    $$;
    CREATE TABLE campuses(id uuid PRIMARY KEY, name text, code text);
    CREATE TABLE profiles(user_id uuid, campus text);
    CREATE TABLE departments(id uuid PRIMARY KEY, institution_id uuid);
    CREATE TABLE courses(id uuid PRIMARY KEY, department_id uuid);
    CREATE TABLE institutions(id uuid PRIMARY KEY, campus_id uuid, type text);
    CREATE TABLE user_institution_access(user_id uuid, institution_id uuid, role app_role, PRIMARY KEY(user_id,institution_id,role));
    CREATE TABLE user_course_access(user_id uuid, course_id uuid, mode text);
    CREATE TABLE students(id uuid PRIMARY KEY, campus_id uuid, course_id uuid);
    CREATE TABLE fee_ledger(id uuid PRIMARY KEY, student_id uuid REFERENCES students(id), total_amount numeric);
    CREATE TABLE fee_ledger_payments(id uuid PRIMARY KEY, fee_ledger_id uuid REFERENCES fee_ledger(id));
    CREATE TABLE lead_payments(id uuid PRIMARY KEY, student_id uuid REFERENCES students(id), lead_id uuid);
    GRANT USAGE ON SCHEMA auth, public TO authenticated;
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
  `);
  await db.exec(helper(campuses, "user_assigned_campus_ids"));
  await db.exec(helper(campuses, "user_can_access_assigned_campus"));
  await db.exec(helper(grants, "user_can_access_course_scope"));
  await db.exec(`
    INSERT INTO campuses VALUES ('${id(1)}','School campus','GZ3'), ('${id(2)}','Other campus','GN');
    INSERT INTO departments VALUES ('${id(10)}','${id(20)}'), ('${id(11)}','${id(21)}');
    INSERT INTO courses VALUES ('${id(30)}','${id(10)}'), ('${id(31)}','${id(11)}');
    INSERT INTO students VALUES ('${id(40)}','${id(1)}','${id(30)}'), ('${id(41)}','${id(2)}','${id(31)}');
    INSERT INTO fee_ledger VALUES ('${id(50)}','${id(40)}',59628), ('${id(51)}','${id(41)}',90000);
    INSERT INTO fee_ledger_payments VALUES ('${id(60)}','${id(50)}'), ('${id(61)}','${id(51)}');
    INSERT INTO lead_payments VALUES ('${id(70)}','${id(40)}',NULL), ('${id(71)}','${id(41)}',NULL),
      ('${id(72)}','${id(40)}','${id(80)}');
    INSERT INTO user_roles VALUES ('${id(100)}','principal'), ('${id(101)}','principal'),
      ('${id(102)}','principal'), ('${id(103)}','principal'), ('${id(104)}','teacher'),
      ('${id(105)}','accountant'), ('${id(106)}','super_admin');
    INSERT INTO profiles VALUES ('${id(100)}','GZ3'), ('${id(103)}','NIMT School');
    INSERT INTO user_institution_access VALUES ('${id(101)}','${id(20)}','principal'), ('${id(104)}','${id(20)}','teacher'), ('${id(105)}','${id(20)}','accountant');
    INSERT INTO user_course_access VALUES ('${id(102)}','${id(30)}','allow');
    ALTER TABLE students ENABLE ROW LEVEL SECURITY;
    ALTER TABLE fee_ledger ENABLE ROW LEVEL SECURITY;
    ALTER TABLE fee_ledger_payments ENABLE ROW LEVEL SECURITY;
    ALTER TABLE lead_payments ENABLE ROW LEVEL SECURITY;
    CREATE POLICY test_student_read ON students FOR SELECT TO authenticated USING (
      has_role(auth.uid(),'super_admin') OR user_can_access_assigned_campus(auth.uid(),campus_id)
      OR user_can_access_course_scope(auth.uid(),course_id));
    CREATE POLICY legacy_ledger_read ON fee_ledger FOR SELECT TO authenticated USING (
      has_role(auth.uid(),'super_admin') OR (has_role(auth.uid(),'principal') AND EXISTS (
        SELECT 1 FROM students s WHERE s.id=student_id AND user_can_access_assigned_campus(auth.uid(),s.campus_id))));
    CREATE POLICY legacy_allocation_read ON fee_ledger_payments FOR SELECT TO authenticated USING (has_role(auth.uid(),'super_admin'));
    CREATE POLICY legacy_receipt_read ON lead_payments FOR SELECT TO authenticated USING (has_role(auth.uid(),'super_admin'));
  `);
  // Reproduce the mismatch before applying the new policy: institution access
  // opens the student, but its existing ledger is silently filtered out.
  expect(await readAs(101, "students")).toEqual([id(40)]);
  expect(await readAs(101, "fee_ledger")).toEqual([]);
  await db.exec("RESET ROLE;");
  await db.exec(sql);
}, 30000);

afterAll(async () => { await db?.close(); });

describe("principal financial reads follow student scope", () => {
  it.each([100, 101, 102])("allows only the assigned student's ledger and allocations for user %s", async (user) => {
    expect(await readAs(user, "fee_ledger")).toEqual([id(50)]);
    expect(await readAs(user, "fee_ledger_payments")).toEqual([id(60)]);
    expect(await readAs(user, "lead_payments")).toEqual([id(70)]);
  });

  it.each([103, 104, 105])("does not grant finance reads to an unassigned principal or another role (%s)", async (user) => {
    for (const table of ["fee_ledger", "fee_ledger_payments", "lead_payments"]) {
      expect(await readAs(user, table)).toEqual([]);
    }
  });

  it("preserves the super-admin's existing reads", async () => {
    expect(await readAs(106, "fee_ledger")).toEqual([id(50), id(51)]);
    expect(await readAs(106, "lead_payments")).toEqual([id(70), id(71), id(72)]);
  });

  it("does not grant financial writes", async () => {
    await readAs(101, "fee_ledger");
    expect((await db.query("UPDATE fee_ledger SET total_amount=0 RETURNING id")).rows).toEqual([]);
    expect((await db.query("DELETE FROM fee_ledger RETURNING id")).rows).toEqual([]);
    await expect(db.query(`INSERT INTO fee_ledger VALUES ('${id(52)}','${id(40)}',1)`)).rejects.toThrow(/row-level security/);
  });

  it("repairs only the confirmed principal's Avantika II institution grant, idempotently", async () => {
    await db.exec("RESET ROLE;");
    await db.exec(`
      INSERT INTO user_roles VALUES ('e73c3a3d-a1f0-4617-847f-26e608cdd190','principal');
      INSERT INTO institutions VALUES ('0ddbdc8b-778d-45ef-8718-93202f231170','9bb6b4cc-c992-4af1-b9d3-384537a510c8','school');
    `);
    await db.exec(sql);
    await db.exec(sql);
    const rows = (await db.query("SELECT institution_id, role FROM user_institution_access WHERE user_id='e73c3a3d-a1f0-4617-847f-26e608cdd190'")).rows;
    expect(rows).toEqual([{ institution_id: "0ddbdc8b-778d-45ef-8718-93202f231170", role: "principal" }]);
    await db.exec("UPDATE institutions SET type='college' WHERE id='0ddbdc8b-778d-45ef-8718-93202f231170';");
    await expect(db.exec(sql)).rejects.toThrow(/school identity mismatch/);
  });
});
