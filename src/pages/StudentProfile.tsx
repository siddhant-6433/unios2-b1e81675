import { useState, useEffect } from "react";
import { useParams, Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ArrowLeft, User, Phone, Mail, MapPin, Calendar, Heart, GraduationCap, Check, X, Clock, BookOpen, Loader2, TrendingUp, BarChart3, Activity, Filter, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StudentFeePanel } from "@/components/finance/StudentFeePanel";

const StudentProfile = () => {
  const { admissionNo } = useParams<{ admissionNo: string }>();
  const [student, setStudent] = useState<any>(null);
  const [fees, setFees] = useState<any[]>([]);
  const [attendance, setAttendance] = useState<any[]>([]);
  const [exams, setExams] = useState<any[]>([]);
  const [siblings, setSiblings] = useState<any[]>([]);
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

      // Sibling lookup
      const orParts: string[] = [];
      if (data.father_user_id) orParts.push(`father_user_id.eq.${data.father_user_id}`);
      if (data.mother_user_id) orParts.push(`mother_user_id.eq.${data.mother_user_id}`);
      if (data.guardian_user_id) orParts.push(`guardian_user_id.eq.${data.guardian_user_id}`);

      if (orParts.length > 0) {
        const { data: sibs } = await supabase.from("students")
          .select("id, name, admission_no, course_id, section, status, father_user_id, mother_user_id, guardian_user_id, courses:course_id(name)")
          .or(orParts.join(","))
          .neq("id", data.id);
        if (sibs) setSiblings(sibs.map(s => {
          const rels: string[] = [];
          if (data.father_user_id && s.father_user_id === data.father_user_id) rels.push("Same Father");
          if (data.mother_user_id && s.mother_user_id === data.mother_user_id) rels.push("Same Mother");
          if (data.guardian_user_id && s.guardian_user_id === data.guardian_user_id) rels.push("Same Guardian");
          return { ...s, relationship: rels.join(", ") || "Sibling" };
        }));
      } else {
        setSiblings([]);
      }
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

  const fmtDate = (v: string | null | undefined) => {
    if (!v) return "—";
    const d = new Date(v);
    return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
  };
  const bool = (v: any) => (v === true ? "Yes" : v === false ? "No" : "—");

  const statusBg: Record<string, string> = { present: "bg-success/10 text-success", absent: "bg-destructive/10 text-destructive", late: "bg-warning/10 text-warning" };
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
            {/* Personal Information */}
            <div className="rounded-xl bg-card card-shadow p-5 space-y-4 md:col-span-2">
              <h3 className="text-sm font-semibold text-foreground">Personal Information</h3>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-y-3 gap-x-4 text-sm">
                <Detail label="Full Name" value={student.name || "—"} />
                <Detail label="First Name" value={student.first_name || "—"} />
                <Detail label="Middle Name" value={student.middle_name || "—"} />
                <Detail label="Last Name" value={student.last_name || "—"} />
                <Detail label="Date of Birth" value={fmtDate(student.dob)} />
                <Detail label="Gender" value={student.gender || "—"} />
                <Detail label="Blood Group" value={student.blood_group || "—"} />
                <Detail label="Nationality" value={student.nationality || "—"} />
                <Detail label="Phone" value={student.phone || "—"} />
                <Detail label="WhatsApp No" value={student.whatsapp_no || "—"} />
                <Detail label="Email" value={student.email || "—"} />
                <Detail label="Student Email" value={student.student_email || "—"} />
                <Detail label="School Email" value={student.school_email || "—"} />
                <Detail label="Student Aadhar" value={student.student_aadhar || "—"} />
                <Detail label="Biometric ID" value={student.biometric_id || "—"} />
                <Detail label="Address" value={student.address || "—"} />
                <Detail label="City" value={student.city || "—"} />
                <Detail label="State" value={student.state || "—"} />
                <Detail label="Country" value={student.country || "—"} />
                <Detail label="Pincode" value={student.pincode || "—"} />
                <Detail label="Birth Place" value={student.birth_place || "—"} />
                <Detail label="Religion" value={student.religion || "—"} />
                <Detail label="Caste" value={student.caste || "—"} />
                <Detail label="Sub Caste" value={student.sub_caste || "—"} />
                <Detail label="Caste Category" value={student.caste_category || "—"} />
                <Detail label="Mother Tongue" value={student.mother_tongue || "—"} />
                <Detail label="Language Spoken" value={student.language_spoken || "—"} />
                <Detail label="Second Language" value={student.second_language || "—"} />
                <Detail label="Third Language" value={student.third_language || "—"} />
                <Detail label="House" value={student.house || "—"} />
                <Detail label="Sports" value={student.sports || "—"} />
                <Detail label="Food Habits" value={student.food_habits || "—"} />
                <Detail label="Student Type" value={student.student_type || "—"} />
                <Detail label="Hostel Type" value={student.hostel_type || "—"} />
                <Detail label="SR Number" value={student.sr_number || "—"} />
                <Detail label="School Admission No" value={student.school_admission_no || "—"} />
                <Detail label="Class Roll No" value={student.class_roll_no || "—"} />
              </div>
            </div>

            {/* Father's Information */}
            <div className="rounded-xl bg-card card-shadow p-5 space-y-4">
              <h3 className="text-sm font-semibold text-foreground">Father's Information</h3>
              <div className="grid grid-cols-2 gap-y-3 gap-x-4 text-sm">
                <Detail label="Father Name" value={student.father_name || "—"} />
                <Detail label="Father Phone" value={student.father_phone || "—"} />
                <Detail label="Father WhatsApp" value={student.father_whatsapp || "—"} />
                <Detail label="Father Email" value={student.father_email || "—"} />
                <Detail label="Occupation" value={student.father_occupation || "—"} />
                <Detail label="Designation" value={student.father_designation || "—"} />
                <Detail label="Organization" value={student.father_organization || "—"} />
                <Detail label="Qualification" value={student.father_qualification || "—"} />
                <Detail label="Income" value={student.father_income || "—"} />
                <Detail label="Father Aadhar" value={student.father_aadhar || "—"} />
              </div>
            </div>

            {/* Mother's Information */}
            <div className="rounded-xl bg-card card-shadow p-5 space-y-4">
              <h3 className="text-sm font-semibold text-foreground">Mother's Information</h3>
              <div className="grid grid-cols-2 gap-y-3 gap-x-4 text-sm">
                <Detail label="Mother Name" value={student.mother_name || "—"} />
                <Detail label="Mother Phone" value={student.mother_phone || "—"} />
                <Detail label="Mother WhatsApp" value={student.mother_whatsapp || "—"} />
                <Detail label="Mother Email" value={student.mother_email || "—"} />
                <Detail label="Occupation" value={student.mother_occupation || "—"} />
                <Detail label="Organization" value={student.mother_organization || "—"} />
                <Detail label="Mother Aadhar" value={student.mother_aadhar || "—"} />
              </div>
            </div>

            {/* Guardian Information */}
            <div className="rounded-xl bg-card card-shadow p-5 space-y-4 md:col-span-2">
              <h3 className="text-sm font-semibold text-foreground">Guardian Information</h3>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-y-3 gap-x-4 text-sm">
                <Detail label="Guardian Name" value={student.guardian_name || "—"} />
                <Detail label="Guardian Phone" value={student.guardian_phone || "—"} />
              </div>
            </div>

            {/* Siblings */}
            {siblings.length > 0 && (
              <div className="rounded-xl bg-card card-shadow p-5 space-y-4 md:col-span-2">
                <div className="flex items-center gap-2">
                  <Users className="h-4 w-4 text-muted-foreground" />
                  <h3 className="text-sm font-semibold text-foreground">Siblings</h3>
                </div>
                <div className="overflow-hidden rounded-lg border border-border">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border bg-muted/30 text-left">
                        <th className="px-4 py-2.5 font-medium text-muted-foreground">Name</th>
                        <th className="px-4 py-2.5 font-medium text-muted-foreground">Course</th>
                        <th className="px-4 py-2.5 font-medium text-muted-foreground">Section</th>
                        <th className="px-4 py-2.5 font-medium text-muted-foreground">Status</th>
                        <th className="px-4 py-2.5 font-medium text-muted-foreground">Relationship</th>
                      </tr>
                    </thead>
                    <tbody>
                      {siblings.map((sib: any) => (
                        <tr key={sib.id} className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors">
                          <td className="px-4 py-2.5">
                            <Link to={`/students/${sib.admission_no}`} className="font-medium text-primary hover:underline">
                              {sib.name}
                            </Link>
                          </td>
                          <td className="px-4 py-2.5 text-muted-foreground">{sib.courses?.name || "—"}</td>
                          <td className="px-4 py-2.5 text-muted-foreground">{sib.section || "—"}</td>
                          <td className="px-4 py-2.5">
                            <span className={`rounded-full px-2.5 py-0.5 text-[10px] font-semibold capitalize ${sib.status === "active" ? "bg-success/10 text-success" : "bg-destructive/10 text-destructive"}`}>
                              {sib.status?.replace("_", " ") || "—"}
                            </span>
                          </td>
                          <td className="px-4 py-2.5 text-muted-foreground text-xs">{sib.relationship}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Academic Information */}
            <div className="rounded-xl bg-card card-shadow p-5 space-y-4 md:col-span-2">
              <h3 className="text-sm font-semibold text-foreground">Academic Information</h3>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-y-3 gap-x-4 text-sm">
                <Detail label="Course" value={student.courses?.name || "—"} />
                <Detail label="Section" value={student.section || "—"} />
                <Detail label="Batch" value={student.batches?.name || "—"} />
                <Detail label="Session" value={student.admission_sessions?.name || "—"} />
                <Detail label="Campus" value={student.campuses?.name || "—"} />
                <Detail label="Admission Date" value={fmtDate(student.admission_date)} />
                <Detail label="Date of Admission" value={fmtDate(student.date_of_admission)} />
                <Detail label="Form Filling Date" value={fmtDate(student.form_filling_date)} />
                <Detail label="Joining Class" value={student.joining_class || "—"} />
                <Detail label="Previous School" value={student.previous_school || "—"} />
                <Detail label="Previous Class" value={student.previous_class || "—"} />
                <Detail label="Previous Board" value={student.previous_board || "—"} />
                <Detail label="Joining Academic Year" value={student.joining_academic_year || "—"} />
                <Detail label="Concession Category" value={student.concession_category || "—"} />
                <Detail label="Fee Profile Type" value={student.fee_profile_type || "—"} />
                <Detail label="Fee Remarks" value={student.fee_remarks || "—"} />
                <Detail label="RTE Student" value={bool(student.rte_student)} />
                <Detail label="PEN" value={student.pen || "—"} />
                <Detail label="UDISE" value={student.udise || "—"} />
                <Detail label="APAAR ID" value={student.apaar_id || "—"} />
              </div>
            </div>

            {/* Documents */}
            <div className="rounded-xl bg-card card-shadow p-5 space-y-4">
              <h3 className="text-sm font-semibold text-foreground">Documents</h3>
              <div className="grid grid-cols-2 gap-y-3 gap-x-4 text-sm">
                <Detail label="TC Submitted" value={bool(student.tc_submitted)} />
                <Detail label="Marksheet Submitted" value={bool(student.marksheet_submitted)} />
                <Detail label="DOB Certificate Submitted" value={bool(student.dob_certificate_submitted)} />
                <Detail label="Transport Required" value={bool(student.transport_required)} />
              </div>
            </div>

            {/* Medical Information */}
            <div className="rounded-xl bg-card card-shadow p-5 space-y-4">
              <h3 className="text-sm font-semibold text-foreground">Medical Information</h3>
              <div className="grid grid-cols-2 gap-y-3 gap-x-4 text-sm">
                <Detail label="Is Asthmatic" value={bool(student.is_asthmatic)} />
                <Detail label="Allergies (Medicine)" value={student.allergies_medicine || "—"} />
                <Detail label="Allergies (Food)" value={student.allergies_food || "—"} />
                <Detail label="Vision" value={student.vision || "—"} />
                <Detail label="Medical Ailments" value={student.medical_ailments || "—"} />
                <Detail label="Physical Handicap" value={student.physical_handicap || "—"} />
                <Detail label="Ongoing Treatment" value={student.ongoing_treatment || "—"} />
              </div>
            </div>

            {/* Identification */}
            <div className="rounded-xl bg-card card-shadow p-5 space-y-4">
              <h3 className="text-sm font-semibold text-foreground">Identification</h3>
              <div className="grid grid-cols-2 gap-y-3 gap-x-4 text-sm">
                <Detail label="Identification Mark 1" value={student.identification_mark_1 || "—"} />
                <Detail label="Identification Mark 2" value={student.identification_mark_2 || "—"} />
              </div>
            </div>

            {/* Banking */}
            <div className="rounded-xl bg-card card-shadow p-5 space-y-4">
              <h3 className="text-sm font-semibold text-foreground">Banking</h3>
              <div className="grid grid-cols-2 gap-y-3 gap-x-4 text-sm">
                <Detail label="Bank Name" value={student.bank_name || "—"} />
                <Detail label="IFSC Code" value={student.ifsc_code || "—"} />
                <Detail label="Bank Account No" value={student.bank_account_no || "—"} />
                <Detail label="Bank Reference No" value={student.bank_reference_no || "—"} />
              </div>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="fees">
          <div className="mt-4">
            <StudentFeePanel student={student} onRefresh={fetchStudent} />
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
