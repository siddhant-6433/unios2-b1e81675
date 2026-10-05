// @vitest-environment node
import { PGlite } from "@electric-sql/pglite";
import { readMigration } from "./readMigration";
import { beforeAll, afterAll, describe, expect, it } from "vitest";

let db: PGlite;
const uid = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const cutoff = "2026-10-05T08:00:00Z";
type Preview = { cutoff: string; digest: string; items: { lead_id: string; action: string; reason: string; destination: string | null }[] };
async function rpc<T>(sql: string, args: unknown[] = []): Promise<T> {
  return (await db.query<{ result: T }>(`SELECT ${sql} AS result`, args)).rows[0].result;
}
async function lead(n: number, fields: Record<string, unknown> = {}) {
  const data = { id: uid(n), name: `Lead ${n}`, phone: `8${String(n).padStart(9, "0")}`, created_at: "2026-09-01T00:00:00Z", course_id: uid(43), ...fields };
  await db.query(`INSERT INTO leads SELECT * FROM jsonb_populate_record(NULL::leads, to_jsonb((SELECT l FROM leads l LIMIT 1)) || $1::jsonb)`, [JSON.stringify(data)]);
}
async function preview() { return rpc<Preview>("preview_lead_cleanup($1)", [cutoff]); }
async function prepare(p: Preview) { return rpc<string>("prepare_lead_cleanup($1,$2)", [p.cutoff, p.digest]); }

describe("reversible lead backlog cleanup (real PostgreSQL functions)", () => {
  beforeAll(async () => {
    db = new PGlite();
    await db.exec(`
      CREATE ROLE authenticated; CREATE ROLE anon; CREATE ROLE service_role;
      CREATE SCHEMA auth;
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('test.user',true),'')::uuid $$;
      CREATE TYPE app_role AS ENUM ('super_admin','counsellor');
      CREATE FUNCTION has_role(uuid,app_role) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT current_setting('test.admin',true)='true' $$;
      CREATE TABLE profiles(id uuid PRIMARY KEY, user_id uuid NOT NULL, display_name text, archived_at timestamptz, deleted_at timestamptz, login_disabled boolean DEFAULT false);
      CREATE TABLE institutions(id uuid PRIMARY KEY,type text,campus_id uuid);
      CREATE TABLE jd_category_mappings(category text,is_school boolean);
      CREATE TABLE departments(id uuid PRIMARY KEY,institution_id uuid REFERENCES institutions);
      CREATE TABLE courses(id uuid PRIMARY KEY,name text,department_id uuid REFERENCES departments,code text);
      CREATE TABLE leads(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),name text,phone text,email text,created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now(),
        stage text DEFAULT 'new_lead',counsellor_id uuid REFERENCES profiles,assigned_at timestamptz,first_contact_at timestamptz,application_id uuid,admission_no text,pre_admission_no text,
        legacy_admission_no text,legacy_pre_admission_no text,admitted_at timestamptz,applied_at timestamptz,person_role text DEFAULT 'lead',
        token_amount numeric,jd_category text,course_id uuid REFERENCES courses,campus_id uuid,portal_brand text,lead_institution_type text DEFAULT 'college',is_mirror boolean DEFAULT false,
        mirror_lead_id uuid,source_lead_id uuid,application_progress jsonb,shared_with_nimt boolean DEFAULT true,notes text);
      CREATE FUNCTION fn_lead_assignment_tracker() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
        IF OLD.counsellor_id IS DISTINCT FROM NEW.counsellor_id AND NEW.counsellor_id IS NOT NULL THEN NEW.assigned_at:=now(); NEW.first_contact_at:=NULL; END IF;
        IF NEW.counsellor_id IS NULL AND OLD.counsellor_id IS NOT NULL THEN NEW.assigned_at:=NULL; END IF;
        RETURN NEW; END $$;
      CREATE TRIGGER trg_lead_assignment_tracker BEFORE UPDATE ON leads FOR EACH ROW EXECUTE FUNCTION fn_lead_assignment_tracker();
      CREATE TABLE applications(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),lead_id uuid REFERENCES leads,phone text);
      CREATE TABLE students(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),lead_id uuid REFERENCES leads,phone text,father_phone text,mother_phone text,guardian_phone text);
      CREATE TABLE lead_payments(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),lead_id uuid REFERENCES leads,amount numeric);
      CREATE TABLE payment_links(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),lead_id uuid REFERENCES leads);
      CREATE TABLE lead_followups(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),lead_id uuid REFERENCES leads,user_id uuid,scheduled_at timestamptz DEFAULT now(),
        status text DEFAULT 'pending',type text DEFAULT 'call',completed_at timestamptz,notes text);
      CREATE TABLE lead_lists(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),name text,description text,source text,purpose text,list_type text,created_by uuid REFERENCES profiles,member_count integer DEFAULT 0);
      CREATE TABLE lead_list_members(list_id uuid REFERENCES lead_lists,lead_id uuid REFERENCES leads,assigned_to uuid REFERENCES profiles,assigned_at timestamptz,work_status text DEFAULT 'pending',PRIMARY KEY(list_id,lead_id));
      CREATE TABLE whatsapp_scheduled_sends(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),lead_id uuid REFERENCES leads,status text DEFAULT 'pending',error text,sent_at timestamptz);
      CREATE TABLE ai_call_queue(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),lead_id uuid REFERENCES leads,status text DEFAULT 'pending',error_message text);
      CREATE TABLE call_logs(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),lead_id uuid REFERENCES leads,called_at timestamptz DEFAULT now(),disposition text);
      CREATE TABLE ai_call_records(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),lead_id uuid REFERENCES leads,disposition text,status text,created_at timestamptz DEFAULT now(),completed_at timestamptz);
      CREATE VIEW v_assignable_counsellors AS SELECT id AS profile_id FROM profiles WHERE archived_at IS NULL AND deleted_at IS NULL AND NOT login_disabled;
      CREATE TABLE lead_assignment_history(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),lead_id uuid,assigned_to uuid,previous_counsellor_id uuid,assigned_by_profile_id uuid,assigned_by_user_id uuid,assignment_source text,bucket_name text,lead_stage_at_assignment text);
      CREATE TABLE lead_notes(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),lead_id uuid REFERENCES leads,content text);
      CREATE TABLE lead_activities(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),lead_id uuid,user_id uuid,type text,description text);
      CREATE TABLE marketing_contacts(phone text,email text,opted_out boolean);
      CREATE FUNCTION get_unassigned_leads_bucket() RETURNS SETOF public.leads LANGUAGE sql STABLE AS $$ SELECT * FROM public.leads WHERE counsellor_id IS NULL $$;
      CREATE FUNCTION cloud_dialer_campaign_queue() RETURNS SETOF public.leads LANGUAGE sql STABLE AS $$ SELECT * FROM public.leads $$;
      CREATE VIEW cold_cycle_state AS SELECT id,stage FROM public.leads WHERE stage='cold';
      CREATE FUNCTION fn_reclaim_overdue_leads() RETURNS void LANGUAGE sql AS $$ UPDATE public.leads SET counsellor_id=NULL WHERE stage='new_lead' $$;
      CREATE FUNCTION fn_round_robin_assign_counsellor(_lead_id uuid) RETURNS uuid LANGUAGE plpgsql AS $$ BEGIN UPDATE public.leads SET counsellor_id='${uid(1)}' WHERE id=_lead_id; RETURN '${uid(1)}'::uuid; END $$;
      INSERT INTO profiles(id,user_id,display_name) VALUES
        ('${uid(1)}','${uid(11)}','Ashish Kumar'),('${uid(2)}','${uid(12)}','Payal'),('${uid(3)}','${uid(13)}','Reema'),('${uid(4)}','${uid(14)}','Harsh Verma');
      INSERT INTO institutions(id,type) VALUES ('${uid(20)}','college'),('${uid(21)}','school');
      INSERT INTO departments VALUES ('${uid(30)}','${uid(20)}'),('${uid(31)}','${uid(21)}');
      INSERT INTO courses VALUES ('${uid(40)}','Bachelor of Science in Nursing (B.Sc Nursing)','${uid(30)}','BSCN-GN'),('${uid(41)}','General Nursing & Midwifery (GNM)','${uid(30)}','GNM-GN'),('${uid(42)}','School Class 5','${uid(31)}','CLASS5'),('${uid(43)}','Other college course','${uid(30)}','OTHER');
      INSERT INTO leads(id,name,phone) VALUES('${uid(99)}','Fixture defaults','8999999999');
      SELECT set_config('test.user','${uid(11)}',false),set_config('test.admin','true',false);
    `);
    await db.exec(readMigration("lead_archive_cleanup"));
    await db.exec(readMigration("lead_archive_cleanup"));
  }, 30000);
  afterAll(async () => { await db?.close(); });

  it("classifies admissions, draft applications, payments, phone matches, school interest and Mirai correctly", async () => {
    await lead(100, { course_id: uid(40) });
    await lead(101, { course_id: uid(41) });
    await lead(102, { stage: "not_interested", course_id: uid(40) });
    await lead(103, { stage: "new_lead" });
    await db.query("INSERT INTO applications(lead_id) VALUES($1)", [uid(103)]);
    await lead(104, { admission_no: "AN100" });
    await lead(105); await db.query("INSERT INTO lead_payments(lead_id,amount) VALUES($1,1)", [uid(105)]);
    await lead(106, { phone: "+91 98765 43210" });
    await db.query("INSERT INTO students(father_phone) VALUES('09876543210')");
    await lead(107, { course_id: uid(42), lead_institution_type: "school", stage: "priority_interested" });
    await lead(108, { course_id: uid(42), lead_institution_type: "school" });
    await db.query("INSERT INTO lead_followups(lead_id) VALUES($1)", [uid(108)]);
    await lead(109, { course_id: uid(42), lead_institution_type: "school", stage: "cold" });
    await db.query("INSERT INTO lead_followups(lead_id,type) VALUES($1,'cold_followup')", [uid(109)]);
    await lead(110, { course_id: uid(42), lead_institution_type: "school" });
    await db.query("INSERT INTO call_logs(lead_id,disposition) VALUES($1,'interested')", [uid(110)]);
    for (let n = 111; n <= 115; n++) await lead(n, { portal_brand: "mirai", lead_institution_type: "school" });
    await lead(116, { created_at: cutoff });
    await lead(117, { is_mirror: true });
    await lead(118, { application_id: uid(200) });
    await lead(119, { stage: "application_in_progress" });
    await lead(120); await db.query("INSERT INTO students(lead_id) VALUES($1)", [uid(120)]);
    await lead(121, { portal_brand: "mirai", stage: "dnc" });
    const p = await preview();
    const byId = new Map(p.items.map(i => [i.lead_id, i]));
    expect(byId.get(uid(100))?.destination).toBe(uid(1));
    expect(byId.get(uid(101))?.destination).toBe(uid(1));
    expect(byId.get(uid(102))?.action).toBe("archive");
    for (const n of [103, 104, 105, 118, 119, 120]) expect(byId.get(uid(n))?.action).toBe("protected");
    expect(byId.get(uid(106))?.action).toBe("review");
    for (const n of [107, 108, 110]) expect(byId.get(uid(n))?.destination).toBe(uid(2));
    expect(byId.get(uid(109))?.action).toBe("archive");
    const mirai = p.items.filter(i => i.reason === "mirai");
    expect(mirai.filter(i => i.destination === uid(3))).toHaveLength(3);
    expect(mirai.filter(i => i.destination === uid(4))).toHaveLength(2);
    expect(byId.has(uid(116))).toBe(false);
    expect(byId.get(uid(117))?.action).toBe("review");
    expect(byId.get(uid(121))?.action).toBe("archive");
  });

  it("rejects ambiguous staff and unauthorized preview without mutating leads", async () => {
    await db.exec(`SELECT set_config('test.admin','false',false)`);
    await expect(preview()).rejects.toThrow(/super admin/);
    await db.exec(`SELECT set_config('test.admin','true',false)`);
    await db.query("INSERT INTO profiles(id,user_id,display_name) VALUES($1,$2,'Ashish Other')", [uid(5), uid(15)]);
    await expect(preview()).rejects.toThrow(/Resolve one active staff/);
    await db.query("DELETE FROM profiles WHERE id=$1", [uid(5)]);
  });

  it("rejects a stale preview; protects admissions created after preparation", async () => {
    const p = await preview();
    await db.query("UPDATE leads SET notes='Changed by staff' WHERE id=$1", [uid(100)]);
    await expect(prepare(p)).rejects.toThrow(/Preview changed/);
    await db.query("INSERT INTO whatsapp_scheduled_sends(lead_id) VALUES($1)", [uid(109)]);
    const run = await prepare(await preview());
    await db.query("INSERT INTO applications(lead_id) VALUES($1)", [uid(101)]);
    await db.query("UPDATE leads SET notes='Another staff edit' WHERE id=$1", [uid(110)]);
    const protectedBefore = await rpc("(SELECT to_jsonb(l) FROM leads l WHERE id=$1)", [uid(103)]);
    await rpc("apply_lead_cleanup($1,500)", [run]);
    expect(await rpc("(SELECT to_jsonb(l) FROM leads l WHERE id=$1)", [uid(103)])).toEqual(protectedBefore);
    expect((await db.query("SELECT status FROM lead_cleanup_items WHERE run_id=$1 AND lead_id=$2", [run, uid(101)])).rows[0]).toEqual({ status: "skipped" });
    expect((await db.query("SELECT status FROM lead_cleanup_items WHERE run_id=$1 AND lead_id=$2", [run, uid(110)])).rows[0]).toEqual({ status: "skipped" });
    const report = await rpc<{ run: { archive_list_id: string }; counts: Record<string, number> }>("lead_cleanup_report($1)", [run]);
    expect(report.counts.applied).toBeGreaterThan(0);
    expect(await rpc("apply_lead_cleanup($1,100)", [run])).toEqual({ remaining: 0, processed: 0 });
    const list = await db.query("SELECT purpose FROM lead_lists WHERE id=$1", [report.run.archive_list_id]);
    expect(list.rows[0]).toEqual({ purpose: "marketing" });
    // Transfer follow-up owner without changing schedule or notes.
    expect((await db.query("SELECT user_id,status FROM lead_followups WHERE lead_id=$1", [uid(108)])).rows[0]).toEqual({ user_id: uid(12), status: "pending" });
    expect((await db.query<{ stage: string; archived_at: string | null }>("SELECT stage,archived_at FROM leads WHERE id=$1", [uid(109)])).rows[0].stage).toBe("cold");
    expect((await db.query("SELECT status FROM lead_followups WHERE lead_id=$1", [uid(109)])).rows[0]).toEqual({ status: "cancelled" });
    expect((await db.query("SELECT id FROM cloud_dialer_campaign_queue() WHERE id=$1", [uid(102)])).rows).toHaveLength(0);
    // A stale worker cannot enqueue revival/calling work for archived records.
    await db.query("INSERT INTO lead_followups(lead_id) VALUES($1)", [uid(102)]);
    await db.query("INSERT INTO ai_call_queue(lead_id) VALUES($1)", [uid(102)]);
    expect((await db.query("SELECT id FROM lead_followups WHERE lead_id=$1 AND status='pending'", [uid(102)])).rows).toHaveLength(0);
    expect((await db.query("SELECT id FROM ai_call_queue WHERE lead_id=$1", [uid(102)])).rows).toHaveLength(0);
    await expect(db.query("INSERT INTO ai_call_records(lead_id,status) VALUES($1,'initiated')", [uid(102)])).rejects.toThrow(/Archived lead cannot start a call/);
    expect(await rpc("archive_marketing_recipient_allowed($1)", [uid(121)])).toBe(false);
    await db.query("INSERT INTO applications(lead_id) VALUES($1)", [uid(102)]);
    expect(await rpc("archive_marketing_recipient_allowed($1)", [uid(102)])).toBe(false);
    expect((await db.query("SELECT status FROM whatsapp_scheduled_sends WHERE lead_id=$1", [uid(109)])).rows[0]).toEqual({ status: "skipped" });
    await db.query("INSERT INTO whatsapp_scheduled_sends(lead_id) VALUES($1)", [uid(102)]);
    expect((await db.query("SELECT id FROM whatsapp_scheduled_sends WHERE lead_id=$1", [uid(102)])).rows).toHaveLength(0);
    // New prospect inserts remain unassigned; auto-assignment cannot consume them.
    await lead(122, { created_at: "2026-10-06T00:00:00Z", counsellor_id: uid(1) });
    expect((await db.query("SELECT counsellor_id FROM leads WHERE id=$1", [uid(122)])).rows[0]).toEqual({ counsellor_id: null });
    expect(await rpc("fn_round_robin_assign_counsellor($1)", [uid(122)])).toBe(null);
    // Explicit allocation is still possible.
    await db.query("UPDATE leads SET counsellor_id=$1 WHERE id=$2", [uid(2), uid(122)]);
    expect((await db.query("SELECT counsellor_id FROM leads WHERE id=$1", [uid(122)])).rows[0]).toEqual({ counsellor_id: uid(2) });
    // Rollback preserves later staff work and new admission-linked records.
    await db.query("UPDATE leads SET notes='Later staff work' WHERE id=$1", [uid(100)]);
    const result = await rpc<{ remaining: number }>("rollback_lead_cleanup($1,500)", [run]);
    expect(result.remaining).toBe(0);
    expect((await db.query("SELECT status FROM lead_cleanup_items WHERE run_id=$1 AND lead_id=$2", [run, uid(100)])).rows[0]).toEqual({ status: "conflict" });
    expect((await db.query("SELECT status FROM lead_cleanup_items WHERE run_id=$1 AND lead_id=$2", [run, uid(102)])).rows[0]).toEqual({ status: "conflict" });
    expect((await db.query("SELECT archived_at FROM leads WHERE id=$1", [uid(109)])).rows[0]).toEqual({ archived_at: null });
    expect((await db.query("SELECT status FROM whatsapp_scheduled_sends WHERE lead_id=$1", [uid(109)])).rows[0]).toEqual({ status: "pending" });
    expect((await db.query("SELECT status FROM lead_followups WHERE lead_id=$1", [uid(109)])).rows[0]).toEqual({ status: "pending" });
  });

  it("preview is read-only and even Mirai populations divide exactly equally", async () => {
    await db.exec("BEGIN");
    try {
      await lead(130, { portal_brand: "mirai", lead_institution_type: "school" });
      const before = (await db.query("SELECT (SELECT count(*) FROM lead_cleanup_runs) runs,(SELECT count(*) FROM lead_lists) lists")).rows;
      const p = await preview();
      const mirai = p.items.filter(i => i.reason === "mirai");
      expect(mirai.filter(i => i.destination === uid(3))).toHaveLength(3);
      expect(mirai.filter(i => i.destination === uid(4))).toHaveLength(3);
      expect((await db.query("SELECT (SELECT count(*) FROM lead_cleanup_runs) runs,(SELECT count(*) FROM lead_lists) lists")).rows).toEqual(before);
    } finally { await db.exec("ROLLBACK"); }
  });

  it("batch failure rolls back membership, lead mutations and policy together", async () => {
    await db.exec("BEGIN");
    try {
      const run = await prepare(await preview());
      const before = await rpc("lead_cleanup_snapshot($1)", [uid(100)]);
      await db.exec(`CREATE FUNCTION fail_cleanup_test() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
        IF NEW.id='${uid(109)}' AND NEW.archived_at IS NOT NULL THEN RAISE EXCEPTION 'Injected batch failure'; END IF; RETURN NEW; END $$;
        CREATE TRIGGER fail_cleanup_test BEFORE UPDATE ON leads FOR EACH ROW EXECUTE FUNCTION fail_cleanup_test();`);
      // A savepoint lets us inspect state after the failed RPC transaction.
      await db.exec("SAVEPOINT batch");
      await expect(rpc("apply_lead_cleanup($1,500)", [run])).rejects.toThrow(/Injected batch failure/);
      await db.exec("ROLLBACK TO SAVEPOINT batch");
      expect(await rpc("lead_cleanup_snapshot($1)", [uid(100)])).toEqual(before);
      expect((await db.query("SELECT archive_list_id,status FROM lead_cleanup_runs WHERE id=$1", [run])).rows[0]).toEqual({ archive_list_id: null, status: "prepared" });
      expect((await db.query("SELECT * FROM lead_cleanup_policy")).rows).toHaveLength(0);
    } finally { await db.exec("ROLLBACK"); }
  });

  it("can resume small batches without duplicate members and rollback restores pending work", async () => {
    await db.exec("BEGIN");
    try {
      await lead(140, { counsellor_id: uid(4), assigned_at: "2026-09-02T00:00:00Z", first_contact_at: "2026-09-03T00:00:00Z" });
      await lead(141, { course_id: uid(40), counsellor_id: uid(4), assigned_at: "2026-09-02T00:00:00Z", first_contact_at: "2026-09-03T00:00:00Z" });
      const beforeRetain = await rpc<Record<string, Record<string, unknown>>>("lead_cleanup_snapshot($1)", [uid(141)]);
      const list = (await db.query<{ id: string }>("INSERT INTO lead_lists(name,purpose) VALUES('Existing calling list','calling') RETURNING id")).rows[0].id;
      await db.query("INSERT INTO lead_list_members(list_id,lead_id,assigned_to) VALUES($1,$2,$3)", [list,uid(140),uid(4)]);
      await db.query("INSERT INTO lead_followups(lead_id,user_id,notes) VALUES($1,$2,'Call next week')", [uid(140),uid(14)]);
      await db.query("INSERT INTO ai_call_queue(lead_id) VALUES($1)", [uid(140)]);
      const before = await rpc("lead_cleanup_snapshot($1)", [uid(140)]);
      const run = await prepare(await preview());
      let result: { remaining: number };
      do { result = await rpc("apply_lead_cleanup($1,1)", [run]); } while (result.remaining > 0);
      expect((await db.query("SELECT work_status,assigned_to FROM lead_list_members WHERE list_id=$1 AND lead_id=$2", [list,uid(140)])).rows[0]).toEqual({ work_status: "not_dialable", assigned_to: uid(4) });
      expect((await db.query("SELECT status FROM ai_call_queue WHERE lead_id=$1", [uid(140)])).rows[0]).toEqual({ status: "skipped" });
      expect(await rpc("apply_lead_cleanup($1,1)", [run])).toEqual({ processed: 0, remaining: 0 });
      do { result = await rpc("rollback_lead_cleanup($1,1)", [run]); } while (result.remaining > 0);
      const restored = await rpc<Record<string, unknown>>("lead_cleanup_snapshot($1)", [uid(140)]);
      expect({ ...restored, activities: [] }).toEqual({ ...(before as Record<string, unknown>), activities: [] });
      expect(await rpc("rollback_lead_cleanup($1,1)", [run])).toEqual({ processed: 0, remaining: 0 });
      const restoredRetain = await rpc<Record<string, Record<string, unknown>>>("lead_cleanup_snapshot($1)", [uid(141)]);
      expect(restoredRetain.lead.assigned_at).toEqual(beforeRetain.lead.assigned_at);
      expect(restoredRetain.lead.first_contact_at).toEqual(beforeRetain.lead.first_contact_at);
    } finally { await db.exec("ROLLBACK"); }
  });


  it("returns post-cutoff automatic assignments to the bucket but preserves explicit allocations", async () => {
    await db.exec("BEGIN");
    try {
      await lead(150, { created_at: cutoff, counsellor_id: uid(4) });
      await lead(151, { created_at: cutoff, counsellor_id: uid(4) });
      await db.query("INSERT INTO lead_assignment_history(lead_id,assigned_to,assignment_source) VALUES($1,$3,'ai_priority'),($2,$3,'assigned')", [uid(150),uid(151),uid(4)]);
      const p = await preview();
      expect(p.items.find(i => i.lead_id === uid(150))?.action).toBe("bucket");
      expect(p.items.find(i => i.lead_id === uid(151))?.action).toBe("review");
      const run = await prepare(p);
      await rpc("apply_lead_cleanup($1,500)", [run]);
      expect((await db.query("SELECT counsellor_id,archived_at FROM leads WHERE id=$1", [uid(150)])).rows[0]).toEqual({ counsellor_id: null, archived_at: null });
      expect((await db.query("SELECT counsellor_id FROM leads WHERE id=$1", [uid(151)])).rows[0]).toEqual({ counsellor_id: uid(4) });
    } finally { await db.exec("ROLLBACK"); }
  });


  it("leaves active calls, unmapped courses and orphan application progress for protection/review", async () => {
    await db.exec("BEGIN");
    try {
      await lead(160, { course_id: null });
      await lead(161, { application_progress: { step: 1 } });
      await lead(162);
      await db.query("INSERT INTO ai_call_records(lead_id,status) VALUES($1,'initiated')", [uid(162)]);
      await lead(163);
      await db.query("INSERT INTO payment_links(lead_id) VALUES($1)", [uid(163)]);
      await db.query("INSERT INTO courses(id,name,code) VALUES($1,'BSc Nursing','BSCN-GN')", [uid(44)]);
      await lead(165, { course_id: uid(44) });
      await lead(164, { course_id: uid(40), portal_brand: "mirai" });
      const p = await preview();
      expect(p.items.find(i => i.lead_id === uid(165))?.action).toBe("review");
      expect(p.items.find(i => i.lead_id === uid(164))?.destination).toBe(uid(1));
      expect(p.items.find(i => i.lead_id === uid(160))?.action).toBe("review");
      expect(p.items.find(i => i.lead_id === uid(161))?.action).toBe("protected");
      expect(p.items.find(i => i.lead_id === uid(162))?.reason).toBe("active_call");
      expect(p.items.find(i => i.lead_id === uid(163))?.reason).toBe("payment");
    } finally { await db.exec("ROLLBACK"); }
  });

});
