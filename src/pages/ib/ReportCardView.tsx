import { useState, useEffect } from "react";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2, ArrowLeft, Printer, Download } from "lucide-react";

interface ReportCardData {
  id: string;
  student_id: string;
  batch_id: string;
  term: string;
  academic_year: string;
  status: string;
  homeroom_comment: string | null;
  coordinator_comment: string | null;
  principal_comment: string | null;
  attendance_summary: any;
  report_data: any;
  students: {
    name: string;
    admission_no: string | null;
    batch_id: string;
    batches: {
      name: string;
      course_id: string;
      courses: { name: string; code: string };
    } | null;
  } | null;
  ib_report_templates: any;
}

interface GradebookSnapshot {
  id: string;
  student_id: string;
  term: string;
  subject_group_id: string | null;
  subject_name: string | null;
  criterion_a: number | null;
  criterion_b: number | null;
  criterion_c: number | null;
  criterion_d: number | null;
  final_grade: number | null;
  teacher_comment: string | null;
  ib_myp_subject_groups: { name: string } | null;
}

const ReportCardView = () => {
  const { studentId, term } = useParams<{ studentId: string; term: string }>();
  const [searchParams] = useSearchParams();
  const academicYear = searchParams.get("year") || "2026-27";
  const navigate = useNavigate();
  const { toast } = useToast();

  const [report, setReport] = useState<ReportCardData | null>(null);
  const [snapshots, setSnapshots] = useState<GradebookSnapshot[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!studentId || !term) return;
    (async () => {
      setLoading(true);
      const [reportRes, snapRes] = await Promise.all([
        supabase
          .from("ib_report_cards")
          .select("*, students(name, admission_no, batch_id, batches(name, course_id, courses(name, code))), ib_report_templates(*)")
          .eq("student_id", studentId)
          .eq("term", term)
          .eq("academic_year", academicYear)
          .single(),
        supabase
          .from("ib_gradebook_snapshots")
          .select("*, ib_myp_subject_groups(name)")
          .eq("student_id", studentId)
          .eq("term", term),
      ]);
      if (reportRes.data) setReport(reportRes.data as any);
      if (snapRes.data) setSnapshots(snapRes.data as any);
      if (reportRes.error && reportRes.error.code !== "PGRST116") {
        toast({ title: "Error loading report", description: reportRes.error.message, variant: "destructive" });
      }
      setLoading(false);
    })();
  }, [studentId, term, academicYear, toast]);

  const isPYP = report?.students?.batches?.courses?.code?.includes("PYP");

  const handlePrint = () => window.print();
  const handleDownload = () => {
    toast({ title: "PDF generation coming soon", description: "This feature is under development." });
  };

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!report) {
    return (
      <div className="space-y-4">
        <Button variant="ghost" onClick={() => navigate("/ib/reports")} className="gap-1.5">
          <ArrowLeft className="h-4 w-4" /> Back to Reports
        </Button>
        <div className="rounded-xl border border-border bg-card p-12 text-center">
          <p className="text-sm text-muted-foreground">Report card not found.</p>
        </div>
      </div>
    );
  }

  const student = report.students;
  const attendance = report.attendance_summary as {
    total_days?: number;
    present?: number;
    absent?: number;
  } | null;
  const reportData = report.report_data as any;

  return (
    <div className="space-y-4 animate-fade-in">
      {/* Action Bar (hidden on print) */}
      <div className="flex items-center justify-between gap-4 flex-wrap print:hidden">
        <Button variant="ghost" onClick={() => navigate("/ib/reports")} className="gap-1.5">
          <ArrowLeft className="h-4 w-4" /> Back to Reports
        </Button>
        <div className="flex gap-2">
          <Button variant="outline" onClick={handlePrint} className="gap-1.5 text-sm">
            <Printer className="h-4 w-4" /> Print
          </Button>
          <Button variant="outline" onClick={handleDownload} className="gap-1.5 text-sm">
            <Download className="h-4 w-4" /> Download PDF
          </Button>
        </div>
      </div>

      {/* Print-ready Report */}
      <div className="max-w-[800px] mx-auto bg-white rounded-xl border border-border shadow-sm print:shadow-none print:border-0">
        {/* School Header */}
        <div className="border-b border-border p-8 text-center">
          <div className="flex items-center justify-center gap-4 mb-2">
            <div className="h-16 w-16 rounded-full bg-muted flex items-center justify-center text-muted-foreground text-xs">
              Logo
            </div>
            <div>
              <h1 className="text-xl font-bold text-foreground">Mirai Experiential School</h1>
              <p className="text-sm text-muted-foreground">IB World School</p>
            </div>
          </div>
          <div className="mt-3">
            <Badge variant="outline" className="text-sm">
              {isPYP ? "Primary Years Programme" : "Middle Years Programme"} Report Card
            </Badge>
          </div>
        </div>

        {/* Student Info */}
        <div className="border-b border-border p-6">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <div>
              <p className="text-muted-foreground text-xs">Student Name</p>
              <p className="font-medium text-foreground">{student?.name || "—"}</p>
            </div>
            <div>
              <p className="text-muted-foreground text-xs">Class</p>
              <p className="font-medium text-foreground">{student?.batches?.name || "—"}</p>
            </div>
            <div>
              <p className="text-muted-foreground text-xs">Admission No</p>
              <p className="font-medium text-foreground">{student?.admission_no || "—"}</p>
            </div>
            <div>
              <p className="text-muted-foreground text-xs">Academic Year</p>
              <p className="font-medium text-foreground">{report.academic_year}</p>
            </div>
            <div>
              <p className="text-muted-foreground text-xs">Term</p>
              <p className="font-medium text-foreground">{report.term}</p>
            </div>
            <div>
              <p className="text-muted-foreground text-xs">Programme</p>
              <p className="font-medium text-foreground">
                {student?.batches?.courses?.name || "—"}
              </p>
            </div>
          </div>
        </div>

        {/* Attendance */}
        {attendance && (
          <div className="border-b border-border p-6">
            <h2 className="text-sm font-semibold text-foreground mb-3">Attendance Summary</h2>
            <div className="grid grid-cols-3 gap-4 text-sm">
              <div className="rounded-xl bg-muted/50 p-3 text-center">
                <p className="text-lg font-bold text-foreground">{attendance.total_days ?? "—"}</p>
                <p className="text-xs text-muted-foreground">Total Days</p>
              </div>
              <div className="rounded-xl bg-green-50 p-3 text-center">
                <p className="text-lg font-bold text-green-700">{attendance.present ?? "—"}</p>
                <p className="text-xs text-muted-foreground">Present</p>
              </div>
              <div className="rounded-xl bg-red-50 p-3 text-center">
                <p className="text-lg font-bold text-red-700">{attendance.absent ?? "—"}</p>
                <p className="text-xs text-muted-foreground">Absent</p>
              </div>
            </div>
          </div>
        )}

        {/* PYP Section */}
        {isPYP && (
          <>
            {/* Unit Summaries */}
            {reportData?.unit_summaries && (
              <div className="border-b border-border p-6">
                <h2 className="text-sm font-semibold text-foreground mb-3">
                  Unit of Inquiry Summaries
                </h2>
                <div className="space-y-3">
                  {(reportData.unit_summaries as any[]).map((unit: any, i: number) => (
                    <div key={i} className="rounded-xl border border-border p-4">
                      <p className="text-xs font-medium text-muted-foreground mb-1">
                        {unit.transdisciplinary_theme}
                      </p>
                      <p className="text-sm font-medium text-foreground mb-1">{unit.title}</p>
                      <p className="text-sm text-muted-foreground">{unit.summary}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Achievement Levels by Subject */}
            {reportData?.subject_achievements && (
              <div className="border-b border-border p-6">
                <h2 className="text-sm font-semibold text-foreground mb-3">
                  Subject Achievement Levels
                </h2>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border">
                        <th className="text-left px-3 py-2 font-medium text-muted-foreground">Subject</th>
                        <th className="text-center px-3 py-2 font-medium text-muted-foreground">Level</th>
                        <th className="text-left px-3 py-2 font-medium text-muted-foreground">Comment</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(reportData.subject_achievements as any[]).map((sa: any, i: number) => (
                        <tr key={i} className="border-b border-border last:border-0">
                          <td className="px-3 py-2 font-medium text-foreground">{sa.subject}</td>
                          <td className="px-3 py-2 text-center">
                            <Badge variant="outline">{sa.level}</Badge>
                          </td>
                          <td className="px-3 py-2 text-muted-foreground">{sa.comment || "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* ATL Skills */}
            {reportData?.atl_skills && (
              <div className="border-b border-border p-6">
                <h2 className="text-sm font-semibold text-foreground mb-3">
                  Approaches to Learning (ATL) Skills
                </h2>
                <div className="grid grid-cols-2 gap-3">
                  {(reportData.atl_skills as any[]).map((skill: any, i: number) => (
                    <div key={i} className="flex justify-between items-center rounded-xl border border-border px-4 py-2">
                      <span className="text-sm text-foreground">{skill.name}</span>
                      <Badge variant="outline" className="text-xs">{skill.level}</Badge>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Learner Profile */}
            {reportData?.learner_profile && (
              <div className="border-b border-border p-6">
                <h2 className="text-sm font-semibold text-foreground mb-3">
                  Learner Profile Development
                </h2>
                <div className="space-y-2">
                  {(reportData.learner_profile as any[]).map((lp: any, i: number) => (
                    <div key={i} className="rounded-xl border border-border p-3">
                      <p className="text-sm font-medium text-foreground">{lp.attribute}</p>
                      <p className="text-xs text-muted-foreground mt-1">{lp.note}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        {/* MYP Section */}
        {!isPYP && snapshots.length > 0 && (
          <div className="border-b border-border p-6">
            <h2 className="text-sm font-semibold text-foreground mb-3">Subject Results</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left px-3 py-2 font-medium text-muted-foreground">Subject Group</th>
                    <th className="text-left px-3 py-2 font-medium text-muted-foreground">Subject</th>
                    <th className="text-center px-3 py-2 font-medium text-muted-foreground">A</th>
                    <th className="text-center px-3 py-2 font-medium text-muted-foreground">B</th>
                    <th className="text-center px-3 py-2 font-medium text-muted-foreground">C</th>
                    <th className="text-center px-3 py-2 font-medium text-muted-foreground">D</th>
                    <th className="text-center px-3 py-2 font-medium text-muted-foreground">Grade (1-7)</th>
                    <th className="text-left px-3 py-2 font-medium text-muted-foreground">Comment</th>
                  </tr>
                </thead>
                <tbody>
                  {snapshots.map((snap) => (
                    <tr key={snap.id} className="border-b border-border last:border-0">
                      <td className="px-3 py-2 text-muted-foreground">
                        {snap.ib_myp_subject_groups?.name || "—"}
                      </td>
                      <td className="px-3 py-2 font-medium text-foreground">
                        {snap.subject_name || "—"}
                      </td>
                      <td className="px-3 py-2 text-center">{snap.criterion_a ?? "—"}</td>
                      <td className="px-3 py-2 text-center">{snap.criterion_b ?? "—"}</td>
                      <td className="px-3 py-2 text-center">{snap.criterion_c ?? "—"}</td>
                      <td className="px-3 py-2 text-center">{snap.criterion_d ?? "—"}</td>
                      <td className="px-3 py-2 text-center">
                        <Badge variant="outline" className="text-sm font-bold">
                          {snap.final_grade ?? "—"}
                        </Badge>
                      </td>
                      <td className="px-3 py-2 text-muted-foreground text-xs max-w-[200px] truncate">
                        {snap.teacher_comment || "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Comments */}
        <div className="p-6 space-y-4">
          {report.homeroom_comment && (
            <div>
              <h3 className="text-xs font-semibold text-muted-foreground mb-1">
                Homeroom Teacher Comment
              </h3>
              <p className="text-sm text-foreground bg-muted/30 rounded-xl p-3">
                {report.homeroom_comment}
              </p>
            </div>
          )}
          {report.coordinator_comment && (
            <div>
              <h3 className="text-xs font-semibold text-muted-foreground mb-1">
                Coordinator Comment
              </h3>
              <p className="text-sm text-foreground bg-muted/30 rounded-xl p-3">
                {report.coordinator_comment}
              </p>
            </div>
          )}
          {report.principal_comment && (
            <div>
              <h3 className="text-xs font-semibold text-muted-foreground mb-1">
                Principal Comment
              </h3>
              <p className="text-sm text-foreground bg-muted/30 rounded-xl p-3">
                {report.principal_comment}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default ReportCardView;
