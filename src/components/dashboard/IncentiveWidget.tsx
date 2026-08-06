import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { ButtonOrb } from "@/components/ui/thinking-orb";
import { Badge } from "@/components/ui/badge";
import { IndianRupee, TrendingUp, CheckCircle2, XCircle, CircleDashed } from "lucide-react";

interface Gate {
  value: number | null;
  required: number;
  advisory?: boolean;
}

interface Snapshot {
  month: string;
  designation: string;
  admissions: number;
  admission_target: number;
  revenue: number;
  revenue_target: number;
  admission_pct: number;
  revenue_pct: number;
  achievement_pct: number;
  multiplier: number;
  next_band: { min: number; mult: number } | null;
  accrued_base: number;
  accrued_bonuses: number;
  clawbacks: number;
  volume_bonus: number;
  next_volume_slab: { min_admissions: number; bonus: number } | null;
  projected_net: number;
  gates: Record<string, Gate>;
}

const snapshotRpc = supabase as unknown as {
  rpc: (fn: "counsellor_incentive_snapshot") => Promise<{ data: Snapshot | null; error: { message: string } | null }>;
};

const inr = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 });

const GATE_LABELS: Record<string, string> = {
  admission_pct: "Admission target ≥70%",
  revenue_pct: "Revenue target ≥70%",
  kpi_compliance: "Daily KPIs ≥90%",
  attendance: "Attendance ≥95%",
};

function GateRow({ label, gate }: { label: string; gate: Gate }) {
  const pass = gate.value != null && gate.value >= gate.required;
  const pending = gate.value == null;
  // advisory gates inform but never block eligibility — never shown red
  if (gate.advisory) {
    return (
      <div className="flex items-center justify-between text-xs py-0.5">
        <span className="flex items-center gap-1.5 text-muted-foreground">
          {pass
            ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
            : <CircleDashed className="h-3.5 w-3.5 text-muted-foreground/60" />}
          {label} <span className="text-[10px] rounded bg-muted px-1">advisory</span>
        </span>
        <span className="text-muted-foreground">{pending ? "—" : `${gate.value}%`}</span>
      </div>
    );
  }
  return (
    <div className="flex items-center justify-between text-xs py-0.5">
      <span className="flex items-center gap-1.5 text-muted-foreground">
        {pending
          ? <CircleDashed className="h-3.5 w-3.5 text-muted-foreground/60" />
          : pass
            ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
            : <XCircle className="h-3.5 w-3.5 text-destructive" />}
        {label}
      </span>
      <span className={pending ? "text-muted-foreground/60" : pass ? "text-emerald-700 font-medium" : "text-destructive font-medium"}>
        {pending ? "—" : `${gate.value}%`}
      </span>
    </div>
  );
}

export function IncentiveWidget() {
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    snapshotRpc.rpc("counsellor_incentive_snapshot").then(({ data, error }) => {
      if (cancelled) return;
      if (error) console.error("Incentive snapshot error:", error.message);
      setSnap(data);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, []);

  if (loading) {
    return (
      <Card className="rounded-2xl border-border/40">
        <CardContent className="p-5 flex items-center gap-2 text-sm text-muted-foreground">
          <ButtonOrb state="solving" /> Loading incentives…
        </CardContent>
      </Card>
    );
  }
  if (!snap) return null;

  const admissionsToNextBand = snap.next_band
    ? Math.max(0, Math.ceil((snap.next_band.min / 100) * snap.admission_target) - snap.admissions)
    : 0;
  const nextBandExtra = snap.next_band
    ? Math.round(snap.accrued_base * (snap.next_band.mult - snap.multiplier))
    : 0;
  const progress = Math.min(100, snap.achievement_pct);

  return (
    <Card className="rounded-2xl border-emerald-200/60 bg-gradient-to-br from-emerald-50/60 to-teal-50/30">
      <CardContent className="p-5">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-100">
              <IndianRupee className="h-4 w-4 text-emerald-700" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-foreground">This Month's Incentive</h3>
              <p className="text-[11px] text-muted-foreground">
                {snap.admissions}/{snap.admission_target} admissions · {inr.format(snap.revenue)} of {inr.format(snap.revenue_target)} revenue
              </p>
            </div>
          </div>
          <Badge variant="secondary" className="text-[10px]">{snap.multiplier}× multiplier</Badge>
        </div>

        <p className="text-3xl font-bold tracking-tight text-foreground leading-none">
          {inr.format(snap.projected_net)}
        </p>
        <p className="text-[11px] text-muted-foreground mt-1">
          projected payout · {inr.format(snap.accrued_base)} base + {inr.format(snap.accrued_bonuses + snap.volume_bonus)} bonuses
          {snap.clawbacks < 0 && <> − {inr.format(-snap.clawbacks)} clawbacks</>}
        </p>

        <div className="mt-3">
          <div className="flex justify-between text-[11px] text-muted-foreground mb-1">
            <span>Achievement {snap.achievement_pct}%</span>
            {snap.next_band && (
              <span className="flex items-center gap-1 text-emerald-700 font-medium">
                <TrendingUp className="h-3 w-3" />
                {admissionsToNextBand} more admission{admissionsToNextBand === 1 ? "" : "s"} → {snap.next_band.mult}×
                {nextBandExtra > 0 && <> (+{inr.format(nextBandExtra)})</>}
              </span>
            )}
          </div>
          <div className="h-2 rounded-full bg-emerald-100 overflow-hidden">
            <div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${progress}%` }} />
          </div>
        </div>

        {snap.next_volume_slab && (
          <p className="text-[11px] text-muted-foreground mt-2">
            {snap.next_volume_slab.min_admissions - snap.admissions} more admissions unlock a{" "}
            <span className="font-medium text-foreground">{inr.format(snap.next_volume_slab.bonus)}</span> volume bonus
          </p>
        )}

        <div className="mt-3 border-t border-border/40 pt-2">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-1">Eligibility gates</p>
          {Object.entries(GATE_LABELS).map(([key, label]) =>
            snap.gates[key] ? <GateRow key={key} label={label} gate={snap.gates[key]} /> : null
          )}
        </div>
      </CardContent>
    </Card>
  );
}
