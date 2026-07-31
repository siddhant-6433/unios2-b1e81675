import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import {
  EXAM_CODES,
  EXAM_SHORT_LABELS,
  EXAM_DISPLAY_NAMES,
  examStatusLabel,
  examStatusClass,
  type ExamCode,
  type ExamRegistrationStatus,
} from "@/lib/examRegistration";
import { signExamRegistrationDoc } from "@/lib/examRegistrationClient";
import { exportRowsCsv, formatExportDateTime } from "@/lib/xlsxExport";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";
import { Download, FileText } from "lucide-react";

// One flattened exam-registration row joined to its lead. Names are
// denormalized from the leads FK joins the same way Admissions does it.
interface ExamRow {
  id: string;
  lead_id: string;
  exam_code: ExamCode;
  status: ExamRegistrationStatus;
  registration_no: string | null;
  document_url: string | null;
  registered_at: string | null;
  created_at: string;
  lead_name: string;
  phone: string;
  course_name: string;
  campus_name: string;
  counsellor_name: string;
}

const EXAM_REG_SELECT =
  "id, lead_id, exam_code, status, registration_no, document_url, registered_at, created_at, " +
  "leads:lead_id(name, phone, courses:course_id(name), campuses:campus_id(name), profiles:counsellor_id(display_name))";

// Segregation is per entrance exam. "all" shows every exam together.
type ExamFilter = ExamCode | "all";

const Exams = () => {
  const { role } = useAuth();
  const { toast } = useToast();
  const [rows, setRows] = useState<ExamRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [examFilter, setExamFilter] = useState<ExamFilter>("all");
  const [search, setSearch] = useState("");

  // Download gated to super_admin + admission_head (mirrors Admissions export).
  const canExport = role === "super_admin" || role === "admission_head";

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const out: ExamRow[] = [];
      const pageSize = 1000;
      // ponytail: keyset-paginate to beat the silent 1000-row response cap.
      let cursor: { created_at: string; id: string } | null = null;
      for (;;) {
        let query: any = supabase
          .from("exam_registrations" as any)
          .select(EXAM_REG_SELECT)
          .order("created_at", { ascending: false })
          .order("id", { ascending: false })
          .limit(pageSize);
        if (cursor) {
          query = query.or(
            `created_at.lt.${cursor.created_at},and(created_at.eq.${cursor.created_at},id.lt.${cursor.id})`,
          );
        }
        const { data, error } = await query;
        if (error) {
          console.error("exam_registrations list fetch failed:", error.message);
          break;
        }
        const batch = ((data || []) as any[]).map((r): ExamRow => ({
          id: r.id,
          lead_id: r.lead_id,
          exam_code: r.exam_code,
          status: r.status,
          registration_no: r.registration_no || null,
          document_url: r.document_url || null,
          registered_at: r.registered_at || null,
          created_at: r.created_at,
          lead_name: r.leads?.name || "",
          phone: r.leads?.phone || "",
          course_name: r.leads?.courses?.name || "",
          campus_name: r.leads?.campuses?.name || "",
          counsellor_name: r.leads?.profiles?.display_name || "Unassigned",
        }));
        out.push(...batch);
        const last = batch[batch.length - 1];
        if (batch.length < pageSize || !last) break;
        cursor = { created_at: last.created_at, id: last.id };
      }
      if (!cancelled) {
        setRows(out);
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Which exams actually have data — drives the segregation tabs.
  const examCounts = useMemo(() => {
    const counts = new Map<ExamCode, number>();
    for (const r of rows) counts.set(r.exam_code, (counts.get(r.exam_code) || 0) + 1);
    return counts;
  }, [rows]);

  const visible = useMemo(() => {
    const q = search.toLowerCase().trim();
    const digits = q.replace(/\D/g, "");
    return rows.filter((r) => {
      if (examFilter !== "all" && r.exam_code !== examFilter) return false;
      if (!q) return true;
      return (
        r.lead_name.toLowerCase().includes(q) ||
        (digits && r.phone.replace(/\D/g, "").includes(digits)) ||
        (r.registration_no || "").toLowerCase().includes(q)
      );
    });
  }, [rows, examFilter, search]);

  const handleExport = () => {
    const { count } = exportRowsCsv(
      visible.map((r) => ({
        Exam: EXAM_SHORT_LABELS[r.exam_code],
        "Lead Name": r.lead_name,
        Phone: r.phone,
        Course: r.course_name,
        Campus: r.campus_name,
        Counsellor: r.counsellor_name,
        Status: examStatusLabel(r.status),
        "Registration No": r.registration_no || "",
        Registered: formatExportDateTime(r.registered_at),
        Created: formatExportDateTime(r.created_at),
      })),
      examFilter === "all" ? "exam-registrations" : `exam-${examFilter}`,
    );
    toast({
      title: count > 0 ? "Exam data exported" : "Nothing to export",
      description: count > 0 ? `${count} registration${count === 1 ? "" : "s"} exported.` : undefined,
    });
  };

  const openDoc = async (path: string) => {
    const url = await signExamRegistrationDoc(path);
    if (url) window.open(url, "_blank", "noopener,noreferrer");
    else toast({ title: "Document unavailable", variant: "destructive" });
  };

  // Tabs: "All" plus every exam that has at least one registration.
  const examTabs: ExamFilter[] = ["all", ...EXAM_CODES.filter((c) => examCounts.has(c))];

  return (
    <div className="space-y-4 animate-fade-in p-1">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Entrance Exams</h1>
          <p className="text-sm text-muted-foreground">
            Entrance-exam & counselling registrations, segregated by exam.
          </p>
        </div>
        {canExport && (
          <Button size="sm" variant="outline" onClick={handleExport} disabled={visible.length === 0}>
            <Download className="mr-2 h-4 w-4" />
            Download CSV
          </Button>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {examTabs.map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => setExamFilter(tab)}
            title={tab === "all" ? "All exams" : EXAM_DISPLAY_NAMES[tab]}
            className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
              examFilter === tab
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border bg-background text-muted-foreground hover:bg-muted"
            }`}
          >
            {tab === "all" ? "All" : EXAM_SHORT_LABELS[tab]}
            <span className="ml-1 opacity-70">
              {tab === "all" ? rows.length : examCounts.get(tab) || 0}
            </span>
          </button>
        ))}
      </div>

      <Input
        placeholder="Search name, phone, or registration no…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="max-w-sm"
      />

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Exam</TableHead>
                <TableHead>Lead</TableHead>
                <TableHead>Phone</TableHead>
                <TableHead>Course</TableHead>
                <TableHead>Campus</TableHead>
                <TableHead>Counsellor</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Reg. No</TableHead>
                <TableHead>Doc</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                Array.from({ length: 6 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell colSpan={9}>
                      <Skeleton className="h-5 w-full" />
                    </TableCell>
                  </TableRow>
                ))
              ) : visible.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={9} className="py-10 text-center text-sm text-muted-foreground">
                    No exam registrations found.
                  </TableCell>
                </TableRow>
              ) : (
                visible.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-medium">{EXAM_SHORT_LABELS[r.exam_code]}</TableCell>
                    <TableCell>{r.lead_name}</TableCell>
                    <TableCell className="whitespace-nowrap">{r.phone}</TableCell>
                    <TableCell>{r.course_name}</TableCell>
                    <TableCell>{r.campus_name}</TableCell>
                    <TableCell>{r.counsellor_name}</TableCell>
                    <TableCell>
                      <span
                        className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${examStatusClass(
                          r.status,
                        )}`}
                      >
                        {examStatusLabel(r.status)}
                      </span>
                    </TableCell>
                    <TableCell>{r.registration_no || "—"}</TableCell>
                    <TableCell>
                      {r.document_url ? (
                        <button
                          type="button"
                          onClick={() => openDoc(r.document_url!)}
                          className="text-primary hover:underline"
                          title="Open registration document"
                        >
                          <FileText className="h-4 w-4" />
                        </button>
                      ) : (
                        "—"
                      )}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </Card>
    </div>
  );
};

export default Exams;
