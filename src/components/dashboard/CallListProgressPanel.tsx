import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Badge } from "@/components/ui/badge";
import { ListChecks, ChevronRight, AlertTriangle } from "lucide-react";

/**
 * Assigner-facing view of the call lists that have been handed to counsellors.
 * The whole point is that a principal / admission head / super admin can see
 * "is it being called, and what came back" without opening Marketing Hub →
 * Lists → Calling Report for each list in turn.
 *
 * One aggregated RPC — a client-side rollup over lead_list_members would hit
 * the 1000-row response cap on any list worth assigning.
 */

export interface CallListOverviewRow {
  id: string;
  name: string;
  priority_note: string | null;
  due_date: string | null;
  assigned_at: string;
  total: number;
  pending: number;
  worked: number;
  skipped: number;
  last_call_at: string | null;
  dispositions: Record<string, number>;
  by_counsellor: {
    counsellor_id: string;
    counsellor_name: string;
    total: number;
    worked: number;
    pending: number;
  }[];
  overdue: boolean;
}

export function useCallListOverview(opts?: { enabled?: boolean; includeDone?: boolean }) {
  const { user } = useAuth();
  const enabled = opts?.enabled ?? true;
  return useQuery<CallListOverviewRow[]>({
    queryKey: ["call-list-overview", user?.id ?? null, opts?.includeDone ?? false],
    enabled: enabled && !!user?.id,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("call_list_overview" as any, {
        p_include_done: opts?.includeDone ?? false,
      });
      if (error) throw error;
      return (Array.isArray(data) ? data : []) as CallListOverviewRow[];
    },
  });
}

// Outcome colours match the dialer's disposition buttons so the same word means
// the same thing on both sides of the hand-off.
const DISPOSITION_STYLE: Record<string, string> = {
  interested: "bg-success/10 text-success border-success/30",
  call_back: "bg-info/10 text-info-foreground border-info/30",
  not_answered: "bg-warning/10 text-warning-foreground border-warning/30",
  busy: "bg-warning/10 text-warning-foreground border-warning/30",
  voicemail: "bg-warning/10 text-warning-foreground border-warning/30",
  not_interested: "bg-destructive/10 text-destructive border-destructive/30",
  ineligible: "bg-primary/10 text-primary border-primary/25",
  wrong_number: "bg-muted text-muted-foreground border-border",
  do_not_contact: "bg-destructive/10 text-destructive border-destructive/30",
  unrecorded: "bg-muted text-muted-foreground border-border",
};

const label = (d: string) => d.replace(/_/g, " ");

const relativeTime = (iso: string | null) => {
  if (!iso) return "no calls yet";
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
};

export function CallListProgressPanel() {
  const { role } = useAuth();
  const canSee = ["super_admin", "principal", "admission_head", "campus_admin"].includes(role || "");
  // Team leaders also get rows back from the RPC (scoped to their own members),
  // so let the query run and let an empty result hide the panel.
  const { data: lists = [], isLoading } = useCallListOverview({ enabled: role !== "counsellor" });

  if (isLoading || lists.length === 0) return null;

  return (
    <div className="rounded-xl border border-border bg-card">
      <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
        <div className="flex items-center gap-2">
          <ListChecks className="h-4 w-4 text-primary" />
          <span className="text-sm font-semibold text-foreground">Assigned call lists</span>
          <Badge variant="outline" className="text-[10px]">{lists.length} active</Badge>
        </div>
        {canSee && (
          <Link to="/lists" className="flex items-center gap-1 text-xs text-primary hover:underline">
            Manage lists <ChevronRight className="h-3 w-3" />
          </Link>
        )}
      </div>

      <div className="divide-y divide-border">
        {lists.map((list) => {
          const pct = list.total ? Math.round((list.worked / list.total) * 100) : 0;
          const outcomes = Object.entries(list.dispositions).sort((a, b) => b[1] - a[1]);
          return (
            <div key={list.id} className="px-4 py-3 space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                {/* Opens straight into that list's Calling Report — per-lead
                    outcomes, not just the rollup. */}
                <Link to={`/lists?report=${list.id}`} className="text-sm font-medium text-foreground hover:text-primary">
                  {list.name}
                </Link>
                {list.overdue && (
                  <Badge className="gap-1 border-0 bg-destructive/10 text-[10px] text-destructive">
                    <AlertTriangle className="h-2.5 w-2.5" />
                    past due {list.due_date}
                  </Badge>
                )}
                {!list.overdue && list.due_date && (
                  <span className="text-[11px] text-muted-foreground">due {list.due_date}</span>
                )}
                <span className="ml-auto text-[11px] text-muted-foreground">
                  last call {relativeTime(list.last_call_at)}
                </span>
              </div>

              <div className="flex items-center gap-3">
                <div className="h-1.5 w-40 overflow-hidden rounded-full bg-muted">
                  <div className="h-full bg-primary transition-all" style={{ width: `${pct}%` }} />
                </div>
                <span className="text-xs tabular-nums text-foreground">{list.worked}/{list.total} called</span>
                <span className="text-[11px] text-muted-foreground">
                  {list.pending} pending{list.skipped > 0 && ` · ${list.skipped} skipped`}
                </span>
              </div>

              {/* The actual "call updates" — what came back, not just how many. */}
              {outcomes.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {outcomes.map(([disposition, n]) => (
                    <span
                      key={disposition}
                      className={`rounded-full border px-2 py-0.5 text-[10px] font-medium capitalize ${
                        DISPOSITION_STYLE[disposition] || DISPOSITION_STYLE.unrecorded
                      }`}
                    >
                      {label(disposition)} {n}
                    </span>
                  ))}
                </div>
              )}

              {list.by_counsellor.length > 0 && (
                <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                  {list.by_counsellor.map((c) => (
                    <span key={c.counsellor_id} className={c.pending === 0 ? "text-success" : undefined}>
                      {c.counsellor_name} {c.worked}/{c.total}
                    </span>
                  ))}
                </div>
              )}

              {list.priority_note && (
                <p className="text-[11px] italic text-muted-foreground">“{list.priority_note}”</p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
