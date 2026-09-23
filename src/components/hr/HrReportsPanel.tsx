// HR Reports — one screen for the aggregates HR is asked for ad hoc.
//
// Every tab is a thin shell over a SECURITY DEFINER RPC (see
// supabase/migrations/20260923152627_hr_reports_rpc.sql). The database does the
// grouping; the browser only renders and exports. That matters at NIMT's size:
// paging the whole attendance or payroll tables client-side is exactly the
// failure mode these RPCs exist to avoid.

import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { usePermissions } from "@/contexts/PermissionContext";
import { PageLoader } from "@/components/ui/page-loader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  AlertTriangle, CalendarRange, Download, IndianRupee, RefreshCw, TrendingDown, UserPlus, Users,
  type LucideIcon,
} from "lucide-react";
import { defaultMonthRange, downloadCsv, fmtInr, type CsvRow } from "@/lib/hrReports";

type ReportKey = "headcount" | "attendance" | "leave" | "payroll" | "attrition" | "recruitment" | "expenses";

interface Column {
  key: string;
  label: string;
  align?: "right";
  /** Display formatter; the CSV value uses the same formatter so the export
   *  matches what is on screen. */
  format?: (row: CsvRow) => string;
}

interface ReportDef {
  key: ReportKey;
  label: string;
  icon: LucideIcon;
  rpc: string;
  /** Renders _from/_to pickers and passes them to the RPC. */
  usesRange: boolean;
  /** Tab is only offered when at least one of these [module, action] pairs is
   *  held — the RPC's own SECURITY DEFINER check uses the same permissions. */
  requiresAny?: Array<[string, string]>;
  columns: Column[];
}

const fmtTime = (value: unknown): string => {
  if (!value) return "—";
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
};

const num = (value: unknown): string => String(Number(value ?? 0));

const REPORTS: ReportDef[] = [
  {
    key: "headcount",
    label: "Headcount",
    icon: Users,
    rpc: "hr_headcount_summary",
    usesRange: false,
    requiresAny: [["hr", "view"]],
    columns: [
      { key: "legal_entity", label: "Legal entity" },
      { key: "department", label: "Department" },
      { key: "campus", label: "Campus" },
      { key: "employment_status", label: "Status" },
      { key: "worker_type", label: "Worker type" },
      { key: "headcount", label: "Headcount", align: "right", format: (r) => num(r.headcount) },
      { key: "on_probation", label: "On probation", align: "right", format: (r) => num(r.on_probation) },
      { key: "joined_this_month", label: "Joined (mth)", align: "right", format: (r) => num(r.joined_this_month) },
      { key: "exited_this_month", label: "Exited (mth)", align: "right", format: (r) => num(r.exited_this_month) },
    ],
  },
  {
    key: "attendance",
    label: "Attendance",
    icon: CalendarRange,
    rpc: "hr_attendance_summary",
    usesRange: true,
    requiresAny: [["hr", "view"]],
    columns: [
      { key: "employee_name", label: "Employee" },
      { key: "employee_number", label: "Emp #" },
      { key: "present_days", label: "Present", align: "right", format: (r) => num(r.present_days) },
      { key: "absent_days", label: "Absent", align: "right", format: (r) => num(r.absent_days) },
      { key: "avg_hours", label: "Avg hours", align: "right", format: (r) => Number(r.avg_hours ?? 0).toFixed(2) },
      { key: "first_punch", label: "First in", format: (r) => fmtTime(r.first_punch) },
      { key: "last_punch", label: "Last out", format: (r) => fmtTime(r.last_punch) },
    ],
  },
  {
    key: "leave",
    label: "Leave",
    icon: CalendarRange,
    rpc: "hr_leave_summary",
    usesRange: false,
    requiresAny: [["hr", "view"]],
    columns: [
      { key: "employee_name", label: "Employee" },
      { key: "leave_type", label: "Leave type" },
      { key: "entitled", label: "Entitled", align: "right", format: (r) => num(r.entitled) },
      { key: "carried_forward", label: "Carried fwd", align: "right", format: (r) => num(r.carried_forward) },
      { key: "used", label: "Used", align: "right", format: (r) => num(r.used) },
      { key: "available", label: "Available", align: "right", format: (r) => num(r.available) },
    ],
  },
  {
    key: "payroll",
    label: "Payroll cost",
    icon: IndianRupee,
    rpc: "hr_payroll_cost_summary",
    usesRange: true,
    requiresAny: [["hr", "payroll_run"]],
    columns: [
      { key: "cycle_name", label: "Cycle" },
      { key: "legal_entity", label: "Legal entity" },
      { key: "status", label: "Status" },
      { key: "employees", label: "Employees", align: "right", format: (r) => num(r.employees) },
      { key: "gross_earnings", label: "Gross", align: "right", format: (r) => fmtInr(Number(r.gross_earnings)) },
      { key: "deductions", label: "Deductions", align: "right", format: (r) => fmtInr(Number(r.deductions)) },
      { key: "employer_cost", label: "Employer cost", align: "right", format: (r) => fmtInr(Number(r.employer_cost)) },
      { key: "net_pay", label: "Net pay", align: "right", format: (r) => fmtInr(Number(r.net_pay)) },
    ],
  },
  {
    key: "attrition",
    label: "Attrition",
    icon: TrendingDown,
    rpc: "hr_attrition_summary",
    usesRange: true,
    requiresAny: [["hr", "view"]],
    columns: [
      { key: "exit_type", label: "Exit type" },
      { key: "exits", label: "Exits", align: "right", format: (r) => num(r.exits) },
      { key: "avg_tenure_days", label: "Avg tenure (days)", align: "right", format: (r) => Number(r.avg_tenure_days ?? 0).toFixed(1) },
    ],
  },
  {
    key: "recruitment",
    label: "Recruitment funnel",
    icon: UserPlus,
    rpc: "hr_recruitment_funnel",
    usesRange: true,
    requiresAny: [["hr", "view"]],
    columns: [
      { key: "status", label: "Status" },
      { key: "source", label: "Source" },
      { key: "applicants", label: "Applicants", align: "right", format: (r) => num(r.applicants) },
    ],
  },
  {
    key: "expenses",
    label: "Expenses",
    icon: IndianRupee,
    rpc: "hr_expense_summary",
    usesRange: true,
    requiresAny: [["hr", "expenses_approve"], ["hr", "payroll_run"]],
    columns: [
      { key: "status", label: "Status" },
      { key: "category", label: "Category" },
      { key: "claims", label: "Claims", align: "right", format: (r) => num(r.claims) },
      { key: "total", label: "Total", align: "right", format: (r) => fmtInr(Number(r.total)) },
    ],
  },
];

function cellText(column: Column, row: CsvRow): string {
  const raw = column.format ? column.format(row) : row[column.key];
  return raw === null || raw === undefined || raw === "" ? "—" : String(raw);
}

function csvRowsFor(columns: Column[], rows: CsvRow[]): CsvRow[] {
  return rows.map((row) => {
    const out: CsvRow = {};
    for (const column of columns) {
      out[column.label] = column.format ? column.format(row) : (row[column.key] ?? "");
    }
    return out;
  });
}

export function HrReportsPanel() {
  const { toast } = useToast();
  const { can } = usePermissions();

  const initial = useMemo(() => defaultMonthRange(), []);
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const [year, setYear] = useState(new Date().getFullYear());
  const [tab, setTab] = useState<ReportKey>("headcount");

  const [rows, setRows] = useState<CsvRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reports = useMemo(
    () => REPORTS.filter((r) => !r.requiresAny || r.requiresAny.some(([m, a]) => can(m, a))),
    [can],
  );
  const active = reports.find((r) => r.key === tab) ?? reports[0];

  // A privilege change (or the first permission load) can remove the selected
  // tab; fall back to the first one that is still visible.
  useEffect(() => {
    if (active && active.key !== tab) setTab(active.key);
  }, [active, tab]);

  const load = useCallback(async () => {
    if (!active) return;
    setLoading(true);
    setError(null);
    const args: Record<string, unknown> = {};
    if (active.usesRange) {
      args._from = from;
      args._to = to;
    }
    if (active.key === "leave") args._leave_year = year;

    const { data, error: rpcError } = await (supabase.rpc as any)(active.rpc, args);
    if (rpcError) {
      setRows([]);
      setError(rpcError.message || "Could not load this report.");
    } else {
      setRows((data as CsvRow[]) ?? []);
    }
    setLoading(false);
  }, [active, from, to, year]);

  useEffect(() => { load(); }, [load]);

  const exportCsv = () => {
    if (!active || rows.length === 0) return;
    const suffix = active.usesRange ? `-${from}-to-${to}` : active.key === "leave" ? `-${year}` : "";
    downloadCsv(`hr-${active.key}${suffix}.csv`, csvRowsFor(active.columns, rows));
    toast({ title: "CSV downloaded", description: `${rows.length} rows` });
  };

  if (reports.length === 0) {
    return (
      <div className="rounded-xl bg-card card-shadow px-4 py-12 text-center">
        <p className="text-sm text-foreground">HR reports are restricted</p>
        <p className="text-xs text-muted-foreground mt-1">You need the “HR view” permission.</p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <Tabs value={active?.key ?? tab} onValueChange={(value) => setTab(value as ReportKey)}>
        <TabsList className="flex-wrap h-auto justify-start gap-1 bg-muted/60 p-1">
          {reports.map((report) => (
            <TabsTrigger key={report.key} value={report.key} className="gap-1.5">
              <report.icon className="h-3.5 w-3.5" />
              {report.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <div className="flex flex-wrap items-end gap-3 rounded-xl bg-card card-shadow p-3">
        {active?.usesRange ? (
          <div className="flex flex-wrap items-end gap-2">
            <label className="text-[11px] text-muted-foreground">
              <span className="mb-1 block">From</span>
              <Input type="date" value={from} max={to}
                onChange={(e) => setFrom(e.target.value)} className="h-8 w-[150px] text-xs" />
            </label>
            <label className="text-[11px] text-muted-foreground">
              <span className="mb-1 block">To</span>
              <Input type="date" value={to} min={from}
                onChange={(e) => setTo(e.target.value)} className="h-8 w-[150px] text-xs" />
            </label>
          </div>
        ) : active?.key === "leave" ? (
          <label className="text-[11px] text-muted-foreground">
            <span className="mb-1 block">Leave year</span>
            <Input type="number" value={year}
              onChange={(e) => setYear(Number(e.target.value))} className="h-8 w-24 text-xs" />
          </label>
        ) : (
          <span className="text-xs text-muted-foreground">
            Headcount is a live snapshot — no date range.
          </span>
        )}

        <div className="flex-1" />
        <Button size="sm" variant="outline" onClick={load} disabled={loading}>
          <RefreshCw className="h-4 w-4 mr-1.5" /> Refresh
        </Button>
        <Button size="sm" onClick={exportCsv} disabled={loading || rows.length === 0}>
          <Download className="h-4 w-4 mr-1.5" /> Download CSV
        </Button>
      </div>

      {loading ? (
        <div className="rounded-xl bg-card card-shadow py-12">
          <PageLoader />
        </div>
      ) : error ? (
        <div className="flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-xs">
          <AlertTriangle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
          <span className="text-foreground">{error}</span>
        </div>
      ) : (
        <div className="rounded-xl bg-card card-shadow overflow-x-auto">
          <table className="w-full text-xs min-w-[640px]">
            <thead className="bg-muted/50">
              <tr className="text-left">
                {(active?.columns ?? []).map((column) => (
                  <th key={column.key}
                    className={`px-3 py-2 font-medium ${column.align === "right" ? "text-right" : ""}`}>
                    {column.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={active?.columns.length ?? 1} className="px-3 py-10 text-center text-muted-foreground">
                    No data for the selected {active?.usesRange ? "period" : "filters"}.
                  </td>
                </tr>
              ) : rows.map((row, index) => (
                <tr key={index} className="hover:bg-muted/30 transition-colors">
                  {(active?.columns ?? []).map((column) => (
                    <td key={column.key}
                      className={`px-3 py-2 text-foreground ${column.align === "right" ? "text-right tabular-nums" : ""}`}>
                      {cellText(column, row)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!loading && !error && rows.length > 0 && (
        <p className="text-[11px] text-muted-foreground">
          {rows.length} row{rows.length === 1 ? "" : "s"} · aggregated by the database, not the browser.
        </p>
      )}
    </div>
  );
}

export default HrReportsPanel;
