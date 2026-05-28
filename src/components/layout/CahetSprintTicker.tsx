import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { ArrowRight, Flame, X } from "lucide-react";

interface SprintStats {
  own_count: number;
  own_today: number;
  team_count: number;
  team_today: number;
  pool_total: number;
  pool_remaining: number;
  deadline_at: string;
}

const TARGET_PER_COUNSELLOR = 15;
const DEADLINE_FALLBACK = "2026-06-05T23:59:59+05:30";
const DISMISS_KEY = "cahet_ticker_dismissed_session";

// Only ticker for users who can act on this — counsellors and admission staff.
const TICKER_ROLES = new Set([
  "counsellor",
  "admission_head",
  "campus_admin",
  "super_admin",
]);

function daysRemaining(deadlineIso: string): number {
  const ms = new Date(deadlineIso).getTime() - Date.now();
  if (ms <= 0) return 0;
  return Math.ceil(ms / 86_400_000);
}

export function CahetSprintTicker() {
  const { profile, role } = useAuth();
  const location = useLocation();
  const [stats, setStats] = useState<SprintStats | null>(null);
  const [dismissed, setDismissed] = useState<boolean>(() => {
    try { return sessionStorage.getItem(DISMISS_KEY) === "1"; } catch { return false; }
  });

  const eligible = role && TICKER_ROLES.has(role as string);
  const isCounsellor = role === "counsellor";
  const profileId = profile?.id || null;

  // Don't show on the sprint page itself — the page already has its own header card.
  const onSprintPage = location.pathname === "/cahet-sprint";

  useEffect(() => {
    if (!eligible || dismissed || onSprintPage) return;
    let cancelled = false;
    async function load() {
      const { data, error } = await supabase.rpc("cahet_sprint_stats", { p_counsellor_id: profileId });
      if (cancelled || error || !data) return;
      const s = Array.isArray(data) ? data[0] : data;
      setStats(s as SprintStats);
    }
    load();
    // Refresh every 2 minutes so registrations from another tab show up.
    const interval = window.setInterval(load, 120_000);
    return () => { cancelled = true; window.clearInterval(interval); };
  }, [eligible, dismissed, onSprintPage, profileId]);

  if (!eligible || dismissed || onSprintPage) return null;
  if (!stats) return null;

  const days = daysRemaining(stats.deadline_at || DEADLINE_FALLBACK);
  if (days === 0) return null;

  const ownProgress = Math.min(100, Math.round((stats.own_count / TARGET_PER_COUNSELLOR) * 100));
  const urgent = days <= 3;

  const dismiss = () => {
    try { sessionStorage.setItem(DISMISS_KEY, "1"); } catch {}
    setDismissed(true);
  };

  return (
    <div
      className={`flex items-center gap-3 px-4 py-1.5 text-xs border-b ${
        urgent
          ? "bg-rose-600 text-white border-rose-700"
          : "bg-rose-50 text-rose-900 border-rose-200"
      }`}
    >
      <Flame className={`h-3.5 w-3.5 flex-shrink-0 ${urgent ? "animate-pulse" : ""}`} />
      <span className="font-semibold whitespace-nowrap">
        CAHET ends in {days} {days === 1 ? "day" : "days"}
      </span>
      {isCounsellor ? (
        <>
          <span className="opacity-80">·</span>
          <span className="whitespace-nowrap">
            You: <strong className="tabular-nums">{stats.own_count}/{TARGET_PER_COUNSELLOR}</strong>
            {stats.own_today > 0 && (
              <span className={urgent ? "ml-1 opacity-80" : "ml-1 text-rose-600"}>(+{stats.own_today} today)</span>
            )}
          </span>
          <div className={`h-1.5 w-24 rounded overflow-hidden ${urgent ? "bg-rose-800/40" : "bg-rose-200"}`}>
            <div
              className={urgent ? "h-full bg-white" : "h-full bg-rose-600"}
              style={{ width: `${ownProgress}%` }}
            />
          </div>
          <span className="opacity-80">·</span>
          <span className="whitespace-nowrap">
            Team <strong className="tabular-nums">{stats.team_count}</strong>
          </span>
        </>
      ) : (
        <>
          <span className="opacity-80">·</span>
          <span className="whitespace-nowrap">
            Team <strong className="tabular-nums">{stats.team_count}</strong>
            {stats.team_today > 0 && (
              <span className={urgent ? "ml-1 opacity-80" : "ml-1 text-rose-600"}>(+{stats.team_today} today)</span>
            )}
          </span>
          <span className="opacity-80">·</span>
          <span className="whitespace-nowrap">
            Pool left <strong className="tabular-nums">{stats.pool_remaining}</strong>
          </span>
        </>
      )}
      <Link
        to="/cahet-sprint"
        className={`ml-auto inline-flex items-center gap-1 font-medium hover:underline ${urgent ? "" : "text-rose-700"}`}
      >
        Open Sprint <ArrowRight className="h-3 w-3" />
      </Link>
      <button
        type="button"
        aria-label="Dismiss"
        onClick={dismiss}
        className={`opacity-60 hover:opacity-100 transition-opacity ${urgent ? "text-white" : "text-rose-900"}`}
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
