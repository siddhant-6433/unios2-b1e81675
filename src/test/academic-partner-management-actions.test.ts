import { readFileSync } from "fs";
import { describe, expect, it } from "vitest";

const academicPartnersPage = readFileSync("src/pages/AcademicPartners.tsx", "utf8");
const academicPartnerPortal = readFileSync("src/pages/AcademicPartnerPortal.tsx", "utf8");
const onboardingMigration = readFileSync("supabase/migrations/20260627101000_academic_partner_onboarding.sql", "utf8");
const tanMigration = readFileSync("supabase/migrations/20260627143000_academic_partner_tan_and_admin_onboarding.sql", "utf8");
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

  it("restricts payout percentages and payout edits to super admins with confirmation", () => {
    expect(academicPartnersPage).toContain('role === "super_admin"');
    expect(academicPartnersPage).toContain("canManagePayout &&");
    expect(academicPartnersPage).toContain("Default Payout %");
    expect(academicPartnersPage).toContain("Payout Override %");
    expect(academicPartnersPage).toContain("Edit Payout");
    expect(academicPartnersPage).toContain("Confirm payout change");
    expect(academicPartnersPage).toContain("handleUpdateAssignmentPayout");
    expect(academicPartnersPage).toContain("payout_percentage: canManagePayout ? payoutOverride : null");
  });

  it("provides a resumable academic partner onboarding flow", () => {
    expect(academicPartnersPage).toContain("Start Onboarding");
    expect(academicPartnersPage).toContain("Resume Onboarding");
    expect(academicPartnersPage).toContain("Upload Documents");
    expect(academicPartnersPage).toContain("saveAdminOnboarding");
    expect(academicPartnerPortal).toContain("Academic Partner Onboarding");
    expect(academicPartnerPortal).toContain("Skip for now");
    expect(academicPartnerPortal).toContain("Resume Onboarding");
    expect(academicPartnerPortal).toContain("Save & Continue");
    expect(academicPartnerPortal).toContain("Complete Onboarding");
    expect(academicPartnerPortal).toContain("save_academic_partner_onboarding");
  });

  it("captures academic partner TAN details and TAN documents", () => {
    expect(academicPartnersPage).toContain("tan_number");
    expect(academicPartnersPage).toContain("TAN Certificate");
    expect(academicPartnerPortal).toContain("_tan_number");
    expect(academicPartnerPortal).toContain("TAN Certificate");
    expect(tanMigration).toContain("ADD COLUMN IF NOT EXISTS tan_number text");
    expect(tanMigration).toContain("'tan'");
    expect(tanMigration).toContain("_tan_number text DEFAULT NULL");
  });

  it("keeps onboarding usable when the deployed schema is missing TAN support", () => {
    expect(academicPartnersPage).toContain("isTanSchemaCacheError");
    expect(academicPartnersPage).toContain("adminOnboardingPayload(status, nextStep, now, false)");
    expect(academicPartnersPage).toContain('document_type: "additional"');
    expect(academicPartnerPortal).toContain("isTanSchemaCacheError");
    expect(academicPartnerPortal).toContain("onboardingRpcPayload(status, nextStep, false)");
    expect(academicPartnerPortal).toContain('document_type: "additional"');
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
