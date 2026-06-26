import { describe, expect, it } from "vitest";
import {
  applyApplicationDossierToRow,
  buildApplicationDossier,
  type ApplicationDossierApp,
  type ApplicationDossierFacts,
} from "./applicationDossier";

const app = (overrides: Partial<ApplicationDossierApp> = {}): ApplicationDossierApp => ({
  id: "app-row-1",
  application_id: "APP-1",
  lead_id: "lead-1",
  status: "draft",
  payment_status: "pending",
  ...overrides,
});

const facts = (overrides: Partial<ApplicationDossierFacts> = {}): ApplicationDossierFacts => ({
  lead: {
    hasLead: true,
    leadStage: "application_in_progress",
    counsellorId: "profile-1",
    counsellorName: "Counsellor",
    preAdmissionNo: null,
    admissionNo: null,
  },
  hasOffer: false,
  appFeePaid: 0,
  hasTokenFeePaid: false,
  docs: { total: 0, verified: 0, rejected: 0, pending: 0 },
  panDue: null,
  anDue: null,
  year1Due: null,
  ...overrides,
});

describe("buildApplicationDossier", () => {
  it("returns lifecycle, funnel, and next action for a draft application", () => {
    const dossier = buildApplicationDossier(app(), facts());

    expect(dossier.funnelStage).toBe("in_progress");
    expect(dossier.nextAction).toBe("collect_application_fee");
    expect(dossier.lifecycle.hasLead).toBe(true);
    expect(dossier.lifecycleStages.map((stage) => stage.key)).toEqual([
      "fee",
      "docs",
      "submitted",
      "approved",
      "offer",
      "token",
      "admitted",
    ]);
  });

  it("uses offer and PAN/AN facts to classify later lifecycle stages", () => {
    const dossier = buildApplicationDossier(
      app({ status: "approved", payment_status: "paid" }),
      facts({
        lead: {
          hasLead: true,
          leadStage: "offer_sent",
          preAdmissionNo: "PAN-1",
          admissionNo: null,
        },
        hasOffer: true,
        appFeePaid: 1500,
        hasTokenFeePaid: true,
        docs: { total: 2, verified: 2, rejected: 0, pending: 0 },
        anDue: 25000,
      }),
    );

    expect(dossier.funnelStage).toBe("pre_admitted");
    expect(dossier.nextAction).toBe("collect_admission_fee");
    expect(dossier.lifecycle.lead?.pre_admission_no).toBe("PAN-1");
    expect(dossier.anDue).toBe(25000);
  });

  it("surfaces approved orphan applications as create-lead work", () => {
    const dossier = buildApplicationDossier(
      app({ status: "approved", payment_status: "paid" }),
      facts({
        lead: { hasLead: false, leadStage: "" },
        hasOffer: false,
        appFeePaid: 1500,
        docs: { total: 2, verified: 2, rejected: 0, pending: 0 },
      }),
    );

    expect(dossier.lifecycle.hasLead).toBe(false);
    expect(dossier.nextAction).toBe("create_lead");
    expect(dossier.blockers).toContain("Approved application has no linked lead.");
  });

  it("can enrich list rows without callers rebuilding lifecycle fields", () => {
    const row = app({ status: "approved", payment_status: "paid" });
    const dossier = buildApplicationDossier(row, facts({
      hasOffer: true,
      appFeePaid: 1500,
      docs: { total: 1, verified: 1, rejected: 0, pending: 0 },
    }));

    expect(applyApplicationDossierToRow(row, dossier)).toMatchObject({
      application_id: "APP-1",
      lead_stage: "application_in_progress",
      has_offer: true,
      app_fee_paid: 1500,
      doc_counts: { total: 1, verified: 1, rejected: 0, pending: 0 },
      dossier: expect.objectContaining({ nextAction: "collect_token_fee" }),
    });
  });

  it("centralizes offer action capability and blocked reason", () => {
    expect(buildApplicationDossier(app({ status: "approved" }), facts({
      hasOffer: false,
      capabilities: { canManageOffer: false, hasLeadCourse: true },
    }))).toMatchObject({
      canIssueOffer: false,
      offerBlockedReason: "You do not have permission to issue offers",
    });

    expect(buildApplicationDossier(app({ status: "approved" }), facts({
      hasOffer: false,
      capabilities: { canManageOffer: true, hasLeadCourse: false },
    }))).toMatchObject({
      canIssueOffer: false,
      offerBlockedReason: "No course/class is linked to this application yet",
    });

    expect(buildApplicationDossier(app({ status: "approved" }), facts({
      hasOffer: false,
      capabilities: { canManageOffer: true, hasLeadCourse: true },
    })).canIssueOffer).toBe(true);
  });
});
