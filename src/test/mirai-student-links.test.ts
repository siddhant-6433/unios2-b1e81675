// @vitest-environment node
import { PGlite } from "@electric-sql/pglite";
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { readMigration } from "./readMigration";

const school = "d8c95a30-ecc6-4b41-8bed-987c960dc44a";
const student = "00000000-0000-0000-0000-000000000001";
const course = "00000000-0000-0000-0000-000000000002";
const department = "00000000-0000-0000-0000-000000000003";
const lead = "00000000-0000-0000-0000-000000000004";
let db: PGlite;
beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE SCHEMA auth; CREATE SCHEMA vault; CREATE SCHEMA net;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS 'SELECT NULL::uuid';
    CREATE FUNCTION public.can_collect_fee(uuid) RETURNS boolean LANGUAGE sql AS 'SELECT false';
    CREATE FUNCTION public.has_role(uuid,text) RETURNS boolean LANGUAGE sql AS 'SELECT false';
    CREATE FUNCTION public.can_academic_partner_view_fee_student(uuid,uuid) RETURNS boolean LANGUAGE sql AS 'SELECT false';
    CREATE TABLE public._app_config(key text PRIMARY KEY, value text);
    CREATE TABLE public.departments(id uuid PRIMARY KEY,institution_id uuid);
    CREATE TABLE public.courses(id uuid PRIMARY KEY,department_id uuid);
    CREATE TABLE public.leads(id uuid PRIMARY KEY,portal_brand text,source text,origin_domain text,landing_page text,course_id uuid);
    CREATE TABLE public.applications(lead_id uuid, flags text[], created_at timestamptz,course_selections jsonb);
    CREATE TABLE public.students(id uuid PRIMARY KEY,lead_id uuid,course_id uuid,name text,admission_no text,phone text,whatsapp_no text,email text);
    CREATE TABLE public.student_magic_tokens(id uuid DEFAULT gen_random_uuid(),token uuid DEFAULT gen_random_uuid(),student_id uuid,lead_id uuid,phone text,email text,expires_at timestamptz,auto_send boolean,claimed_at timestamptz);
    CREATE TABLE public.lead_activities(lead_id uuid,type text,description text);
    CREATE TABLE vault.decrypted_secrets(name text,decrypted_secret text);
    CREATE FUNCTION net.http_post(url text,headers jsonb,body jsonb) RETURNS bigint LANGUAGE sql AS 'SELECT 1::bigint';
    INSERT INTO departments VALUES ('${department}','${school}');
    INSERT INTO courses VALUES ('${course}','${department}');
    INSERT INTO students(id,course_id,phone) VALUES ('${student}','${course}','919000000000');
  `);
  await db.exec(readMigration("mirai_student_portal_links"));
}, 30000);
afterAll(async () => { await db?.close(); });
const base = async () => (await db.query<{ url: string }>(`SELECT student_website_base('${student}') AS url`)).rows[0].url;

describe("student invitation migration", () => {
  it("retains the old base until explicit activation, then recognizes an imported Mirai student", async () => {
    expect(await base()).toBe("https://uni.nimt.ac.in/student");
    await db.exec("UPDATE _app_config SET value='true' WHERE key='mirai_rollout_enabled'");
    expect(await base()).toBe("https://uni.miraischool.in/student");
  });
  it("preserves existing institution rules and does not confuse a shared-campus college course", async () => {
    await db.exec(`UPDATE departments SET institution_id='00000000-0000-0000-0000-000000000099'`);
    expect(await base()).toBe("https://uni.nimt.ac.in/student");
    await db.exec(`INSERT INTO leads(id,portal_brand) VALUES ('${lead}','mirai'); UPDATE students SET lead_id='${lead}';`);
    expect(await base()).toBe("https://uni.miraischool.in/student");
    await db.exec(`INSERT INTO applications VALUES ('${lead}',ARRAY['portal:beacon'],now(),'[]');`);
    expect(await base()).toBe("https://uni.nimt.ac.in/student");
    await db.exec(`UPDATE applications SET flags=ARRAY['portal:mirai'];`);
    expect(await base()).toBe("https://uni.miraischool.in/student");
  });
  it("keeps authorization checks before minting links", async () => {
    await expect(db.query(`SELECT issue_student_login_link('${student}')`)).rejects.toThrow("Not authorised");
    expect((await db.query("SELECT * FROM student_magic_tokens")).rows).toHaveLength(0);
  });
  it("resolves UUID application course selections when student and lead courses are absent", async () => {
    await db.exec("BEGIN");
    try {
      await db.exec(`
        UPDATE departments SET institution_id='${school}';
        UPDATE students SET course_id=NULL;
        UPDATE leads SET portal_brand=NULL, course_id=NULL;
        DELETE FROM applications;
        INSERT INTO applications VALUES ('${lead}',ARRAY[]::text[],now(),'[{"course_id":"${course}"}]');
      `);
      expect(await base()).toBe("https://uni.miraischool.in/student");
      // Non-array or invalid selections must neither throw nor invent ownership.
      await db.exec(`UPDATE applications SET course_selections='{"course_id":"${course}"}'`);
      expect(await base()).toBe("https://uni.nimt.ac.in/student");
      await db.exec(`UPDATE applications SET course_selections='[{"course_id":"not-a-uuid"}]'`);
      expect(await base()).toBe("https://uni.nimt.ac.in/student");
    } finally {
      await db.exec("ROLLBACK");
    }
  });
  it("ignores retired Mirai selections outside the latest five applications", async () => {
    await db.exec("BEGIN");
    try {
      await db.exec(`
        UPDATE students SET course_id=NULL;
        UPDATE leads SET portal_brand=NULL, course_id=NULL;
        DELETE FROM applications;
        INSERT INTO applications VALUES ('${lead}',ARRAY[]::text[],now()-interval '6 days','[{"course_name":"Mirai Grade I"}]');
        INSERT INTO applications
          SELECT '${lead}',ARRAY[]::text[],now()-n*interval '1 day','[]'::jsonb FROM generate_series(1,5) n;
      `);
      expect(await base()).toBe("https://uni.nimt.ac.in/student");
      // The same stored text signal still owns a recent application.
      await db.exec(`UPDATE applications SET created_at=now() WHERE course_selections::text LIKE '%Mirai%'`);
      expect(await base()).toBe("https://uni.miraischool.in/student");
    } finally {
      await db.exec("ROLLBACK");
    }
  });
  it("normalizes explicit saved flags and brands before institution fallbacks", async () => {
    await db.exec("BEGIN");
    try {
      await db.exec(`UPDATE applications SET flags=ARRAY[' PORTAL:BEACON '];`);
      expect(await base()).toBe("https://uni.nimt.ac.in/student");
      await db.exec(`UPDATE applications SET flags=ARRAY[]::text[]; UPDATE leads SET portal_brand=' PORTAL:MIRAI ';`);
      expect(await base()).toBe("https://uni.miraischool.in/student");
    } finally {
      await db.exec("ROLLBACK");
    }
  });
  it("allows the existing scoped partner permission and keeps generate/send separate", async () => {
    await db.exec(`CREATE OR REPLACE FUNCTION public.can_academic_partner_view_fee_student(uuid,uuid) RETURNS boolean LANGUAGE sql AS 'SELECT true'`);
    const row = (await db.query<{ link: {url: string; token_id: string} }>(`SELECT issue_student_login_link('${student}') AS link`)).rows[0].link;
    expect(row.url).toMatch(/^https:\/\/uni\.miraischool\.in\/student\?token=/);
    expect((await db.query<{auto_send: boolean}>("SELECT auto_send FROM student_magic_tokens")).rows[0].auto_send).toBe(false);
    expect((await db.query("SELECT * FROM lead_activities")).rows).toHaveLength(0);
  });
  it("can roll back link generation without changing existing tokens", async () => {
    await db.exec("UPDATE _app_config SET value='false' WHERE key='mirai_rollout_enabled'");
    expect(await base()).toBe("https://uni.nimt.ac.in/student");
    expect((await db.query("SELECT * FROM student_magic_tokens")).rows).toHaveLength(1);
  });
});
