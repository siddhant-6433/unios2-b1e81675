import { STAGE_LABELS, shouldAutoAdvance } from "@/lib/leadStages";

export type LeadCallDisposition =
  | "interested"
  | "not_interested"
  | "ineligible"
  | "not_answered"
  | "wrong_number"
  | "call_back"
  | "do_not_contact"
  | "voicemail"
  | "busy";

const LEAD_CALL_DISPOSITIONS = [
  "interested",
  "not_interested",
  "ineligible",
  "not_answered",
  "wrong_number",
  "call_back",
  "do_not_contact",
  "voicemail",
  "busy",
] as const;

export const isLeadCallDisposition = (disposition: string): disposition is LeadCallDisposition =>
  (LEAD_CALL_DISPOSITIONS as readonly string[]).includes(disposition);

export type LeadTransitionCommandName =
  | "recordDispositionInterested"
  | "recordDispositionCallback"
  | "recordDispositionNotAnswered"
  | "recordDispositionNotInterested"
  | "recordDispositionDnc"
  | "recordDispositionIneligible"
  | "recordDispositionDeferred"
  | "recordDispositionNoStageChange"
  | "scheduleVisit"
  | "rescheduleVisit"
  | "issueOffer"
  | "markDnc"
  | "restoreFromDnc"
  | "classifyLead"
  | "classifyNotInterested"
  | "classifyIneligible"
  | "classifyInactive"
  | "submitApplication"
  | "approveApplication"
  | "recordInterviewPending"
  | "recordInterviewPassed"
  | "recordInterviewFailed"
  | "convertPreAdmitted"
  | "convertAdmitted"
  | "adminOverrideStage";

export interface LeadTransitionCommand {
  name: LeadTransitionCommandName;
  currentStage: string;
  newStage: string | null;
  activityDescription: string | null;
  futureEligibleSession: string | null;
}

export interface ResolveCallDispositionTransitionArgs {
  currentStage: string;
  disposition: LeadCallDisposition;
  futureEligibleSession?: string | null;
}

export type WorkflowLeadTransitionCommandName =
  | "scheduleVisit"
  | "rescheduleVisit"
  | "issueOffer"
  | "markDnc"
  | "restoreFromDnc"
  | "classifyLead"
  | "classifyNotInterested"
  | "classifyIneligible"
  | "classifyInactive"
  | "submitApplication"
  | "approveApplication"
  | "recordInterviewPending"
  | "recordInterviewPassed"
  | "recordInterviewFailed"
  | "convertPreAdmitted"
  | "convertAdmitted"
  | "adminOverrideStage";

export interface ResolveWorkflowLeadTransitionArgs {
  currentStage: string;
  command: WorkflowLeadTransitionCommandName;
  targetStage?: string | null;
}

const keepCurrentStage = (currentStage: string): LeadTransitionCommand => ({
  name: "recordDispositionNoStageChange",
  currentStage,
  newStage: null,
  activityDescription: null,
  futureEligibleSession: null,
});

export function resolveCallDispositionTransition(
  args: ResolveCallDispositionTransitionArgs,
): LeadTransitionCommand {
  const { currentStage, disposition, futureEligibleSession = null } = args;

  if (disposition === "interested" || disposition === "call_back" || disposition === "not_answered") {
    const name =
      disposition === "interested"
        ? "recordDispositionInterested"
        : disposition === "call_back"
          ? "recordDispositionCallback"
          : "recordDispositionNotAnswered";

    if (!shouldAutoAdvance(currentStage, "counsellor_call")) {
      return {
        ...keepCurrentStage(currentStage),
        name,
      };
    }

    return {
      name,
      currentStage,
      newStage: "counsellor_call",
      activityDescription: `Stage auto-advanced from ${STAGE_LABELS[currentStage] || currentStage} to ${STAGE_LABELS["counsellor_call"] || "counsellor_call"}`,
      futureEligibleSession: null,
    };
  }

  if (disposition === "not_interested") {
    return {
      name: "recordDispositionNotInterested",
      currentStage,
      newStage: "not_interested",
      activityDescription: "Stage changed to Not Interested",
      futureEligibleSession: null,
    };
  }

  if (disposition === "do_not_contact") {
    return {
      name: "recordDispositionDnc",
      currentStage,
      newStage: "dnc",
      activityDescription: "Stage changed to Do Not Contact",
      futureEligibleSession: null,
    };
  }

  if (disposition === "ineligible") {
    if (futureEligibleSession) {
      return {
        name: "recordDispositionDeferred",
        currentStage,
        newStage: "deferred",
        activityDescription: `Stage changed to Deferred (Next Session — eligible for ${futureEligibleSession})`,
        futureEligibleSession,
      };
    }

    return {
      name: "recordDispositionIneligible",
      currentStage,
      newStage: "ineligible",
      activityDescription: "Stage changed to Ineligible",
      futureEligibleSession: null,
    };
  }

  return keepCurrentStage(currentStage);
}

export function resolveLeadTransitionCommand(args: ResolveWorkflowLeadTransitionArgs): LeadTransitionCommand {
  const { currentStage, command } = args;

  if (command === "scheduleVisit" || command === "rescheduleVisit") {
    return {
      name: command,
      currentStage,
      newStage: "visit_scheduled",
      activityDescription: command === "scheduleVisit"
        ? `Stage changed to ${STAGE_LABELS["visit_scheduled"] || "visit_scheduled"}`
        : `Stage changed to ${STAGE_LABELS["visit_scheduled"] || "visit_scheduled"} after visit reschedule`,
      futureEligibleSession: null,
    };
  }

  if (command === "issueOffer") {
    return {
      name: command,
      currentStage,
      newStage: "offer_sent",
      activityDescription: `Stage changed to ${STAGE_LABELS["offer_sent"] || "offer_sent"}`,
      futureEligibleSession: null,
    };
  }

  if (command === "markDnc") {
    return {
      name: command,
      currentStage,
      newStage: "dnc",
      activityDescription: "Lead marked as Do Not Contact (DNC)",
      futureEligibleSession: null,
    };
  }

  if (command === "restoreFromDnc") {
    return {
      name: command,
      currentStage,
      newStage: "new_lead",
      activityDescription: "Lead removed from DNC list and moved back to New Lead",
      futureEligibleSession: null,
    };
  }

  if (command === "classifyLead") {
    return {
      name: command,
      currentStage,
      newStage: "new_lead",
      activityDescription: "Stage changed to New Lead",
      futureEligibleSession: null,
    };
  }

  if (command === "classifyIneligible") {
    return {
      name: command,
      currentStage,
      newStage: "ineligible",
      activityDescription: "Stage changed to Ineligible",
      futureEligibleSession: null,
    };
  }

  if (command === "classifyInactive") {
    return {
      name: command,
      currentStage,
      newStage: "inactive",
      activityDescription: "Stage changed to Inactive",
      futureEligibleSession: null,
    };
  }

  if (command === "submitApplication") {
    return {
      name: command,
      currentStage,
      newStage: "application_submitted",
      activityDescription: "Application submitted",
      futureEligibleSession: null,
    };
  }

  if (command === "approveApplication") {
    return {
      name: command,
      currentStage,
      newStage: "application_approved",
      activityDescription: "Application approved",
      futureEligibleSession: null,
    };
  }

  if (command === "recordInterviewPending" || command === "recordInterviewPassed" || command === "recordInterviewFailed") {
    const newStage = command === "recordInterviewPassed"
      ? "offer_sent"
      : command === "recordInterviewFailed"
        ? "rejected"
        : "interview";
    return {
      name: command,
      currentStage,
      newStage,
      activityDescription: `Interview result moved lead to ${STAGE_LABELS[newStage] || newStage}`,
      futureEligibleSession: null,
    };
  }

  if (command === "convertPreAdmitted" || command === "convertAdmitted") {
    const newStage = command === "convertPreAdmitted" ? "pre_admitted" : "admitted";
    return {
      name: command,
      currentStage,
      newStage,
      activityDescription: `Stage changed to ${STAGE_LABELS[newStage] || newStage}`,
      futureEligibleSession: null,
    };
  }

  if (command === "adminOverrideStage") {
    return {
      name: command,
      currentStage,
      newStage: args.targetStage || null,
      activityDescription: args.targetStage
        ? `Stage changed to ${STAGE_LABELS[args.targetStage] || args.targetStage}`
        : null,
      futureEligibleSession: null,
    };
  }

  return {
    name: command,
    currentStage,
    newStage: "not_interested",
    activityDescription: "Stage changed to Not Interested",
    futureEligibleSession: null,
  };
}

export function leadTransitionStagePatch(
  transition: LeadTransitionCommand,
  extraFields: Record<string, unknown> = {},
): Record<string, unknown> | null {
  if (!transition.newStage) return null;
  return {
    stage: transition.newStage,
    ...extraFields,
  };
}
