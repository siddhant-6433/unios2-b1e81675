import { describe, expect, it } from "vitest";
import {
  WHATSAPP_GOLDEN_ANSWER_EVALS,
  evaluateWhatsAppGoldenAnswer,
  evaluateWhatsAppGoldenAnswers,
} from "@/lib/whatsappGoldenEvals";

describe("WhatsApp golden answer evals", () => {
  it("defines admissions evals with required source references", () => {
    expect(WHATSAPP_GOLDEN_ANSWER_EVALS.length).toBeGreaterThanOrEqual(4);
    expect(WHATSAPP_GOLDEN_ANSWER_EVALS.some((item) => item.category === "fees")).toBe(true);
    expect(WHATSAPP_GOLDEN_ANSWER_EVALS.some((item) => item.category === "eligibility")).toBe(true);
    expect(WHATSAPP_GOLDEN_ANSWER_EVALS.every((item) => item.sourceRefs.length > 0)).toBe(true);
    expect(WHATSAPP_GOLDEN_ANSWER_EVALS.flatMap((item) => item.sourceRefs)).toContain("web-chat-server/knowledge.ts");
    expect(WHATSAPP_GOLDEN_ANSWER_EVALS.flatMap((item) => item.sourceRefs)).toContain("fee_structures");
    expect(WHATSAPP_GOLDEN_ANSWER_EVALS.flatMap((item) => item.sourceRefs)).toContain("eligibility_rules");
  });

  it("passes a grounded fee answer and fails a vague fee answer", () => {
    const feeEval = WHATSAPP_GOLDEN_ANSWER_EVALS.find((item) => item.id === "fee_bsc_nursing_en");
    expect(feeEval).toBeTruthy();

    const good = evaluateWhatsAppGoldenAnswer(feeEval!, [
      "B.Sc Nursing first-year fee is Rs 1,53,000.",
      "Full year-wise fee structure: https://nimt.ac.in/admissions/fees/",
      "Scholarship and loan support may be available.",
    ].join("\n"));
    expect(good.passed).toBe(true);

    const vague = evaluateWhatsAppGoldenAnswer(feeEval!, "Please contact admissions for latest fee.");
    expect(vague.passed).toBe(false);
    expect(vague.missingTerms).toContain("https://nimt.ac.in/admissions/fees/");
    expect(vague.forbiddenTermsFound).toContain("contact admissions for latest fee");
  });

  it("evaluates a batch of generated answers by eval id", () => {
    const results = evaluateWhatsAppGoldenAnswers({
      fee_unknown_course_hinglish: "Fees course aur campus par depend karti hai. Official page: https://nimt.ac.in/admissions/fees/ Please course and campus share kar dijiye.",
      eligibility_bpt_en: "For BPT, eligibility is 10+2 with PCB and English. UP 2026-27 admission is through CAHET counselling.",
      course_not_offered_mbbs: "We do not currently offer MBBS. You can consider B.Sc Nursing or BPT at NIMT.",
    });

    const checked = results.filter((result) => result.id !== "fee_bsc_nursing_en");
    expect(checked.every((result) => result.passed)).toBe(true);
  });
});
