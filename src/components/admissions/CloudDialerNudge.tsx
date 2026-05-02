import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Phone, X, Zap, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Counsellor nudge: encourages adoption of the Cloud Dialer over manual calling.
 *
 * Visibility rules:
 *  - Only renders for users with role === "counsellor".
 *  - Dismissible — stored in localStorage with a monthly key, so it re-appears
 *    on the 1st of the next month (a gentle re-nag rather than ignoring forever).
 *  - Hidden if the counsellor has already made cloud-dialer calls in the last
 *    7 days (they're already using it; no need to nudge).
 */
export function CloudDialerNudge() {
  const { role, user, profile } = useAuth();
  const [hidden, setHidden] = useState(true); // start hidden until we've checked usage

  const dismissKey = (() => {
    const now = new Date();
    return `cloud_dialer_nudge_dismissed_${now.getFullYear()}_${now.getMonth() + 1}`;
  })();

  useEffect(() => {
    if (role !== "counsellor" || !user?.id) return;

    // Respect monthly dismissal.
    if (typeof window !== "undefined" && window.localStorage.getItem(dismissKey) === "1") {
      setHidden(true);
      return;
    }

    // Skip the nudge if they're already using cloud dialer recently.
    (async () => {
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
      const counsellorId = profile?.id;
      if (!counsellorId) { setHidden(false); return; }

      const { count } = await supabase
        .from("call_logs" as any)
        .select("id", { count: "exact", head: true })
        .eq("counsellor_id", counsellorId)
        .eq("source", "cloud_dialer")
        .gte("created_at", sevenDaysAgo);

      // Heads-up: the call_logs table / source column may not exist on every
      // deployment. If the query errors out, count is null — fall back to
      // showing the nudge (safer to over-nudge than miss it).
      setHidden((count ?? 0) > 0);
    })();
  }, [role, user?.id, profile?.id, dismissKey]);

  if (role !== "counsellor" || hidden) return null;

  const dismiss = () => {
    if (typeof window !== "undefined") window.localStorage.setItem(dismissKey, "1");
    setHidden(true);
  };

  return (
    <div className="rounded-xl border border-violet-200/60 bg-gradient-to-r from-violet-50 via-indigo-50 to-blue-50 dark:from-violet-950/30 dark:via-indigo-950/30 dark:to-blue-950/30 dark:border-violet-800/40 px-4 py-3">
      <div className="flex items-start gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-violet-100 dark:bg-violet-900/40 text-violet-600 dark:text-violet-300">
          <Phone className="h-4 w-4" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold text-foreground">Try the Cloud Dialer</span>
            <span className="inline-flex items-center gap-1 rounded-full bg-violet-100 dark:bg-violet-900/50 px-2 py-0.5 text-[10px] font-semibold text-violet-700 dark:text-violet-300">
              <Zap className="h-2.5 w-2.5" /> Faster calls
            </span>
          </div>
          <p className="text-[12.5px] text-muted-foreground mt-0.5 leading-relaxed">
            One-click calling, automatic call logs, AI-powered summaries, and built-in disposition
            tracking. Counsellors using the dialer make <span className="font-semibold text-foreground">2–3× more calls per hour</span> and never have to type a follow-up note.
          </p>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <Button asChild size="sm" className="h-8 gap-1.5 bg-violet-600 hover:bg-violet-700 text-white">
            <Link to="/cloud-dialer">
              Open Dialer <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </Button>
          <button
            onClick={dismiss}
            className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-background/60 transition-colors"
            title="Dismiss for this month"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}
