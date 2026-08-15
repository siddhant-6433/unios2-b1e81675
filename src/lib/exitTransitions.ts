// Moving an exit through its states, in one place.
//
// The same four actions are now offered from two screens — the lifecycle queue and
// the employee's own profile — and they must not drift. What each state allows, the
// wording, and the approval stamp all live here.

import { supabase } from "@/integrations/supabase/client";

export type ExitAction = "in_progress" | "rejected" | "completed" | "reverted";

export interface ActionSpec {
  status: ExitAction;
  label: string;
  /** Destructive-looking actions get the quiet treatment, not the loud one. */
  variant: "default" | "outline" | "ghost";
  confirm?: string;
}

const REVERT: ActionSpec = {
  status: "reverted",
  label: "Revert",
  variant: "ghost",
  confirm: "Revert this exit?\n\nThe employee returns to active, and their access and login are restored.",
};

/** What can be done to an exit in a given state, in the order it should be offered. */
export function actionsFor(status: string): ActionSpec[] {
  switch (status) {
    case "under_review":
      return [
        { status: "rejected", label: "Reject", variant: "ghost" },
        { status: "in_progress", label: "Approve", variant: "default" },
      ];
    case "in_progress":
      return [REVERT, { status: "completed", label: "Complete exit", variant: "default" }];
    case "completed":
      return [REVERT];
    // Rejected and reverted are terminal; reopening means raising a new exit.
    default:
      return [];
  }
}

export interface TransitionResult {
  ok: boolean;
  title: string;
  description?: string;
  error?: string;
}

export function messageFor(status: ExitAction): { title: string; description?: string } {
  switch (status) {
    case "in_progress":
      return { title: "Exit approved — notice period started" };
    case "completed":
      return {
        title: "Exit completed",
        description: "Payroll excludes them from the last working day, and their login is revoked.",
      };
    case "reverted":
      return { title: "Exit reverted — access restored" };
    case "rejected":
      return { title: "Exit rejected" };
  }
}

/**
 * Apply a transition. Selects back deliberately: an RLS-filtered update "succeeds"
 * with zero rows and no error, which would otherwise report success having changed
 * nothing.
 */
export async function applyExitTransition(id: string, status: ExitAction): Promise<TransitionResult> {
  const patch: Record<string, unknown> = { status };
  if (status === "in_progress") {
    patch.approved_at = new Date().toISOString();
    patch.approved_by = (await supabase.auth.getUser()).data.user?.id ?? null;
  }

  const { data, error } = await supabase
    .from("employee_exits").update(patch as never).eq("id", id).select("id");

  if (error || !data?.length) {
    return {
      ok: false,
      title: "Could not update the exit",
      error: error?.message ?? "No permission to change this exit.",
    };
  }
  return { ok: true, ...messageFor(status) };
}

export const EXIT_STATUS_LABEL: Record<string, string> = {
  under_review: "Under review",
  in_progress: "Serving notice",
  completed: "Exited",
  reverted: "Reverted",
  rejected: "Rejected",
};

export const EXIT_TYPE_LABEL: Record<string, string> = {
  resignation: "Resignation",
  termination: "Termination",
  retirement: "Retirement",
  end_of_contract: "End of contract",
  absconded: "Absconded",
};
