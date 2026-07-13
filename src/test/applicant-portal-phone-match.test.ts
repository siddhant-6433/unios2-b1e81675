import { readFileSync } from "fs";
import { describe, expect, it } from "vitest";

const phoneMatch = readFileSync(
  "supabase/migrations/20260713140000_applicant_portal_phone_lead_match.sql",
  "utf8",
);
const courseIdMig = readFileSync(
  "supabase/migrations/20260713150000_applicant_offers_return_course_id.sql",
  "utf8",
);
const applyPortal = readFileSync("src/pages/ApplyPortal.tsx", "utf8");
const tokenPanel = readFileSync("src/components/applicant/TokenFeePanel.tsx", "utf8");

describe("applicant portal phone/lead match", () => {
  it("loads applications by application phone OR linked lead phone", () => {
    expect(phoneMatch).toContain("get_applicant_applications_by_phone");
    expect(phoneMatch).toContain("a.phone = _phone");
    expect(phoneMatch).toContain("a.lead_id IN");
  });

  it("offers RPC returns course_id for per-app ownership", () => {
    expect(courseIdMig).toContain("get_applicant_offers_by_phone");
    expect(courseIdMig).toContain("ol.course_id");
  });

  it("dashboard attaches offer only to the owning application", () => {
    expect(applyPortal).toContain("pickOfferOwnerAppId");
    expect(applyPortal).toContain("offerOwnerByLead");
    expect(applyPortal).toContain("isOfferOwner");
    expect(applyPortal).toContain("Offer linked");
  });

  it("places year-1 / one-time options above the token-fee fallback", () => {
    const y1 = tokenPanel.indexOf("Pay year 1 now");
    const token = tokenPanel.indexOf("Can't pay full amount right now?");
    expect(y1).toBeGreaterThan(-1);
    expect(token).toBeGreaterThan(-1);
    expect(y1).toBeLessThan(token);
  });
});
