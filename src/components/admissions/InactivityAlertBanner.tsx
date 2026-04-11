import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { AlertTriangle, Clock, X, ChevronRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";

interface Props {
  /** Called with the set of inactive lead IDs so the parent can filter */
  onViewInactive?: (ids: Set<string>) => void;
  onViewOverdue?: () => void;
  campusId?: string;
}

export function InactivityAlertBanner({ onViewInactive, onViewOverdue, campusId }: Props) {
  const { role, user, profile } = useAuth();
  const [inactiveIds, setInactiveIds] = useState<Set<string>>(new Set());
  const [overdueCount, setOverdueCount] = useState(0);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    (async () => {
      // Fetch inactive leads — scope to counsellor's own leads for non-admin roles
      // counsellor_id FK references profiles.id, not auth.users.id
      let inactiveQuery = supabase.from("inactive_leads" as any).select("id, counsellor_id");
      if (campusId && campusId !== "all") inactiveQuery = inactiveQuery.eq("campus_id", campusId);
      const isCounsellorOnly = role === "counsellor" || role === "faculty" || role === "teacher";
      if (isCounsellorOnly && profile?.id) {
        inactiveQuery = inactiveQuery.eq("counsellor_id", profile.id);
      }
      const inactiveRes = await inactiveQuery;
      const ids = new Set<string>((inactiveRes.data || []).map((r: any) => r.id));
      setInactiveIds(ids);

      // Fetch overdue follow-ups — scope similarly
      let overdueQuery = supabase.from("overdue_followups" as any).select("id", { count: "exact", head: true });
      if (isCounsellorOnly && profile?.id) {
        overdueQuery = overdueQuery.eq("counsellor_id", profile.id);
      }
      const overdueRes = await overdueQuery;
      setOverdueCount(overdueRes.count || 0);
    })();
  }, [role, profile?.id, campusId]);

  const inactiveCount = inactiveIds.size;

  if (dismissed || (inactiveCount === 0 && overdueCount === 0)) return null;

  return (
    <div className="relative flex flex-wrap items-center gap-4 rounded-xl border border-amber-200 dark:border-amber-800/40 bg-amber-50 dark:bg-amber-950/20 px-4 py-3">
      <button onClick={() => setDismissed(true)} className="absolute top-2 right-2 text-amber-400 hover:text-amber-600">
        <X className="h-3.5 w-3.5" />
      </button>

      {inactiveCount > 0 && (
        <button
          onClick={() => onViewInactive?.(inactiveIds)}
          className="flex items-center gap-2 text-sm hover:underline"
        >
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-amber-100 dark:bg-amber-900/30">
            <Clock className="h-3.5 w-3.5 text-amber-600" />
          </div>
          <span className="font-medium text-amber-800 dark:text-amber-300">
            {inactiveCount} inactive lead{inactiveCount !== 1 ? "s" : ""}
          </span>
          <Badge className="bg-amber-200 text-amber-800 dark:bg-amber-900/50 dark:text-amber-300 border-0 text-[10px]">
            past threshold
          </Badge>
          <ChevronRight className="h-3.5 w-3.5 text-amber-500" />
        </button>
      )}

      {overdueCount > 0 && (
        <button
          onClick={onViewOverdue}
          className="flex items-center gap-2 text-sm hover:underline"
        >
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-red-100 dark:bg-red-900/30">
            <AlertTriangle className="h-3.5 w-3.5 text-red-600" />
          </div>
          <span className="font-medium text-red-700 dark:text-red-400">
            {overdueCount} overdue follow-up{overdueCount !== 1 ? "s" : ""}
          </span>
          <ChevronRight className="h-3.5 w-3.5 text-red-500" />
        </button>
      )}
    </div>
  );
}
