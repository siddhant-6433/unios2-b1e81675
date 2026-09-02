import { useState, useEffect, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useCampus } from "@/contexts/CampusContext";
import { useToast } from "@/hooks/use-toast";
import { exportRowsXlsx, type ExportRow } from "@/lib/xlsxExport";
import { IndianRupee, AlertTriangle, Wallet, Search, Download, Users } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { OrbLoader } from "@/components/ui/thinking-orb";
import { ButtonOrb } from "@/components/ui/thinking-orb";
import { defaultFeeTermLabel } from "@/lib/feeTermLabels";
import { Send } from "lucide-react";

type StudentRow = {
  student_id: string;
  name: string | null;
  admission_no: string | null;
  campus_name: string | null;
  course_name: string | null;
  batch_name: string | null;
  session_name: string | null;
  total_charged: number;
  total_paid: number;
  total_concession: number;
  balance: number;
  overdue_amount: number;
  next_due_date: string | null;
  earliest_overdue_date: string | null;
  days_overdue: number;
  fully_paid: boolean;
};

type LineRow = {
  student_id: string;
  name: string | null;
  admission_no: string | null;
  campus_name: string | null;
  course_name: string | null;
  batch_name: string | null;
  session_name: string | null;
  fee_code: string | null;
  fee_name: string | null;
  term: string | null;
  total_amount: number;
  concession: number;
  paid_amount: number;
  balance: number;
  due_date: string | null;
  days_overdue: number;
  is_overdue: boolean;
};

type Granularity = "student" | "line";
type Scope = "all" | "overdue";

const inr = (n: number) => `₹${Number(n || 0).toLocaleString("en-IN")}`;
const fmtDate = (d: string | null) =>
  d ? new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—";

const thClass =
  "px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide";
const thRight = thClass.replace("text-left", "text-right");

export function FeeDueDefaultReport() {
  const { selectedCampusId } = useCampus();
  const { toast } = useToast();
  const [students, setStudents] = useState<StudentRow[]>([]);
  const [lines, setLines] = useState<LineRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [granularity, setGranularity] = useState<Granularity>("student");
  const [scope, setScope] = useState<Scope>("all");
  const [search, setSearch] = useState("");
  const [exporting, setExporting] = useState(false);
  const [campusF, setCampusF] = useState("all");
  const [courseF, setCourseF] = useState("all");
  const [batchF, setBatchF] = useState("all");
  const [sessionF, setSessionF] = useState("all");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [previewing, setPreviewing] = useState(false);
  const [sending, setSending] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [preview, setPreview] = useState<{ total: number; skipped_no_due: number; skipped_no_phone: number } | null>(null);

  useEffect(() => {
    fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCampusId]);

  const fetchData = async () => {
    setLoading(true);
    const { data, error } = await (supabase.rpc as any)("fee_due_report", {
      _campus_ids: selectedCampusId === "all" ? null : [selectedCampusId],
    });
    if (error) {
      toast({ title: "Failed to load report", description: error.message, variant: "destructive" });
      setStudents([]);
      setLines([]);
    } else {
      setStudents((data?.students ?? []) as StudentRow[]);
      setLines((data?.lines ?? []) as LineRow[]);
    }
    setLoading(false);
  };

  const q = search.trim().toLowerCase();
  const matchesSearch = (name: string | null, adm: string | null) =>
    !q || (name || "").toLowerCase().includes(q) || (adm || "").toLowerCase().includes(q);
  type Dims = { campus_name: string | null; course_name: string | null; batch_name: string | null; session_name: string | null };
  const val = (v: string | null) => v || "—";
  const matchesDims = (r: Dims) =>
    (campusF === "all" || val(r.campus_name) === campusF) &&
    (courseF === "all" || val(r.course_name) === courseF) &&
    (batchF === "all" || val(r.batch_name) === batchF) &&
    (sessionF === "all" || val(r.session_name) === sessionF);

  // Cascading dropdown options: each list is narrowed by the filters above it,
  // so e.g. picking a campus limits Course/Batch/Session to what that campus has.
  const optsFrom = (
    rows: StudentRow[],
    key: keyof Dims,
    keep: (r: StudentRow) => boolean,
  ) => Array.from(new Set(rows.filter(keep).map((r) => val(r[key] as string | null)))).sort();

  const campusOpts = useMemo(() => optsFrom(students, "campus_name", () => true), [students]);
  const courseOpts = useMemo(
    () => optsFrom(students, "course_name", (r) => campusF === "all" || val(r.campus_name) === campusF),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [students, campusF],
  );
  const batchOpts = useMemo(
    () => optsFrom(students, "batch_name", (r) =>
      (campusF === "all" || val(r.campus_name) === campusF) &&
      (courseF === "all" || val(r.course_name) === courseF)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [students, campusF, courseF],
  );
  const sessionOpts = useMemo(
    () => optsFrom(students, "session_name", (r) =>
      (campusF === "all" || val(r.campus_name) === campusF) &&
      (courseF === "all" || val(r.course_name) === courseF) &&
      (batchF === "all" || val(r.batch_name) === batchF)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [students, campusF, courseF, batchF],
  );

  // When a parent filter changes, drop any child selection that's no longer valid
  // so a stale Course/Batch/Session can't strand the table on "No records".
  useEffect(() => {
    if (courseF !== "all" && !courseOpts.includes(courseF)) setCourseF("all");
    if (batchF !== "all" && !batchOpts.includes(batchF)) setBatchF("all");
    if (sessionF !== "all" && !sessionOpts.includes(sessionF)) setSessionF("all");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [courseOpts, batchOpts, sessionOpts]);

  const filteredStudents = useMemo(
    () =>
      students
        .filter((s) => (scope === "overdue" ? s.days_overdue > 0 : true))
        .filter(matchesDims)
        .filter((s) => matchesSearch(s.name, s.admission_no)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [students, scope, q, campusF, courseF, batchF, sessionF],
  );

  const filteredLines = useMemo(
    () =>
      lines
        .filter((l) => (scope === "overdue" ? l.is_overdue : true))
        .filter(matchesDims)
        .filter((l) => matchesSearch(l.name, l.admission_no)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [lines, scope, q, campusF, courseF, batchF, sessionF],
  );

  // KPIs over the currently-shown rows.
  const kpis = useMemo(() => {
    if (granularity === "student") {
      return filteredStudents.reduce(
        (a, s) => ({
          charged: a.charged + Number(s.total_charged || 0),
          paid: a.paid + Number(s.total_paid || 0),
          balance: a.balance + Number(s.balance || 0),
          overdue: a.overdue + Number(s.overdue_amount || 0),
        }),
        { charged: 0, paid: 0, balance: 0, overdue: 0 },
      );
    }
    return filteredLines.reduce(
      (a, l) => ({
        charged: a.charged + Number(l.total_amount || 0) - Number(l.concession || 0),
        paid: a.paid + Number(l.paid_amount || 0),
        balance: a.balance + Number(l.balance || 0),
        overdue: a.overdue + (l.is_overdue ? Number(l.balance || 0) : 0),
      }),
      { charged: 0, paid: 0, balance: 0, overdue: 0 },
    );
  }, [granularity, filteredStudents, filteredLines]);

  const handleExport = async () => {
    const rows: ExportRow[] =
      granularity === "student"
        ? filteredStudents.map((s) => ({
            Student: s.name || "",
            "Admission No": s.admission_no || "",
            Course: s.course_name || "",
            Batch: s.batch_name || "",
            Session: s.session_name || "",
            Campus: s.campus_name || "",
            "Total Charged": Number(s.total_charged || 0),
            Paid: Number(s.total_paid || 0),
            Balance: Number(s.balance || 0),
            "Next Due Date": s.next_due_date || "",
            "Overdue Amount": Number(s.overdue_amount || 0),
            "Days Overdue": s.days_overdue,
            Status: s.fully_paid ? "Paid" : s.days_overdue > 0 ? "Overdue" : "Due",
          }))
        : filteredLines.map((l) => ({
            Student: l.name || "",
            "Admission No": l.admission_no || "",
            Course: l.course_name || "",
            Batch: l.batch_name || "",
            Session: l.session_name || "",
            Campus: l.campus_name || "",
            "Fee Head": l.fee_name || l.fee_code || "",
            Term: defaultFeeTermLabel(l.term || ""),
            Total: Number(l.total_amount || 0),
            Concession: Number(l.concession || 0),
            Paid: Number(l.paid_amount || 0),
            Balance: Number(l.balance || 0),
            "Due Date": l.due_date || "",
            "Days Overdue": l.days_overdue,
            Status: l.is_overdue ? "Overdue" : Number(l.balance) <= 0 ? "Paid" : "Due",
          }));
    if (rows.length === 0) {
      toast({ title: "Nothing to export" });
      return;
    }
    setExporting(true);
    await exportRowsXlsx(rows, "Fee Dues", `fee-${granularity}-${scope}`);
    setExporting(false);
    toast({ title: `Exported ${rows.length} rows` });
  };

  // Only students who actually owe can be reminded; fully-paid rows aren't selectable.
  const sendableStudents = useMemo(
    () => filteredStudents.filter((s) => Number(s.balance) > 0),
    [filteredStudents],
  );
  const selectableIds = useMemo(() => new Set(sendableStudents.map((s) => s.student_id)), [sendableStudents]);
  // Only count selections still visible under the current filters.
  const selectedVisible = useMemo(
    () => [...selectedIds].filter((id) => selectableIds.has(id)),
    [selectedIds, selectableIds],
  );
  const allSelected = sendableStudents.length > 0 && selectedVisible.length === sendableStudents.length;

  const toggleSelected = (id: string) =>
    setSelectedIds((cur) => {
      const next = new Set(cur);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  const toggleAll = () =>
    setSelectedIds(allSelected ? new Set() : new Set(sendableStudents.map((s) => s.student_id)));

  const extractError = async (error: unknown, data: any) => {
    if (data?.error) return data.error as string;
    const ctx = (error as { context?: { text?: () => Promise<string> } })?.context;
    const text = await ctx?.text?.().catch(() => "");
    try { return JSON.parse(text || "{}").error || (error as Error)?.message || "Request failed"; }
    catch { return (error as Error)?.message || "Request failed"; }
  };

  const handleRemindPreview = async () => {
    if (selectedVisible.length === 0) return;
    setPreviewing(true);
    setPreview(null);
    const { data, error } = await supabase.functions.invoke("fee-notify-bulk", {
      body: { student_ids: selectedVisible, purpose_label: "Fee due", expires_days: 7, dry_run: true },
    });
    setPreviewing(false);
    if (error || data?.error) {
      toast({ title: "Preview failed", description: await extractError(error, data), variant: "destructive" });
      return;
    }
    setPreview(data as { total: number; skipped_no_due: number; skipped_no_phone: number });
    setConfirmOpen(true);
  };

  const handleRemindSend = async () => {
    setConfirmOpen(false);
    setSending(true);
    const { data, error } = await supabase.functions.invoke("fee-notify-bulk", {
      body: { student_ids: selectedVisible, purpose_label: "Fee due", expires_days: 7, dry_run: false },
    });
    setSending(false);
    if (error || data?.error) {
      toast({ title: "Send failed", description: await extractError(error, data), variant: "destructive" });
      return;
    }
    const res = data as { sent: number; failed: number };
    toast({
      title: `Sent ${res.sent}, failed ${res.failed}`,
      variant: res.failed > 0 ? "destructive" : "default",
    });
    setSelectedIds(new Set());
    setPreview(null);
  };

  if (loading) {
    return (
      <div className="flex h-48 items-center justify-center">
        <OrbLoader state="working" />
      </div>
    );
  }

  const rowCount = granularity === "student" ? filteredStudents.length : filteredLines.length;

  return (
    <div className="space-y-4">
      {/* Controls */}
      <div className="flex flex-wrap items-center gap-2">
        <Pills
          value={granularity}
          onChange={(v) => setGranularity(v as Granularity)}
          options={[
            { value: "student", label: "By Student" },
            { value: "line", label: "By Fee Head" },
          ]}
        />
        <Pills
          value={scope}
          onChange={(v) => setScope(v as Scope)}
          options={[
            { value: "all", label: "All Dues" },
            { value: "overdue", label: "Overdue only" },
          ]}
        />
        <FilterSelect allLabel="All Campuses" value={campusF} onChange={setCampusF} options={campusOpts} />
        <FilterSelect allLabel="All Courses" value={courseF} onChange={setCourseF} options={courseOpts} />
        <FilterSelect allLabel="All Batches" value={batchF} onChange={setBatchF} options={batchOpts} />
        <FilterSelect allLabel="All Sessions" value={sessionF} onChange={setSessionF} options={sessionOpts} />
        <div className="relative flex-1 min-w-[180px] max-w-xs">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search name / admission no..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-xl border border-input bg-card py-2.5 pl-10 pr-4 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/20"
          />
        </div>
        {granularity === "student" && selectedVisible.length > 0 && (
          <Button
            size="sm"
            className="gap-1.5 h-9 text-xs ml-auto"
            disabled={previewing || sending}
            onClick={handleRemindPreview}
          >
            {previewing || sending ? <ButtonOrb state="composing" /> : <Send className="h-3.5 w-3.5" />}
            Send Fee Reminder ({selectedVisible.length})
          </Button>
        )}
        <Button
          size="sm"
          variant="outline"
          className={`gap-1.5 h-9 text-xs ${granularity === "student" && selectedVisible.length > 0 ? "" : "ml-auto"}`}
          disabled={exporting || rowCount === 0}
          onClick={handleExport}
        >
          {exporting ? <ButtonOrb state="composing" /> : <Download className="h-3.5 w-3.5" />} Export to Excel
        </Button>
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Kpi label="Total Charged" value={inr(kpis.charged)} icon={IndianRupee} bg="bg-pastel-blue" />
        <Kpi label="Total Paid" value={inr(kpis.paid)} icon={Wallet} bg="bg-pastel-green" />
        <Kpi label="Balance" value={inr(kpis.balance)} icon={Users} bg="bg-pastel-yellow" />
        <Kpi label="Overdue" value={inr(kpis.overdue)} icon={AlertTriangle} bg="bg-pastel-red" />
      </div>

      {/* Table */}
      <Card className="border-border/60 shadow-none overflow-hidden">
        <CardContent className="p-0 overflow-x-auto">
          {granularity === "student" ? (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/50">
                  <th className="px-4 py-3 w-10">
                    <Checkbox
                      aria-label="Select all"
                      checked={allSelected}
                      disabled={sendableStudents.length === 0}
                      onCheckedChange={toggleAll}
                    />
                  </th>
                  <th className={thClass}>Student</th>
                  <th className={thClass}>Adm. No</th>
                  <th className={thClass}>Course</th>
                  <th className={thClass}>Batch</th>
                  <th className={thRight}>Total Charged</th>
                  <th className={thRight}>Paid</th>
                  <th className={thRight}>Balance</th>
                  <th className={thClass}>Next Due</th>
                  <th className={thRight}>Overdue</th>
                  <th className={thRight}>Days</th>
                  <th className={thClass}>Status</th>
                </tr>
              </thead>
              <tbody>
                {filteredStudents.length === 0 ? (
                  <tr>
                    <td colSpan={12} className="px-4 py-12 text-center text-muted-foreground">
                      No records
                    </td>
                  </tr>
                ) : (
                  filteredStudents.map((s) => (
                    <tr
                      key={s.student_id}
                      className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors"
                    >
                      <td className="px-4 py-3">
                        {Number(s.balance) > 0 && (
                          <Checkbox
                            aria-label={`Select ${s.name || "student"}`}
                            checked={selectedIds.has(s.student_id)}
                            onCheckedChange={() => toggleSelected(s.student_id)}
                          />
                        )}
                      </td>
                      <td className="px-4 py-3 font-medium text-foreground">{s.name || "—"}</td>
                      <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{s.admission_no || "—"}</td>
                      <td className="px-4 py-3 text-muted-foreground">{s.course_name || "—"}</td>
                      <td className="px-4 py-3 text-muted-foreground">{s.batch_name || "—"}</td>
                      <td className="px-4 py-3 text-right text-foreground">{inr(s.total_charged)}</td>
                      <td className="px-4 py-3 text-right text-foreground">{inr(s.total_paid)}</td>
                      <td className="px-4 py-3 text-right font-semibold text-foreground">{inr(s.balance)}</td>
                      <td className="px-4 py-3 text-muted-foreground">{fmtDate(s.next_due_date)}</td>
                      <td className="px-4 py-3 text-right font-semibold text-foreground">{inr(s.overdue_amount)}</td>
                      <td className="px-4 py-3 text-right text-muted-foreground">{s.days_overdue || "—"}</td>
                      <td className="px-4 py-3">{statusBadge(s.fully_paid, s.days_overdue)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/50">
                  <th className={thClass}>Student</th>
                  <th className={thClass}>Adm. No</th>
                  <th className={thClass}>Fee Head</th>
                  <th className={thClass}>Term</th>
                  <th className={thRight}>Total</th>
                  <th className={thRight}>Paid</th>
                  <th className={thRight}>Balance</th>
                  <th className={thClass}>Due Date</th>
                  <th className={thRight}>Days</th>
                  <th className={thClass}>Status</th>
                </tr>
              </thead>
              <tbody>
                {filteredLines.length === 0 ? (
                  <tr>
                    <td colSpan={10} className="px-4 py-12 text-center text-muted-foreground">
                      No records
                    </td>
                  </tr>
                ) : (
                  filteredLines.map((l, i) => (
                    <tr
                      key={`${l.student_id}-${l.fee_code}-${l.term}-${i}`}
                      className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors"
                    >
                      <td className="px-4 py-3 font-medium text-foreground">{l.name || "—"}</td>
                      <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{l.admission_no || "—"}</td>
                      <td className="px-4 py-3 text-foreground">{l.fee_name || l.fee_code || "—"}</td>
                      <td className="px-4 py-3 text-muted-foreground">{defaultFeeTermLabel(l.term || "")}</td>
                      <td className="px-4 py-3 text-right text-foreground">{inr(l.total_amount)}</td>
                      <td className="px-4 py-3 text-right text-foreground">{inr(l.paid_amount)}</td>
                      <td className="px-4 py-3 text-right font-semibold text-foreground">{inr(l.balance)}</td>
                      <td className="px-4 py-3 text-muted-foreground">{fmtDate(l.due_date)}</td>
                      <td className="px-4 py-3 text-right text-muted-foreground">{l.days_overdue || "—"}</td>
                      <td className="px-4 py-3">
                        {statusBadge(Number(l.balance) <= 0, l.days_overdue)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">
        {rowCount} {granularity === "student" ? "students" : "fee lines"} · Overdue = balance past its due date.
      </p>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Send fee reminder?</AlertDialogTitle>
            <AlertDialogDescription>
              {preview
                ? `A WhatsApp payment link for their full outstanding dues will be sent to ${preview.total} student${preview.total === 1 ? "" : "s"}.` +
                  (preview.skipped_no_due ? ` ${preview.skipped_no_due} skipped (nothing due).` : "") +
                  (preview.skipped_no_phone ? ` ${preview.skipped_no_phone} skipped (no phone).` : "")
                : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction disabled={!preview || preview.total === 0} onClick={handleRemindSend}>
              Send {preview?.total ?? 0}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function statusBadge(fullyPaid: boolean, daysOverdue: number) {
  if (fullyPaid) return <Badge className="text-[10px] font-medium border-0 bg-pastel-green text-foreground/80">Paid</Badge>;
  if (daysOverdue > 0)
    return <Badge className="text-[10px] font-medium border-0 bg-pastel-red text-foreground/80">Overdue</Badge>;
  return <Badge className="text-[10px] font-medium border-0 bg-pastel-yellow text-foreground/80">Due</Badge>;
}

function Kpi({
  label,
  value,
  icon: Icon,
  bg,
}: {
  label: string;
  value: string;
  icon: typeof IndianRupee;
  bg: string;
}) {
  return (
    <Card className="border-border/60 shadow-none">
      <CardContent className="p-4">
        <div className={`flex h-9 w-9 items-center justify-center rounded-lg ${bg} mb-3`}>
          <Icon className="h-4 w-4 text-foreground/70" />
        </div>
        <p className="text-xs font-medium text-muted-foreground">{label}</p>
        <p className="text-xl font-bold text-foreground mt-1 tabular-nums">{value}</p>
      </CardContent>
    </Card>
  );
}

function FilterSelect({
  allLabel,
  value,
  onChange,
  options,
}: {
  allLabel: string;
  value: string;
  onChange: (v: string) => void;
  options: string[];
}) {
  return (
    <select
      aria-label={allLabel}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="rounded-lg border border-input bg-card py-2 pl-3 pr-8 text-xs font-medium text-foreground focus:outline-none focus:ring-2 focus:ring-ring/20"
    >
      <option value="all">{allLabel}</option>
      {options.map((o) => (
        <option key={o} value={o}>
          {o}
        </option>
      ))}
    </select>
  );
}

function Pills({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <div className="flex flex-wrap items-center gap-1 rounded-lg border border-input bg-card p-1 w-fit">
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
            value === o.value ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
