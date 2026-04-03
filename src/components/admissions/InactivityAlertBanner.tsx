import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { AlertTriangle, Clock, X, ChevronRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";

interface Props {
  onViewInactive?: () => void;
  onViewOverdue?: () => void;
}

export function InactivityAlertBanner({ onViewInactive, onViewOverdue }: Props) {
  const [inactiveCount, setInactiveCount] = useState(0);
  const [overdueCount, setOverdueCount] = useState(0);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    (async () => {
      const [inactiveRes, overdueRes] = await Promise.all([
        supabase.from("inactive_leads" as any).select("id", { count: "exact", head: true }),
        supabase.from("overdue_followups" as any).select("id", { count: "exact", head: true }),
      ]);
      setInactiveCount(inactiveRes.count || 0);
      setOverdueCount(overdueRes.count || 0);
    })();
  }, []);

  if (dismissed || (inactiveCount === 0 && overdueCount === 0)) return null;

  return (
    <div className="relative flex flex-wrap items-center gap-4 rounded-xl border border-amber-200 dark:border-amber-800/40 bg-amber-50 dark:bg-amber-950/20 px-4 py-3">
      <button onClick={() => setDismissed(true)} className="absolute top-2 right-2 text-amber-400 hover:text-amber-600">
        <X className="h-3.5 w-3.5" />
      </button>

      {inactiveCount > 0 && (
        <button
          onClick={onViewInactive}
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
