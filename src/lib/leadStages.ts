import type { Database } from "@/integrations/supabase/types";

export type LeadStage = Database["public"]["Enums"]["lead_stage"];

// Stages where outreach should stop. Used by PendingFollowups to suppress
// rows whose lead has already exited the funnel — chasing them surfaces in
// the daily list and wastes counsellor time.
//
// `cold` is included so counsellors aren't chased to call leads who already
// went silent across multiple attempts. It's softer than the others — the
// lead can still be re-engaged manually, but it should not block the daily
// follow-up queue.
export const TERMINAL_LEAD_STAGES: LeadStage[] = [
  "not_interested",
  "dnc",
  "rejected",
  "ineligible",
  "cold",
];

export const isTerminalLeadStage = (s: string | null | undefined): boolean =>
  !!s && (TERMINAL_LEAD_STAGES as string[]).includes(s);
