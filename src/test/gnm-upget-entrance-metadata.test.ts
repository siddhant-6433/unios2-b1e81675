import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

// The pre-commit hook restamps new migrations, so resolve by name suffix.
function readMigration(suffix: string): string {
  const dir = "supabase/migrations";
  const file = readdirSync(dir).find((f) => f.endsWith(`_${suffix}.sql`));
  if (!file) throw new Error(`migration *_${suffix}.sql not found`);
  return readFileSync(`${dir}/${file}`, "utf8");
}

const adminApplicationView = readFileSync("src/pages/AdminApplicationView.tsx", "utf8");
const migration = readFileSync("supabase/migrations/20260619131000_fix_gnm_upget_entrance_metadata.sql", "utf8");
const whatsappAiReply = readFileSync("supabase/functions/whatsapp-ai-reply/index.ts", "utf8");

describe("GNM UPGET entrance metadata", () => {
  it("corrects GNM entrance metadata in both course and eligibility rule records", () => {
    expect(migration).toContain("WHERE code = 'GNM-GN'");
    expect(migration).toContain("UP GNM Entrance Test (UPGET)");
    expect(migration).toContain("entrance_mandatory = true");
    expect(migration).toContain("entrance_exam_required = true");
    expect(migration).not.toContain("UPCNET");
  });

  it("shows the curated course facts on the document review page", () => {
    // The reviewer checks documents against the criteria the student was
    // actually shown, so curated course_facts now lead. eligibility_rules stays
    // as the fallback and remains canonical for entrance_mandatory, which is a
    // boolean course_facts does not carry.
    expect(adminApplicationView).toContain('"fn_course_facts"');
    expect(adminApplicationView).toContain('from("eligibility_rules")');
    expect(adminApplicationView).toContain("courseFacts?.eligibility || eligibilityRule?.notes || lead.course.eligibility");
    expect(adminApplicationView).toContain("courseFacts?.entrance_exam || eligibilityRule?.entrance_exam_name || lead.course.entrance_exam");
    expect(adminApplicationView).toContain("eligibilityRule?.entrance_exam_required ?? lead.course.entrance_mandatory");
  });

  it("does not advertise UPCNET for GNM in the WhatsApp AI prompt", () => {
    // The per-course facts that used to be hardcoded in KNOWLEDGE_BASE now come
    // from course_facts at request time, so the guarantee moved with them: the
    // constant must no longer state any course's entrance exam, and the seeded
    // GNM row must say UPGET.
    const knowledgeBase = whatsappAiReply.slice(whatsappAiReply.indexOf("const KNOWLEDGE_BASE"));
    const body = knowledgeBase.slice(0, knowledgeBase.indexOf("\n`;"));
    expect(body).toContain("{{COURSE_FACTS}}");
    expect(body).not.toContain("UPCNET");
    expect(body).not.toMatch(/^- Entrance:/m);

    const seed = readMigration("seed_course_facts_curated");
    const gnmRow = seed.slice(seed.indexOf("('GNM-GN'"));
    const gnmValues = gnmRow.slice(0, gnmRow.indexOf("),\n"));
    expect(gnmValues).toContain("UP GNM Entrance Test (UPGET)");
    expect(gnmValues).not.toContain("UPCNET");
  });
});
