import { describe, expect, it } from "vitest";
import {
  buildApplyPortalUrl,
  normalizeApplyPortalId,
  resolveApplyPortal,
} from "../../supabase/functions/generate-apply-link/portal";

describe("generate-apply-link portal routing", () => {
  it("normalizes portal ids from application flags", () => {
    expect(normalizeApplyPortalId("portal:beacon")).toBe("beacon");
    expect(normalizeApplyPortalId("MIRAI")).toBe("mirai");
    expect(normalizeApplyPortalId("unknown")).toBeNull();
  });

  it("prefers an explicit application portal flag for school applicants", () => {
    expect(resolveApplyPortal(
      { portal_brand: "nimt", lead_institution_type: "college" },
      [{ flags: ["portal:beacon"], program_category: "school" }],
    )).toBe("beacon");
  });

  it("routes unflagged school leads to the Beacon apply portal", () => {
    expect(resolveApplyPortal(
      { portal_brand: "nimt", lead_institution_type: "school" },
      [{ flags: [], program_category: "school" }],
    )).toBe("beacon");
  });

  it("routes explicit Mirai brand leads to the Mirai apply portal", () => {
    expect(resolveApplyPortal(
      { portal_brand: "mirai", lead_institution_type: "school" },
      [{ flags: [], program_category: "school" }],
    )).toBe("mirai");
  });

  it("routes Mirai website leads to the Mirai apply portal before the school fallback", () => {
    expect(resolveApplyPortal(
      { portal_brand: null, lead_institution_type: "school", source: "mirai_website" },
      [{ flags: [], program_category: "school" }],
    )).toBe("mirai");
  });

  it("routes Mirai campus leads to the Mirai apply portal before the school fallback", () => {
    expect(resolveApplyPortal(
      {
        portal_brand: null,
        lead_institution_type: "school",
        campus_id: "c0000002-0000-0000-0000-000000000001",
      },
      [{ flags: [], program_category: "school" }],
    )).toBe("mirai");
  });

  it("routes Mirai landing pages and course selections to the Mirai apply portal", () => {
    expect(resolveApplyPortal(
      { portal_brand: null, lead_institution_type: "school", landing_page: "https://miraischool.in/apply" },
      [{ flags: [], program_category: "school" }],
    )).toBe("mirai");

    expect(resolveApplyPortal(
      { portal_brand: null, lead_institution_type: "school" },
      [{
        flags: [],
        program_category: "school",
        course_selections: [{ campus_name: "Mirai Experiential School", course_name: "PYP" }],
      }],
    )).toBe("mirai");
  });

  it("keeps college leads on the NIMT apply portal", () => {
    expect(resolveApplyPortal(
      { portal_brand: "nimt", lead_institution_type: "college" },
      [{ flags: [], program_category: "undergraduate" }],
    )).toBe("nimt");
  });

  it("builds a portal-scoped magic link instead of the bare college fallback", () => {
    expect(buildApplyPortalUrl("https://uni.nimt.ac.in/apply", "beacon", "tok_123"))
      .toBe("https://uni.nimt.ac.in/apply/beacon?token=tok_123");
  });

  it("replaces an already-scoped portal base with the resolved portal", () => {
    expect(buildApplyPortalUrl("https://uni.nimt.ac.in/apply/nimt", "beacon", "tok_123"))
      .toBe("https://uni.nimt.ac.in/apply/beacon?token=tok_123");
  });

  it("builds Mirai-scoped magic links", () => {
    expect(buildApplyPortalUrl("https://uni.nimt.ac.in/apply", "mirai", "tok_123"))
      .toBe("https://uni.nimt.ac.in/apply/mirai?token=tok_123");
  });
});
