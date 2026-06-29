import type { LeadTransitionCommand, LeadTransitionCommandName } from "@/lib/leadTransitions";

export type LeadTransitionCommandExtraPatch = {
  admission_no?: string | null;
  category_locked?: boolean;
  future_eligible_session?: string | null;
  interview_result?: string | null;
  interview_score?: number | null;
  offer_amount?: number | null;
  person_role?: string | null;
  pre_admission_no?: string | null;
};

export type ApplyLeadTransitionCommandArgs = {
  leadId: string;
  command: LeadTransitionCommandName | "automationAdvanceStage";
  targetStage?: string | null;
  reason?: string | null;
  extraPatch?: LeadTransitionCommandExtraPatch;
};

type RpcResult = {
  old_stage: string;
  new_stage: string;
};

type LeadTransitionRpcClient = {
  rpc: (
    functionName: string,
    args: Record<string, unknown>,
  ) => PromiseLike<{ data: RpcResult[] | RpcResult | null; error: { message?: string } | null }>;
};

export async function applyLeadTransitionCommand(
  client: LeadTransitionRpcClient,
  args: ApplyLeadTransitionCommandArgs,
): Promise<RpcResult | null> {
  if (args.command === "recordDispositionNoStageChange") return null;

  if (
    (args.command === "adminOverrideStage" || args.command === "automationAdvanceStage") &&
    (!args.targetStage || !args.reason?.trim())
  ) {
    throw new Error(`${args.command} requires a target stage and reason`);
  }

  const { data, error } = await client.rpc("apply_lead_transition_command", {
    _lead_id: args.leadId,
    _command: args.command,
    _target_stage: args.targetStage ?? null,
    _reason: args.reason ?? null,
    _extra_patch: args.extraPatch ?? {},
  });

  if (error) throw new Error(error.message || "Lead transition failed");
  if (Array.isArray(data)) return data[0] ?? null;
  return data ?? null;
}

export async function applyResolvedLeadTransition(
  client: LeadTransitionRpcClient,
  args: {
    leadId: string;
    transition: LeadTransitionCommand;
    reason?: string | null;
    extraPatch?: LeadTransitionCommandExtraPatch;
  },
): Promise<RpcResult | null> {
  if (!args.transition.newStage) return null;

  return applyLeadTransitionCommand(client, {
    leadId: args.leadId,
    command: args.transition.name,
    targetStage: args.transition.name === "adminOverrideStage" ? args.transition.newStage : null,
    reason: args.reason ?? args.transition.activityDescription ?? null,
    extraPatch: {
      ...(args.transition.futureEligibleSession
        ? { future_eligible_session: args.transition.futureEligibleSession }
        : {}),
      ...(args.extraPatch ?? {}),
    },
  });
}
