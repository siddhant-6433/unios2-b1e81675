import { describe, it, expect } from "vitest";
import {
  acceptanceBadge,
  canRespond,
  type OfferByToken,
} from "./offerAcceptance";

const offer = (over: Partial<OfferByToken> = {}): OfferByToken => ({
  letter_id: "letter-1",
  applicant_name: "Asha Rao",
  subject: "Offer of Employment",
  body: "We are pleased to offer you the role of Counsellor.",
  status: "issued",
  acceptance_status: "pending",
  reference_no: "UNIOS/OFR/2026/001",
  desired_role: "Counsellor",
  job_opening_title: "Senior Counsellor",
  ...over,
});

describe("canRespond", () => {
  it("allows a response while the offer is pending", () => {
    expect(canRespond(offer({ acceptance_status: "pending" }))).toBe(true);
  });

  it("blocks a response once accepted or declined", () => {
    expect(canRespond(offer({ acceptance_status: "accepted" }))).toBe(false);
    expect(canRespond(offer({ acceptance_status: "declined" }))).toBe(false);
  });

  it("blocks a response when there is no offer (invalid token)", () => {
    expect(canRespond(null)).toBe(false);
    expect(canRespond(undefined)).toBe(false);
  });
});

describe("acceptanceBadge", () => {
  it("maps each known status to a pastel pill", () => {
    expect(acceptanceBadge("pending")).toContain("bg-pastel-yellow");
    expect(acceptanceBadge("accepted")).toContain("bg-pastel-green");
    expect(acceptanceBadge("declined")).toContain("bg-pastel-red");
  });

  it("never returns undefined for an unexpected status", () => {
    expect(acceptanceBadge("mystery")).toContain("bg-muted");
  });
});
