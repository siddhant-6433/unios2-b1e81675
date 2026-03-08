import { useState, useEffect } from "react";
import { useParams, Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ArrowLeft, User, Phone, Mail, MapPin, Calendar, Heart, GraduationCap, Check, X, Clock, BookOpen, Loader2 } from "lucide-react";

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
    // Find student by admission_no or pre_admission_no
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
      // Fetch related data
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
  const attendanceTotal = attendance.length;
  const attendancePct = attendanceTotal > 0 ? Math.round((attendancePresent / attendanceTotal) * 100) : 0;
  const totalFee = fees.reduce((s, f) => s + Number(f.total_amount || 0), 0);
  const totalPaid = fees.reduce((s, f) => s + Number(f.paid_amount || 0), 0);
  const totalBalance = fees.reduce((s, f) => s + Number(f.balance || 0), 0);
  const displayNo = student.admission_no || student.pre_admission_no || "—";

  const statusBg: Record<string, string> = { present: "bg-pastel-green text-foreground/80", absent: "bg-pastel-red text-foreground/80", late: "bg-pastel-yellow text-foreground/80" };
  const feeStatusBg: Record<string, string> = { paid: "bg-pastel-green text-foreground/80", due: "bg-pastel-yellow text-foreground/80", overdue: "bg-pastel-red text-foreground/80" };
  const gradeColor = (grade: string) => {
    if (!grade) return "bg-muted text-foreground/80";
    if (grade.startsWith("A")) return "bg-pastel-green text-foreground/80";
    if (grade.startsWith("B")) return "bg-pastel-blue text-foreground/80";
    return "bg-pastel-yellow text-foreground/80";
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <Link to="/students" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors">
        <ArrowLeft className="h-4 w-4" />Back to Students
      </Link>

      <div className="rounded-xl bg-card card-shadow p-6">
        <div className="flex flex-col sm:flex-row gap-5">
          <div className="flex h-20 w-20 items-center justify-center rounded-2xl bg-primary/10 text-2xl font-bold text-primary shrink-0">
            {student.name.split(" ").map((n: string) => n[0]).join("").slice(0, 2)}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-xl font-bold text-foreground">{student.name}</h1>
              <span className={`rounded-md px-2.5 py-0.5 text-[11px] font-semibold capitalize ${student.status === "active" ? "bg-pastel-green text-foreground/80" : "bg-pastel-red text-foreground/80"}`}>
                {student.status.replace("_", " ")}
              </span>
            </div>
            <p className="text-sm text-muted-foreground mt-0.5 font-mono">{displayNo}</p>
            <div className="flex flex-wrap gap-x-5 gap-y-1.5 mt-3 text-sm text-muted-foreground">
              <span className="flex items-center gap-1.5"><GraduationCap className="h-3.5 w-3.5" />{student.courses?.name || "—"}</span>
              <span className="flex items-center gap-1.5"><BookOpen className="h-3.5 w-3.5" />{student.batches?.name || "—"}</span>
              <span className="flex items-center gap-1.5"><MapPin className="h-3.5 w-3.5" />{student.campuses?.name || "—"}</span>
            </div>
          </div>
          <div className="flex sm:flex-col gap-4 sm:gap-2 sm:items-end shrink-0">
            <div className="text-right"><p className="text-[11px] text-muted-foreground">Attendance</p><p className="text-lg font-bold text-foreground">{attendancePct}%</p></div>
            <div className="text-right"><p className="text-[11px] text-muted-foreground">Fee Balance</p><p className="text-lg font-bold text-foreground">₹{totalBalance.toLocaleString("en-IN")}</p></div>
          </div>
        </div>
      </div>

      <Tabs defaultValue="details" className="w-full">
        <TabsList className="bg-card border border-border rounded-xl p-1 h-auto flex-wrap">
          <TabsTrigger value="details" className="rounded-lg text-sm data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">Basic Details</TabsTrigger>
          <TabsTrigger value="fees" className="rounded-lg text-sm data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">Fee Ledger</TabsTrigger>
          <TabsTrigger value="attendance" className="rounded-lg text-sm data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">Attendance</TabsTrigger>
          <TabsTrigger value="exams" className="rounded-lg text-sm data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">Exams</TabsTrigger>
        </TabsList>

        <TabsContent value="details">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
            <div className="rounded-xl bg-card card-shadow p-5 space-y-4">
              <h3 className="text-sm font-semibold text-foreground">Personal Information</h3>
              <div className="grid grid-cols-2 gap-y-3 gap-x-4 text-sm">
                <Detail label="Date of Birth" value={student.dob ? new Date(student.dob).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—"} />
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
              <StatCard label="Total Fee" value={`₹${totalFee.toLocaleString("en-IN")}`} bg="bg-pastel-blue" />
              <StatCard label="Paid" value={`₹${totalPaid.toLocaleString("en-IN")}`} bg="bg-pastel-green" />
              <StatCard label="Balance" value={`₹${totalBalance.toLocaleString("en-IN")}`} bg={totalBalance > 0 ? "bg-pastel-red" : "bg-pastel-green"} />
            </div>
            <div className="rounded-xl bg-card card-shadow overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left">
                    <th className="px-4 py-3 font-medium text-muted-foreground">Fee Code</th>
                    <th className="px-4 py-3 font-medium text-muted-foreground">Term</th>
                    <th className="px-4 py-3 font-medium text-muted-foreground text-right">Total</th>
                    <th className="px-4 py-3 font-medium text-muted-foreground text-right">Concession</th>
                    <th className="px-4 py-3 font-medium text-muted-foreground text-right">Paid</th>
                    <th className="px-4 py-3 font-medium text-muted-foreground text-right">Balance</th>
                    <th className="px-4 py-3 font-medium text-muted-foreground">Due Date</th>
                    <th className="px-4 py-3 font-medium text-muted-foreground">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {fees.length === 0 ? (
                    <tr><td colSpan={8} className="px-4 py-8 text-center text-muted-foreground">No fee records found</td></tr>
                  ) : fees.map((f: any) => (
                    <tr key={f.id} className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors">
                      <td className="px-4 py-3 font-medium text-foreground">{f.fee_codes?.code || "—"}</td>
                      <td className="px-4 py-3 text-muted-foreground">{f.term}</td>
                      <td className="px-4 py-3 text-right text-foreground">₹{Number(f.total_amount).toLocaleString("en-IN")}</td>
                      <td className="px-4 py-3 text-right text-muted-foreground">₹{Number(f.concession).toLocaleString("en-IN")}</td>
                      <td className="px-4 py-3 text-right text-foreground">₹{Number(f.paid_amount).toLocaleString("en-IN")}</td>
                      <td className="px-4 py-3 text-right font-medium text-foreground">₹{Number(f.balance || 0).toLocaleString("en-IN")}</td>
                      <td className="px-4 py-3 text-muted-foreground">{f.due_date ? new Date(f.due_date).toLocaleDateString("en-IN", { day: "2-digit", month: "short" }) : "—"}</td>
                      <td className="px-4 py-3">
                        <span className={`rounded-md px-2 py-0.5 text-[10px] font-semibold capitalize ${feeStatusBg[f.status] || "bg-muted"}`}>{f.status}</span>
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
              <StatCard label="Total Classes" value={String(attendanceTotal)} bg="bg-pastel-blue" />
              <StatCard label="Present" value={String(attendancePresent)} bg="bg-pastel-green" />
              <StatCard label="Absent" value={String(attendance.filter(a => a.status === "absent").length)} bg="bg-pastel-red" />
              <StatCard label="Late" value={String(attendance.filter(a => a.status === "late").length)} bg="bg-pastel-yellow" />
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
                        <span className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[10px] font-semibold capitalize ${statusBg[a.status] || "bg-muted"}`}>
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
                    <th className="px-4 py-3 font-medium text-muted-foreground text-center">Max Marks</th>
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
                        <span className={`rounded-md px-2 py-0.5 text-[10px] font-semibold ${gradeColor(e.grade || "")}`}>{e.grade || "—"}</span>
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

const StatCard = ({ label, value, bg }: { label: string; value: string; bg: string }) => (
  <div className="rounded-xl bg-card card-shadow p-4 flex items-center gap-3">
    <div className={`flex h-9 w-9 items-center justify-center rounded-xl ${bg}`}>
      <span className="text-xs font-bold text-foreground/70">{value.charAt(0) === "₹" ? "₹" : "#"}</span>
    </div>
    <div>
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className="text-lg font-bold text-foreground">{value}</p>
    </div>
  </div>
);

export default StudentProfile;
