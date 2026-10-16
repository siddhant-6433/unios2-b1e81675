// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readMigration } from "./readMigration";

const migration = readMigration("finance_receipt_link_identity_evidence");
const actor = "00000000-0000-4000-8000-000000000001";
const campus = "00000000-0000-4000-8000-000000000010";
const course = "00000000-0000-4000-8000-000000000020";
const lead = "00000000-0000-4000-8000-000000000030";
const payment = "00000000-0000-4000-8000-000000000040";
const target = "00000000-0000-4000-8000-000000000050";
const conflictingLeadStudent = "00000000-0000-4000-8000-000000000060";
let db: PGlite;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    CREATE ROLE anon;
    CREATE ROLE authenticated;
    CREATE ROLE service_role;
    CREATE SCHEMA auth;
    CREATE TYPE public.app_role AS ENUM ('super_admin');
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT '${actor}'::uuid $$;
    CREATE FUNCTION public.has_permission(uuid, text) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT true $$;
    CREATE FUNCTION public.has_role(uuid, public.app_role) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
    CREATE FUNCTION public.user_can_access_assigned_campus(uuid, uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT true $$;
    CREATE TABLE public.leads (
      id uuid PRIMARY KEY, campus_id uuid, course_id uuid, application_id text
    );
    CREATE TABLE public.applications (
      application_id text PRIMARY KEY, lead_id uuid, full_name text, dob date,
      father jsonb, mother jsonb, course_selections jsonb
    );
    CREATE TABLE public.students (
      id uuid PRIMARY KEY, lead_id uuid, name text, admission_no text,
      campus_id uuid, course_id uuid, dob date, father_name text, mother_name text,
      archived_at timestamptz, deleted_at timestamptz
    );
    CREATE TABLE public.lead_payments (
      id uuid PRIMARY KEY, student_id uuid, lead_id uuid, application_id text,
      status text, receipt_no text, amount numeric, concession_amount numeric,
      payment_date date, type text, allocations jsonb, applied_to_ledger boolean,
      created_at timestamptz DEFAULT now()
    );
    CREATE TABLE public.fee_ledger (
      id uuid PRIMARY KEY, student_id uuid, fee_code_id uuid, total_amount numeric,
      paid_amount numeric DEFAULT 0, concession numeric DEFAULT 0,
      due_date date, status text, updated_at timestamptz
    );
    CREATE TABLE public.fee_ledger_payments (
      fee_ledger_id uuid, lead_payment_id uuid, amount numeric,
      concession_amount numeric DEFAULT 0, notes text
    );
    CREATE FUNCTION public.fn_incentive_on_payment() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$;
    CREATE FUNCTION public.trg_recompute_consultant_payout() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$;
  `);
  await db.exec(migration);
  await db.exec(`
    INSERT INTO public.leads(id,campus_id,course_id,application_id)
      VALUES ('${lead}','${campus}','${course}','APP-RECEIPT-TEST');
    INSERT INTO public.applications(application_id,lead_id,full_name,dob,mother,course_selections)
      VALUES ('APP-RECEIPT-TEST','${lead}','Prashasti','2016-01-01','{"name":"Mira"}','[]');
    INSERT INTO public.students(id,lead_id,name,admission_no,campus_id,course_id,dob,mother_name)
      VALUES
        ('${target}',NULL,'Prashasti Bharanagar','P-001','${campus}','${course}','2016-01-01','Mira'),
        ('${conflictingLeadStudent}','${lead}','Different Student','P-002','${campus}','${course}','2015-01-01','Different Parent');
    INSERT INTO public.lead_payments(id,lead_id,application_id,status,receipt_no,amount,applied_to_ledger)
      VALUES ('${payment}','${lead}','APP-RECEIPT-TEST','confirmed','N-565',26500,false);
  `);
}, 30000);

afterAll(async () => { await db?.close(); });

describe("finance receipt link identity migration", () => {
  it("rejects a profile match while the receipt lead points to a different active student", async () => {
    await expect(db.query(`
      SELECT public.repair_confirmed_lead_payment_student_link(
        '${payment}','${target}',NULL,'APP-RECEIPT-TEST',
        'Verified against the original bank record',true
      )
    `)).rejects.toThrow(/Receipt lead is linked to a different active student/);

    const row = (await db.query<{ student_id: string | null }>(
      "SELECT student_id FROM public.lead_payments WHERE id=$1", [payment],
    )).rows[0];
    expect(row.student_id).toBeNull();
  });

  it("links the existing receipt after the lead/student conflict is resolved", async () => {
    await db.query("UPDATE public.students SET lead_id=NULL WHERE id=$1", [conflictingLeadStudent]);
    const result = await db.query<{ receipt_no: string }>(`
      SELECT public.repair_confirmed_lead_payment_student_link(
        '${payment}','${target}',NULL,'APP-RECEIPT-TEST',
        'Verified against the original bank record',true
      )->>'receipt_no' AS receipt_no
    `);
    expect(result.rows[0].receipt_no).toBe("N-565");
    const row = (await db.query<{ student_id: string }>(
      "SELECT student_id FROM public.lead_payments WHERE id=$1", [payment],
    )).rows[0];
    expect(row.student_id).toBe(target);
  });

  it("rechecks payment status after acquiring the allocation lock", async () => {
    const { rows } = await db.query<{ definition: string }>(`
      SELECT pg_get_functiondef('public.apply_fee_payment_allocations(uuid,jsonb)'::regprocedure) AS definition
    `);
    const lockedRead = rows[0].definition.indexOf("FOR UPDATE");
    const staleStatusCheck = rows[0].definition.indexOf("Payment status changed while allocation was starting");
    expect(lockedRead).toBeGreaterThanOrEqual(0);
    expect(staleStatusCheck).toBeGreaterThan(lockedRead);
  });
});
