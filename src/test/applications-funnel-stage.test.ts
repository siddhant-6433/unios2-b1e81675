import { describe, expect, it } from "vitest";
import { applicationFunnelStageOf, isPaidBeforeOfferStage } from "@/lib/applicationFunnel";

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
});
