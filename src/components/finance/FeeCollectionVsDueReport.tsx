import { useEffect, useMemo, useState, Fragment } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useCampus } from "@/contexts/CampusContext";
import { useToast } from "@/hooks/use-toast";
import { exportRowsXlsx } from "@/lib/xlsxExport";
import { exportRowsPdf } from "@/lib/pdfExport";
import { exportCollectionVsDuePdf } from "@/lib/feeCollectionVsDuePdf";
import { exportCollectedReceiptsPdf } from "@/lib/feeCollectionCollectedPdf";
import { exportOverdueFeesPdf } from "@/lib/feeCollectionOverduePdf";
import nimtLogo from "@/assets/nimt-edu-inst-logo.svg";
import { useAuth } from "@/contexts/AuthContext";
import {
  IndianRupee, AlertTriangle, Wallet, Search, Download, FileText, Users, Calendar,
  ChevronDown, ChevronRight, Percent,
} from "lucide-react";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  Legend,
} from "recharts";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { OrbLoader } from "@/components/ui/thinking-orb";
import { ButtonOrb } from "@/components/ui/thinking-orb";
import { feeTermLabel } from "@/lib/feeTermLabels";
import { useFeeStructureMetaByCourse } from "@/hooks/useFeeStructureMeta";
import { indiaTodayDate } from "@/lib/indiaDateTime";
import {
  COLLECTION_VS_DUE_SCOPES,
  aggregateKpis,
  buildDetailedExportRows,
  buildSummaryExportRows,
  displayVal,
  feeHeadLabel,
  feeHeadsForLines,
  filterLinesForPdfSelection,
  groupByProgrammeBatch,
  pdfFeeHeadOptionsForLines,
  pdfPeriodGroupsForLines,
  planCollectionVsDuePdfParts,
  pivotStudents,
  type CollectionVsDueLine,
  type CollectionVsDueScope,
  type CollectionVsDueView,
  type PdfFeeHeadOption,
  type PdfPeriodGroup,
} from "@/lib/feeCollectionVsDue";

const inr = (n: number) => `₹${Number(n || 0).toLocaleString("en-IN")}`;
const fmtDate = (d: string | null) =>
  d ? new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—";
const modeLabel = (mode: string | null | undefined) => {
  const value = String(mode || "");
  const labels: Record<string, string> = {
    cash: "Cash",
    upi: "UPI",
    bank_transfer: "Bank Transfer",
    cheque: "Cheque",
    online: "Online",
    gateway: "Gateway",
    consultant_credit_note: "Consultant Credit Note",
  };
  return labels[value] || value.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()) || "—";
};

const thClass =
  "px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap";
const thRight = thClass.replace("text-left", "text-right");
const thCenter = thClass.replace("text-left", "text-center");

const toggleKey = (keys: string[], key: string) =>
  keys.includes(key) ? keys.filter((k) => k !== key) : [...keys, key];

const isCollectedReceiptLine = (line: CollectionVsDueLine) =>
  Number(line.collected_amount || 0) > 0 &&
  !!(line.payment_id || line.fee_ledger_payment_id || line.receipt_no || line.payment_mode || line.payment_date);

export function FeeCollectionVsDueReport() {
  const { selectedCampusId } = useCampus();
  const { role } = useAuth();
  const isSuperAdmin = role === "super_admin";
  const { toast } = useToast();
  const [lines, setLines] = useState<CollectionVsDueLine[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<CollectionVsDueView>("summary");
  const [scope, setScope] = useState<CollectionVsDueScope>("till_date");
  const [asOf, setAsOf] = useState(indiaTodayDate());
  const [search, setSearch] = useState("");
  const [exporting, setExporting] = useState(false);
  const [exportingPdf, setExportingPdf] = useState(false);
  const [campusF, setCampusF] = useState("all");
  const [courseF, setCourseF] = useState("all");
  const [batchF, setBatchF] = useState("all");
  const [sessionF, setSessionF] = useState("all");
  const [pdfPeriodKeys, setPdfPeriodKeys] = useState<string[]>([]);
  const [pdfHeadKeys, setPdfHeadKeys] = useState<string[]>([]);

  const feeMetaByCourse = useFeeStructureMetaByCourse(
    useMemo(() => lines.map((l) => l.course_id), [lines]),
  );

  useEffect(() => {
    fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCampusId, scope, asOf]);

  useEffect(() => {
    if (scope === "collected" && view !== "detailed" && view !== "monthly") setView("detailed");
  }, [scope, view]);

  const fetchData = async () => {
    setLoading(true);
    const { data, error } = await supabase.rpc("fee_collection_vs_due_report", {
      _campus_ids: selectedCampusId === "all" ? null : [selectedCampusId],
      _scope: scope,
      _as_of: asOf || indiaTodayDate(),
    });
    if (error) {
      toast({ title: "Failed to load report", description: error.message, variant: "destructive" });
      setLines([]);
    } else {
      const payload = data as { lines?: CollectionVsDueLine[] } | null;
      setLines((payload?.lines ?? []) as CollectionVsDueLine[]);
    }
    setLoading(false);
  };

  const q = search.trim().toLowerCase();
  const matchesSearch = (name: string | null, adm: string | null) =>
    !q || (name || "").toLowerCase().includes(q) || (adm || "").toLowerCase().includes(q);
  const matchesDims = (r: CollectionVsDueLine) =>
    (campusF === "all" || displayVal(r.campus_name) === campusF) &&
    (courseF === "all" || displayVal(r.course_name) === courseF) &&
    (batchF === "all" || displayVal(r.batch_name) === batchF) &&
    (sessionF === "all" || displayVal(r.session_name) === sessionF);

  const optsFrom = (
    rows: CollectionVsDueLine[],
    key: keyof Pick<CollectionVsDueLine, "campus_name" | "course_name" | "batch_name" | "session_name">,
    keep: (r: CollectionVsDueLine) => boolean,
  ) => Array.from(new Set(rows.filter(keep).map((r) => displayVal(r[key])))).sort();

  const campusOpts = useMemo(() => optsFrom(lines, "campus_name", () => true), [lines]);
  const courseOpts = useMemo(
    () => optsFrom(lines, "course_name", (r) => campusF === "all" || displayVal(r.campus_name) === campusF),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [lines, campusF],
  );
  const batchOpts = useMemo(
    () => optsFrom(lines, "batch_name", (r) =>
      (campusF === "all" || displayVal(r.campus_name) === campusF) &&
      (courseF === "all" || displayVal(r.course_name) === courseF)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [lines, campusF, courseF],
  );
  const sessionOpts = useMemo(
    () => optsFrom(lines, "session_name", (r) =>
      (campusF === "all" || displayVal(r.campus_name) === campusF) &&
      (courseF === "all" || displayVal(r.course_name) === courseF) &&
      (batchF === "all" || displayVal(r.batch_name) === batchF)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [lines, campusF, courseF, batchF],
  );

  useEffect(() => {
    if (campusF !== "all" && !campusOpts.includes(campusF)) setCampusF("all");
    if (courseF !== "all" && !courseOpts.includes(courseF)) setCourseF("all");
    if (batchF !== "all" && !batchOpts.includes(batchF)) setBatchF("all");
    if (sessionF !== "all" && !sessionOpts.includes(sessionF)) setSessionF("all");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [campusOpts, courseOpts, batchOpts, sessionOpts]);

  const filteredLines = useMemo(
    () => lines.filter(matchesDims).filter((l) => matchesSearch(l.name, l.admission_no)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [lines, q, campusF, courseF, batchF, sessionF],
  );
  const reportLines = useMemo(
    () => scope === "collected" ? filteredLines.filter(isCollectedReceiptLine) : filteredLines,
    [filteredLines, scope],
  );

  const sections = useMemo(() => groupByProgrammeBatch(reportLines), [reportLines]);
  const kpis = useMemo(() => aggregateKpis(reportLines), [reportLines]);
  const pdfPeriodOptions = useMemo(
    () => pdfPeriodGroupsForLines(reportLines, feeMetaByCourse),
    [reportLines, feeMetaByCourse],
  );
  const pdfHeadOptions = useMemo(
    () => pdfFeeHeadOptionsForLines(reportLines, feeMetaByCourse),
    [reportLines, feeMetaByCourse],
  );
  const pdfParts = useMemo(
    () => planCollectionVsDuePdfParts(reportLines, feeMetaByCourse, {
      periodKeys: pdfPeriodKeys,
      headKeys: pdfHeadKeys,
    }),
    [reportLines, feeMetaByCourse, pdfHeadKeys, pdfPeriodKeys],
  );
  const hasPdfSelection = pdfPeriodKeys.length > 0 || pdfHeadKeys.length > 0;

  useEffect(() => {
    const periodSet = new Set(pdfPeriodOptions.map((o) => o.key));
    const headSet = new Set(pdfHeadOptions.map((o) => o.key));
    setPdfPeriodKeys((keys) => {
      const next = keys.filter((key) => periodSet.has(key));
      return next.length === keys.length ? keys : next;
    });
    setPdfHeadKeys((keys) => {
      const next = keys.filter((key) => headSet.has(key));
      return next.length === keys.length ? keys : next;
    });
  }, [pdfHeadOptions, pdfPeriodOptions]);

  const handleExport = async (fmt: "xlsx" | "pdf") => {
    const pdfSelectedLines = filterLinesForPdfSelection(reportLines, {
      periodKeys: pdfPeriodKeys,
      headKeys: pdfHeadKeys,
    }, feeMetaByCourse);
    const rows = scope !== "collected" && view === "summary"
      ? buildSummaryExportRows(reportLines, feeMetaByCourse)
      : buildDetailedExportRows(fmt === "pdf" ? pdfSelectedLines : reportLines, feeMetaByCourse);
    if (rows.length === 0) {
      toast({ title: "Nothing to export" });
      return;
    }
    const setBusy = fmt === "pdf" ? setExportingPdf : setExporting;
    setBusy(true);
    const prefix = `fee-collection-vs-due-${view}-${scope}`;
    const scopeLabel = COLLECTION_VS_DUE_SCOPES.find((s) => s.value === scope)?.label || scope;
    if (fmt === "pdf") {
      const subtitle = [
        view === "summary" ? "Summary" : "Detailed",
        scopeLabel,
        `As of ${fmtDate(asOf)}`,
        campusF === "all" ? "All Campuses" : campusF,
        courseF !== "all" ? courseF : null,
        batchF !== "all" ? batchF : null,
        sessionF !== "all" ? sessionF : null,
        hasPdfSelection ? "PDF selection applied" : null,
      ].filter(Boolean).join(" · ");
      const brand = {
        logoSrc: nimtLogo,
        org: "NIMT Educational Institutions",
        contactLine: "9555192192 · admissions@nimt.ac.in · www.nimt.ac.in",
        subtitle,
      };
      if (scope === "collected") {
        await exportCollectedReceiptsPdf(reportLines, {
          filePrefix: prefix,
          title: "Fee Collection - Collected",
          subtitle,
          brand,
          metaByCourse: feeMetaByCourse,
        });
      } else if (scope === "overdue") {
        await exportOverdueFeesPdf(pdfSelectedLines, {
          filePrefix: prefix,
          title: "Fee Collection - Overdue",
          subtitle,
          brand,
          metaByCourse: feeMetaByCourse,
        });
      } else if (view === "summary") {
        if (pdfParts.length === 0) {
          toast({ title: "Nothing to export" });
          setBusy(false);
          return;
        }
        await exportCollectionVsDuePdf(reportLines, pdfParts, {
          filePrefix: prefix,
          title: "Fee Collection vs Due",
          subtitle,
          brand,
          metaByCourse: feeMetaByCourse,
        });
      } else {
        await exportRowsPdf(rows, "Fee Collection vs Due", prefix, {
          unmask: isSuperAdmin,
          brand,
        });
      }
    } else {
      await exportRowsXlsx(rows, "Collection vs Due", prefix, { unmask: isSuperAdmin });
    }
    setBusy(false);
    toast({ title: view === "summary" && fmt === "pdf" && scope !== "collected" ? `Exported ${pdfParts.length} PDF parts` : `Exported ${rows.length} rows` });
  };

  if (loading) {
    return (
      <div className="flex h-48 items-center justify-center">
        <OrbLoader state="working" />
      </div>
    );
  }

  const studentCount = kpis.students;
  const rowCount = scope !== "collected" && view === "summary" ? studentCount : reportLines.length;
  const collectedMode = scope === "collected";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Pills
          value={view}
          onChange={(v) => setView(v as CollectionVsDueView)}
          options={collectedMode
            ? [{ value: "detailed", label: "Detailed" }, { value: "monthly", label: "Monthly" }]
            : [
                { value: "summary", label: "Summary" },
                { value: "detailed", label: "Detailed" },
                { value: "monthly", label: "Monthly" },
              ]}
        />
        <Pills
          value={scope}
          onChange={(v) => setScope(v as CollectionVsDueScope)}
          options={COLLECTION_VS_DUE_SCOPES}
        />
        <div className="relative">
          <Calendar className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground pointer-events-none" />
          <input
            type="date"
            aria-label="As of date"
            value={asOf}
            onChange={(e) => setAsOf(e.target.value || indiaTodayDate())}
            className="rounded-lg border border-input bg-card py-2 pl-8 pr-3 text-xs font-medium text-foreground focus:outline-none focus:ring-2 focus:ring-ring/20"
          />
        </div>
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
        <Button
          size="sm"
          variant="outline"
          className="gap-1.5 h-9 text-xs ml-auto"
          disabled={exporting || exportingPdf || rowCount === 0}
          onClick={() => handleExport("xlsx")}
        >
          {exporting ? <ButtonOrb state="composing" /> : <Download className="h-3.5 w-3.5" />} Export to Excel
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="gap-1.5 h-9 text-xs"
          disabled={exporting || exportingPdf || rowCount === 0}
          onClick={() => handleExport("pdf")}
        >
          {exportingPdf ? <ButtonOrb state="composing" /> : <FileText className="h-3.5 w-3.5" />} Export to PDF
        </Button>
      </div>

      <div className={`grid grid-cols-2 gap-3 ${view === "detailed" ? "lg:grid-cols-6" : "lg:grid-cols-4"}`}>
        <Kpi label="Total Due" value={inr(kpis.due)} icon={IndianRupee} bg="bg-pastel-blue" />
        <Kpi label="Total Collected" value={inr(kpis.collected)} icon={Wallet} bg="bg-pastel-green" />
        <Kpi label="Balance" value={inr(kpis.balance)} icon={Users} bg="bg-pastel-yellow" />
        <Kpi label="Overdue" value={inr(kpis.overdue)} icon={AlertTriangle} bg="bg-pastel-red" />
        {view === "detailed" && (
          <>
            <Kpi label="Late Fine Due" value={inr(kpis.lateDue)} icon={AlertTriangle} bg="bg-pastel-orange" />
            <Kpi label="Late Fine Paid" value={inr(kpis.lateCollected)} icon={Wallet} bg="bg-pastel-mint" />
          </>
        )}
      </div>

      <MonthlyChartCard lines={reportLines} />

      {!collectedMode && view === "summary" && (
        <PdfSelectionPanel
          periodOptions={pdfPeriodOptions}
          headOptions={pdfHeadOptions}
          selectedPeriods={pdfPeriodKeys}
          selectedHeads={pdfHeadKeys}
          partCount={pdfParts.length}
          onTogglePeriod={(key) => setPdfPeriodKeys((keys) => toggleKey(keys, key))}
          onToggleHead={(key) => setPdfHeadKeys((keys) => toggleKey(keys, key))}
          onClear={() => {
            setPdfPeriodKeys([]);
            setPdfHeadKeys([]);
          }}
        />
      )}

      {sections.length === 0 ? (
        <Card className="border-border/60 shadow-none">
          <CardContent className="px-4 py-12 text-center text-muted-foreground">
            No records
          </CardContent>
        </Card>
      ) : view === "monthly" ? (
        <MonthlySection lines={reportLines} metaByCourse={feeMetaByCourse} />
      ) : !collectedMode && view === "summary" ? (
        <div className="space-y-6">
          {sections.map((section) => (
            <SummarySection
              key={section.key}
              campus={section.campus_name}
              course={section.course_name}
              batch={section.batch_name}
              lines={section.lines}
              metaByCourse={feeMetaByCourse}
              collectedMode={collectedMode}
            />
          ))}
        </div>
      ) : (
        <div className="space-y-6">
          {sections.map((section) => (
            <DetailedSection
              key={section.key}
              campus={section.campus_name}
              course={section.course_name}
              batch={section.batch_name}
              lines={section.lines}
              metaByCourse={feeMetaByCourse}
            />
          ))}
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        {studentCount} students · {reportLines.length} {collectedMode ? "receipt rows" : "fee heads"} · As of {fmtDate(asOf)}.
        Due till date includes heads due on or before this date; entire batch includes future terms;
        overdue is unpaid heads past their due date; collected only shows confirmed receipt allocations up to this date.
        Late fines are shown in the detailed view.
      </p>
    </div>
  );
}

function SectionHeading({
  campus,
  course,
  batch,
  countLabel,
}: {
  campus: string;
  course: string;
  batch: string;
  countLabel: string;
}) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-2 px-1">
      <h3 className="text-sm font-semibold text-foreground">
        {course}
        <span className="font-medium text-muted-foreground"> · {batch}</span>
        {campus !== "—" && <span className="font-medium text-muted-foreground"> · {campus}</span>}
      </h3>
      <p className="text-xs text-muted-foreground">{countLabel}</p>
    </div>
  );
}

function SummarySection({
  campus,
  course,
  batch,
  lines,
  metaByCourse,
}: {
  campus: string;
  course: string;
  batch: string;
  lines: CollectionVsDueLine[];
  metaByCourse: Record<string, import("@/lib/feeTermLabels").FeeStructureMetadata>;
}) {
  const heads = feeHeadsForLines(lines);
  const students = pivotStudents(lines);
  const totals = students.reduce(
    (a, s) => ({ due: a.due + s.totalDue, collected: a.collected + s.totalCollected }),
    { due: 0, collected: 0 },
  );
  const headTotals = Object.fromEntries(
    heads.map((h) => [
      h.key,
      students.reduce(
        (a, s) => ({
          due: a.due + Number(s.amounts[h.key]?.due || 0),
          collected: a.collected + Number(s.amounts[h.key]?.collected || 0),
        }),
        { due: 0, collected: 0 },
      ),
    ]),
  ) as Record<string, { due: number; collected: number }>;

  return (
    <div className="space-y-2">
      <SectionHeading campus={campus} course={course} batch={batch} countLabel={`${students.length} students`} />
      <Card className="border-border/60 shadow-none overflow-hidden">
        <CardContent className="p-0 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/50">
                <th rowSpan={2} className={`${thClass} w-14`}>S. No.</th>
                <th rowSpan={2} className={thClass}>Student</th>
                <th rowSpan={2} className={thClass}>Adm. No</th>
                {heads.map((h) => (
                  <th key={h.key} colSpan={2} className={thCenter}>
                    {feeHeadLabel(h, metaByCourse)}
                  </th>
                ))}
                <th colSpan={2} className={thCenter}>Total</th>
              </tr>
              <tr className="border-b border-border bg-muted/50">
                {heads.map((h) => (
                  <HeadPairHeaders key={h.key} />
                ))}
                <HeadPairHeaders />
              </tr>
            </thead>
            <tbody>
              {students.map((s, i) => (
                <tr key={s.student_id} className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors">
                  <td className="px-4 py-3 tabular-nums text-muted-foreground">{i + 1}</td>
                  <td className="px-4 py-3 font-medium text-foreground whitespace-nowrap">{s.name}</td>
                  <td className="px-4 py-3 font-mono text-xs text-muted-foreground whitespace-nowrap">{s.admission_no}</td>
                  {heads.map((h) => {
                    const amt = s.amounts[h.key];
                    return (
                      <HeadPairCells
                        key={h.key}
                        due={amt?.due || 0}
                        collected={amt?.collected || 0}
                        overdue={!!amt?.overdue}
                      />
                    );
                  })}
                  <HeadPairCells due={s.totalDue} collected={s.totalCollected} overdue={s.overdueAmount > 0} emphasize />
                </tr>
              ))}
              {students.length > 0 && (
                <tr className="bg-muted/40 font-medium">
                  <td className="px-4 py-3" colSpan={3}>Section total</td>
                  {heads.map((h) => (
                    <HeadPairCells
                      key={h.key}
                      due={headTotals[h.key]?.due || 0}
                      collected={headTotals[h.key]?.collected || 0}
                    />
                  ))}
                  <HeadPairCells due={totals.due} collected={totals.collected} emphasize />
                </tr>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}

function HeadPairHeaders() {
  return (
    <>
      <th className={thRight}>Due</th>
      <th className={thRight}>Collected</th>
    </>
  );
}

function HeadPairCells({
  due,
  collected,
  overdue,
  emphasize,
}: {
  due: number;
  collected: number;
  overdue?: boolean;
  emphasize?: boolean;
}) {
  return (
    <>
      <td className={`px-4 py-3 text-right tabular-nums whitespace-nowrap ${overdue ? "text-destructive" : "text-foreground"} ${emphasize ? "font-semibold" : ""}`}>
        {inr(due)}
      </td>
      <td className={`px-4 py-3 text-right tabular-nums whitespace-nowrap text-foreground ${emphasize ? "font-semibold" : ""}`}>
        {inr(collected)}
      </td>
    </>
  );
}

function DetailedSection({
  campus,
  course,
  batch,
  lines,
  metaByCourse,
  collectedMode = false,
}: {
  campus: string;
  course: string;
  batch: string;
  lines: CollectionVsDueLine[];
  metaByCourse: Record<string, import("@/lib/feeTermLabels").FeeStructureMetadata>;
  collectedMode?: boolean;
}) {
  const sorted = [...lines].sort((a, b) => {
    if (collectedMode) {
      return (a.payment_date || a.collected_date || "").localeCompare(b.payment_date || b.collected_date || "")
        || displayVal(a.name).localeCompare(displayVal(b.name))
        || displayVal(a.receipt_no).localeCompare(displayVal(b.receipt_no))
        || displayVal(a.fee_name).localeCompare(displayVal(b.fee_name));
    }
    return displayVal(a.name).localeCompare(displayVal(b.name))
      || displayVal(a.fee_name).localeCompare(displayVal(b.fee_name))
      || (a.due_date || "").localeCompare(b.due_date || "");
  });
  const totals = sorted.reduce(
    (a, l) => ({
      due: a.due + Number(l.due_amount || 0),
      collected: a.collected + Number(l.collected_amount || 0),
      balance: a.balance + Number(l.balance || 0),
      lateDue: a.lateDue + Number(l.late_fine_due || 0),
      lateCollected: a.lateCollected + Number(l.late_fine_collected || 0),
    }),
    { due: 0, collected: 0, balance: 0, lateDue: 0, lateCollected: 0 },
  );
  if (collectedMode) {
    return (
      <div className="space-y-2">
        <SectionHeading campus={campus} course={course} batch={batch} countLabel={`${sorted.length} receipt rows`} />
        <Card className="border-border/60 shadow-none overflow-hidden">
          <CardContent className="p-0 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/50">
                  <th className={`${thClass} w-14`}>S. No.</th>
                  <th className={thClass}>Student</th>
                  <th className={thClass}>Adm. No</th>
                  <th className={thClass}>Receipt No</th>
                  <th className={thClass}>Payment Date</th>
                  <th className={thClass}>Fee Head</th>
                  <th className={thClass}>Term</th>
                  <th className={thClass}>Mode</th>
                  <th className={thClass}>Txn Ref</th>
                  <th className={thRight}>Collected</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((l, i) => (
                  <tr
                    key={l.fee_ledger_payment_id || l.payment_id || `${l.student_id}-${l.receipt_no}-${l.fee_ledger_id}-${i}`}
                    className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors"
                  >
                    <td className="px-4 py-3 tabular-nums text-muted-foreground">{i + 1}</td>
                    <td className="px-4 py-3 font-medium text-foreground whitespace-nowrap">{l.name || "—"}</td>
                    <td className="px-4 py-3 font-mono text-xs text-muted-foreground whitespace-nowrap">{l.admission_no || "—"}</td>
                    <td className="px-4 py-3 font-mono text-xs text-foreground whitespace-nowrap">{l.receipt_no || "—"}</td>
                    <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">{fmtDate(l.payment_date || l.collected_date)}</td>
                    <td className="px-4 py-3 text-foreground whitespace-nowrap">{l.fee_name || l.fee_code || "—"}</td>
                    <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">
                      {feeTermLabel(l.term || "", metaByCourse[l.course_id || ""])}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">{modeLabel(l.payment_mode)}</td>
                    <td className="px-4 py-3 font-mono text-xs text-muted-foreground whitespace-nowrap">{l.transaction_ref || "—"}</td>
                    <td className="px-4 py-3 text-right tabular-nums font-semibold text-foreground">{inr(l.collected_amount)}</td>
                  </tr>
                ))}
                {sorted.length > 0 && (
                  <tr className="bg-muted/40 font-medium">
                    <td className="px-4 py-3" colSpan={9}>Section total</td>
                    <td className="px-4 py-3 text-right tabular-nums">{inr(totals.collected)}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </CardContent>
        </Card>
      </div>
    );
  }
  return (
    <div className="space-y-2">
      <SectionHeading campus={campus} course={course} batch={batch} countLabel={`${sorted.length} fee heads`} />
      <Card className="border-border/60 shadow-none overflow-hidden">
        <CardContent className="p-0 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/50">
                <th className={`${thClass} w-14`}>S. No.</th>
                <th className={thClass}>Student</th>
                <th className={thClass}>Adm. No</th>
                <th className={thClass}>Fee Head</th>
                <th className={thClass}>Term</th>
                <th className={thRight}>Due</th>
                <th className={thRight}>Collected</th>
                <th className={thRight}>Balance</th>
                <th className={thClass}>Due Date</th>
                <th className={thClass}>Collected Date</th>
                <th className={thRight}>Late Fine Due</th>
                <th className={thRight}>Late Fine Paid</th>
                <th className={thClass}>Status</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((l, i) => (
                <tr
                  key={l.fee_ledger_id || `${l.student_id}-${l.fee_code}-${l.term}-${i}`}
                  className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors"
                >
                  <td className="px-4 py-3 tabular-nums text-muted-foreground">{i + 1}</td>
                  <td className="px-4 py-3 font-medium text-foreground whitespace-nowrap">{l.name || "—"}</td>
                  <td className="px-4 py-3 font-mono text-xs text-muted-foreground whitespace-nowrap">{l.admission_no || "—"}</td>
                  <td className="px-4 py-3 text-foreground whitespace-nowrap">{l.fee_name || l.fee_code || "—"}</td>
                  <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">
                    {feeTermLabel(l.term || "", metaByCourse[l.course_id || ""])}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-foreground">{inr(l.due_amount)}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-foreground">{inr(l.collected_amount)}</td>
                  <td className="px-4 py-3 text-right tabular-nums font-semibold text-foreground">{inr(l.balance)}</td>
                  <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">{fmtDate(l.due_date)}</td>
                  <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">{fmtDate(l.collected_date)}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-foreground">{inr(l.late_fine_due)}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-foreground">{inr(l.late_fine_collected)}</td>
                  <td className="px-4 py-3">{statusBadge(Number(l.balance) <= 0, l.is_overdue)}</td>
                </tr>
              ))}
              {sorted.length > 0 && (
                <tr className="bg-muted/40 font-medium">
                  <td className="px-4 py-3" colSpan={5}>Section total</td>
                  <td className="px-4 py-3 text-right tabular-nums">{inr(totals.due)}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{inr(totals.collected)}</td>
                  <td className="px-4 py-3 text-right tabular-nums font-semibold">{inr(totals.balance)}</td>
                  <td className="px-4 py-3" colSpan={2} />
                  <td className="px-4 py-3 text-right tabular-nums">{inr(totals.lateDue)}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{inr(totals.lateCollected)}</td>
                  <td />
                </tr>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}

function statusBadge(fullyPaid: boolean, overdue: boolean) {
  if (fullyPaid) return <Badge className="text-[10px] font-medium border-0 bg-pastel-green text-foreground/80">Paid</Badge>;
  if (overdue) return <Badge className="text-[10px] font-medium border-0 bg-pastel-red text-foreground/80">Overdue</Badge>;
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

function PdfSelectionPanel({
  periodOptions,
  headOptions,
  selectedPeriods,
  selectedHeads,
  partCount,
  onTogglePeriod,
  onToggleHead,
  onClear,
}: {
  periodOptions: PdfPeriodGroup[];
  headOptions: PdfFeeHeadOption[];
  selectedPeriods: string[];
  selectedHeads: string[];
  partCount: number;
  onTogglePeriod: (key: string) => void;
  onToggleHead: (key: string) => void;
  onClear: () => void;
}) {
  const selectedPeriodSet = new Set(selectedPeriods);
  const selectedHeadSet = new Set(selectedHeads);
  return (
    <div className="rounded-lg border border-border/70 bg-card p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-xs font-semibold text-foreground">PDF parts</p>
          <p className="text-xs text-muted-foreground">
            Auto parts by due month/term · {partCount} {partCount === 1 ? "part" : "parts"}
          </p>
        </div>
        {(selectedPeriods.length > 0 || selectedHeads.length > 0) && (
          <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={onClear}>
            Clear PDF selection
          </Button>
        )}
      </div>
      <div className="mt-3 grid gap-3 lg:grid-cols-2">
        <Checklist
          title="Months / terms"
          options={periodOptions.map((o) => ({ key: o.key, label: o.label }))}
          selected={selectedPeriodSet}
          onToggle={onTogglePeriod}
        />
        <Checklist
          title="Fee heads"
          options={headOptions.map((o) => ({ key: o.key, label: `${o.periodLabel} · ${o.fee_name || o.fee_code || "Fee"}` }))}
          selected={selectedHeadSet}
          onToggle={onToggleHead}
        />
      </div>
    </div>
  );
}

function Checklist({
  title,
  options,
  selected,
  onToggle,
}: {
  title: string;
  options: { key: string; label: string }[];
  selected: Set<string>;
  onToggle: (key: string) => void;
}) {
  return (
    <div>
      <p className="mb-1.5 text-xs font-medium text-muted-foreground">{title}</p>
      <div className="max-h-32 space-y-1 overflow-auto rounded-md border border-border/60 p-2">
        {options.length === 0 ? (
          <p className="py-2 text-xs text-muted-foreground">No options</p>
        ) : options.map((option) => (
          <label key={option.key} className="flex cursor-pointer items-center gap-2 text-xs text-foreground">
            <input
              type="checkbox"
              checked={selected.has(option.key)}
              onChange={() => onToggle(option.key)}
              className="h-3.5 w-3.5 rounded border-input"
            />
            <span className="truncate" title={option.label}>{option.label}</span>
          </label>
        ))}
      </div>
    </div>
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
          type="button"
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

interface MonthlyDataRow {
  monthKey: string;
  monthLabel: string;
  due: number;
  collected: number;
  balance: number;
  lines: CollectionVsDueLine[];
}

function getMonthlySegregation(lines: CollectionVsDueLine[]): MonthlyDataRow[] {
  const map = new Map<string, MonthlyDataRow>();

  for (const line of lines) {
    let key = "no-date";
    let label = "No Due Date";

    if (line.due_date) {
      const parts = line.due_date.split("-");
      if (parts.length >= 2) {
        const year = parts[0];
        const month = parts[1];
        key = `${year}-${month}`;
        
        const monthIndex = Math.max(0, Math.min(11, Number(month) - 1));
        label = new Date(Number(year), monthIndex, 1).toLocaleDateString("en-IN", {
          month: "short",
          year: "numeric",
        });
      }
    }

    let existing = map.get(key);
    if (!existing) {
      existing = {
        monthKey: key,
        monthLabel: label,
        due: 0,
        collected: 0,
        balance: 0,
        lines: [],
      };
      map.set(key, existing);
    }

    existing.due += Number(line.due_amount || 0);
    existing.collected += Number(line.collected_amount || 0);
    existing.balance += Number(line.balance || 0);
    existing.lines.push(line);
  }

  return Array.from(map.values()).sort((a, b) => {
    if (a.monthKey === "no-date") return 1;
    if (b.monthKey === "no-date") return -1;
    return a.monthKey.localeCompare(b.monthKey);
  });
}

function MonthlySection({
  lines,
  metaByCourse,
}: {
  lines: CollectionVsDueLine[];
  metaByCourse: Record<string, import("@/lib/feeTermLabels").FeeStructureMetadata>;
}) {
  const monthlyData = useMemo(() => getMonthlySegregation(lines), [lines]);
  const [expandedMonths, setExpandedMonths] = useState<string[]>([]);

  const toggleMonth = (key: string) => {
    setExpandedMonths((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]
    );
  };

  const totals = useMemo(() => {
    return monthlyData.reduce(
      (acc, curr) => ({
        due: acc.due + curr.due,
        collected: acc.collected + curr.collected,
        balance: acc.balance + curr.balance,
      }),
      { due: 0, collected: 0, balance: 0 }
    );
  }, [monthlyData]);

  // Format tick labels
  const tickFormatter = (v: number) => {
    if (v >= 100000) return `₹${(v / 100000).toFixed(1)}L`;
    if (v >= 1000) return `₹${(v / 1000).toFixed(0)}K`;
    return `₹${v}`;
  };

  return (
    <div className="space-y-6">
      {/* Visual Chart */}
      <Card className="border-border/60 shadow-none">
        <div className="p-4 border-b border-border/60 flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-foreground">Monthly Fee Collection vs Due Trend</h3>
            <p className="text-xs text-muted-foreground mt-0.5">Chronological comparison of target dues and actual collections</p>
          </div>
        </div>
        <CardContent className="pt-6">
          {monthlyData.length === 0 ? (
            <div className="flex h-64 items-center justify-center text-sm text-muted-foreground">No monthly data available</div>
          ) : (
            <div className="h-72 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={monthlyData} barGap={4}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                  <XAxis dataKey="monthLabel" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                  <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} tickFormatter={tickFormatter} />
                  <RechartsTooltip
                    contentStyle={{ borderRadius: "8px", border: "1px solid hsl(var(--border))", fontSize: "12px", backgroundColor: "hsl(var(--card))" }}
                    formatter={(v: number, name: string) => [inr(v), name === "due" ? "Amount Due" : "Amount Collected"]}
                  />
                  <Legend verticalAlign="top" height={36} wrapperStyle={{ fontSize: "12px" }} />
                  <Bar name="collected" dataKey="collected" fill="#22c55e" radius={[4, 4, 0, 0]} maxBarSize={32} />
                  <Bar name="due" dataKey="due" fill="#ef4444" radius={[4, 4, 0, 0]} maxBarSize={32} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Monthly Details Table */}
      <div className="space-y-2">
        <div className="px-1 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-foreground">Month-wise Segregation & Details</h3>
          <span className="text-xs text-muted-foreground">{monthlyData.length} months</span>
        </div>
        <Card className="border-border/60 shadow-none overflow-hidden">
          <CardContent className="p-0 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/50">
                  <th className={`${thClass} w-12 text-center`}></th>
                  <th className={thClass}>Month</th>
                  <th className={thRight}>Amount Due</th>
                  <th className={thRight}>Amount Collected</th>
                  <th className={thRight}>Balance</th>
                  <th className={thCenter}>Collection %</th>
                </tr>
              </thead>
              <tbody>
                {monthlyData.map((row) => {
                  const isExpanded = expandedMonths.includes(row.monthKey);
                  const pct = row.due > 0 ? Math.round((row.collected / row.due) * 100) : 0;
                  
                  return (
                    <Fragment key={row.monthKey}>
                      <tr 
                        className="border-b border-border hover:bg-muted/30 transition-colors cursor-pointer"
                        onClick={() => toggleMonth(row.monthKey)}
                      >
                        <td className="px-4 py-3 text-center">
                          <Button variant="ghost" size="icon" className="h-5 w-5 p-0">
                            {isExpanded ? (
                              <ChevronDown className="h-4 w-4 text-muted-foreground" />
                            ) : (
                              <ChevronRight className="h-4 w-4 text-muted-foreground" />
                            )}
                          </Button>
                        </td>
                        <td className="px-4 py-3 font-semibold text-foreground whitespace-nowrap">{row.monthLabel}</td>
                        <td className="px-4 py-3 text-right tabular-nums text-foreground">{inr(row.due)}</td>
                        <td className="px-4 py-3 text-right tabular-nums text-foreground">{inr(row.collected)}</td>
                        <td className="px-4 py-3 text-right tabular-nums font-semibold text-foreground">{inr(row.balance)}</td>
                        <td className="px-4 py-3">
                          <div className="flex flex-col items-center justify-center gap-1">
                            <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${
                              pct >= 100 
                                ? "bg-pastel-green text-foreground/80" 
                                : pct > 0 
                                ? "bg-pastel-yellow text-foreground/80" 
                                : "bg-pastel-red text-foreground/80"
                            }`}>
                              {pct}%
                            </span>
                            <div className="w-20 bg-muted h-1 rounded-full overflow-hidden">
                              <div 
                                className={`h-full rounded-full ${pct >= 100 ? "bg-emerald-500" : pct > 0 ? "bg-yellow-500" : "bg-red-500"}`} 
                                style={{ width: `${Math.min(100, pct)}%` }}
                              />
                            </div>
                          </div>
                        </td>
                      </tr>
                      {isExpanded && (
                        <tr>
                          <td colSpan={6} className="bg-muted/10 p-4 border-b border-border">
                            <div className="space-y-2">
                              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider px-1">
                                Monthly Details for {row.monthLabel} ({row.lines.length} items)
                              </p>
                              <Card className="border-border/60 shadow-none overflow-hidden bg-card">
                                <table className="w-full text-xs text-left">
                                  <thead>
                                    <tr className="border-b border-border bg-muted/30">
                                      <th className="px-3 py-2">Student</th>
                                      <th className="px-3 py-2">Adm. No</th>
                                      <th className="px-3 py-2">Campus</th>
                                      <th className="px-3 py-2">Fee Head</th>
                                      <th className="px-3 py-2">Term</th>
                                      <th className="px-3 py-2 text-right">Due</th>
                                      <th className="px-3 py-2 text-right">Collected</th>
                                      <th className="px-3 py-2 text-right">Balance</th>
                                      <th className="px-3 py-2">Status</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {row.lines.map((l, idx) => (
                                      <tr key={l.fee_ledger_id || idx} className="border-b border-border last:border-0 hover:bg-muted/20">
                                        <td className="px-3 py-2 font-medium whitespace-nowrap">{l.name || "—"}</td>
                                        <td className="px-3 py-2 font-mono text-muted-foreground whitespace-nowrap">{l.admission_no || "—"}</td>
                                        <td className="px-3 py-2 text-muted-foreground whitespace-nowrap">{l.campus_name || "—"}</td>
                                        <td className="px-3 py-2 whitespace-nowrap">{l.fee_name || l.fee_code || "—"}</td>
                                        <td className="px-3 py-2 text-muted-foreground whitespace-nowrap">
                                          {feeTermLabel(l.term || "", metaByCourse[l.course_id || ""])}
                                        </td>
                                        <td className="px-3 py-2 text-right tabular-nums">{inr(l.due_amount)}</td>
                                        <td className="px-3 py-2 text-right tabular-nums">{inr(l.collected_amount)}</td>
                                        <td className="px-3 py-2 text-right tabular-nums font-medium">{inr(l.balance)}</td>
                                        <td className="px-3 py-2">
                                          {statusBadge(Number(l.balance) <= 0, l.is_overdue)}
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </Card>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
                {monthlyData.length > 0 && (
                  <tr className="bg-muted/40 font-semibold text-foreground">
                    <td className="px-4 py-3 text-center" />
                    <td className="px-4 py-3 font-bold whitespace-nowrap">Grand Total</td>
                    <td className="px-4 py-3 text-right tabular-nums">{inr(totals.due)}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{inr(totals.collected)}</td>
                    <td className="px-4 py-3 text-right tabular-nums font-bold">{inr(totals.balance)}</td>
                    <td className="px-4 py-3 text-center">
                      <div className="flex flex-col items-center justify-center gap-1">
                        <span className="text-[10px] font-bold">
                          {totals.due > 0 ? Math.round((totals.collected / totals.due) * 100) : 0}%
                        </span>
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function MonthlyChartCard({ lines }: { lines: CollectionVsDueLine[] }) {
  const monthlyData = useMemo(() => getMonthlySegregation(lines).filter(row => row.monthKey !== "no-date" || row.due > 0 || row.collected > 0), [lines]);
  
  // Format tick labels
  const tickFormatter = (v: number) => {
    if (v >= 100000) return `₹${(v / 100000).toFixed(1)}L`;
    if (v >= 1000) return `₹${(v / 1000).toFixed(0)}K`;
    return `₹${v}`;
  };

  if (monthlyData.length === 0) return null;

  return (
    <Card className="border-border/60 shadow-none">
      <div className="p-4 border-b border-border/60 flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-foreground">Monthly Fee Collection vs Due</h3>
          <p className="text-xs text-muted-foreground mt-0.5">Chronological comparison of target dues (Red) and actual collections (Green)</p>
        </div>
      </div>
      <CardContent className="pt-6">
        <div className="h-64 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={monthlyData} barGap={4}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
              <XAxis dataKey="monthLabel" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
              <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} tickFormatter={tickFormatter} />
              <RechartsTooltip
                contentStyle={{ borderRadius: "8px", border: "1px solid hsl(var(--border))", fontSize: "12px", backgroundColor: "hsl(var(--card))" }}
                formatter={(v: number, name: string) => [inr(v), name === "due" ? "Amount Due" : "Amount Collected"]}
              />
              <Legend verticalAlign="top" height={36} wrapperStyle={{ fontSize: "12px" }} />
              <Bar name="collected" dataKey="collected" fill="#22c55e" radius={[4, 4, 0, 0]} maxBarSize={32} />
              <Bar name="due" dataKey="due" fill="#ef4444" radius={[4, 4, 0, 0]} maxBarSize={32} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}
