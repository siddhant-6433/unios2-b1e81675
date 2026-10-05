// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readMigration } from "./readMigration";

const repair = readMigration("restore_student_receipt_read_scope");
const isolation = readMigration("campus_data_isolation");
const campuses = readMigration("campus_scope_concession_nav_guards");
const grants = readMigration("user_data_access_grants");
const principal = readMigration("principal_student_finance_scope");
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
let db: PGlite;

function helper(source: string, name: string) {
  const start = source.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
  if (start < 0) throw new Error(`Missing helper: ${name}`);
  return source.slice(start, source.indexOf("$$;", start) + 3);
}

function policy(source: string, name: string) {
  const start = source.indexOf(`CREATE POLICY "${name}"`);
  if (start < 0) throw new Error(`Missing policy: ${name}`);
  return source.slice(start, source.indexOf(";", start) + 1);
}

async function asUser(user: number) {
  await db.exec(`RESET ROLE; SELECT set_config('request.jwt.claim.sub', '${id(user)}', false); SET ROLE authenticated;`);
}

async function receiptIds(user: number) {
  await asUser(user);
  return (await db.query<{ id: string }>("SELECT id FROM lead_payments ORDER BY id")).rows.map((r) => r.id);
}

async function breakdown(user: number) {
  await asUser(user);
  // The LEFT JOIN mirrors PostgREST's embedded lead_payments relation: the
  // allocation survives when RLS filters out its parent receipt.
  return (await db.query(`
    SELECT flp.amount, lp.receipt_no, lp.receipt_url, lp.payment_date::text
    FROM fee_ledger_payments flp
    LEFT JOIN lead_payments lp ON lp.id = flp.lead_payment_id
    WHERE flp.fee_ledger_id = '${id(50)}'
  `)).rows;
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    CREATE ROLE authenticated;
    CREATE SCHEMA auth;
    CREATE TYPE app_role AS ENUM ('super_admin','campus_admin','principal','admission_head',
      'counsellor','accountant','data_entry','office_admin','office_assistant','teacher','faculty','school_coordinator');
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
      SELECT current_setting('request.jwt.claim.sub', true)::uuid;
    $$;
    CREATE TABLE user_roles(user_id uuid, role app_role);
    CREATE FUNCTION has_role(_user_id uuid, _role app_role) RETURNS boolean
      LANGUAGE sql STABLE SECURITY DEFINER AS $$
      SELECT EXISTS(SELECT 1 FROM user_roles WHERE user_id=_user_id AND role=_role);
    $$;
    CREATE TABLE campuses(id uuid PRIMARY KEY, name text, code text);
    CREATE TABLE profiles(user_id uuid, campus text);
    CREATE TABLE departments(id uuid PRIMARY KEY, institution_id uuid);
    CREATE TABLE courses(id uuid PRIMARY KEY, department_id uuid);
    CREATE TABLE institutions(id uuid PRIMARY KEY, campus_id uuid, type text);
    CREATE TABLE user_institution_access(user_id uuid, institution_id uuid, role app_role);
    CREATE TABLE user_course_access(user_id uuid, course_id uuid, mode text);
    CREATE TABLE students(id uuid PRIMARY KEY, campus_id uuid, course_id uuid, user_id uuid, login_disabled boolean DEFAULT false);
    CREATE TABLE leads(id uuid PRIMARY KEY, campus_id uuid);
    CREATE TABLE fee_ledger(id uuid PRIMARY KEY, student_id uuid REFERENCES students(id), paid_amount numeric);
    CREATE TABLE lead_payments(id uuid PRIMARY KEY, student_id uuid REFERENCES students(id), lead_id uuid REFERENCES leads(id),
      amount numeric, receipt_no text, receipt_url text, payment_date date, status text);
    CREATE TABLE fee_ledger_payments(id uuid PRIMARY KEY, fee_ledger_id uuid REFERENCES fee_ledger(id),
      lead_payment_id uuid REFERENCES lead_payments(id), amount numeric);
    GRANT USAGE ON SCHEMA auth, public TO authenticated;
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
  `);
  await db.exec(helper(isolation, "user_assigned_campus_ids"));
  await db.exec(helper(campuses, "user_can_access_assigned_campus"));
  await db.exec(helper(grants, "user_can_access_course_scope"));
  await db.exec(`
    INSERT INTO campuses VALUES ('${id(1)}','School campus','GZ3'), ('${id(2)}','Other campus','GN');
    INSERT INTO institutions VALUES ('${id(20)}','${id(1)}','school'), ('${id(21)}','${id(2)}','college');
    INSERT INTO departments VALUES ('${id(10)}','${id(20)}'), ('${id(11)}','${id(21)}');
    INSERT INTO courses VALUES ('${id(30)}','${id(10)}'), ('${id(31)}','${id(11)}');
    INSERT INTO students(id,campus_id,course_id) VALUES ('${id(40)}','${id(1)}','${id(30)}'), ('${id(41)}','${id(2)}','${id(31)}');
    INSERT INTO leads VALUES ('${id(80)}','${id(1)}'), ('${id(81)}','${id(2)}');
    INSERT INTO fee_ledger VALUES ('${id(50)}','${id(40)}',10000), ('${id(51)}','${id(41)}',3000);
    INSERT INTO lead_payments VALUES
      ('${id(70)}','${id(40)}',NULL,10000,'R-SCHOOL','https://example.test/school.pdf','2026-09-03','confirmed'),
      ('${id(71)}','${id(41)}',NULL,3000,'R-OTHER','https://example.test/other.pdf','2026-09-04','confirmed'),
      ('${id(72)}',NULL,'${id(80)}',500,'R-LEAD','https://example.test/lead.pdf','2026-09-05','confirmed'),
      ('${id(73)}',NULL,'${id(81)}',500,'R-OTHER-LEAD',NULL,'2026-09-05','confirmed'),
      ('${id(74)}','${id(40)}','${id(81)}',500,'R-MIXED',NULL,'2026-09-05','confirmed');
    INSERT INTO fee_ledger_payments VALUES ('${id(60)}','${id(50)}','${id(70)}',10000), ('${id(61)}','${id(51)}','${id(71)}',3000);
    INSERT INTO user_roles VALUES ('${id(100)}','accountant'), ('${id(101)}','principal'),
      ('${id(102)}','principal'), ('${id(103)}','principal'), ('${id(104)}','accountant'),
      ('${id(105)}','accountant'), ('${id(106)}','teacher'), ('${id(107)}','super_admin'),
      ('${id(108)}','school_coordinator'), ('${id(109)}','accountant'), ('${id(110)}','principal');
    INSERT INTO profiles VALUES ('${id(100)}','GZ3'), ('${id(101)}','School campus'),
      ('${id(105)}','Unknown campus'), ('${id(106)}','GZ3'), ('${id(108)}','GZ3'),
      ('${id(109)}','GZ3, GN');
    INSERT INTO user_institution_access VALUES ('${id(102)}','${id(20)}','principal');
    INSERT INTO user_course_access VALUES ('${id(103)}','${id(30)}','allow');
    ALTER TABLE students ENABLE ROW LEVEL SECURITY;
    ALTER TABLE leads ENABLE ROW LEVEL SECURITY;
    ALTER TABLE fee_ledger ENABLE ROW LEVEL SECURITY;
    ALTER TABLE fee_ledger_payments ENABLE ROW LEVEL SECURITY;
    ALTER TABLE lead_payments ENABLE ROW LEVEL SECURITY;
    -- Lead visibility is a fixture prerequisite; this repair does not change it.
    CREATE POLICY fixture_leads ON leads FOR SELECT TO authenticated USING (
      has_role(auth.uid(),'super_admin') OR user_can_access_assigned_campus(auth.uid(),campus_id));
  `);
  for (const name of ["Staff can view students", "Finance staff can view all ledger",
    "Finance staff can view ledger payments", "Staff can read lead_payments"]) {
    await db.exec(policy(isolation, name));
  }
  await db.exec(`CREATE POLICY fixture_principal_students ON students FOR SELECT TO authenticated USING (
    has_role(auth.uid(),'principal') AND user_can_access_course_scope(auth.uid(),course_id));`);
  // October 4 principal policies are already deployed. Keep them active while
  // reproducing the accountant's remaining failure and testing the repair.
  await db.exec(principal);
}, 30000);

afterAll(async () => { await db?.close(); });

describe.sequential("student receipt campus reads", () => {
  it("reproduces filtered accountant receipts and null embedded details, then restores both", async () => {
    expect(await receiptIds(100)).toEqual([id(72)]);
    expect(await breakdown(100)).toEqual([{ amount: "10000", receipt_no: null, receipt_url: null, payment_date: null }]);
    await db.exec("RESET ROLE;");
    await db.exec(repair);
    expect(await receiptIds(100)).toEqual([id(70), id(72)]);
    expect(await breakdown(100)).toEqual([{
      amount: "10000", receipt_no: "R-SCHOOL", receipt_url: "https://example.test/school.pdf", payment_date: "2026-09-03",
    }]);
  });

  it.each([101, 102, 103])("preserves principal receipt details under campus/institution/course access (%s)", async (user) => {
    expect(await receiptIds(user)).toEqual(user === 101 ? [id(70), id(72)] : [id(70)]);
    expect(await breakdown(user)).toEqual([{
      amount: "10000", receipt_no: "R-SCHOOL", receipt_url: "https://example.test/school.pdf", payment_date: "2026-09-03",
    }]);
  });

  it.each([104, 105, 106, 108, 110])("denies unassigned staff and roles outside the existing receipt policy (%s)", async (user) => {
    expect(await receiptIds(user)).toEqual([]);
  });

  it("does not use the student's campus to override an out-of-campus lead", async () => {
    expect(await receiptIds(100)).not.toContain(id(74));
    expect(await receiptIds(101)).not.toContain(id(74));
  });

  it.each([107, 109])("preserves superadmin and multiple assigned-campus reads (%s)", async (user) => {
    expect(await receiptIds(user)).toEqual([70, 71, 72, 73, 74].map(id));
  });

  it("does not add any payment write policies", async () => {
    await db.exec("RESET ROLE;");
    expect((await db.query("SELECT cmd FROM pg_policies WHERE tablename='lead_payments'")).rows)
      .toEqual([{ cmd: "SELECT" }, { cmd: "SELECT" }]);
    for (const user of [100, 101, 102, 103]) {
      await asUser(user);
      expect((await db.query("UPDATE lead_payments SET amount=0 RETURNING id")).rows).toEqual([]);
      expect((await db.query("DELETE FROM lead_payments RETURNING id")).rows).toEqual([]);
      await expect(db.query(`INSERT INTO lead_payments(id,student_id,amount) VALUES ('${id(75)}','${id(40)}',1)`))
        .rejects.toThrow(/row-level security/);
    }
  });

  it("can be reapplied without changing scope", async () => {
    await db.exec("RESET ROLE;");
    await db.exec(repair);
    expect(await receiptIds(100)).toEqual([id(70), id(72)]);
    expect(await receiptIds(102)).toEqual([id(70)]);
  });
});
