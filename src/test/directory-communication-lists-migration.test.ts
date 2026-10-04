// @vitest-environment node
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readMigration } from "./readMigration";

let db: PGlite;
const staff = "00000000-0000-0000-0000-000000000001";
const outsider = "00000000-0000-0000-0000-000000000002";
let consultantList: string;
let partnerList: string;

describe("directory communication migration on PostgreSQL", () => {
  beforeAll(async () => {
    db = new PGlite();
    await db.exec(`
      CREATE ROLE authenticated; CREATE ROLE anon; CREATE ROLE service_role;
      CREATE SCHEMA auth;
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT nullif(current_setting('test.user_id',true),'')::uuid $$;
      CREATE TYPE app_role AS ENUM ('super_admin','campus_admin','admission_head','principal','counsellor');
      CREATE FUNCTION public.has_role(u uuid, r app_role) RETURNS boolean LANGUAGE sql AS $$ SELECT u = '${staff}' AND r = 'super_admin' $$;
      CREATE FUNCTION public.get_user_permissions(u uuid) RETURNS text[] LANGUAGE sql AS $$ SELECT '{}'::text[] $$;
      CREATE FUNCTION public.can_manage_lead_lists() RETURNS boolean LANGUAGE sql AS $$ SELECT auth.uid() = '${staff}' $$;
      CREATE TABLE public.profiles(id uuid DEFAULT gen_random_uuid(), user_id uuid);
      INSERT INTO profiles(user_id) VALUES ('${staff}');
      CREATE TABLE public.lead_lists(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text, purpose text DEFAULT 'marketing', list_type text DEFAULT 'static', source text, filter_definition jsonb, created_by uuid, archived_at timestamptz);
      CREATE TABLE public.lead_list_members(list_id uuid, lead_id uuid);
      CREATE TABLE public.consultants(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text, phone text, email text, stage text);
      CREATE TABLE public.academic_partners(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text, phone text, email text, status text);
      CREATE TABLE public.whatsapp_campaigns(list_id uuid); CREATE TABLE public.email_campaigns(list_id uuid);
      CREATE TABLE public.whatsapp_campaign_recipients(lead_id uuid, contact_id uuid, phone text, CONSTRAINT whatsapp_campaign_recipients_one_target CHECK (num_nonnulls(lead_id,contact_id)=1));
      CREATE TABLE public.email_campaign_recipients(lead_id uuid, contact_id uuid, to_email text, CONSTRAINT email_campaign_recipients_one_target CHECK (num_nonnulls(lead_id,contact_id)=1));
      CREATE FUNCTION public.resolve_dynamic_list_members(_list_id uuid) RETURNS jsonb LANGUAGE sql AS $$ SELECT '{"lead_resolver":true}'::jsonb $$;
      ALTER TABLE lead_lists ENABLE ROW LEVEL SECURITY;
      ALTER TABLE email_campaign_recipients ENABLE ROW LEVEL SECURITY;
      ALTER TABLE whatsapp_campaign_recipients ENABLE ROW LEVEL SECURITY;
      ALTER TABLE email_campaigns ENABLE ROW LEVEL SECURITY;
      ALTER TABLE whatsapp_campaigns ENABLE ROW LEVEL SECURITY;
      CREATE POLICY existing_email_recipients ON email_campaign_recipients FOR ALL TO authenticated USING (true) WITH CHECK (true);
      CREATE POLICY existing_wa_recipients ON whatsapp_campaign_recipients FOR ALL TO authenticated USING (true) WITH CHECK (true);
      CREATE POLICY existing_email_campaigns ON email_campaigns FOR ALL TO authenticated USING (true) WITH CHECK (true);
      CREATE POLICY existing_wa_campaigns ON whatsapp_campaigns FOR ALL TO authenticated USING (true) WITH CHECK (true);
      GRANT SELECT,INSERT,UPDATE,DELETE ON email_campaign_recipients,whatsapp_campaign_recipients,email_campaigns,whatsapp_campaigns TO authenticated;
      CREATE POLICY existing_lists ON lead_lists FOR ALL TO authenticated USING (true) WITH CHECK (true);
      GRANT SELECT,INSERT,UPDATE,DELETE ON lead_lists TO authenticated;
    `);
    await db.exec(readMigration("directory_communication_lists"));
    await db.exec(`SELECT set_config('test.user_id','${staff}',false)`);
  }, 30000);
  afterAll(async () => {
    await db?.close();
  });

  it("creates two separate lists and reuses an existing active list", async () => {
    const create = async (audience: string) =>
      (await db.query<{ id: string }>(
        `SELECT ensure_directory_communication_list($1) AS id`,
        [audience],
      )).rows[0].id;
    consultantList = await create("consultants");
    partnerList = await create("academic_partners");
    expect(consultantList).not.toBe(partnerList);
    expect(await create("consultants")).toBe(consultantList);
    expect((await db.query(`SELECT name FROM lead_lists ORDER BY name`)).rows)
      .toEqual([{ name: "All Academic Partners" }, {
        name: "All Consultants",
      }]);
  });

  it("reads all statuses live, including edits, additions, and deletions", async () => {
    await db.exec(
      `INSERT INTO consultants(name,stage) VALUES ('New','new'),('Inactive','inactive'); INSERT INTO academic_partners(name,status) VALUES ('Academic','inactive')`,
    );
    const read = () =>
      db.query<{ name: string; total_count: number }>(
        "SELECT * FROM directory_list_members_page($1)",
        [consultantList],
      );
    expect((await read()).rows.map((r) => r.name).sort()).toEqual([
      "Inactive",
      "New",
    ]);
    await db.exec(
      `UPDATE consultants SET name='Edited' WHERE name='New'; DELETE FROM consultants WHERE name='Inactive'; INSERT INTO consultants(name,stage) VALUES ('Added','active')`,
    );
    expect((await read()).rows.map((r) => r.name).sort()).toEqual([
      "Added",
      "Edited",
    ]);
    expect(
      (await db.query("SELECT * FROM directory_list_members_page($1)", [
        partnerList,
      ])).rows,
    ).toHaveLength(1);
  });

  it("pages beyond 1000 and supplies a live total", async () => {
    await db.exec(
      `INSERT INTO consultants(name,stage) SELECT 'Consultant ' || n, 'new' FROM generate_series(1,1200) n`,
    );
    const page = await db.query<{ total_count: number }>(
      "SELECT * FROM directory_list_members_page($1,500,1000)",
      [consultantList],
    );
    expect(page.rows).toHaveLength(202);
    expect(Number(page.rows[0].total_count)).toBe(1202);
  });

  it("keeps directory lists out of the lead resolver and calling membership", async () => {
    expect(
      (await db.query<
        { result: { skipped?: boolean; lead_resolver?: boolean } }
      >(
        "SELECT resolve_dynamic_list_members($1) AS result",
        [consultantList],
      )).rows[0].result.skipped,
    ).toBe(true);
    await expect(
      db.query("UPDATE lead_lists SET purpose=$1 WHERE id=$2", [
        "calling",
        consultantList,
      ]),
    ).rejects.toThrow("directory_lists_marketing_only");
    await expect(
      db.query("INSERT INTO lead_list_members(list_id) VALUES ($1)", [
        consultantList,
      ]),
    ).rejects.toThrow("resolve membership live");
    await db.exec(`INSERT INTO lead_lists(name) VALUES ('Existing leads')`);
    expect(
      (await db.query<
        { result: { skipped?: boolean; lead_resolver?: boolean } }
      >(
        `SELECT resolve_dynamic_list_members(id) AS result FROM lead_lists WHERE name='Existing leads'`,
      )).rows[0].result.lead_resolver,
    ).toBe(true);
  });

  it("requires exactly one native recipient and preserves snapshots after deletion", async () => {
    const id = (await db.query<{ id: string }>(
      `SELECT id FROM consultants WHERE name='Added'`,
    )).rows[0].id;
    await db.query(
      `INSERT INTO email_campaign_recipients(consultant_id,to_email,recipient_name,recipient_phone,recipient_email) VALUES ($1,'snapshot@example.com','Queued','9876543210','snapshot@example.com')`,
      [id],
    );
    await db.query("DELETE FROM consultants WHERE id=$1", [id]);
    expect(
      (await db.query(
        `SELECT recipient_name,to_email,recipient_phone,recipient_email FROM email_campaign_recipients`,
      )).rows,
    ).toEqual([{
      recipient_name: "Queued",
      to_email: "snapshot@example.com",
      recipient_phone: "9876543210",
      recipient_email: "snapshot@example.com",
    }]);
    await expect(
      db.query(
        `INSERT INTO email_campaign_recipients(consultant_id,academic_partner_id) VALUES ($1,$1)`,
        [id],
      ),
    ).rejects.toThrow("one_target");
    await expect(
      db.exec("INSERT INTO whatsapp_campaign_recipients DEFAULT VALUES"),
    ).rejects.toThrow("one_target");
  });

  it("denies outsiders list creation, resolution, and direct list reads", async () => {
    await db.exec(
      `SELECT set_config('test.user_id','${outsider}',false); SET ROLE authenticated`,
    );
    try {
      await expect(
        db.query(`SELECT ensure_directory_communication_list('consultants')`),
      ).rejects.toThrow("access denied");
      await expect(
        db.query("SELECT * FROM directory_list_members_page($1)", [
          partnerList,
        ]),
      ).rejects.toThrow("access denied");
      expect(
        (await db.query(
          `SELECT * FROM lead_lists WHERE audience_type <> 'leads'`,
        )).rows,
      ).toHaveLength(0);
      await expect(
        db.query("SELECT resolve_dynamic_lead_list_members($1)", [
          consultantList,
        ]),
      ).rejects.toThrow("permission denied");
      expect((await db.query("SELECT * FROM email_campaign_recipients")).rows)
        .toHaveLength(0);
      await expect(
        db.query(
          "INSERT INTO email_campaign_recipients(consultant_id) VALUES ($1)",
          [staff],
        ),
      ).rejects.toThrow("row-level security");
      await expect(
        db.query(
          "INSERT INTO whatsapp_campaign_recipients(academic_partner_id) VALUES ($1)",
          [staff],
        ),
      ).rejects.toThrow("row-level security");
      await expect(
        db.query("INSERT INTO email_campaigns(list_id) VALUES ($1)", [
          consultantList,
        ]),
      ).rejects.toThrow("row-level security");
      await expect(
        db.query("INSERT INTO whatsapp_campaigns(list_id) VALUES ($1)", [
          partnerList,
        ]),
      ).rejects.toThrow("row-level security");
    } finally {
      await db.exec(
        `RESET ROLE; SELECT set_config('test.user_id','${staff}',false)`,
      );
    }
  });
});
