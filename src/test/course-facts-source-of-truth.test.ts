import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

// The pre-commit hook restamps new migrations, so resolve by suffix.
function readMigration(suffix: string): string {
  const dir = "supabase/migrations";
  const file = readdirSync(dir).find((f) => f.endsWith(`_${suffix}.sql`));
  if (!file) throw new Error(`migration *_${suffix}.sql not found`);
  return readFileSync(`${dir}/${file}`, "utf8");
}

const seed = readMigration("seed_course_facts_curated");
const resolvers = readMigration("course_facts_resolvers_and_surfaces");
const coursePanel = readFileSync("src/components/leads/CourseInfoPanel.tsx", "utf8");
const templateManager = readFileSync("src/pages/TemplateManager.tsx", "utf8");
const navyaContext = readFileSync("supabase/functions/_shared/nimt-admissions-context.ts", "utf8");

describe("course_facts is the single source of truth", () => {
  it("stores curated facts as text, because the answers are prose", () => {
    // "800/month", "Stetho Batch total fee Rs 1,85,000 across 5 semesters..."
    // and "Minimum age 17 on or before 31st December" do not fit int columns.
    expect(seed).toContain("CREATE TABLE IF NOT EXISTS public.course_facts");
    expect(seed).toMatch(/fee_first_year\s+text/);
    expect(seed).toMatch(/age_requirement\s+text/);
  });

  it("only admissions leadership can change what students are told", () => {
    expect(seed).toContain('CREATE POLICY "Admins can manage course_facts"');
    expect(seed).toMatch(/'admission_head'::public\.app_role/);
    // Counsellors read but cannot write.
    expect(seed).toContain('CREATE POLICY "Staff can read course_facts"');
  });

  it("seeds every course from the admissions-curated sheet", () => {
    const codes = [...seed.matchAll(/^\('([A-Z0-9-]+)',/gm)].map((m) => m[1]);
    expect(new Set(codes).size).toBe(64);
    // Spot-check the values that were previously wrong on WhatsApp.
    expect(seed).toContain("'Chaudhary Charan Singh University | Bar Council of India'");
    expect(seed).toContain("'Atal Bihari Vajpayee Medical University, Lucknow'");
    expect(seed).toMatch(/'LLB-GN'.*graduation or post-graduation degree/);
  });

  it("leaves the misaligned MES-TOD cells blank rather than guessing", () => {
    // Those two cells were shifted a row up in the source sheet.
    expect(seed).toContain("('MES-TOD', NULL, NULL, NULL, NULL, 'Minimum age: 2 years plus'");
  });
});

describe("one resolver, read by every surface", () => {
  it("prefers curated facts and falls back per field", () => {
    expect(resolvers).toContain("CREATE OR REPLACE FUNCTION public.fn_course_facts");
    // Curated value always wins; legacy columns only fill gaps.
    expect(resolvers).toMatch(/COALESCE\(NULLIF\(trim\(cf\.eligibility\), ''\),\s*NULLIF\(trim\(c\.eligibility\)/);
    expect(resolvers).toContain("'curated', (cf.course_id IS NOT NULL)");
  });

  it("routes the WhatsApp course_info templates through it", () => {
    expect(resolvers).toContain("fn_resolve_course_info_params_by_course");
    expect(resolvers).toContain("public.fn_course_facts(p_course_id, p_student_name)");
    // The lead-keyed resolver is now a thin wrapper, not a second implementation.
    expect(resolvers).toMatch(/fn_resolve_course_info_params\(p_lead_id uuid\)[\s\S]{0,400}fn_resolve_course_info_params_by_course/);
  });

  it("routes the website view through it", () => {
    expect(resolvers).toContain("CREATE OR REPLACE VIEW public.course_marketing_info");
    expect(resolvers).toContain("LEFT JOIN public.course_facts cf");
    expect(resolvers).toContain("public.fn_course_affiliation_label(c.id) AS affiliation");
  });

  it("prefers curated affiliation over the approval_letters archive", () => {
    // The archive has no notion of recency, which is why BMRIT read "ABVMU, CCSU".
    expect(resolvers).toMatch(/curated_fact[\s\S]{0,600}curated_array[\s\S]{0,600}from_letters/);
  });

  it("routes the counsellor Course tab through it", () => {
    expect(coursePanel).toContain('"fn_course_facts"');
    expect(coursePanel).toContain("What we tell students");
  });

  it("routes Navya through it and marks the facts authoritative", () => {
    expect(navyaContext).toContain("loadCuratedCourseFacts");
    expect(navyaContext).toContain("fn_course_facts");
    expect(navyaContext).toContain("CURATED COURSE FACTS");
    expect(navyaContext).toContain("quote them verbatim");
  });
});

describe("editing goes to the source of truth", () => {
  it("saves curated fields to course_facts, not the deprecated column", () => {
    expect(templateManager).toContain('from("course_facts")');
    expect(templateManager).toContain("FACT_FIELDS");
    // marketing_eligibility is no longer an editable field in the admin table.
    expect(templateManager).not.toContain('set("marketing_eligibility"');
  });

  it("tells the admin which surfaces their edit reaches", () => {
    expect(templateManager).toContain("single source of truth");
    expect(templateManager).toContain("counsellor Course tab");
  });
});
