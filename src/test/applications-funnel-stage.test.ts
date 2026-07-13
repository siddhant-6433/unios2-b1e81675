import { describe, expect, it } from "vitest";
import {
  applicationFunnelStageOf,
  funnelStageHoldSplits,
  isApplicationOnHold,
  isPaidBeforeOfferStage,
} from "@/lib/applicationFunnel";
import { readFileSync } from "node:fs";

const app = (overrides: Record<string, unknown> = {}) => ({
  status: "draft",
  payment_status: "pending",
  lead_stage: "",
  lead_pre_admission_no: null,
  lead_admission_no: null,
  has_token_fee_paid: false,
  has_offer: false,
  ...overrides,
} as any);

describe("Applications funnel stage", () => {
  it("treats AN as admitted even when lead_stage is stale", () => {
    expect(applicationFunnelStageOf(app({
      lead_stage: "token_paid",
      lead_pre_admission_no: "PAN-1",
      lead_admission_no: "AN-1",
      has_token_fee_paid: true,
    }))).toBe("admitted");
  });

  it("treats PAN as pre-admitted before token/payment fallbacks", () => {
    expect(applicationFunnelStageOf(app({
      lead_stage: "offer_sent",
      lead_pre_admission_no: "PAN-1",
      has_token_fee_paid: true,
    }))).toBe("pre_admitted");
  });

  it("treats approved applications as pending offer even when lead_stage is stale", () => {
    expect(applicationFunnelStageOf(app({
      status: "approved",
      payment_status: "paid",
      lead_stage: "counsellor_call",
    }))).toBe("approved");
  });

  it("keeps offer-sent ahead of approved once an offer exists", () => {
    expect(applicationFunnelStageOf(app({
      status: "approved",
      payment_status: "paid",
      lead_stage: "counsellor_call",
      has_offer: true,
    }))).toBe("offer_sent");
  });

  it("counts the paid no-offer badge from stages before offer sent", () => {
    const apps = [
      app({ payment_status: "paid" }),
      app({ status: "submitted", payment_status: "paid" }),
      app({ status: "approved", payment_status: "paid" }),
      app({ payment_status: "paid", has_offer: true }),
      app({ payment_status: "paid", has_token_fee_paid: true }),
      app({ payment_status: "pending", status: "approved" }),
    ];

    expect(apps.filter(isPaidBeforeOfferStage)).toHaveLength(3);
  });

  it("keeps on-hold apps in their progress stage and splits hold vs active", () => {
    // Note: status "on_hold" is not "draft", so unpaid on_hold follows the
    // existing "past draft" branch → submitted. Paid on_hold also lands at
    // submitted (or later) via the normal paid + non-draft path.
    const apps = [
      app({ status: "draft", payment_status: "pending" }), // in_progress active
      app({ status: "draft", payment_status: "paid" }), // paid active
      app({ status: "on_hold", payment_status: "pending" }), // submitted hold (unpaid non-draft)
      app({ status: "on_hold", payment_status: "paid" }), // submitted hold
      app({ status: "submitted", payment_status: "paid" }), // submitted active
      app({ status: "on_hold", payment_status: "paid", lead_stage: "application_approved" }), // approved hold
    ];

    expect(isApplicationOnHold(apps[2])).toBe(true);
    expect(applicationFunnelStageOf(apps[0])).toBe("in_progress");
    expect(applicationFunnelStageOf(apps[1])).toBe("paid");
    expect(applicationFunnelStageOf(apps[2])).toBe("submitted");
    expect(applicationFunnelStageOf(apps[3])).toBe("submitted");
    expect(applicationFunnelStageOf(apps[5])).toBe("approved");

    const splits = funnelStageHoldSplits(apps);
    expect(splits.in_progress).toEqual({ stuck: 1, onHold: 0, active: 1 });
    expect(splits.paid).toEqual({ stuck: 1, onHold: 0, active: 1 });
    expect(splits.submitted).toEqual({ stuck: 3, onHold: 2, active: 1 });
    expect(splits.approved).toEqual({ stuck: 1, onHold: 1, active: 0 });
  });

  it("renders hold/active split chips on pipeline stage cards", () => {
    const page = readFileSync("src/pages/Applications.tsx", "utf8");
    expect(page).toContain("funnelStageHoldSplits");
    expect(page).toContain("stageHoldSplit");
    expect(page).toContain("hold");
    expect(page).toContain("active");
    expect(page).toContain("stuckOnHold");
  });
});
