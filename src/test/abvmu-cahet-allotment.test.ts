import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  ABVMU_CAHET_ALLOTTED_NO,
  ABVMU_CAHET_ALLOTTED_YES,
  applicationNeedsAbvmuCahetAllotment,
  hasAbvmuCahetAllotmentAnswer,
  withAbvmuCahetAllotmentFlag,
} from "@/lib/abvmuCahetAllotment";

const applyPortal = readFileSync("src/pages/ApplyPortal.tsx", "utf8");
const allotmentStep = readFileSync("src/components/apply/AbvmuCahetAllotmentStep.tsx", "utf8");
const tokenPanel = readFileSync("src/components/applicant/TokenFeePanel.tsx", "utf8");
const offerLetter = readFileSync("supabase/functions/generate-offer-letter/index.ts", "utf8");

describe("ABVMU CAHET allotment on BPT/BMRIT applications", () => {
  it("asks the allotment question until the candidate answers", () => {
    const bptApp = {
      course_selections: [{ course_name: "Bachelor of Physiotherapy (BPT)" }],
      flags: [] as string[],
    };
    expect(applicationNeedsAbvmuCahetAllotment(bptApp)).toBe(true);
    expect(applicationNeedsAbvmuCahetAllotment({
      ...bptApp,
      flags: withAbvmuCahetAllotmentFlag(bptApp.flags, true),
    })).toBe(false);
    expect(applicationNeedsAbvmuCahetAllotment({
      course_selections: [{ course_name: "MBA" }],
      flags: [],
    })).toBe(false);
    expect(applicationNeedsAbvmuCahetAllotment({
      course_selections: [{ course_name: "BMRIT" }],
      flags: [],
    })).toBe(true);
    expect(applicationNeedsAbvmuCahetAllotment({
      course_selections: [{ course_name: "B.Sc Radiology and Imaging Technology" }],
      flags: [],
    })).toBe(true);
  });

  it("records yes/no as exclusive application flags", () => {
    const yes = withAbvmuCahetAllotmentFlag(["portal:nimt"], true);
    expect(yes).toContain(ABVMU_CAHET_ALLOTTED_YES);
    expect(yes).not.toContain(ABVMU_CAHET_ALLOTTED_NO);
    const no = withAbvmuCahetAllotmentFlag(yes, false);
    expect(no).toContain(ABVMU_CAHET_ALLOTTED_NO);
    expect(no).not.toContain(ABVMU_CAHET_ALLOTTED_YES);
    expect(hasAbvmuCahetAllotmentAnswer(no)).toBe(true);
  });

  it("wires the apply-form gate and reuses the existing challan claim RPC", () => {
    expect(applyPortal).toContain("AbvmuCahetAllotmentStep");
    expect(applyPortal).toContain("applicationNeedsAbvmuCahetAllotment");
    expect(allotmentStep).toContain("submit_abvmu_deposit_claim");
    expect(allotmentStep).toContain("Has the candidate been allotted a seat by ABVMU CAHET counselling?");
    expect(allotmentStep).toContain("abvmu-claims/");
  });

  it("adds uniform to one-time first-year payment without waiving it", () => {
    expect(tokenPanel).toContain("uniformFee");
    expect(tokenPanel).toContain("Uniform fee (no waiver)");
    expect(tokenPanel).toContain("Not included in the 5% lump-sum waiver");
  });

  it("prints uniform on the offer letter and links a pre-uploaded challan", () => {
    expect(offerLetter).toContain("Uniform Fee (payable with first-year fee; not eligible for lump-sum waiver)");
    expect(offerLetter).toContain(".is(\"offer_letter_id\", null)");
    expect(offerLetter).toContain(".in(\"status\", [\"pending\", \"approved\"])");
  });
});
