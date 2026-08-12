import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { OrbLoader } from "@/components/ui/thinking-orb";
import { Clock, Play, CheckCircle2, AlertTriangle, ListChecks, PauseCircle, Activity } from "lucide-react";

interface QueueStatus {
  pending: number;
  pending_due: number;
  processing: number;
  completed_1h: number;
  completed_today: number;
  failed_today: number;
  skipped_today: number;
  last_completed_at: string | null;
  next_scheduled_at: string | null;
  in_business_hours: boolean;
  ist_now: string;
  by_source: { source: string; pending: number }[];
}

const SOURCE_LABELS: Record<string, string> = {
  collegehai: "CollegeHai",
  collegedunia: "CollegeDunia",
  justdial: "JustDial",
  salahlo: "Salahlo",
  website: "Website",
  whatsapp: "WhatsApp",
  walk_in: "Walk-in",
  mirai_website: "Mirai Website",
  meta_ads: "Meta Ads",
  google_ads: "Google Ads",
  enquiry: "Enquiry",
  consultant: "Consultant",
  reference: "Reference",
  unknown: "Unknown",
};

function fmtRelative(iso: string | null): string {
  if (!iso) return "—";
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 0) {
    const future = -ms;
    if (future < 60_000) return "in <1 min";
    if (future < 3600_000) return `in ${Math.round(future / 60_000)} min`;
    if (future < 86400_000) return `in ${Math.round(future / 3600_000)} hr`;
    return `on ${new Date(iso).toLocaleDateString("en-IN", { day: "2-digit", month: "short" })}`;
  }
  if (ms < 60_000) return `${Math.round(ms / 1000)}s ago`;
  if (ms < 3600_000) return `${Math.round(ms / 60_000)} min ago`;
  if (ms < 86400_000) return `${Math.round(ms / 3600_000)} hr ago`;
  return new Date(iso).toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
}

/** Estimate drain time at the cron's processing rate (2 calls / minute). */
function fmtDrain(pending: number, inBusinessHours: boolean): string {
  if (!pending) return "—";
  const minutes = pending / 2;
  if (!inBusinessHours) return `~${Math.round(minutes / 60 * 10) / 10}h of business hours`;
  if (minutes < 60) return `~${Math.round(minutes)} min`;
  return `~${Math.round(minutes / 60 * 10) / 10}h`;
}

export function AiCallQueueStatus() {
  const [status, setStatus] = useState<QueueStatus | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchStatus = async () => {
    const { data } = await (supabase as any).rpc("fn_ai_call_queue_status");
    if (data) setStatus(data as QueueStatus);
    setLoading(false);
  };

  useEffect(() => {
    fetchStatus();
    // Refresh every 20s — cron fires every minute, so this catches state changes within ~1 tick.
    const id = setInterval(fetchStatus, 20_000);
    return () => clearInterval(id);
  }, []);

  if (loading || !status) {
    return (
      <Card className="border-border/60 shadow-none">
        <CardContent className="p-6 flex items-center justify-center">
          <OrbLoader state="connecting" />
        </CardContent>
      </Card>
    );
  }

  const heroBg = status.in_business_hours
    ? "bg-success/5 border-success/20"
    : "bg-muted/40 border-border";
  const heroIcon = status.in_business_hours
    ? <Activity className="h-4 w-4 text-success animate-pulse" />
    : <PauseCircle className="h-4 w-4 text-muted-foreground" />;
  const heroText = status.in_business_hours
    ? "Cron is firing — 2 calls / min, FIFO by scheduled time"
    : "Outside business hours (9 AM – 8 PM IST, Mon-Sat) — queue will resume next business window";

  return (
    <div className="space-y-3">
      {/* Hero status strip */}
      <div className={`rounded-xl border ${heroBg} px-4 py-3 flex items-center gap-3 flex-wrap`}>
        {heroIcon}
        <span className={`text-sm font-medium ${status.in_business_hours ? "text-success-foreground" : "text-foreground"}`}>{heroText}</span>
        <span className="text-xs text-muted-foreground ml-auto">
          IST: {new Date(status.ist_now).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true })}
        </span>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <StatCard
          label="In Queue"
          value={status.pending}
          sub={status.pending_due > 0 ? `${status.pending_due.toLocaleString("en-IN")} due now` : "all scheduled later"}
          Icon={ListChecks} iconBg="bg-info/10" iconColor="text-info-foreground"
        />
        <StatCard
          label="Processing"
          value={status.processing}
          sub={status.processing > 0 ? "in flight" : "idle"}
          Icon={Play} iconBg="bg-warning/10" iconColor="text-warning-foreground"
        />
        <StatCard
          label="Fired in Last 60 min"
          value={status.completed_1h}
          sub={`${status.completed_today.toLocaleString("en-IN")} today`}
          Icon={Clock} iconBg="bg-primary/10" iconColor="text-primary"
        />
        <StatCard
          label="Failed Today"
          value={status.failed_today}
          sub={status.skipped_today > 0 ? `${status.skipped_today.toLocaleString("en-IN")} skipped` : "—"}
          Icon={AlertTriangle} iconBg="bg-destructive/10" iconColor="text-destructive"
        />
        <StatCard
          label="Last Completed"
          rawValue={fmtRelative(status.last_completed_at)}
          sub={status.in_business_hours
            ? `Drain ETA: ${fmtDrain(status.pending_due, true)}`
            : "Cron paused — resumes 9 AM IST"}
          Icon={CheckCircle2}
          iconBg={status.in_business_hours ? "bg-success/10" : "bg-muted"}
          iconColor={status.in_business_hours ? "text-success" : "text-muted-foreground"}
          muted={!status.in_business_hours}
        />
      </div>

      {/* Per-source pending breakdown */}
      {status.by_source.length > 0 && (
        <Card className="border-border/60 shadow-none">
          <CardContent className="p-4">
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-3">Pending by Source</p>
            <div className="flex flex-wrap gap-2">
              {status.by_source.map(b => (
                <span key={b.source}
                  className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1 text-xs text-foreground">
                  <span className="font-medium">{SOURCE_LABELS[b.source] || b.source}</span>
                  <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-bold tabular-nums">{b.pending.toLocaleString("en-IN")}</span>
                </span>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function StatCard({ label, value, rawValue, sub, Icon, iconBg, iconColor, muted = false }: {
  label: string;
  value?: number;
  rawValue?: string;
  sub?: string;
  Icon: any;
  iconBg: string;
  iconColor: string;
  /** Dim the value text — used to signal historical / paused metrics */
  muted?: boolean;
}) {
  // Reference-inspired stat-card shape: rounded-2xl shell, generous
  // padding, larger tinted icon chip, hero-sized value with the optional
  // sub line tucked underneath.
  return (
    <Card className="rounded-2xl border-border/40 shadow-none transition-all duration-280 ease-standard hover:elevation-mid hover:-translate-y-1">
      <CardContent className="p-4 flex items-start gap-3.5">
        <div className={`w-10 h-10 rounded-xl ${iconBg} flex items-center justify-center shrink-0`}>
          <Icon className={`h-[18px] w-[18px] ${iconColor}`} />
        </div>
        <div className="min-w-0">
          <p className="text-[11px] text-muted-foreground">{label}</p>
          <p className={`text-2xl font-bold tabular-nums truncate leading-none tracking-tight mt-1.5 ${muted ? "text-muted-foreground" : "text-foreground"}`}>
            {rawValue ?? (value ?? 0).toLocaleString("en-IN")}
          </p>
          {sub && <p className="text-[10px] text-muted-foreground/80 mt-1 truncate">{sub}</p>}
        </div>
      </CardContent>
    </Card>
  );
}
