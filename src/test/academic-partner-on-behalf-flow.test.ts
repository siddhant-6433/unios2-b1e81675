import { readFileSync } from "fs";
import { describe, expect, it } from "vitest";

const portal = readFileSync("src/pages/AcademicPartnerPortal.tsx", "utf8");
const applyPortal = readFileSync("src/pages/ApplyPortal.tsx", "utf8");
const applyLinkButton = readFileSync("src/components/leads/ApplyMagicLinkButton.tsx", "utf8");
const paymentSection = readFileSync("src/components/apply/PaymentSection.tsx", "utf8");
const tokenFeePanel = readFileSync("src/components/applicant/TokenFeePanel.tsx", "utf8");
const generateApplyLink = readFileSync("supabase/functions/generate-apply-link/index.ts", "utf8");
const redeemApplyLink = readFileSync("supabase/functions/redeem-apply-link/index.ts", "utf8");
const applicationAction = readFileSync("supabase/functions/academic-partner-application-action/index.ts", "utf8");
const onBehalfAudit = readFileSync("supabase/functions/academic-partner-on-behalf-audit/index.ts", "utf8");
const offerOtp = readFileSync("supabase/functions/academic-partner-offer-otp/index.ts", "utf8");
const migration = readFileSync("supabase/migrations/20260627090000_academic_partner_on_behalf_flow.sql", "utf8");

describe("academic partner on-behalf application flow", () => {
  it("adds on-behalf actions inside the academic partner portal", () => {
    expect(portal).toContain('mode="academic_partner_on_behalf"');
    expect(portal).toContain("Complete Application");
    expect(portal).toContain("Continue Application");
    expect(portal).toContain("Start New Application");
    expect(portal).toContain("View/Download PDF");
    expect(portal).toContain("application_form_pdf_url");
    expect(portal).toContain("isCompletedApplication");
    expect(portal).toContain('label: "Applications", value: "applications"');
    expect(portal).toContain('label: "Leads", value: "leads"');
    expect(portal).not.toContain('navigate(`/admissions/${lead.id}`)');
  });

  it("generates scoped on-behalf apply links only for mapped partner leads", () => {
    expect(applyLinkButton).toContain('mode = "student"');
    expect(applyLinkButton).toContain("expires_in_hours: 24, mode");
    expect(applyLinkButton).toContain("start_new=1");
    expect(applyPortal).toContain("forceStartNew");
    expect(generateApplyLink).toContain('mode = "student"');
    expect(generateApplyLink).toContain('"academic_partner_on_behalf"');
    expect(generateApplyLink).toContain("can_academic_partner_view_mapped_lead");
    expect(generateApplyLink).toContain("Only academic partners can generate on-behalf application links");
    expect(generateApplyLink).toContain("application_on_behalf_audit");
  });

  it("redeems on-behalf links with actor context for the Apply Portal", () => {
    expect(redeemApplyLink).toContain("on_behalf");
    expect(redeemApplyLink).toContain("actor_user_id");
    expect(redeemApplyLink).toContain("academic_partner_id");
    expect(redeemApplyLink).toContain("can_academic_partner_view_mapped_lead");
    expect(applyPortal).toContain("type OnBehalfContext");
    expect(applyPortal).toContain("OnBehalfBanner");
    expect(applyPortal).toContain("Academic partner on-behalf mode");
  });

  it("routes on-behalf create update and submit through a secure edge function", () => {
    expect(applyPortal).toContain('supabase.functions.invoke("academic-partner-application-action"');
    expect(applyPortal).toContain('runOnBehalfApplicationAction("create"');
    expect(applyPortal).toContain('runOnBehalfApplicationAction("update"');
    expect(applyPortal).toContain('runOnBehalfApplicationAction("submit"');
    expect(applicationAction).toContain("CREATE_FIELDS");
    expect(applicationAction).toContain("UPDATE_FIELDS");
    expect(applicationAction).toContain("can_academic_partner_view_mapped_lead");
    expect(applicationAction).toContain("application_created_by_partner");
    expect(applicationAction).toContain("application_edited_by_partner");
    expect(applicationAction).toContain("application_submitted_by_partner");
  });

  it("records application fee and token fee partner attribution internally", () => {
    expect(paymentSection).toContain("application_fee_initiated_by_partner");
    expect(paymentSection).toContain("application_fee_paid_by_partner");
    expect(paymentSection).toContain("on_behalf_token");
    expect(tokenFeePanel).toContain("token_fee_initiated_by_partner");
    expect(tokenFeePanel).toContain("token_fee_paid_by_partner");
    expect(onBehalfAudit).toContain("ALLOWED_ACTIONS");
    expect(onBehalfAudit).toContain("Application is not linked to this assigned lead");
    expect(onBehalfAudit).toContain("Offer is not linked to this assigned lead");
  });

  it("requires WhatsApp OTP consent before partner offer acceptance and token payment", () => {
    expect(tokenFeePanel).toContain("Student OTP consent required");
    expect(tokenFeePanel).toContain("academic-partner-offer-otp");
    expect(tokenFeePanel).toContain("offerConsentVerified");
    expect(tokenFeePanel).toContain("Student WhatsApp OTP consent is required");
    expect(offerOtp).toContain("offer_acceptance_otp_sent");
    expect(offerOtp).toContain("offer_acceptance_otp_verified");
    expect(offerOtp).toContain("approval_status");
    expect(offerOtp).toContain("can_academic_partner_view_mapped_lead");
  });

  it("adds audit and consent storage in the database migration", () => {
    expect(migration).toContain("mode TEXT NOT NULL DEFAULT 'student'");
    expect(migration).toContain("actor_user_id UUID REFERENCES auth.users");
    expect(migration).toContain("academic_partner_id UUID REFERENCES public.academic_partners");
    expect(migration).toContain("public.application_on_behalf_audit");
    expect(migration).toContain("public.academic_partner_offer_otps");
    expect(migration).toContain("application_uuid UUID REFERENCES public.applications");
  });
});
