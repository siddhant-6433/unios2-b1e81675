import { describe, expect, it } from "vitest";
import { applicationFunnelStageOf } from "@/lib/applicationFunnel";

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
});
