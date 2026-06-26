import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const transitionAdapter = readFileSync("supabase/functions/_shared/lead-transition.ts", "utf8");

const serverStageWriters = [
  "supabase/functions/dnc-scan/index.ts",
  "supabase/functions/voice-call-callback/index.ts",
  "supabase/functions/whatsapp-conversation-orchestrator/index.ts",
  "supabase/functions/whatsapp-ai-reply/index.ts",
  "supabase/functions/whatsapp-webhook/index.ts",
  "supabase/functions/automation-engine/index.ts",
  "supabase/functions/wa-classify-message/index.ts",
];

describe("server lead transition adapter", () => {
  it("defines named server transition commands instead of exposing a generic stage setter", () => {
    for (const command of [
      "markDnc",
      "restoreFromDnc",
      "classifyLead",
      "classifyNotInterested",
      "classifyIneligible",
      "automationAdvanceStage",
    ]) {
      expect(transitionAdapter).toContain(command);
    }

    expect(transitionAdapter).toContain("applyLeadTransition");
    expect(transitionAdapter).toContain('from("lead_activities")');
  });

  it("routes high-risk server stage writers through the transition adapter", () => {
    for (const file of serverStageWriters) {
      const source = readFileSync(file, "utf8");
      expect(source, `${file} should import the lead transition adapter`).toContain("applyLeadTransition");
      expect(source, `${file} should not directly update leads.stage`).not.toContain('update({ stage: "');
      expect(source, `${file} should not directly update leads.stage`).not.toContain("update({ stage: action.to_stage");
      expect(source, `${file} should not combine person_role with a raw stage patch`).not.toContain('person_role: personRoleTarget, stage: "not_interested"');
    }
  });
});
