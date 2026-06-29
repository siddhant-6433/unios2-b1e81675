import { describe, expect, it } from "vitest";
import {
  leadTransitionStagePatch,
  resolveCallDispositionTransition,
  resolveLeadTransitionCommand,
} from "./leadTransitions";

describe("resolveCallDispositionTransition", () => {
  it("advances early contact dispositions to counsellor_call", () => {
    expect(resolveCallDispositionTransition({
      currentStage: "new_lead",
      disposition: "interested",
    })).toEqual({
      name: "recordDispositionInterested",
      currentStage: "new_lead",
      newStage: "counsellor_call",
      activityDescription: "Stage auto-advanced from New Lead to In Follow Up",
      futureEligibleSession: null,
    });
  });

  it("keeps the current stage when a contact disposition would move backwards", () => {
    expect(resolveCallDispositionTransition({
      currentStage: "visit_scheduled",
      disposition: "call_back",
    })).toEqual({
      name: "recordDispositionCallback",
      currentStage: "visit_scheduled",
      newStage: null,
      activityDescription: null,
      futureEligibleSession: null,
    });
  });

  it("marks terminal negative dispositions with named commands", () => {
    expect(resolveCallDispositionTransition({
      currentStage: "counsellor_call",
      disposition: "not_interested",
    }).name).toBe("recordDispositionNotInterested");

    expect(resolveCallDispositionTransition({
      currentStage: "counsellor_call",
      disposition: "do_not_contact",
    })).toMatchObject({
      name: "recordDispositionDnc",
      newStage: "dnc",
      activityDescription: "Stage changed to Do Not Contact",
    });
  });

  it("splits permanent ineligible from future-session deferral", () => {
    expect(resolveCallDispositionTransition({
      currentStage: "counsellor_call",
      disposition: "ineligible",
    })).toMatchObject({
      name: "recordDispositionIneligible",
      newStage: "ineligible",
      futureEligibleSession: null,
    });

    expect(resolveCallDispositionTransition({
      currentStage: "counsellor_call",
      disposition: "ineligible",
      futureEligibleSession: "2027-28",
    })).toEqual({
      name: "recordDispositionDeferred",
      currentStage: "counsellor_call",
      newStage: "deferred",
      activityDescription: "Stage changed to Deferred (Next Session — eligible for 2027-28)",
      futureEligibleSession: "2027-28",
    });
  });

  it("does not change stage for neutral phone outcomes", () => {
    for (const disposition of ["busy", "voicemail", "wrong_number"] as const) {
      expect(resolveCallDispositionTransition({
        currentStage: "new_lead",
        disposition,
      })).toMatchObject({
        name: "recordDispositionNoStageChange",
        newStage: null,
      });
    }
  });
});

describe("resolveLeadTransitionCommand", () => {
  it("resolves visit, offer, DNC, restore, and not-interested workflow commands", () => {
    expect(resolveLeadTransitionCommand({
      currentStage: "counsellor_call",
      command: "scheduleVisit",
    })).toMatchObject({
      name: "scheduleVisit",
      newStage: "visit_scheduled",
    });

    expect(resolveLeadTransitionCommand({
      currentStage: "visit_scheduled",
      command: "issueOffer",
    })).toMatchObject({
      name: "issueOffer",
      newStage: "offer_sent",
    });

    expect(resolveLeadTransitionCommand({
      currentStage: "counsellor_call",
      command: "markDnc",
    })).toMatchObject({
      name: "markDnc",
      newStage: "dnc",
      activityDescription: "Lead marked as Do Not Contact (DNC)",
    });

    expect(resolveLeadTransitionCommand({
      currentStage: "dnc",
      command: "restoreFromDnc",
    })).toMatchObject({
      name: "restoreFromDnc",
      newStage: "new_lead",
    });

    expect(resolveLeadTransitionCommand({
      currentStage: "counsellor_call",
      command: "classifyNotInterested",
    })).toMatchObject({
      name: "classifyNotInterested",
      newStage: "not_interested",
    });

    expect(resolveLeadTransitionCommand({
      currentStage: "not_interested",
      command: "classifyLead",
    })).toMatchObject({
      name: "classifyLead",
      newStage: "new_lead",
    });

    expect(resolveLeadTransitionCommand({
      currentStage: "counsellor_call",
      command: "classifyIneligible",
    })).toMatchObject({
      name: "classifyIneligible",
      newStage: "ineligible",
    });
  });

  it("builds a stage patch only from a resolved transition", () => {
    const transition = resolveLeadTransitionCommand({
      currentStage: "counsellor_call",
      command: "issueOffer",
    });

    expect(leadTransitionStagePatch(transition, { offer_amount: 50000 })).toEqual({
      stage: "offer_sent",
      offer_amount: 50000,
    });

    expect(leadTransitionStagePatch(resolveCallDispositionTransition({
      currentStage: "visit_scheduled",
      disposition: "busy",
    }))).toBeNull();
  });

  it("resolves explicit workflow commands for inactive, application, interview, conversion, and admin override paths", () => {
    expect(resolveLeadTransitionCommand({
      currentStage: "counsellor_call",
      command: "classifyInactive",
    }).newStage).toBe("inactive");

    expect(resolveLeadTransitionCommand({
      currentStage: "application_fee_paid",
      command: "submitApplication",
    }).newStage).toBe("application_submitted");

    expect(resolveLeadTransitionCommand({
      currentStage: "application_submitted",
      command: "approveApplication",
    }).newStage).toBe("application_approved");

    expect(resolveLeadTransitionCommand({
      currentStage: "interview",
      command: "recordInterviewPassed",
    }).newStage).toBe("offer_sent");

    expect(resolveLeadTransitionCommand({
      currentStage: "interview",
      command: "recordInterviewFailed",
    }).newStage).toBe("rejected");

    expect(resolveLeadTransitionCommand({
      currentStage: "token_paid",
      command: "convertPreAdmitted",
    }).newStage).toBe("pre_admitted");

    expect(resolveLeadTransitionCommand({
      currentStage: "pre_admitted",
      command: "convertAdmitted",
    }).newStage).toBe("admitted");

    expect(resolveLeadTransitionCommand({
      currentStage: "new_lead",
      command: "adminOverrideStage",
      targetStage: "waitlisted",
    })).toMatchObject({
      name: "adminOverrideStage",
      newStage: "waitlisted",
    });
  });
});
