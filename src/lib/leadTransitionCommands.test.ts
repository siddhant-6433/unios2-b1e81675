import { describe, expect, it, vi } from "vitest";
import {
  applyLeadTransitionCommand,
  applyResolvedLeadTransition,
} from "@/lib/leadTransitionCommands";
import type { LeadTransitionCommand } from "@/lib/leadTransitions";

describe("leadTransitionCommands", () => {
  it("calls the server command RPC with explicit command inputs", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [{ old_stage: "application_approved", new_stage: "offer_sent" }],
      error: null,
    });

    const result = await applyLeadTransitionCommand({ rpc }, {
      leadId: "lead-1",
      command: "issueOffer",
      extraPatch: { offer_amount: 50000 },
    });

    expect(result).toEqual({ old_stage: "application_approved", new_stage: "offer_sent" });
    expect(rpc).toHaveBeenCalledWith("apply_lead_transition_command", {
      _lead_id: "lead-1",
      _command: "issueOffer",
      _target_stage: null,
      _reason: null,
      _extra_patch: { offer_amount: 50000 },
    });
  });

  it("rejects generic override commands without a reason", async () => {
    const rpc = vi.fn();

    await expect(applyLeadTransitionCommand({ rpc }, {
      leadId: "lead-1",
      command: "adminOverrideStage",
      targetStage: "cold",
    })).rejects.toThrow("requires a target stage and reason");

    expect(rpc).not.toHaveBeenCalled();
  });

  it("skips no-op resolved transitions", async () => {
    const rpc = vi.fn();
    const transition: LeadTransitionCommand = {
      name: "recordDispositionNoStageChange",
      currentStage: "visit_scheduled",
      newStage: null,
      activityDescription: null,
      futureEligibleSession: null,
    };

    await expect(applyResolvedLeadTransition({ rpc }, {
      leadId: "lead-1",
      transition,
    })).resolves.toBeNull();

    expect(rpc).not.toHaveBeenCalled();
  });
});
