import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  MIRAI_CAMPUS_ID,
  pickLeadForPortal,
  pickLeadForSchoolBrand,
  schoolLeadBrand,
} from "@/lib/schoolLeadBrand";
import { readMigration } from "./readMigration";

const stopMirroring = readMigration("stop_beacon_mirai_lead_mirroring");
const applyPortal = readFileSync("src/pages/ApplyPortal.tsx", "utf8");
const courseSelector = readFileSync("src/components/apply/CourseSelector.tsx", "utf8");
const leadIngest = readFileSync("supabase/functions/lead-ingest/index.ts", "utf8");
const leadDetail = readFileSync("src/pages/LeadDetail.tsx", "utf8");
const sharedHelper = readFileSync("supabase/functions/_shared/schoolLeadBrand.ts", "utf8");

const BEACON_CAMPUS = "9bb6b4cc-c992-4af1-b9d3-384537a510c8";

describe("school lead brand", () => {
  it("treats Mirai school and NIMT/Beacon as different CRM brands", () => {
    expect(schoolLeadBrand({ portal_brand: "mirai" })).toBe("mirai");
    expect(schoolLeadBrand({
      campus_id: MIRAI_CAMPUS_ID,
      lead_institution_type: "school",
    })).toBe("mirai");
    expect(schoolLeadBrand({
      campus_id: BEACON_CAMPUS,
      lead_institution_type: "school",
    })).toBe("nimt");
    expect(schoolLeadBrand({
      campus_id: MIRAI_CAMPUS_ID,
      lead_institution_type: "college",
    })).toBe("nimt");
  });

  it("does not attach a Beacon portal lookup to a Mirai school lead", () => {
    const beacon = {
      id: "beacon",
      campus_id: BEACON_CAMPUS,
      portal_brand: "beacon",
      lead_institution_type: "school" as const,
    };
    const mirai = {
      id: "mirai",
      campus_id: MIRAI_CAMPUS_ID,
      portal_brand: "mirai",
      lead_institution_type: "school" as const,
    };
    expect(pickLeadForPortal([mirai, beacon], "beacon")?.id).toBe("beacon");
    expect(pickLeadForPortal([mirai, beacon], "mirai")?.id).toBe("mirai");
    expect(pickLeadForSchoolBrand([mirai], "nimt")).toBeNull();
  });
});

describe("stop Beacon↔Mirai lead mirroring", () => {
  it("disables the clone trigger and lets the same phone exist once per brand", () => {
    expect(stopMirroring).toContain("DROP TRIGGER IF EXISTS trg_mirror_school_lead ON public.leads");
    expect(stopMirroring).toContain("CREATE OR REPLACE FUNCTION public.fn_mirror_school_lead()");
    expect(stopMirroring).toContain("RETURN NEW;");
    expect(stopMirroring).toContain("DROP INDEX IF EXISTS public.idx_leads_phone_unique");
    expect(stopMirroring).toContain("CREATE UNIQUE INDEX idx_leads_phone_unique_nimt");
    expect(stopMirroring).toContain("CREATE UNIQUE INDEX idx_leads_phone_unique_mirai");
    expect(stopMirroring).toContain("SET mirror_lead_id = NULL");
    expect(stopMirroring).toContain("SET is_mirror = false");
  });

  it("keeps add-lead, bulk import, and WhatsApp find-or-create on the same brand", () => {
    expect(stopMirroring).toContain("CREATE OR REPLACE FUNCTION public.insert_lead");
    expect(stopMirroring).toContain("public.school_lead_brand(portal_brand, campus_id, lead_institution_type) = v_brand");
    expect(stopMirroring).toContain("CREATE OR REPLACE FUNCTION public.import_leads_bulk");
    expect(stopMirroring).toContain("_portal_brand text DEFAULT NULL");
    expect(stopMirroring).toContain("Do not promote them onto");
    expect(stopMirroring).toContain("CREATE OR REPLACE FUNCTION public.dialer_find_lead_by_phone");
    expect(stopMirroring).toContain("CREATE OR REPLACE FUNCTION public.dialer_create_lead");
    expect(stopMirroring).toContain("ILIKE '%mirai%'");
  });

  it("stops showing a linked counterpart on the lead page", () => {
    expect(leadDetail).not.toContain("MirrorLeadCard");
  });

  it("scopes apply-portal and ingest phone matches by school brand", () => {
    expect(applyPortal).toContain("pickLeadForPortal(leads, portal.id)");
    expect(courseSelector).toContain("pickLeadForPortal(existingLeads, portal.id)");
    expect(leadIngest).toContain("pickLeadForSchoolBrand");
    expect(leadIngest).toContain("incomingBrand");
    expect(sharedHelper).toContain('export const MIRAI_CAMPUS_ID = "c0000002-0000-0000-0000-000000000001"');
  });
});
