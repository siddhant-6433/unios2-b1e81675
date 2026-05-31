import { describe, it, expect } from "vitest";
import {
  ALL_LEAD_STAGES,
  STAGE_TO_BUCKET,
  FUNNEL_LEAKAGE_STAGES,
  LEAD_FUNNEL_ORDER,
  TERMINAL_LEAD_STAGES,
  leadStagesForBucket,
  shouldAutoAdvance,
} from "./leadStages";

describe("leadStages — stage mapping exhaustiveness (regression guard)", () => {
  // This is the test that would have caught `waitlisted` and `cold` silently
  // falling out of the funnel. EVERY live enum value must map to exactly one
  // spine bucket OR be funnel-leakage — never orphaned.
  it("every lead_stage maps to a bucket OR is funnel-leakage, never both, never neither", () => {
    const leakage = new Set<string>(FUNNEL_LEAKAGE_STAGES);
    for (const stage of ALL_LEAD_STAGES) {
      const inBucket = stage in STAGE_TO_BUCKET;
      const inLeakage = leakage.has(stage);
      expect(
        inBucket !== inLeakage,
        `stage "${stage}" must be in EXACTLY one of STAGE_TO_BUCKET / FUNNEL_LEAKAGE_STAGES (bucket=${inBucket}, leakage=${inLeakage})`,
      ).toBe(true);
    }
  });

  it("STAGE_TO_BUCKET only references known funnel buckets", () => {
    const known = new Set<string>(LEAD_FUNNEL_ORDER);
    for (const [stage, bucket] of Object.entries(STAGE_TO_BUCKET)) {
      expect(known.has(bucket), `${stage} → unknown bucket ${bucket}`).toBe(true);
    }
  });

  it("previously-dropped stages are now mapped", () => {
    expect(STAGE_TO_BUCKET.waitlisted).toBe("offered");
    expect(FUNNEL_LEAKAGE_STAGES).toContain("cold");
    // interview is an admission gate (Approved), not Hot
    expect(STAGE_TO_BUCKET.interview).toBe("approved");
  });
});

describe("leadStages — funnel-leakage vs followup-terminal are distinct sets", () => {
  it("deferred is funnel-leakage but NOT followup-terminal", () => {
    expect(FUNNEL_LEAKAGE_STAGES).toContain("deferred");
    expect(TERMINAL_LEAD_STAGES as string[]).not.toContain("deferred");
  });
  it("cold is both", () => {
    expect(FUNNEL_LEAKAGE_STAGES).toContain("cold");
    expect(TERMINAL_LEAD_STAGES as string[]).toContain("cold");
  });
});

describe("leadStagesForBucket", () => {
  it("round-trips a bucket back to its stages", () => {
    const offered = leadStagesForBucket("offered");
    expect(offered).toEqual(expect.arrayContaining(["offer_sent", "token_paid", "pre_admitted", "waitlisted"]));
  });
  it("leakage returns the leakage set", () => {
    expect(leadStagesForBucket("leakage").sort()).toEqual([...FUNNEL_LEAKAGE_STAGES].sort());
  });
});

describe("shouldAutoAdvance — forward-only, terminal-safe", () => {
  it("advances forward", () => {
    expect(shouldAutoAdvance("new_lead", "counsellor_call")).toBe(true);
  });
  it("never rolls backward", () => {
    expect(shouldAutoAdvance("offer_sent", "counsellor_call")).toBe(false);
  });
  it("never leaves a terminal stage", () => {
    expect(shouldAutoAdvance("not_interested", "counsellor_call")).toBe(false);
    expect(shouldAutoAdvance("deferred", "admitted")).toBe(false);
  });
});
