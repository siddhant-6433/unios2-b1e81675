import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import {
  IndianRupee, Loader2, ChevronDown, ChevronUp, Download, RefreshCw,
  CheckCircle2, XCircle, CircleDashed, AlertTriangle, BadgeCheck, Banknote,
} from "lucide-react";

interface Statement {
  id: string;
  counsellor_id: string;
  month: string;
  admission_count: number;
  revenue_realized: number;
  admission_target: number | null;
  revenue_target: number | null;
  achievement_pct: number | null;
  multiplier: number | null;
  eligibility: Record<string, { value: unknown; pass: boolean | null }>;
  is_eligible: boolean;
  gross: number;
  clawbacks: number;
  net: number;
  status: "pending_approval" | "approved" | "paid";
  notes: string | null;
  profiles?: { display_name: string | null } | null;
}

interface LedgerRow {
  id: string;
  lead_id: string | null;
  component: string;
  amount: number;
  calc_inputs: Record<string, unknown>;
  created_at: string;
  leads?: { name: string | null } | null;
}

interface Flag {
  id: string;
  lead_id: string | null;
  flag_type: string;
  details: Record<string, unknown>;
  status: string;
  counsellor_id: string | null;
}

interface MonthInput {
  counsellor_id: string;
  attendance_pct: number | null;
  disciplinary_action: boolean;
}

// New incentive tables/RPCs are not in generated types yet
const db = supabase as unknown as {
  from: (table: string) => any;
  rpc: (fn: string, args?: object) => Promise<{ data: any; error: { message: string } | null }>;
};

const inr = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 });

const COMPONENT_LABELS: Record<string, string> = {
  base: "Base incentive",
  speed_bonus: "Speed bonus",
  token: "Token bonus",
  multiplier_adjustment: "Achievement multiplier",
  volume_bonus: "Volume bonus",
  team_bonus: "Team bonus",
  clawback: "Clawback",
  adjustment: "Manual adjustment",
};

const GATE_LABELS: Record<string, string> = {
  admission_pct: "Admission ≥70%",
  revenue_pct: "Revenue ≥70%",
  attendance: "Attendance ≥95%",
  kpi_compliance: "KPIs ≥90%",
  no_disciplinary_action: "No disciplinary action",
};

function monthOptions(): string[] {
  const out: string[] = [];
  const now = new Date();
  for (let i = 0; i < 12; i++) {
    out.push(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1)).toISOString().slice(0, 10));
  }
  return out;
}

function monthLabel(iso: string): string {
  return new Date(iso).toLocaleDateString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" });
}

export default function IncentiveApprovalPage() {
  const { user, role } = useAuth();
  const isSuperAdmin = role === "super_admin";
  const isAccountant = role === "accountant" || role === "office_admin";
  const months = useMemo(monthOptions, []);
  const [month, setMonth] = useState(months[1]); // default: previous month
  const [statements, setStatements] = useState<Statement[]>([]);
  const [flags, setFlags] = useState<Flag[]>([]);
  const [inputs, setInputs] = useState<Record<string, MonthInput>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [ledger, setLedger] = useState<Record<string, LedgerRow[]>>({});

  const load = useCallback(async () => {
    setLoading(true);
    const [st, fl, mi] = await Promise.all([
      db.from("incentive_statements")
        .select("*, profiles:counsellor_id(display_name)")
        .eq("month", month)
        .order("net", { ascending: false }),
      db.from("incentive_flags").select("*").eq("status", "open"),
      db.from("incentive_month_inputs").select("counsellor_id, attendance_pct, disciplinary_action").eq("month", month),
    ]);
    if (st.error) toast.error(`Failed to load statements: ${st.error.message}`);
    setStatements((st.data as Statement[]) || []);
    setFlags((fl.data as Flag[]) || []);
    const map: Record<string, MonthInput> = {};
    for (const row of (mi.data as MonthInput[]) || []) map[row.counsellor_id] = row;
    setInputs(map);
    setLoading(false);
  }, [month]);

  useEffect(() => { load(); }, [load]);

  const toggleDetail = async (s: Statement) => {
    if (openId === s.id) { setOpenId(null); return; }
    setOpenId(s.id);
    if (!ledger[s.id]) {
      const { data, error } = await db.from("incentive_ledger")
        .select("id, lead_id, component, amount, calc_inputs, created_at, leads:lead_id(name)")
        .eq("counsellor_id", s.counsellor_id)
        .eq("month", s.month)
        .order("created_at", { ascending: true });
      if (error) toast.error(`Failed to load ledger: ${error.message}`);
      setLedger(prev => ({ ...prev, [s.id]: (data as LedgerRow[]) || [] }));
    }
  };

  const recompute = async () => {
    setBusy(true);
    // fn_incentive_month_close does its own admin-role check via auth.uid()
    const { error } = await db.rpc("fn_incentive_month_close", { p_month: month });
    if (error) toast.error(`Recompute failed: ${error.message}`);
    else { toast.success("Statements recomputed"); await load(); }
    setBusy(false);
  };

  const setStatus = async (s: Statement, status: "approved" | "paid") => {
    const patch: Record<string, unknown> = { status };
    if (status === "approved") {
      const { data: prof } = await supabase.from("profiles").select("id").eq("user_id", user?.id ?? "").maybeSingle();
      patch.approved_by = prof?.id ?? null;
      patch.approved_at = new Date().toISOString();
    } else {
      patch.paid_at = new Date().toISOString();
    }
    const { error } = await db.from("incentive_statements").update(patch).eq("id", s.id);
    if (error) toast.error(`Update failed: ${error.message}`);
    else { toast.success(status === "approved" ? "Statement approved" : "Marked paid"); await load(); }
  };

  const saveInput = async (counsellorId: string, attendance: string, disciplinary: boolean) => {
    const attendance_pct = attendance === "" ? null : Number(attendance);
    if (attendance_pct != null && (Number.isNaN(attendance_pct) || attendance_pct < 0 || attendance_pct > 100)) {
      toast.error("Attendance must be 0–100");
      return;
    }
    const { data: prof } = await supabase.from("profiles").select("id").eq("user_id", user?.id ?? "").maybeSingle();
    const { error } = await db.from("incentive_month_inputs").upsert(
      { counsellor_id: counsellorId, month, attendance_pct, disciplinary_action: disciplinary, entered_by: prof?.id ?? null },
      { onConflict: "counsellor_id,month" },
    );
    if (error) toast.error(`Failed to save HR inputs: ${error.message}`);
    else toast.success("HR inputs saved — recompute to apply");
  };

  const resolveFlag = async (flag: Flag, status: "cleared" | "upheld") => {
    const { error } = await db.from("incentive_flags").update({ status, resolved_at: new Date().toISOString() }).eq("id", flag.id);
    if (error) toast.error(`Failed to resolve flag: ${error.message}`);
    else { toast.success(`Flag ${status}`); await load(); }
  };

  const exportCsv = () => {
    const header = "Counsellor,Month,Admissions,Revenue,Achievement %,Multiplier,Eligible,Gross,Clawbacks,Net,Status";
    const rows = statements.map(s => [
      JSON.stringify(s.profiles?.display_name ?? s.counsellor_id),
      s.month, s.admission_count, s.revenue_realized, s.achievement_pct ?? "", s.multiplier ?? "",
      s.is_eligible ? "yes" : "no", s.gross, s.clawbacks, s.net, s.status,
    ].join(","));
    const blob = new Blob([[header, ...rows].join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `incentives-${month}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const flagsFor = (counsellorId: string) => flags.filter(f => f.counsellor_id === counsellorId);
  const totalNet = statements.reduce((sum, s) => sum + Number(s.net), 0);

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Incentive Approvals</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Monthly counsellor incentive statements · payout total {inr.format(totalNet)}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={month}
            onChange={e => setMonth(e.target.value)}
            className="h-9 rounded-lg border border-input bg-card px-3 text-sm"
          >
            {months.map(m => <option key={m} value={m}>{monthLabel(m)}</option>)}
          </select>
          {isSuperAdmin && (
            <Button variant="outline" size="sm" onClick={recompute} disabled={busy}>
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
              <span className="ml-1.5">Recompute</span>
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={exportCsv} disabled={statements.length === 0}>
            <Download className="h-3.5 w-3.5" /><span className="ml-1.5">Payroll CSV</span>
          </Button>
        </div>
      </div>

      {loading ? (
        <Card className="rounded-2xl"><CardContent className="p-8 flex justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></CardContent></Card>
      ) : statements.length === 0 ? (
        <Card className="rounded-2xl">
          <CardContent className="p-8 text-center text-sm text-muted-foreground">
            No statements for {monthLabel(month)}. Use Recompute to generate them from the ledger.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {statements.map(s => {
            const sFlags = flagsFor(s.counsellor_id);
            const input = inputs[s.counsellor_id];
            const open = openId === s.id;
            return (
              <Card key={s.id} className="rounded-2xl border-border/40">
                <CardContent className="p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3 cursor-pointer" onClick={() => toggleDetail(s)}>
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-50">
                        <IndianRupee className="h-4 w-4 text-emerald-700" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-foreground truncate">
                          {s.profiles?.display_name ?? "Unknown counsellor"}
                        </p>
                        <p className="text-[11px] text-muted-foreground">
                          {s.admission_count}/{s.admission_target ?? "—"} admissions · {inr.format(s.revenue_realized)} revenue ·{" "}
                          {s.achievement_pct ?? 0}% achievement · {s.multiplier ?? 0}×
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {sFlags.length > 0 && (
                        <Badge variant="destructive" className="text-[10px]">
                          <AlertTriangle className="h-3 w-3 mr-1" />{sFlags.length} flag{sFlags.length > 1 ? "s" : ""}
                        </Badge>
                      )}
                      {!s.is_eligible && <Badge variant="secondary" className="text-[10px]">Ineligible</Badge>}
                      <Badge
                        variant={s.status === "paid" ? "default" : s.status === "approved" ? "secondary" : "outline"}
                        className="text-[10px] capitalize"
                      >
                        {s.status.replace("_", " ")}
                      </Badge>
                      <span className={`text-base font-bold ${s.net < 0 ? "text-destructive" : "text-foreground"}`}>
                        {inr.format(s.net)}
                      </span>
                      {open ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
                    </div>
                  </div>

                  {open && (
                    <div className="mt-4 border-t border-border/40 pt-4 grid gap-4 lg:grid-cols-2">
                      <div>
                        <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-2">Line items</p>
                        {!ledger[s.id] ? (
                          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                        ) : ledger[s.id].length === 0 ? (
                          <p className="text-xs text-muted-foreground">No ledger entries.</p>
                        ) : (
                          <div className="space-y-1">
                            {ledger[s.id].map(row => (
                              <div key={row.id} className="flex items-start justify-between text-xs py-1 border-b border-border/30 last:border-0">
                                <div className="min-w-0 pr-2">
                                  <span className="font-medium text-foreground">{COMPONENT_LABELS[row.component] ?? row.component}</span>
                                  {row.leads?.name && <span className="text-muted-foreground"> · {row.leads.name}</span>}
                                  <p className="text-[10px] text-muted-foreground truncate">
                                    {Object.entries(row.calc_inputs)
                                      .filter(([k]) => ["course", "source_class", "source_pct", "multiplier", "hours_from_creation", "reason", "admissions", "campus_achievement_pct", "achievement_pct"].includes(k))
                                      .map(([k, v]) => `${k.replaceAll("_", " ")}: ${v}`)
                                      .join(" · ")}
                                  </p>
                                </div>
                                <span className={`font-semibold whitespace-nowrap ${Number(row.amount) < 0 ? "text-destructive" : "text-foreground"}`}>
                                  {inr.format(Number(row.amount))}
                                </span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>

                      <div className="space-y-4">
                        <div>
                          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-2">Eligibility gates</p>
                          {Object.entries(s.eligibility || {}).map(([key, gate]) => (
                            <div key={key} className="flex items-center justify-between text-xs py-0.5">
                              <span className="flex items-center gap-1.5 text-muted-foreground">
                                {gate.pass === null
                                  ? <CircleDashed className="h-3.5 w-3.5 text-muted-foreground/60" />
                                  : gate.pass
                                    ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                                    : <XCircle className="h-3.5 w-3.5 text-destructive" />}
                                {GATE_LABELS[key] ?? key}
                              </span>
                              <span className="text-foreground">{gate.value == null ? "pending input" : String(gate.value)}</span>
                            </div>
                          ))}
                        </div>

                        <div>
                          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-2">HR inputs</p>
                          <HrInputRow
                            initialAttendance={input?.attendance_pct ?? null}
                            initialDisciplinary={input?.disciplinary_action ?? false}
                            disabled={s.status !== "pending_approval" || !isSuperAdmin}
                            onSave={(att, disc) => saveInput(s.counsellor_id, att, disc)}
                          />
                        </div>

                        {sFlags.length > 0 && (
                          <div>
                            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-2">Open flags</p>
                            <div className="space-y-1.5">
                              {sFlags.map(f => (
                                <div key={f.id} className="flex items-center justify-between gap-2 rounded-lg bg-destructive/5 px-2 py-1.5">
                                  <span className="text-xs text-foreground">
                                    {f.flag_type.replaceAll("_", " ")}
                                    <span className="text-[10px] text-muted-foreground ml-1">{JSON.stringify(f.details)}</span>
                                  </span>
                                  {isSuperAdmin && (
                                    <span className="flex gap-1 shrink-0">
                                      <Button variant="outline" size="sm" className="h-6 px-2 text-[10px]" onClick={() => resolveFlag(f, "cleared")}>Clear</Button>
                                      <Button variant="destructive" size="sm" className="h-6 px-2 text-[10px]" onClick={() => resolveFlag(f, "upheld")}>Uphold</Button>
                                    </span>
                                  )}
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        <div className="flex gap-2 pt-1">
                          {s.status === "pending_approval" && isSuperAdmin && (
                            <Button size="sm" onClick={() => setStatus(s, "approved")} disabled={sFlags.length > 0}>
                              <BadgeCheck className="h-3.5 w-3.5 mr-1.5" />
                              {sFlags.length > 0 ? "Resolve flags first" : "Approve"}
                            </Button>
                          )}
                          {s.status === "approved" && (isSuperAdmin || isAccountant) && (
                            <Button size="sm" variant="outline" onClick={() => setStatus(s, "paid")}>
                              <Banknote className="h-3.5 w-3.5 mr-1.5" />Mark paid
                            </Button>
                          )}
                        </div>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

function HrInputRow({
  initialAttendance, initialDisciplinary, disabled, onSave,
}: {
  initialAttendance: number | null;
  initialDisciplinary: boolean;
  disabled: boolean;
  onSave: (attendance: string, disciplinary: boolean) => void;
}) {
  const [attendance, setAttendance] = useState(initialAttendance == null ? "" : String(initialAttendance));
  const [disciplinary, setDisciplinary] = useState(initialDisciplinary);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Input
        type="number"
        min={0}
        max={100}
        placeholder="Attendance %"
        value={attendance}
        onChange={e => setAttendance(e.target.value)}
        disabled={disabled}
        className="h-8 w-32 text-xs"
      />
      <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <input
          type="checkbox"
          checked={disciplinary}
          onChange={e => setDisciplinary(e.target.checked)}
          disabled={disabled}
        />
        Disciplinary action
      </label>
      <Button variant="outline" size="sm" className="h-8 text-xs" disabled={disabled} onClick={() => onSave(attendance, disciplinary)}>
        Save
      </Button>
    </div>
  );
}
