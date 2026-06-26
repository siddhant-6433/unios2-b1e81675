export type ServerLeadTransitionCommand =
  | "markDnc"
  | "restoreFromDnc"
  | "classifyLead"
  | "classifyNotInterested"
  | "classifyIneligible"
  | "automationAdvanceStage";

export interface ApplyLeadTransitionArgs {
  leadId: string;
  currentStage?: string | null;
  command: ServerLeadTransitionCommand;
  targetStage?: string | null;
  activityType?: string;
  description?: string;
  userId?: string | null;
  extraPatch?: Record<string, unknown>;
}

interface SupabaseLike {
  from: (table: string) => any;
}

export function resolveServerLeadTransition(args: ApplyLeadTransitionArgs): string | null {
  if (args.command === "markDnc") return "dnc";
  if (args.command === "restoreFromDnc") return "new_lead";
  if (args.command === "classifyLead") return "new_lead";
  if (args.command === "classifyNotInterested") return "not_interested";
  if (args.command === "classifyIneligible") return "ineligible";
  if (args.command === "automationAdvanceStage") return args.targetStage || null;
  return null;
}

export async function applyLeadTransition(
  admin: SupabaseLike,
  args: ApplyLeadTransitionArgs,
): Promise<{ newStage: string | null; oldStage: string | null }> {
  const newStage = resolveServerLeadTransition(args);
  if (!newStage) return { newStage: null, oldStage: args.currentStage ?? null };

  let oldStage = args.currentStage ?? null;
  if (oldStage === undefined || oldStage === null) {
    const { data: lead } = await admin.from("leads").select("stage").eq("id", args.leadId).maybeSingle();
    oldStage = lead?.stage ?? null;
  }

  await admin.from("leads").update({
    stage: newStage,
    ...(args.extraPatch || {}),
  }).eq("id", args.leadId);

  await admin.from("lead_activities").insert({
    lead_id: args.leadId,
    user_id: args.userId ?? null,
    type: args.activityType || "stage_change",
    description: args.description || `Stage changed to ${newStage}`,
    old_stage: oldStage,
    new_stage: newStage,
  });

  return { newStage, oldStage };
}
