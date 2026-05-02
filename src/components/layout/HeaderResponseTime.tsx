import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Timer, AlertTriangle } from "lucide-react";

function median(arr: number[]): number | null {
  if (arr.length === 0) return null;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function fmt(ms: number | null): string {
  if (ms === null) return "—";
  const totalMins = Math.round(ms / 60000);
  if (totalMins < 1) return "< 1m";
  const d = Math.floor(totalMins / (60 * 24));
  const h = Math.floor((totalMins % (60 * 24)) / 60);
  const m = totalMins % 60;
  const parts: string[] = [];
  if (d > 0) parts.push(`${d}d`);
  if (h > 0) parts.push(`${h}h`);
  if (m > 0 || parts.length === 0) parts.push(`${m}m`);
  return parts.join(" ");
}

// Fetch median time-to-first-call for manual calls placed in last 3 days.
// Pass counsellorId to scope to one counsellor; null = global (no lead_id filter).
async function fetchManualMedian(threeDaysAgo: string, counsellorId: string | null): Promise<number | null> {
  let callQuery = supabase
    .from("lead_activities")
    .select("lead_id, created_at")
    .eq("type", "call")
    .gte("created_at", threeDaysAgo)
    .order("created_at", { ascending: true });

  if (counsellorId) {
    const { data: myLeads } = await supabase.from("leads").select("id").eq("counsellor_id", counsellorId).limit(500);
    const ids = (myLeads ?? []).map((l: any) => l.id);
    if (ids.length === 0) return null;
    callQuery = callQuery.in("lead_id", ids.slice(0, 200)); // limit to avoid URL overflow
  }

  const { data: callActs } = await callQuery;
  if (!callActs || callActs.length === 0) return null;

  const firstCallMap: Record<string, number> = {};
  callActs.forEach((a: any) => {
    if (!firstCallMap[a.lead_id]) firstCallMap[a.lead_id] = new Date(a.created_at).getTime();
  });

  const leadIds = Object.keys(firstCallMap);

  // Batch fetch to avoid URL-too-long errors (Supabase GET has ~8KB URL limit)
  const createdMap: Record<string, number> = {};
  for (let i = 0; i < leadIds.length; i += 50) {
    const batch = leadIds.slice(i, i + 50);
    const { data: leadDates } = await supabase.from("leads").select("id, created_at").in("id", batch);
    (leadDates ?? []).forEach((l: any) => { createdMap[l.id] = new Date(l.created_at).getTime(); });
  }

  const delays = leadIds
    .map(id => firstCallMap[id] - (createdMap[id] ?? firstCallMap[id]))
    .filter(ms => ms >= 0);
  return median(delays);
}


interface Stats { ai: number | null; manual: number | null; }

const GLOBAL_ROLES = ["super_admin", "admission_head"];
const SHOWN_ROLES = ["super_admin", "admission_head", "counsellor"];

export function HeaderResponseTime() {
  const { profile, role } = useAuth();
  const [mine, setMine] = useState<Stats | null>(null);
  const [global, setGlobal] = useState<Stats | null>(null);

  useEffect(() => {
    if (!profile?.id || !role || !SHOWN_ROLES.includes(role)) return;
    const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
    const isGlobalRole = GLOBAL_ROLES.includes(role);
    const counsellorId = isGlobalRole ? null : profile.id;

    (async () => {
      const manual = await fetchManualMedian(threeDaysAgo, counsellorId);
      setMine({ ai: null, manual });

      // Counsellors also fetch global for comparison
      if (!isGlobalRole) {
        const gManual = await fetchManualMedian(threeDaysAgo, null);
        setGlobal({ ai: null, manual: gManual });
      }
    })();
  }, [profile?.id, role]);

  if (!mine || !role || !SHOWN_ROLES.includes(role)) return null;

  const isGlobalRole = GLOBAL_ROLES.includes(role);
  const FOURTEEN_HOURS = 14 * 60 * 60 * 1000;

  // Effective global manual time — for global roles it's their own (=global), for counsellors fetch separately
  const globalManual = isGlobalRole ? mine.manual : (global?.manual ?? null);
  const globalNudge = globalManual !== null && globalManual > FOURTEEN_HOURS;

  const manualSlow = !isGlobalRole && global !== null && global.manual !== null && mine.manual !== null && mine.manual > (global.manual ?? Infinity) * 1.2;
  const anySlow = manualSlow || (!isGlobalRole && globalNudge);
  const isAlert = anySlow || globalNudge;

  return (
    <Tooltip>
        <TooltipTrigger asChild>
          <div className={`hidden md:flex items-center gap-2 rounded-xl border px-3 py-1.5 text-xs cursor-default select-none transition-colors ${
            isAlert
              ? "border-red-400/60 bg-red-50 text-red-700 dark:bg-red-950/30 dark:text-red-400"
              : "border-border/60 bg-muted/40 text-muted-foreground"
          }`}>
            {isAlert
              ? <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-red-500" />
              : <Timer className="h-3.5 w-3.5 shrink-0" />
            }
            <span className="hidden lg:inline font-medium">Avg Time to First Call</span>
            <span className="text-border mx-0.5 hidden lg:inline">·</span>
            <span className={`font-medium ${isAlert ? "text-red-600" : "text-orange-500"}`}>{fmt(mine.manual)}</span>
          </div>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="text-xs max-w-[260px]">
          <p className="font-semibold mb-1">
            Avg Time to First Call · last 3 days
            {isGlobalRole ? " · all counsellors" : " · your leads"}
          </p>
          <div className="space-y-0.5">
            <p>
              <span className="text-orange-500">●</span> {isGlobalRole ? "Team" : "Your"} avg: <strong>{fmt(mine.manual)}</strong>
              {!isGlobalRole && global !== null && global.manual !== null && (
                <span className="text-muted-foreground ml-1">(team: {fmt(global.manual)})</span>
              )}
              {manualSlow && <span className="text-red-500 ml-1">↑ slower than team</span>}
            </p>
          </div>
          {globalNudge && (
            <div className="mt-2 rounded-md bg-red-50 border border-red-200 px-2.5 py-2 text-red-700">
              <p className="font-semibold mb-0.5">🚨 Team response time is too slow</p>
              <p className="leading-snug">Pick up new leads and call them immediately — every hour of delay reduces conversion. Aim for under 30 minutes.</p>
            </div>
          )}
          {!globalNudge && manualSlow && (
            <p className="mt-1.5 text-red-600 font-medium">You're slower than the team average. Call new leads faster.</p>
          )}
          {!isGlobalRole && !anySlow && !globalNudge && global !== null && (
            <p className="mt-1.5 text-emerald-600">On par with or faster than team average.</p>
          )}
        </TooltipContent>
      </Tooltip>
  );
}
