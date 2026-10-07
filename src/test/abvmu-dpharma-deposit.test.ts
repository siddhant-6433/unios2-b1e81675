// @vitest-environment node
import { PGlite } from "@electric-sql/pglite";
import { readdirSync, readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resolveAbvmuDepositAmount } from "@/lib/abvmuDeposit";

const migrationFile = readdirSync("supabase/migrations").find((file) =>
  file.endsWith("_exclude_dpharma_from_abvmu_deposit.sql"),
);
if (!migrationFile) throw new Error("D.Pharma ABVMU deposit migration is missing");
const migration = readFileSync(`supabase/migrations/${migrationFile}`, "utf8");
const feePanel = readFileSync("src/components/finance/StudentFeePanel.tsx", "utf8");
const depositHook = readFileSync("src/components/finance/useAbvmuDeposit.ts", "utf8");
const applicantPanel = readFileSync("src/components/applicant/TokenFeePanel.tsx", "utf8");
const studentPortal = readFileSync("src/pages/StudentPortal.tsx", "utf8");
let db: PGlite;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    CREATE ROLE authenticated;
    CREATE ROLE anon;
    CREATE ROLE service_role;
    CREATE TABLE public.courses (
      id uuid PRIMARY KEY,
      code text,
      webflow_slug text,
      name text
    );
    CREATE TABLE public.leads (
      id uuid PRIMARY KEY,
      course_id uuid,
      abvmu_deposit_not_applicable boolean NOT NULL DEFAULT false
    );
    CREATE TABLE public.fee_structures (
      course_id uuid,
      is_active boolean,
      created_at timestamptz,
      metadata jsonb
    );
  `);
  await db.exec(migration);
}, 30000);

afterAll(async () => {
  await db?.close();
});

describe("D.Pharma ABVMU deposit exclusion", () => {
  it("returns no ABVMU deposit for D.Pharma course identifiers", async () => {
    expect(migration).toContain("c.code = 'DPHARMA-GN'");
    expect(migration).toContain("c.webflow_slug = 'diploma-in-pharmacy'");
    expect(migration).toContain("c.name ILIKE '%d.pharma%'");
    expect(migration).toContain("c.name ILIKE '%diploma%pharmacy%'");
    const fixtures = [
      { course: "10000000-0000-0000-0000-000000000001", lead: "20000000-0000-0000-0000-000000000001", code: "DPHARMA-GN", slug: "other", name: "Diploma course" },
      { course: "10000000-0000-0000-0000-000000000002", lead: "20000000-0000-0000-0000-000000000002", code: "OTHER", slug: "diploma-in-pharmacy", name: "Diploma course" },
      { course: "10000000-0000-0000-0000-000000000003", lead: "20000000-0000-0000-0000-000000000003", code: "OTHER", slug: "other", name: "Diploma in Pharmacy" },
      { course: "10000000-0000-0000-0000-000000000004", lead: "20000000-0000-0000-0000-000000000004", code: "OTHER", slug: "other", name: "Diploma in Pharmacy (D.Pharma)" },
    ];

    for (const fixture of fixtures) {
      await db.query(
        "INSERT INTO courses(id, code, webflow_slug, name) VALUES ($1, $2, $3, $4)",
        [fixture.course, fixture.code, fixture.slug, fixture.name],
      );
      await db.query("INSERT INTO leads(id, course_id) VALUES ($1, $2)", [fixture.lead, fixture.course]);
      await db.query(
        "INSERT INTO fee_structures(course_id, is_active, created_at, metadata) VALUES ($1, true, now(), '{\"seat_reservation_deposit\":20000}')",
        [fixture.course],
      );
      const result = await db.query<{ amount: number }>(
        "SELECT public.lead_abvmu_deposit_amount($1) AS amount",
        [fixture.lead],
      );
      expect(Number(result.rows[0].amount)).toBe(0);
    }
  });

  it("retains configured deposits for other courses and leaves fee records intact", async () => {
    expect(migration).toContain("fs.metadata->>'seat_reservation_deposit'");
    expect(migration).toContain("abvmu_deposit_not_applicable");
    expect(migration).not.toMatch(/UPDATE\s+public\.(fee_ledger|lead_payments|fee_structures)/i);
    await db.exec(`
      INSERT INTO public.courses(id, code, webflow_slug, name)
      VALUES ('10000000-0000-0000-0000-000000000010', 'BPT-GN', 'bachelor-physiotherapy', 'Bachelor of Physiotherapy (BPT)');
      INSERT INTO public.leads(id, course_id)
      VALUES ('20000000-0000-0000-0000-000000000010', '10000000-0000-0000-0000-000000000010');
      INSERT INTO public.fee_structures(course_id, is_active, created_at, metadata)
      VALUES ('10000000-0000-0000-0000-000000000010', true, now(), '{"seat_reservation_deposit":40000}');
    `);
    const result = await db.query<{ amount: number }>(
      "SELECT public.lead_abvmu_deposit_amount($1) AS amount",
      ["20000000-0000-0000-0000-000000000010"],
    );
    expect(Number(result.rows[0].amount)).toBe(40000);
  });

  it("preserves the GNM not-applicable override", async () => {
    await db.exec(`
      INSERT INTO public.courses(id, code, webflow_slug, name)
      VALUES ('10000000-0000-0000-0000-000000000020', 'GNM-GN', 'gnm', 'GNM');
      INSERT INTO public.leads(id, course_id, abvmu_deposit_not_applicable)
      VALUES ('20000000-0000-0000-0000-000000000020', '10000000-0000-0000-0000-000000000020', true);
      INSERT INTO public.fee_structures(course_id, is_active, created_at, metadata)
      VALUES ('10000000-0000-0000-0000-000000000020', true, now(), '{"seat_reservation_deposit":20000}');
    `);
    const result = await db.query<{ amount: number }>(
      "SELECT public.lead_abvmu_deposit_amount($1) AS amount",
      ["20000000-0000-0000-0000-000000000020"],
    );
    expect(Number(result.rows[0].amount)).toBe(0);
  });

  it("suppresses D.Pharma metadata amounts and preserves other courses' deposits", () => {
    expect(resolveAbvmuDepositAmount("Diploma in Pharmacy (D.Pharma)", 20000)).toBe(0);
    expect(resolveAbvmuDepositAmount("Diploma in Pharmacy", 15000)).toBe(0);
    expect(resolveAbvmuDepositAmount("Bachelor of Physiotherapy (BPT)", 40000)).toBe(40000);
    expect(resolveAbvmuDepositAmount("Bachelor of Physiotherapy (BPT)", -10)).toBe(0);
  });

  it("skips the synthetic Year 1 split when the shared amount is zero", () => {
    expect(feePanel).toContain("if (!dep || dep <= 0) return feeGroups");
    expect(depositHook).toContain("resolveAbvmuDepositAmount(courseName, status.abvmu_deposit_amount)");
  });

  it("hides the deposit across applicant and student fee surfaces", () => {
    expect(applicantPanel).toContain("resolveAbvmuDepositAmount(courseName, feeStatus.abvmu_deposit_amount)");
    expect(studentPortal).toContain("resolveAbvmuDepositAmount(course?.name || course?.code");
  });
});
