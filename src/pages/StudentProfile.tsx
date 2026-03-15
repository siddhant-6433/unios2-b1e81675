import { useState, useEffect } from "react";
import { useParams, Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ArrowLeft, User, Phone, Mail, MapPin, Calendar, Heart, GraduationCap, Check, X, Clock, BookOpen, Loader2, TrendingUp, BarChart3, Activity, Filter } from "lucide-react";
import { Button } from "@/components/ui/button";

const StudentProfile = () => {
  const { admissionNo } = useParams<{ admissionNo: string }>();
  const [student, setStudent] = useState<any>(null);
  const [fees, setFees] = useState<any[]>([]);
  const [attendance, setAttendance] = useState<any[]>([]);
  const [exams, setExams] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => { if (admissionNo) fetchStudent(); }, [admissionNo]);

  const fetchStudent = async () => {
    setLoading(true);
    let { data } = await supabase.from("students")
      .select("*, courses:course_id(name), campuses:campus_id(name), batches:batch_id(name), admission_sessions:session_id(name)")
      .eq("admission_no", admissionNo)
      .maybeSingle();

    if (!data) {
      const res = await supabase.from("students")
        .select("*, courses:course_id(name), campuses:campus_id(name), batches:batch_id(name), admission_sessions:session_id(name)")
        .eq("pre_admission_no", admissionNo)
        .maybeSingle();
      data = res.data;
    }

    if (data) {
      setStudent(data);
      const [feesRes, attendanceRes, examsRes] = await Promise.all([
        supabase.from("fee_ledger").select("*, fee_codes:fee_code_id(code, name, category)").eq("student_id", data.id).order("due_date"),
        supabase.from("daily_attendance").select("*").eq("student_id", data.id).order("date", { ascending: false }).limit(50),
        supabase.from("exam_records").select("*").eq("student_id", data.id).order("exam_date", { ascending: false }),
      ]);
      if (feesRes.data) setFees(feesRes.data);
      if (attendanceRes.data) setAttendance(attendanceRes.data);
      if (examsRes.data) setExams(examsRes.data);
    }
    setLoading(false);
  };

  if (loading) return <div className="flex h-64 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;

  if (!student) {
    return (
      <div className="flex flex-col items-center justify-center py-20 animate-fade-in">
        <User className="h-16 w-16 text-muted-foreground/30 mb-4" />
        <h2 className="text-lg font-semibold text-foreground">Student not found</h2>
        <p className="text-sm text-muted-foreground mt-1">No student with admission number "{admissionNo}"</p>
        <Link to="/students" className="mt-4 text-sm font-medium text-primary hover:underline">← Back to Students</Link>
      </div>
    );
  }

  const attendancePresent = attendance.filter(a => a.status === "present").length;
  const attendanceAbsent = attendance.filter(a => a.status === "absent").length;
  const attendanceTotal = attendance.length;
  const attendancePct = attendanceTotal > 0 ? Math.round((attendancePresent / attendanceTotal) * 100) : 0;
  const totalFee = fees.reduce((s, f) => s + Number(f.total_amount || 0), 0);
  const totalPaid = fees.reduce((s, f) => s + Number(f.paid_amount || 0), 0);
  const totalBalance = fees.reduce((s, f) => s + Number(f.balance || 0), 0);
  const displayNo = student.admission_no || student.pre_admission_no || "—";
  const avgScore = exams.length > 0 ? (exams.reduce((s, e) => s + (e.max_marks > 0 ? (e.obtained_marks / e.max_marks) * 100 : 0), 0) / exams.length).toFixed(1) : "0";
  const initials = student.name.split(" ").map((n: string) => n[0]).join("").slice(0, 2).toUpperCase();

  const statusBg: Record<string, string> = { present: "bg-success/10 text-success", absent: "bg-destructive/10 text-destructive", late: "bg-warning/10 text-warning" };
  const feeStatusBg: Record<string, string> = { paid: "bg-success/10 text-success", due: "bg-warning/10 text-warning", overdue: "bg-destructive/10 text-destructive" };
  const gradeColor = (grade: string) => {
    if (!grade) return "bg-muted text-foreground/60";
    if (grade.startsWith("A")) return "bg-success/10 text-success";
    if (grade.startsWith("B")) return "bg-info/10 text-info";
    return "bg-warning/10 text-warning";
  };

  return (
    <div className="space-y-5 animate-fade-in">
      <Link to="/students" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors">
        <ArrowLeft className="h-4 w-4" />Back to Students
      </Link>

      {/* Profile Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10 text-xl font-bold text-primary shrink-0">
            {initials}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold text-foreground">{student.name}</h1>
              <span className={`rounded-md px-2 py-0.5 text-[10px] font-semibold capitalize ${student.status === "active" ? "bg-success/10 text-success" : "bg-destructive/10 text-destructive"}`}>
                {student.status.replace("_", " ")}
              </span>
            </div>
            <p className="text-sm text-muted-foreground mt-0.5">Here's a look at performance and analytics · <span className="font-mono">{displayNo}</span></p>
          </div>
        </div>
        <Button variant="outline" size="sm" className="gap-2 rounded-lg">
          <Filter className="h-3.5 w-3.5" /> Filter
        </Button>
      </div>

      {/* Stats Cards Row */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="rounded-xl bg-card card-shadow p-5">
          <div className="flex items-center justify-between mb-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-success/10">
              <TrendingUp className="h-4 w-4 text-success" />
            </div>
            <span className="text-[10px] font-medium text-success bg-success/10 px-2 py-0.5 rounded-full">+{attendancePct}%</span>
          </div>
          <p className="text-2xl font-bold text-foreground">{attendancePct}%</p>
          <p className="text-xs text-muted-foreground mt-0.5">Attendance rate</p>
          {/* Mini sparkline placeholder */}
          <div className="flex items-end gap-0.5 mt-3 h-6">
            {[40, 60, 45, 70, 85, 65, 90, 75, 80, 95].map((h, i) => (
              <div key={i} className="flex-1 rounded-sm bg-success/20" style={{ height: `${h}%` }} />
            ))}
          </div>
        </div>

        <div className="rounded-xl bg-card card-shadow p-5">
          <div className="flex items-center justify-between mb-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-chart-5/10">
              <BarChart3 className="h-4 w-4 text-chart-5" />
            </div>
            <span className="text-[10px] font-medium text-chart-5 bg-chart-5/10 px-2 py-0.5 rounded-full">{exams.length} exams</span>
          </div>
          <p className="text-2xl font-bold text-foreground">{avgScore}%</p>
          <p className="text-xs text-muted-foreground mt-0.5">Average exam score</p>
          {/* Mini bar chart */}
          <div className="flex items-end gap-1 mt-3 h-6">
            {exams.slice(0, 8).map((e, i) => (
              <div key={i} className="flex-1 rounded-sm bg-chart-5/20" style={{ height: `${e.max_marks > 0 ? (e.obtained_marks / e.max_marks) * 100 : 30}%` }} />
            ))}
            {exams.length === 0 && Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="flex-1 rounded-sm bg-muted" style={{ height: "20%" }} />
            ))}
          </div>
        </div>

        <div className="rounded-xl bg-card card-shadow p-5">
          <div className="flex items-center justify-between mb-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-chart-2/10">
              <Activity className="h-4 w-4 text-chart-2" />
            </div>
          </div>
          <div className="flex items-baseline gap-3">
            <div className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-success" />
              <span className="text-lg font-bold text-foreground">{attendancePresent}</span>
              <span className="text-[11px] text-muted-foreground">Present</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-destructive" />
              <span className="text-lg font-bold text-foreground">{attendanceAbsent}</span>
              <span className="text-[11px] text-muted-foreground">Absent</span>
            </div>
          </div>
          <p className="text-xs text-muted-foreground mt-1">Activity summary</p>
          <div className="flex gap-1 mt-3">
            <div className="h-2 rounded-full bg-success flex-1" style={{ flex: attendancePresent || 1 }} />
            <div className="h-2 rounded-full bg-destructive" style={{ flex: attendanceAbsent || 1 }} />
          </div>
        </div>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="details" className="w-full">
        <TabsList className="bg-card border border-border rounded-lg p-1 h-auto flex-wrap">
          <TabsTrigger value="details" className="rounded-md text-xs data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">Details</TabsTrigger>
          <TabsTrigger value="fees" className="rounded-md text-xs data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">Fee Ledger</TabsTrigger>
          <TabsTrigger value="attendance" className="rounded-md text-xs data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">Attendance</TabsTrigger>
          <TabsTrigger value="exams" className="rounded-md text-xs data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">Exams</TabsTrigger>
        </TabsList>

        <TabsContent value="details">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
            <div className="rounded-xl bg-card card-shadow p-5 space-y-4">
              <h3 className="text-sm font-semibold text-foreground">Personal Information</h3>
              <div className="grid grid-cols-2 gap-y-3 gap-x-4 text-sm">
                <Detail label="Date of Birth" value={student.dob ? (() => { const d = new Date(student.dob); const dd = String(d.getDate()).padStart(2, '0'); const mm = String(d.getMonth() + 1).padStart(2, '0'); const yy = String(d.getFullYear()).slice(-2); return `${dd}/${mm}/${yy}`; })() : "—"} />
                <Detail label="Gender" value={student.gender || "—"} />
                <Detail label="Blood Group" value={student.blood_group || "—"} />
                <Detail label="Phone" value={student.phone || "—"} />
                <Detail label="Email" value={student.email || "—"} />
                <Detail label="Address" value={student.address || "—"} />
              </div>
            </div>
            <div className="rounded-xl bg-card card-shadow p-5 space-y-4">
              <h3 className="text-sm font-semibold text-foreground">Academic Information</h3>
              <div className="grid grid-cols-2 gap-y-3 gap-x-4 text-sm">
                <Detail label="Course" value={student.courses?.name || "—"} />
                <Detail label="Batch" value={student.batches?.name || "—"} />
                <Detail label="Session" value={student.admission_sessions?.name || "—"} />
                <Detail label="Campus" value={student.campuses?.name || "—"} />
                <Detail label="Admission Date" value={student.admission_date ? new Date(student.admission_date).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—"} />
              </div>
            </div>
            <div className="rounded-xl bg-card card-shadow p-5 space-y-4 md:col-span-2">
              <h3 className="text-sm font-semibold text-foreground">Guardian Information</h3>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-y-3 gap-x-4 text-sm">
                <Detail label="Guardian Name" value={student.guardian_name || "—"} />
                <Detail label="Guardian Phone" value={student.guardian_phone || "—"} />
              </div>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="fees">
          <div className="mt-4 space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <StatCard label="Total Fee" value={`₹${totalFee.toLocaleString("en-IN")}`} icon={<span className="text-xs font-bold">₹</span>} color="bg-chart-5/10 text-chart-5" />
              <StatCard label="Paid" value={`₹${totalPaid.toLocaleString("en-IN")}`} icon={<Check className="h-3.5 w-3.5" />} color="bg-success/10 text-success" />
              <StatCard label="Balance" value={`₹${totalBalance.toLocaleString("en-IN")}`} icon={<Clock className="h-3.5 w-3.5" />} color={totalBalance > 0 ? "bg-destructive/10 text-destructive" : "bg-success/10 text-success"} />
            </div>
            <div className="rounded-xl bg-card card-shadow overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left">
                    <th className="px-4 py-3 font-medium text-muted-foreground">Fee Code</th>
                    <th className="px-4 py-3 font-medium text-muted-foreground">Term</th>
                    <th className="px-4 py-3 font-medium text-muted-foreground text-right">Total</th>
                    <th className="px-4 py-3 font-medium text-muted-foreground text-right">Paid</th>
                    <th className="px-4 py-3 font-medium text-muted-foreground text-right">Balance</th>
                    <th className="px-4 py-3 font-medium text-muted-foreground">Due Date</th>
                    <th className="px-4 py-3 font-medium text-muted-foreground">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {fees.length === 0 ? (
                    <tr><td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">No fee records found</td></tr>
                  ) : fees.map((f: any) => (
                    <tr key={f.id} className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors">
                      <td className="px-4 py-3 font-medium text-foreground">{f.fee_codes?.code || "—"}</td>
                      <td className="px-4 py-3 text-muted-foreground">{f.term}</td>
                      <td className="px-4 py-3 text-right text-foreground">₹{Number(f.total_amount).toLocaleString("en-IN")}</td>
                      <td className="px-4 py-3 text-right text-foreground">₹{Number(f.paid_amount).toLocaleString("en-IN")}</td>
                      <td className="px-4 py-3 text-right font-medium text-foreground">₹{Number(f.balance || 0).toLocaleString("en-IN")}</td>
                      <td className="px-4 py-3 text-muted-foreground">{f.due_date ? new Date(f.due_date).toLocaleDateString("en-IN", { day: "2-digit", month: "short" }) : "—"}</td>
                      <td className="px-4 py-3">
                        <span className={`rounded-full px-2.5 py-0.5 text-[10px] font-semibold capitalize ${feeStatusBg[f.status] || "bg-muted"}`}>{f.status}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="attendance">
          <div className="mt-4 space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
              <StatCard label="Total Classes" value={String(attendanceTotal)} icon={<BookOpen className="h-3.5 w-3.5" />} color="bg-chart-5/10 text-chart-5" />
              <StatCard label="Present" value={String(attendancePresent)} icon={<Check className="h-3.5 w-3.5" />} color="bg-success/10 text-success" />
              <StatCard label="Absent" value={String(attendanceAbsent)} icon={<X className="h-3.5 w-3.5" />} color="bg-destructive/10 text-destructive" />
              <StatCard label="Late" value={String(attendance.filter(a => a.status === "late").length)} icon={<Clock className="h-3.5 w-3.5" />} color="bg-warning/10 text-warning" />
            </div>
            <div className="rounded-xl bg-card card-shadow overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left">
                    <th className="px-4 py-3 font-medium text-muted-foreground">Date</th>
                    <th className="px-4 py-3 font-medium text-muted-foreground">Subject</th>
                    <th className="px-4 py-3 font-medium text-muted-foreground">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {attendance.length === 0 ? (
                    <tr><td colSpan={3} className="px-4 py-8 text-center text-muted-foreground">No attendance records</td></tr>
                  ) : attendance.map((a: any) => (
                    <tr key={a.id} className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors">
                      <td className="px-4 py-3 text-foreground">{new Date(a.date).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}</td>
                      <td className="px-4 py-3 text-muted-foreground">{a.subject || "—"}</td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[10px] font-semibold capitalize ${statusBg[a.status] || "bg-muted"}`}>
                          {a.status === "present" && <Check className="h-3 w-3" />}
                          {a.status === "absent" && <X className="h-3 w-3" />}
                          {a.status === "late" && <Clock className="h-3 w-3" />}
                          {a.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="exams">
          <div className="mt-4 space-y-4">
            <div className="rounded-xl bg-card card-shadow overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left">
                    <th className="px-4 py-3 font-medium text-muted-foreground">Subject</th>
                    <th className="px-4 py-3 font-medium text-muted-foreground">Exam Type</th>
                    <th className="px-4 py-3 font-medium text-muted-foreground text-center">Max</th>
                    <th className="px-4 py-3 font-medium text-muted-foreground text-center">Obtained</th>
                    <th className="px-4 py-3 font-medium text-muted-foreground text-center">%</th>
                    <th className="px-4 py-3 font-medium text-muted-foreground">Grade</th>
                    <th className="px-4 py-3 font-medium text-muted-foreground">Date</th>
                  </tr>
                </thead>
                <tbody>
                  {exams.length === 0 ? (
                    <tr><td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">No exam records</td></tr>
                  ) : exams.map((e: any) => (
                    <tr key={e.id} className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors">
                      <td className="px-4 py-3 font-medium text-foreground">{e.subject}</td>
                      <td className="px-4 py-3 text-muted-foreground capitalize">{(e.exam_type || "").replace("_", " ")}</td>
                      <td className="px-4 py-3 text-center text-foreground">{e.max_marks}</td>
                      <td className="px-4 py-3 text-center font-medium text-foreground">{e.obtained_marks}</td>
                      <td className="px-4 py-3 text-center text-muted-foreground">{e.max_marks > 0 ? Math.round((e.obtained_marks / e.max_marks) * 100) : 0}%</td>
                      <td className="px-4 py-3">
                        <span className={`rounded-full px-2.5 py-0.5 text-[10px] font-semibold ${gradeColor(e.grade || "")}`}>{e.grade || "—"}</span>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">{e.exam_date ? new Date(e.exam_date).toLocaleDateString("en-IN", { day: "2-digit", month: "short" }) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
};

const Detail = ({ label, value }: { label: string; value: string }) => (
  <div>
    <p className="text-[11px] text-muted-foreground">{label}</p>
    <p className="text-sm font-medium text-foreground mt-0.5">{value}</p>
  </div>
);

const StatCard = ({ label, value, icon, color }: { label: string; value: string; icon: React.ReactNode; color: string }) => (
  <div className="rounded-xl bg-card card-shadow p-4 flex items-center gap-3">
    <div className={`flex h-9 w-9 items-center justify-center rounded-xl ${color}`}>
      {icon}
    </div>
    <div>
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className="text-lg font-bold text-foreground">{value}</p>
    </div>
  </div>
);

export default StudentProfile;
