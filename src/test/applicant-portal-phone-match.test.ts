import { readFileSync } from "fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/20260713140000_applicant_portal_phone_lead_match.sql",
  "utf8",
);

describe("applicant portal phone/lead match", () => {
  it("loads applications by application phone OR linked lead phone", () => {
    expect(migration).toContain("get_applicant_applications_by_phone");
    expect(migration).toContain("a.phone = _phone");
    expect(migration).toContain("a.lead_id IN");
    expect(migration).toContain("FROM public.leads l");
    expect(migration).toContain("WHERE l.phone = _phone");
  });

  it("loads approved offers by lead phone OR linked application phone", () => {
    expect(migration).toContain("get_applicant_offers_by_phone");
    expect(migration).toContain("l.phone = _phone");
    expect(migration).toContain("FROM public.applications a");
    expect(migration).toContain("a.lead_id = ol.lead_id");
    expect(migration).toContain("a.phone = _phone");
    expect(migration).toContain("ol.approval_status = 'approved'");
  });
});
