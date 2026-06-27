import { readFileSync } from "fs";
import { describe, expect, it } from "vitest";

const academicPartnersPage = readFileSync("src/pages/AcademicPartners.tsx", "utf8");
const academicPartnerPortal = readFileSync("src/pages/AcademicPartnerPortal.tsx", "utf8");
const onboardingMigration = readFileSync("supabase/migrations/20260627101000_academic_partner_onboarding.sql", "utf8");
const logoMigration = readFileSync("supabase/migrations/20260627102000_academic_partner_logo.sql", "utf8");

describe("academic partner management actions", () => {
  it("exposes explicit controls for course, batch, and lead assignment", () => {
    expect(academicPartnersPage).toContain("Assign Course/Batch");
    expect(academicPartnersPage).toContain("Assign Lead");
    expect(academicPartnersPage).toContain("Add Course or Batch Assignment");
    expect(academicPartnersPage).toContain("Assign Lead to Academic Partner");
  });

  it("assigns leads to academic partners through the external owner RPC", () => {
    expect(academicPartnersPage).toContain("assign_lead_external_owner");
    expect(academicPartnersPage).toContain('_owner_type: "academic_partner"');
    expect(academicPartnersPage).toContain("_academic_partner_id: leadAssignmentPartnerId");
  });

  it("provides a resumable academic partner onboarding flow", () => {
    expect(academicPartnerPortal).toContain("Academic Partner Onboarding");
    expect(academicPartnerPortal).toContain("Skip for now");
    expect(academicPartnerPortal).toContain("Resume Onboarding");
    expect(academicPartnerPortal).toContain("Save & Continue");
    expect(academicPartnerPortal).toContain("Complete Onboarding");
    expect(academicPartnerPortal).toContain("save_academic_partner_onboarding");
  });

  it("keeps academic partner documents internal-only after upload", () => {
    expect(onboardingMigration).toContain("academic_partner_documents");
    expect(onboardingMigration).toContain("VALUES ('academic-partner-documents', 'academic-partner-documents', false)");
    expect(onboardingMigration).toContain("Academic partners insert own internal documents");
    expect(onboardingMigration).not.toContain("Academic partners read own internal documents");
    expect(onboardingMigration).toContain("Admins read academic partner documents");
    expect(academicPartnersPage).toContain("createSignedUrl");
    expect(academicPartnerPortal).toContain("They are not listed back in the academic partner portal");
  });

  it("lets academic partners upload a private PNG dashboard logo without exposing documents", () => {
    expect(academicPartnerPortal).toContain("Upload Logo");
    expect(academicPartnerPortal).toContain('accept="image/png"');
    expect(academicPartnerPortal).toContain("save_academic_partner_logo");
    expect(academicPartnerPortal).toContain("academic-partner-logos");
    expect(logoMigration).toContain("logo_file_path");
    expect(logoMigration).toContain("VALUES ('academic-partner-logos', 'academic-partner-logos', false)");
    expect(logoMigration).toContain("Academic partners read own logo files");
    expect(logoMigration).toContain("Academic partners upload own logo files");
    expect(logoMigration).not.toContain("academic-partner-documents");
  });
});
