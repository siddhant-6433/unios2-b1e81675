import { useParams, Link } from "react-router-dom";
import { mockStudentProfiles, mockFees, mockExamRecords, mockAttendanceHistory } from "@/data/mockData";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ArrowLeft, User, Phone, Mail, MapPin, Calendar, Heart, GraduationCap, Check, X, Clock, BookOpen } from "lucide-react";

const StudentProfile = () => {
  const { admissionNo } = useParams<{ admissionNo: string }>();
  const student = mockStudentProfiles.find((s) => s.admissionNo === admissionNo);

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

  const fees = mockFees.filter((f) => f.admissionNo === student.admissionNo);
  const exams = mockExamRecords.filter((e) => e.admissionNo === student.admissionNo);
  const attendance = mockAttendanceHistory.filter((a) => a.admissionNo === student.admissionNo);

  const attendancePresent = attendance.filter((a) => a.status === "Present").length;
  const attendanceTotal = attendance.length;
  const attendancePct = attendanceTotal > 0 ? Math.round((attendancePresent / attendanceTotal) * 100) : 0;

  const totalFee = fees.reduce((s, f) => s + f.totalAmount, 0);
  const totalPaid = fees.reduce((s, f) => s + f.paidAmount, 0);
  const totalBalance = fees.reduce((s, f) => s + f.balance, 0);

  const statusBg: Record<string, string> = {
    Present: "bg-pastel-green text-foreground/80",
    Absent: "bg-pastel-red text-foreground/80",
    Late: "bg-pastel-yellow text-foreground/80",
  };

  const feeStatusBg: Record<string, string> = {
    Paid: "bg-pastel-green text-foreground/80",
    Due: "bg-pastel-yellow text-foreground/80",
    Overdue: "bg-pastel-red text-foreground/80",
  };

  const gradeColor = (grade: string) => {
    if (grade.startsWith("A")) return "bg-pastel-green text-foreground/80";
    if (grade.startsWith("B")) return "bg-pastel-blue text-foreground/80";
    return "bg-pastel-yellow text-foreground/80";
  };

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Back link */}
      <Link to="/students" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors">
        <ArrowLeft className="h-4 w-4" />
        Back to Students
      </Link>

      {/* Header Card */}
      <div className="rounded-xl bg-card card-shadow p-6">
        <div className="flex flex-col sm:flex-row gap-5">
          <div className="flex h-20 w-20 items-center justify-center rounded-2xl bg-primary/10 text-2xl font-bold text-primary shrink-0">
            {student.name.split(" ").map((n) => n[0]).join("")}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-xl font-bold text-foreground">{student.name}</h1>
              <span className={`rounded-md px-2.5 py-0.5 text-[11px] font-semibold ${student.status === "Active" ? "bg-pastel-green text-foreground/80" : "bg-pastel-red text-foreground/80"}`}>
                {student.status}
              </span>
            </div>
            <p className="text-sm text-muted-foreground mt-0.5 font-mono">{student.admissionNo}</p>
            <div className="flex flex-wrap gap-x-5 gap-y-1.5 mt-3 text-sm text-muted-foreground">
              <span className="flex items-center gap-1.5"><GraduationCap className="h-3.5 w-3.5" />{student.course}</span>
              <span className="flex items-center gap-1.5"><BookOpen className="h-3.5 w-3.5" />{student.batch}</span>
              <span className="flex items-center gap-1.5"><MapPin className="h-3.5 w-3.5" />{student.campus}</span>
            </div>
          </div>

          {/* Quick stats */}
          <div className="flex sm:flex-col gap-4 sm:gap-2 sm:items-end shrink-0">
            <div className="text-right">
              <p className="text-[11px] text-muted-foreground">Attendance</p>
              <p className="text-lg font-bold text-foreground">{attendancePct}%</p>
            </div>
            <div className="text-right">
              <p className="text-[11px] text-muted-foreground">Fee Balance</p>
              <p className="text-lg font-bold text-foreground">₹{totalBalance.toLocaleString("en-IN")}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="details" className="w-full">
        <TabsList className="bg-card border border-border rounded-xl p-1 h-auto flex-wrap">
          <TabsTrigger value="details" className="rounded-lg text-sm data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">Basic Details</TabsTrigger>
          <TabsTrigger value="fees" className="rounded-lg text-sm data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">Fee Ledger</TabsTrigger>
          <TabsTrigger value="attendance" className="rounded-lg text-sm data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">Attendance</TabsTrigger>
          <TabsTrigger value="exams" className="rounded-lg text-sm data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">Exams</TabsTrigger>
        </TabsList>

        {/* Basic Details */}
        <TabsContent value="details">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
            <div className="rounded-xl bg-card card-shadow p-5 space-y-4">
              <h3 className="text-sm font-semibold text-foreground">Personal Information</h3>
              <div className="grid grid-cols-2 gap-y-3 gap-x-4 text-sm">
                <Detail label="Date of Birth" value={new Date(student.dob).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })} />
                <Detail label="Gender" value={student.gender} />
                <Detail label="Blood Group" value={student.bloodGroup} />
                <Detail label="Phone" value={student.phone} />
                <Detail label="Email" value={student.email} />
                <Detail label="Address" value={student.address} />
              </div>
            </div>
            <div className="rounded-xl bg-card card-shadow p-5 space-y-4">
              <h3 className="text-sm font-semibold text-foreground">Academic Information</h3>
              <div className="grid grid-cols-2 gap-y-3 gap-x-4 text-sm">
                <Detail label="Course" value={student.course} />
                <Detail label="Department" value={student.department} />
                <Detail label="Batch" value={student.batch} />
                <Detail label="Session" value={student.session} />
                <Detail label="Campus" value={student.campus} />
                <Detail label="Admission Date" value={new Date(student.admissionDate).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })} />
              </div>
            </div>
            <div className="rounded-xl bg-card card-shadow p-5 space-y-4 md:col-span-2">
              <h3 className="text-sm font-semibold text-foreground">Guardian Information</h3>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-y-3 gap-x-4 text-sm">
                <Detail label="Father's Name" value={student.fatherName} />
                <Detail label="Mother's Name" value={student.motherName} />
              </div>
            </div>
          </div>
        </TabsContent>

        {/* Fee Ledger */}
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
                  ) : fees.map((f) => (
                    <tr key={f.id} className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors">
                      <td className="px-4 py-3 font-medium text-foreground">{f.feeCode}</td>
                      <td className="px-4 py-3 text-muted-foreground">{f.term}</td>
                      <td className="px-4 py-3 text-right text-foreground">₹{f.totalAmount.toLocaleString("en-IN")}</td>
                      <td className="px-4 py-3 text-right text-muted-foreground">₹{f.concession.toLocaleString("en-IN")}</td>
                      <td className="px-4 py-3 text-right text-foreground">₹{f.paidAmount.toLocaleString("en-IN")}</td>
                      <td className="px-4 py-3 text-right font-medium text-foreground">₹{f.balance.toLocaleString("en-IN")}</td>
                      <td className="px-4 py-3 text-muted-foreground">{new Date(f.dueDate).toLocaleDateString("en-IN", { day: "2-digit", month: "short" })}</td>
                      <td className="px-4 py-3">
                        <span className={`rounded-md px-2 py-0.5 text-[10px] font-semibold ${feeStatusBg[f.status]}`}>{f.status}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </TabsContent>

        {/* Attendance */}
        <TabsContent value="attendance">
          <div className="mt-4 space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
              <StatCard label="Total Classes" value={String(attendanceTotal)} bg="bg-pastel-blue" />
              <StatCard label="Present" value={String(attendancePresent)} bg="bg-pastel-green" />
              <StatCard label="Absent" value={String(attendance.filter((a) => a.status === "Absent").length)} bg="bg-pastel-red" />
              <StatCard label="Late" value={String(attendance.filter((a) => a.status === "Late").length)} bg="bg-pastel-yellow" />
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
                  ) : attendance.map((a) => (
                    <tr key={a.id} className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors">
                      <td className="px-4 py-3 text-foreground">{new Date(a.date).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}</td>
                      <td className="px-4 py-3 text-muted-foreground">{a.subject}</td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[10px] font-semibold ${statusBg[a.status]}`}>
                          {a.status === "Present" && <Check className="h-3 w-3" />}
                          {a.status === "Absent" && <X className="h-3 w-3" />}
                          {a.status === "Late" && <Clock className="h-3 w-3" />}
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

        {/* Exams */}
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
                  ) : exams.map((e) => (
                    <tr key={e.id} className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors">
                      <td className="px-4 py-3 font-medium text-foreground">{e.subject}</td>
                      <td className="px-4 py-3 text-muted-foreground">{e.examType}</td>
                      <td className="px-4 py-3 text-center text-foreground">{e.maxMarks}</td>
                      <td className="px-4 py-3 text-center font-medium text-foreground">{e.obtained}</td>
                      <td className="px-4 py-3 text-center text-muted-foreground">{Math.round((e.obtained / e.maxMarks) * 100)}%</td>
                      <td className="px-4 py-3">
                        <span className={`rounded-md px-2 py-0.5 text-[10px] font-semibold ${gradeColor(e.grade)}`}>{e.grade}</span>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">{new Date(e.date).toLocaleDateString("en-IN", { day: "2-digit", month: "short" })}</td>
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
