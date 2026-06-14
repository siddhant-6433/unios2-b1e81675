import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

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

  it("uses eligibility_rules as the canonical source on the document review page", () => {
    expect(adminApplicationView).toContain('from("eligibility_rules")');
    expect(adminApplicationView).toContain("entrance_exam_name");
    expect(adminApplicationView).toContain("entrance_exam_required");
    expect(adminApplicationView).toContain("eligibilityRule?.entrance_exam_name || lead.course.entrance_exam");
    expect(adminApplicationView).toContain("eligibilityRule?.entrance_exam_required ?? lead.course.entrance_mandatory");
  });

  it("does not advertise UPCNET for GNM in the WhatsApp AI prompt", () => {
    const gnmSection = whatsappAiReply.slice(
      whatsappAiReply.indexOf("GNM (General Nursing"),
      whatsappAiReply.indexOf("BPT (Bachelor"),
    );
    expect(gnmSection).toContain("UP GNM Entrance Test (UPGET)");
    expect(gnmSection).not.toContain("UPCNET");
  });
});
