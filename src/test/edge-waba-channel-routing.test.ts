import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const channel = readFileSync("supabase/functions/_shared/whatsapp-channel.ts", "utf8");
const send = readFileSync("supabase/functions/whatsapp-send/index.ts", "utf8");

describe("lead template send routes by the template's WABA", () => {
  it("accepts a wabaId hint and normalises NULL to MAIN", () => {
    expect(channel).toContain("wabaId?: string | null;");
    expect(channel).toContain('export const normWaba = (w: string | null | undefined): string => w || "MAIN";');
  });

  it("disqualifies channels outside the template's WABA", () => {
    // A Mirai-WABA template sent from the NIMT number fails with Meta 132001.
    expect(channel).toContain("if (hint.wabaId && normWaba(channel.waba_id) !== normWaba(hint.wabaId)) return -1;");
    expect(channel).toContain("if (hint.wabaId) score += 6;");
  });

  it("reads the template's waba_id and pins the sender", () => {
    expect(send).toContain("components, language, waba_id");
    expect(send).toContain("let templateWabaId: string | null = null;");
    expect(send).toContain("templateWabaId = ((dynamicTemplate as any).waba_id as string | null) || null;");
    expect(send).toContain("wabaId: templateWabaId,");
  });

  it("keeps default-WABA templates on the existing route", () => {
    // templateWabaId stays null for the hardcoded NIMT templates, so the hint
    // carries no WABA and routing is unchanged.
    expect(send).toContain("let templateDef = TEMPLATES[template_key];");
  });
});
