import { computeStages, type DocCounts, type LifecycleInput, type Stage } from "@/lib/admissionLifecycle";
import { applicationFunnelStageOf, type ApplicationFunnelStage } from "@/lib/applicationFunnel";

export type ApplicationDossierNextAction =
  | "create_lead"
  | "collect_application_fee"
  | "complete_application"
  | "review_documents"
  | "approve_application"
  | "issue_offer"
  | "collect_token_fee"
  | "collect_admission_fee"
  | "admission_complete";

export interface ApplicationDossierApp {
  id?: string;
  application_id: string;
  lead_id: string | null;
  status: string;
  payment_status: string | null;
}

export interface ApplicationDossierLeadFacts {
  hasLead: boolean;
  leadStage: string;
  counsellorId?: string | null;
  counsellorName?: string | null;
  preAdmissionNo?: string | null;
  admissionNo?: string | null;
}

export interface ApplicationDossierFacts {
  lead: ApplicationDossierLeadFacts;
  hasOffer: boolean;
  appFeePaid: number;
  hasTokenFeePaid: boolean;
  docs: DocCounts;
  panDue?: number | null;
  anDue?: number | null;
  year1Due?: number | null;
  capabilities?: {
    canManageOffer?: boolean;
    hasLeadCourse?: boolean;
  };
}

export interface ApplicationDossier {
  app: ApplicationDossierApp;
  lifecycle: LifecycleInput;
  lifecycleStages: Stage[];
  funnelStage: ApplicationFunnelStage;
  nextAction: ApplicationDossierNextAction;
  blockers: string[];
  leadStage: string;
  leadCounsellorId: string;
  counsellorName: string;
  leadPreAdmissionNo: string | null;
  leadAdmissionNo: string | null;
  hasOffer: boolean;
  appFeePaid: number;
  hasTokenFeePaid: boolean;
  docCounts: DocCounts;
  panDue: number | null;
  anDue: number | null;
  year1Due: number | null;
  canIssueOffer: boolean;
  offerBlockedReason: string | null;
}

const EMPTY_DOC_COUNTS: DocCounts = { total: 0, verified: 0, rejected: 0, pending: 0 };

export function buildApplicationDossier(app: ApplicationDossierApp, facts: ApplicationDossierFacts): ApplicationDossier {
  const docs = facts.docs || EMPTY_DOC_COUNTS;
  const lead = facts.lead;
  const leadModel = app.lead_id && lead.hasLead
    ? {
        id: app.lead_id,
        pre_admission_no: lead.preAdmissionNo || null,
        admission_no: lead.admissionNo || null,
      }
    : null;

  const lifecycle: LifecycleInput = {
    app: {
      status: app.status,
      payment_status: app.payment_status,
    },
    lead: leadModel,
    hasLead: !!leadModel,
    appFeePaid: facts.appFeePaid || 0,
    hasOffer: facts.hasOffer,
    docs,
    panDue: facts.panDue ?? null,
    anDue: facts.anDue ?? null,
  };
  const lifecycleStages = computeStages(lifecycle);
  const offerAction = resolveApplicationDossierOfferAction({
    canManageOffer: !!facts.capabilities?.canManageOffer,
    hasOffer: facts.hasOffer,
    hasLead: !!leadModel,
    hasLeadCourse: !!facts.capabilities?.hasLeadCourse,
  });
  const funnelStage = applicationFunnelStageOf({
    status: app.status,
    payment_status: app.payment_status,
    lead_stage: lead.leadStage,
    lead_pre_admission_no: lead.preAdmissionNo,
    lead_admission_no: lead.admissionNo,
    has_token_fee_paid: facts.hasTokenFeePaid,
    has_offer: facts.hasOffer,
  });

  return {
    app,
    lifecycle,
    lifecycleStages,
    funnelStage,
    nextAction: resolveApplicationDossierNextAction(lifecycle, lifecycleStages),
    blockers: resolveApplicationDossierBlockers(lifecycle, lifecycleStages),
    leadStage: lead.leadStage || "",
    leadCounsellorId: lead.counsellorId || "",
    counsellorName: lead.counsellorName || "",
    leadPreAdmissionNo: lead.preAdmissionNo || null,
    leadAdmissionNo: lead.admissionNo || null,
    hasOffer: facts.hasOffer,
    appFeePaid: facts.appFeePaid || 0,
    hasTokenFeePaid: facts.hasTokenFeePaid,
    docCounts: docs,
    panDue: facts.panDue ?? null,
    anDue: facts.anDue ?? null,
    year1Due: facts.year1Due ?? null,
    canIssueOffer: offerAction.canIssueOffer,
    offerBlockedReason: offerAction.reason,
  };
}

export function applyApplicationDossierToRow<T extends ApplicationDossierApp>(
  row: T,
  dossier: ApplicationDossier,
): T & {
  counsellor_name: string;
  lead_stage: string;
  lead_counsellor_id: string;
  lead_pre_admission_no: string | null;
  lead_admission_no: string | null;
  has_offer: boolean;
  app_fee_paid: number;
  has_token_fee_paid: boolean;
  doc_counts: DocCounts;
  pan_due: number | null;
  an_due: number | null;
  year1_due: number | null;
  can_issue_offer: boolean;
  offer_blocked_reason: string | null;
  dossier: ApplicationDossier;
} {
  return {
    ...row,
    counsellor_name: dossier.counsellorName,
    lead_stage: dossier.leadStage,
    lead_counsellor_id: dossier.leadCounsellorId,
    lead_pre_admission_no: dossier.leadPreAdmissionNo,
    lead_admission_no: dossier.leadAdmissionNo,
    has_offer: dossier.hasOffer,
    app_fee_paid: dossier.appFeePaid,
    has_token_fee_paid: dossier.hasTokenFeePaid,
    doc_counts: dossier.docCounts,
    pan_due: dossier.panDue,
    an_due: dossier.anDue,
    year1_due: dossier.year1Due,
    can_issue_offer: dossier.canIssueOffer,
    offer_blocked_reason: dossier.offerBlockedReason,
    dossier,
  };
}

export function resolveApplicationDossierOfferAction(args: {
  canManageOffer: boolean;
  hasOffer: boolean;
  hasLead: boolean;
  hasLeadCourse: boolean;
}): { canIssueOffer: boolean; reason: string | null } {
  if (args.hasOffer) return { canIssueOffer: true, reason: null };
  if (!args.canManageOffer) {
    return { canIssueOffer: false, reason: "You do not have permission to issue offers" };
  }
  if (!args.hasLead) {
    return { canIssueOffer: true, reason: null };
  }
  if (!args.hasLeadCourse) {
    return { canIssueOffer: false, reason: "No course/class is linked to this application yet" };
  }
  return { canIssueOffer: true, reason: null };
}

function resolveApplicationDossierNextAction(
  lifecycle: LifecycleInput,
  stages: Stage[],
): ApplicationDossierNextAction {
  if (lifecycle.app?.status === "approved" && !lifecycle.hasLead) return "create_lead";
  if (lifecycle.app?.payment_status !== "paid") return "collect_application_fee";
  if (lifecycle.app?.status === "draft") return "complete_application";
  if (lifecycle.docs.rejected > 0 && lifecycle.app?.status !== "approved") return "review_documents";
  if (lifecycle.app?.status === "submitted" || lifecycle.app?.status === "under_review") return "approve_application";
  if (lifecycle.app?.status === "approved" && !lifecycle.hasOffer) return "issue_offer";
  if (lifecycle.hasOffer && !lifecycle.lead?.pre_admission_no) return "collect_token_fee";
  if (lifecycle.lead?.pre_admission_no && !lifecycle.lead?.admission_no) return "collect_admission_fee";
  if (stages.length > 0 && stages.every((stage) => stage.state === "done")) return "admission_complete";
  return "complete_application";
}

function resolveApplicationDossierBlockers(lifecycle: LifecycleInput, stages: Stage[]) {
  const blockers: string[] = [];
  if (lifecycle.app?.status === "approved" && !lifecycle.hasLead) blockers.push("Approved application has no linked lead.");
  if (lifecycle.docs.rejected > 0 && lifecycle.app?.status !== "approved") blockers.push("One or more documents are rejected.");
  if (stages.some((stage) => stage.state === "blocked")) blockers.push("Lifecycle has a blocked stage.");
  return blockers;
}
