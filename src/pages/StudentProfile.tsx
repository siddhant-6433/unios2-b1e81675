import { useState, useEffect, useRef } from "react";
import { useParams, Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { invokeEdge } from "@/integrations/supabase/edge";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { usePermissions } from "@/contexts/PermissionContext";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ArrowLeft, User, Phone, Mail, MapPin, Calendar, Heart, GraduationCap, Check, X, Clock, BookOpen, Loader2, TrendingUp, BarChart3, Activity, Filter, Users, RefreshCw, FileText, Download, ExternalLink, ShieldCheck, AlertCircle, Clock3, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { StudentFeePanel } from "@/components/finance/StudentFeePanel";

interface StudentDocument {
  id: string;
  document_name: string;
  file_url: string;
  file_name: string | null;
  file_size: number | null;
  mime_type: string | null;
  uploaded_at: string | null;
  created_at: string | null;
}

interface StudentRecord {
  id: string;
  lead_id: string | null;
  name: string;
  status: string;
  admission_no: string | null;
  pre_admission_no: string | null;
  father_user_id: string | null;
  mother_user_id: string | null;
  guardian_user_id: string | null;
  courses?: { name: string | null } | null;
  campuses?: { name: string | null } | null;
  batches?: { name: string | null } | null;
  admission_sessions?: { name: string | null } | null;
  first_name?: string | null;
  middle_name?: string | null;
  last_name?: string | null;
  dob?: string | null;
  gender?: string | null;
  blood_group?: string | null;
  nationality?: string | null;
  phone?: string | null;
  whatsapp_no?: string | null;
  email?: string | null;
  student_email?: string | null;
  school_email?: string | null;
  student_aadhar?: string | null;
  biometric_id?: string | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  country?: string | null;
  pincode?: string | null;
  birth_place?: string | null;
  religion?: string | null;
  caste?: string | null;
  sub_caste?: string | null;
  caste_category?: string | null;
  mother_tongue?: string | null;
  language_spoken?: string | null;
  second_language?: string | null;
  third_language?: string | null;
  house?: string | null;
  sports?: string | null;
  food_habits?: string | null;
  student_type?: string | null;
  hostel_type?: string | null;
  sr_number?: string | null;
  school_admission_no?: string | null;
  class_roll_no?: string | null;
  father_name?: string | null;
  father_phone?: string | null;
  father_whatsapp?: string | null;
  father_email?: string | null;
  father_occupation?: string | null;
  father_designation?: string | null;
  father_organization?: string | null;
  father_qualification?: string | null;
  father_income?: string | null;
  father_aadhar?: string | null;
  mother_name?: string | null;
  mother_phone?: string | null;
  mother_whatsapp?: string | null;
  mother_email?: string | null;
  mother_occupation?: string | null;
  mother_organization?: string | null;
  mother_aadhar?: string | null;
  guardian_name?: string | null;
  guardian_phone?: string | null;
  section?: string | null;
  admission_date?: string | null;
  date_of_admission?: string | null;
  form_filling_date?: string | null;
  joining_class?: string | null;
  previous_school?: string | null;
  previous_class?: string | null;
  previous_board?: string | null;
  joining_academic_year?: string | null;
  concession_category?: string | null;
  fee_profile_type?: string | null;
  fee_remarks?: string | null;
  rte_student?: boolean | null;
  pen?: string | null;
  udise?: string | null;
  apaar_id?: string | null;
  tc_submitted?: boolean | null;
  marksheet_submitted?: boolean | null;
  dob_certificate_submitted?: boolean | null;
  transport_required?: boolean | null;
  is_asthmatic?: boolean | null;
  allergies_medicine?: string | null;
  allergies_food?: string | null;
  vision?: string | null;
  medical_ailments?: string | null;
  physical_handicap?: string | null;
  ongoing_treatment?: string | null;
  identification_mark_1?: string | null;
  identification_mark_2?: string | null;
  bank_name?: string | null;
  ifsc_code?: string | null;
  bank_account_no?: string | null;
  bank_reference_no?: string | null;
}

interface FeeLedgerRow {
  total_amount: number | string | null;
  paid_amount: number | string | null;
  balance: number | string | null;
}

interface AttendanceRow {
  id: string;
  date: string;
  subject: string | null;
  status: string;
}

interface ExamRow {
  id: string;
  subject: string | null;
  exam_type: string | null;
  max_marks: number;
  obtained_marks: number;
  grade: string | null;
  exam_date: string | null;
}

interface SiblingRecord {
  id: string;
  name: string;
  admission_no: string | null;
  section: string | null;
  status: string | null;
  father_user_id: string | null;
  mother_user_id: string | null;
  guardian_user_id: string | null;
  courses?: { name: string | null } | null;
  relationship?: string;
}

interface LeadDocument {
  id: string;
  document_name: string;
  file_url: string | null;
  file_name: string | null;
  status: string | null;
  rejection_reason: string | null;
  verified_at: string | null;
}

const MAX_DOCUMENT_BYTES = 5 * 1024 * 1024;
const isAcceptedDocument = (file: File) =>
  file.type === "application/pdf" ||
  file.type.startsWith("image/") ||
  /\.(pdf|png|jpe?g|gif|webp)$/i.test(file.name);

const CONTACT_FIELDS = [
  { value: "phone", label: "Student Phone" },
  { value: "whatsapp_no", label: "Student WhatsApp" },
  { value: "father_phone", label: "Father Phone" },
  { value: "father_whatsapp", label: "Father WhatsApp" },
  { value: "mother_phone", label: "Mother Phone" },
  { value: "mother_whatsapp", label: "Mother WhatsApp" },
  { value: "guardian_phone", label: "Guardian Phone" },
] as const;

const StudentProfile = () => {
  const { admissionNo } = useParams<{ admissionNo: string }>();
  const { toast } = useToast();
  const { can } = usePermissions();
  const { role, realRole } = useAuth();
  const documentUploadRef = useRef<HTMLDivElement | null>(null);
  const [student, setStudent] = useState<StudentRecord | null>(null);
  const [fees, setFees] = useState<FeeLedgerRow[]>([]);
  const [attendance, setAttendance] = useState<AttendanceRow[]>([]);
  const [exams, setExams] = useState<ExamRow[]>([]);
  const [siblings, setSiblings] = useState<SiblingRecord[]>([]);
  const [leadDocs, setLeadDocs] = useState<LeadDocument[]>([]);
  const [appDocs, setAppDocs] = useState<{ name: string; url: string; path: string }[]>([]);
  const [studentDocs, setStudentDocs] = useState<StudentDocument[]>([]);
  const [documentName, setDocumentName] = useState("");
  const [documentFile, setDocumentFile] = useState<File | null>(null);
  const [documentInputKey, setDocumentInputKey] = useState(0);
  const [uploadingDocument, setUploadingDocument] = useState(false);
  const [activeTab, setActiveTab] = useState("details");
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);
  const [contactDialogOpen, setContactDialogOpen] = useState(false);
  const [contactField, setContactField] = useState<(typeof CONTACT_FIELDS)[number]["value"]>("phone");
  const [contactValue, setContactValue] = useState("");
  const [contactReason, setContactReason] = useState("");
  const [contactSaving, setContactSaving] = useState(false);

  useEffect(() => { if (admissionNo) fetchStudent(); }, [admissionNo]);

  const fetchStudent = async () => {
    setLoading(true);
    setLeadDocs([]);
    setAppDocs([]);
    setStudentDocs([]);
    let { data } = await supabase.from("students")
      .select("*, courses:course_id(name, code), campuses:campus_id(name), batches:batch_id(name), admission_sessions:session_id(name)")
      .eq("admission_no", admissionNo)
      .maybeSingle();

    if (!data) {
      const res = await supabase.from("students")
        .select("*, courses:course_id(name, code), campuses:campus_id(name), batches:batch_id(name), admission_sessions:session_id(name)")
        .eq("pre_admission_no", admissionNo)
        .maybeSingle();
      data = res.data;
    }

    if (data) {
      const currentStudent = data as StudentRecord;
      setStudent(currentStudent);
      const [feesRes, attendanceRes, examsRes, studentDocsRes] = await Promise.all([
        supabase.from("fee_ledger").select("*, fee_codes:fee_code_id(code, name, category)").eq("student_id", currentStudent.id).order("due_date"),
        supabase.from("daily_attendance").select("*").eq("student_id", currentStudent.id).order("date", { ascending: false }).limit(50),
        supabase.from("exam_records").select("*").eq("student_id", currentStudent.id).order("exam_date", { ascending: false }),
        supabase
          .from("student_documents" as never)
          .select("id, document_name, file_url, file_name, file_size, mime_type, uploaded_at, created_at")
          .eq("student_id", currentStudent.id)
          .order("created_at", { ascending: false }),
      ]);
      if (feesRes.data) setFees(feesRes.data as FeeLedgerRow[]);
      if (attendanceRes.data) setAttendance(attendanceRes.data as AttendanceRow[]);
      if (examsRes.data) setExams(examsRes.data as ExamRow[]);
      setStudentDocs((studentDocsRes.data ?? []) as StudentDocument[]);

      // Sibling lookup
      const orParts: string[] = [];
      if (currentStudent.father_user_id) orParts.push(`father_user_id.eq.${currentStudent.father_user_id}`);
      if (currentStudent.mother_user_id) orParts.push(`mother_user_id.eq.${currentStudent.mother_user_id}`);
      if (currentStudent.guardian_user_id) orParts.push(`guardian_user_id.eq.${currentStudent.guardian_user_id}`);

      if (orParts.length > 0) {
        const { data: sibs } = await supabase.from("students")
          .select("id, name, admission_no, course_id, section, status, father_user_id, mother_user_id, guardian_user_id, courses:course_id(name)")
          .or(orParts.join(","))
          .neq("id", currentStudent.id);
        if (sibs) setSiblings((sibs as SiblingRecord[]).map(s => {
          const rels: string[] = [];
          if (currentStudent.father_user_id && s.father_user_id === currentStudent.father_user_id) rels.push("Same Father");
          if (currentStudent.mother_user_id && s.mother_user_id === currentStudent.mother_user_id) rels.push("Same Mother");
          if (currentStudent.guardian_user_id && s.guardian_user_id === currentStudent.guardian_user_id) rels.push("Same Guardian");
          return { ...s, relationship: rels.join(", ") || "Sibling" };
        }));
      } else {
        setSiblings([]);
      }

      // Lead documents + application documents
      if (currentStudent.lead_id) {
        const [ldRes, appRes] = await Promise.all([
          supabase
            .from("lead_documents")
            .select("id, document_name, file_url, file_name, status, rejection_reason, verified_at")
            .eq("lead_id", currentStudent.lead_id)
            .order("created_at"),
          supabase
            .from("applications")
            .select("application_id")
            .eq("lead_id", currentStudent.lead_id)
            .maybeSingle(),
        ]);
        setLeadDocs((ldRes.data ?? []) as LeadDocument[]);

        if (appRes.data?.application_id) {
          const { data: fnData } = await supabase.functions.invoke("list-app-docs", {
            body: { application_id: appRes.data.application_id },
          }).catch(() => ({ data: null }));
          setAppDocs((fnData?.docs ?? []) as { name: string; url: string; path: string }[]);
        }
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
  const bool = (v: boolean | null | undefined) => (v === true ? "Yes" : v === false ? "No" : "—");

  const statusBg: Record<string, string> = { present: "bg-success/10 text-success", absent: "bg-destructive/10 text-destructive", late: "bg-warning/10 text-warning" };
  const gradeColor = (grade: string) => {
    if (!grade) return "bg-muted text-foreground/60";
    if (grade.startsWith("A")) return "bg-success/10 text-success";
    if (grade.startsWith("B")) return "bg-info/10 text-info";
    return "bg-warning/10 text-warning";
  };
  const canUploadDocuments =
    can("documents", "upload") ||
    role === "office_assistant" ||
    role === "office_admin" ||
    role === "super_admin" ||
    realRole === "super_admin";

  const syncFromApplication = async () => {
    setSyncing(true);
    setSyncMsg(null);
    const { data, error } = await supabase.rpc("backfill_student_from_application" as never, { p_student_id: student.id } as never);
    const syncData = data as { ok?: boolean; reason?: string; app_status?: string } | null;
    if (error) {
      setSyncMsg(`Error: ${error.message}`);
    } else if (syncData?.ok === false) {
      setSyncMsg(`Nothing synced: ${syncData.reason}`);
    } else {
      setSyncMsg(`Synced from application (${syncData?.app_status ?? "unknown"} status).`);
      await fetchStudent();
    }
    setSyncing(false);
  };

  const handleDocumentFileChange = (file: File | null) => {
    if (!file) {
      setDocumentFile(null);
      return;
    }
    if (!isAcceptedDocument(file)) {
      toast({ title: "Unsupported file", description: "Upload a PDF or image file.", variant: "destructive" });
      setDocumentInputKey((key) => key + 1);
      return;
    }
    if (file.size > MAX_DOCUMENT_BYTES) {
      toast({ title: "File too large", description: "Upload a file smaller than 5 MB.", variant: "destructive" });
      setDocumentInputKey((key) => key + 1);
      return;
    }
    setDocumentFile(file);
    if (!documentName.trim()) {
      setDocumentName(file.name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " "));
    }
  };

  const uploadStudentDocument = async () => {
    if (!student || !documentFile) return;
    const cleanName = documentName.trim() || documentFile.name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ") || "Student document";
    setUploadingDocument(true);

    try {
      const form = new FormData();
      form.append("file", documentFile);
      form.append("filename", documentFile.name);
      form.append("prefix", `student_documents/${student.id}`);

      const { data, error } = await invokeEdge<{ url?: string; key?: string }>("r2-upload", { body: form });
      if (error) throw new Error(error.message);
      if (!data?.url) throw new Error("Upload returned no document URL.");

      const studentDocumentPayload = {
        student_id: student.id,
        document_name: cleanName,
        file_url: data.url,
        file_name: documentFile.name,
        file_size: documentFile.size,
        mime_type: documentFile.type || null,
      };
      const { error: insertError } = await supabase.from("student_documents" as never).insert(studentDocumentPayload as never);
      if (insertError) throw insertError;

      toast({ title: "Document uploaded" });
      setDocumentName("");
      setDocumentFile(null);
      setDocumentInputKey((key) => key + 1);
      await fetchStudent();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      toast({ title: "Upload failed", description: message, variant: "destructive" });
    } finally {
      setUploadingDocument(false);
    }
  };

  const canRequestContactChange = ["office_assistant", "office_admin", "principal", "super_admin"].includes(role || "");
  const selectedContactLabel = CONTACT_FIELDS.find((f) => f.value === contactField)?.label || "Contact number";
  const selectedContactOldValue = student?.[contactField] || "";

  const openContactDialog = (field: (typeof CONTACT_FIELDS)[number]["value"]) => {
    setContactField(field);
    setContactValue(student?.[field] || "");
    setContactReason("");
    setContactDialogOpen(true);
  };

  const submitContactChange = async () => {
    const trimmedValue = contactValue.trim();
    const trimmedReason = contactReason.trim();
    if (!trimmedValue || !trimmedReason) {
      toast({ title: "Missing details", description: "Enter the new number and reason.", variant: "destructive" });
      return;
    }

    setContactSaving(true);
    const { error } = await supabase.rpc("request_student_contact_change" as never, {
      _student_id: student.id,
      _field_name: contactField,
      _new_value: trimmedValue,
      _reason: trimmedReason,
    } as never);
    setContactSaving(false);

    if (error) {
      toast({ title: "Request failed", description: error.message, variant: "destructive" });
      return;
    }

    toast({
      title: "Change requested",
      description: "Principal or super admin approval is required before the number is updated.",
    });
    setContactDialogOpen(false);
  };

  const openDocumentUpload = () => {
    setActiveTab("documents");
    requestAnimationFrame(() => {
      documentUploadRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
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
        <div className="flex items-center gap-2">
          {syncMsg && <span className="text-xs text-muted-foreground">{syncMsg}</span>}
          {canUploadDocuments && (
            <Button variant="default" size="sm" className="gap-2 rounded-lg" onClick={openDocumentUpload}>
              <Upload className="h-3.5 w-3.5" /> Add Document
            </Button>
          )}
          <Button variant="outline" size="sm" className="gap-2 rounded-lg" onClick={syncFromApplication} disabled={syncing}>
            {syncing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            Sync from Application
          </Button>
          <Button variant="outline" size="sm" className="gap-2 rounded-lg">
            <Filter className="h-3.5 w-3.5" /> Filter
          </Button>
        </div>
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
      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="bg-card border border-border rounded-lg p-1 h-auto flex-wrap">
          <TabsTrigger value="details" className="rounded-md text-xs data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">Details</TabsTrigger>
          <TabsTrigger value="documents" className="rounded-md text-xs data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">
            Documents{(studentDocs.length + leadDocs.length + appDocs.length) > 0 && <span className="ml-1 rounded-full bg-primary/15 px-1.5 py-0.5 text-[10px] font-semibold">{studentDocs.length + leadDocs.length + appDocs.length}</span>}
          </TabsTrigger>
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
              {canRequestContactChange && (
                <div className="flex flex-wrap gap-2 border-t border-border pt-4">
                  <Button type="button" variant="outline" size="sm" className="gap-2" onClick={() => openContactDialog("phone")}>
                    <Phone className="h-3.5 w-3.5" /> Request Student Phone Edit
                  </Button>
                  <Button type="button" variant="outline" size="sm" className="gap-2" onClick={() => openContactDialog("whatsapp_no")}>
                    <Phone className="h-3.5 w-3.5" /> Request Student WhatsApp Edit
                  </Button>
                </div>
              )}
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
              {canRequestContactChange && (
                <div className="flex flex-wrap gap-2 border-t border-border pt-4">
                  <Button type="button" variant="outline" size="sm" className="gap-2" onClick={() => openContactDialog("father_phone")}>
                    <Phone className="h-3.5 w-3.5" /> Request Father Phone Edit
                  </Button>
                  <Button type="button" variant="outline" size="sm" className="gap-2" onClick={() => openContactDialog("father_whatsapp")}>
                    <Phone className="h-3.5 w-3.5" /> Request Father WhatsApp Edit
                  </Button>
                </div>
              )}
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
              {canRequestContactChange && (
                <div className="flex flex-wrap gap-2 border-t border-border pt-4">
                  <Button type="button" variant="outline" size="sm" className="gap-2" onClick={() => openContactDialog("mother_phone")}>
                    <Phone className="h-3.5 w-3.5" /> Request Mother Phone Edit
                  </Button>
                  <Button type="button" variant="outline" size="sm" className="gap-2" onClick={() => openContactDialog("mother_whatsapp")}>
                    <Phone className="h-3.5 w-3.5" /> Request Mother WhatsApp Edit
                  </Button>
                </div>
              )}
            </div>

            {/* Guardian Information */}
            <div className="rounded-xl bg-card card-shadow p-5 space-y-4 md:col-span-2">
              <h3 className="text-sm font-semibold text-foreground">Guardian Information</h3>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-y-3 gap-x-4 text-sm">
                <Detail label="Guardian Name" value={student.guardian_name || "—"} />
                <Detail label="Guardian Phone" value={student.guardian_phone || "—"} />
              </div>
              {canRequestContactChange && (
                <div className="flex flex-wrap gap-2 border-t border-border pt-4">
                  <Button type="button" variant="outline" size="sm" className="gap-2" onClick={() => openContactDialog("guardian_phone")}>
                    <Phone className="h-3.5 w-3.5" /> Request Guardian Phone Edit
                  </Button>
                </div>
              )}
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
                      {siblings.map((sib) => (
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

        <TabsContent value="documents">
          <div className="mt-4 space-y-4">
            {canUploadDocuments && (
              <div ref={documentUploadRef} className="rounded-xl bg-card card-shadow p-5 space-y-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-semibold text-foreground">Upload Document</h3>
                    <p className="text-xs text-muted-foreground mt-0.5">PDF or image, up to 5 MB.</p>
                  </div>
                  <div className="h-9 w-9 rounded bg-primary/10 flex items-center justify-center shrink-0">
                    <Upload className="h-4 w-4 text-primary" />
                  </div>
                </div>
                <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)_auto] md:items-end">
                  <div className="space-y-1.5">
                    <Label htmlFor="student-document-name" className="text-xs">Document name</Label>
                    <Input
                      id="student-document-name"
                      value={documentName}
                      onChange={(event) => setDocumentName(event.target.value)}
                      placeholder="Aadhaar card"
                      disabled={uploadingDocument}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="student-document-file" className="text-xs">File</Label>
                    <Input
                      key={documentInputKey}
                      id="student-document-file"
                      type="file"
                      accept="application/pdf,image/*"
                      disabled={uploadingDocument}
                      onChange={(event) => handleDocumentFileChange(event.target.files?.[0] ?? null)}
                    />
                  </div>
                  <Button className="gap-2" onClick={uploadStudentDocument} disabled={!documentFile || uploadingDocument}>
                    {uploadingDocument ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                    Upload
                  </Button>
                </div>
                {documentFile && (
                  <p className="text-xs text-muted-foreground truncate">{documentFile.name}</p>
                )}
              </div>
            )}

            {studentDocs.length === 0 && leadDocs.length === 0 && appDocs.length === 0 && (
              <div className="rounded-xl bg-card card-shadow p-10 flex flex-col items-center gap-2 text-muted-foreground">
                <FileText className="h-8 w-8 opacity-30" />
                <p className="text-sm">No documents found for this student.</p>
              </div>
            )}

            {studentDocs.length > 0 && (
              <div className="rounded-xl bg-card card-shadow p-5 space-y-3">
                <h3 className="text-sm font-semibold text-foreground">Student Documents</h3>
                <div className="divide-y divide-border">
                  {studentDocs.map((doc) => {
                    const isImage = (doc.mime_type?.startsWith("image/") ?? false) || /\.(jpg|jpeg|png|gif|webp)$/i.test(doc.file_name ?? "");
                    return (
                      <div key={doc.id} className="flex items-center gap-3 py-2.5">
                        {isImage
                          ? <img src={doc.file_url} alt={doc.document_name} className="h-9 w-9 rounded object-cover border border-border shrink-0" />
                          : <div className="h-9 w-9 rounded bg-muted flex items-center justify-center shrink-0"><FileText className="h-4 w-4 text-muted-foreground" /></div>
                        }
                        <div className="flex-1 min-w-0">
                          <p className="text-sm text-foreground truncate">{doc.document_name}</p>
                          <p className="text-[11px] text-muted-foreground truncate">{doc.file_name || "Document"} · {fmtDate(doc.uploaded_at || doc.created_at)}</p>
                        </div>
                        <a href={doc.file_url} target="_blank" rel="noreferrer" className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-primary shrink-0">
                          <ExternalLink className="h-3.5 w-3.5" />
                        </a>
                        <a href={doc.file_url} download className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-primary shrink-0">
                          <Download className="h-3.5 w-3.5" />
                        </a>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {appDocs.length > 0 && (
              <div className="rounded-xl bg-card card-shadow p-5 space-y-3">
                <h3 className="text-sm font-semibold text-foreground">Application Documents</h3>
                <div className="divide-y divide-border">
                  {appDocs.map((doc, i) => {
                    const label = doc.name.split("-").slice(0, -1).join(" ").replace(/_/g, " ") || doc.name;
                    const isImage = /\.(jpg|jpeg|png|gif|webp)$/i.test(doc.name);
                    return (
                      <div key={i} className="flex items-center gap-3 py-2.5">
                        {isImage
                          ? <img src={doc.url} alt={label} className="h-9 w-9 rounded object-cover border border-border shrink-0" />
                          : <div className="h-9 w-9 rounded bg-muted flex items-center justify-center shrink-0"><FileText className="h-4 w-4 text-muted-foreground" /></div>
                        }
                        <span className="flex-1 text-sm text-foreground truncate capitalize">{label}</span>
                        <a href={doc.url} target="_blank" rel="noreferrer" className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-primary">
                          <ExternalLink className="h-3.5 w-3.5" />
                        </a>
                        <a href={doc.url} download className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-primary">
                          <Download className="h-3.5 w-3.5" />
                        </a>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {leadDocs.length > 0 && (
              <div className="rounded-xl bg-card card-shadow p-5 space-y-3">
                <h3 className="text-sm font-semibold text-foreground">Verified Documents</h3>
                <div className="divide-y divide-border">
                  {leadDocs.map((doc) => {
                    const statusIcon = doc.status === "verified"
                      ? <ShieldCheck className="h-4 w-4 text-emerald-500" />
                      : doc.status === "rejected"
                      ? <AlertCircle className="h-4 w-4 text-rose-500" />
                      : <Clock3 className="h-4 w-4 text-amber-500" />;
                    const isImage = /\.(jpg|jpeg|png|gif|webp)$/i.test(doc.file_name ?? "");
                    return (
                      <div key={doc.id} className="flex items-center gap-3 py-2.5">
                        {isImage && doc.file_url
                          ? <img src={doc.file_url} alt={doc.document_name} className="h-9 w-9 rounded object-cover border border-border shrink-0" />
                          : <div className="h-9 w-9 rounded bg-muted flex items-center justify-center shrink-0"><FileText className="h-4 w-4 text-muted-foreground" /></div>
                        }
                        <div className="flex-1 min-w-0">
                          <p className="text-sm text-foreground truncate">{doc.document_name}</p>
                          {doc.rejection_reason && <p className="text-[11px] text-rose-500 truncate">{doc.rejection_reason}</p>}
                        </div>
                        <div title={doc.status} className="shrink-0">{statusIcon}</div>
                        {doc.file_url && (
                          <a href={doc.file_url} target="_blank" rel="noreferrer" className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-primary shrink-0">
                            <ExternalLink className="h-3.5 w-3.5" />
                          </a>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
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
                  ) : attendance.map((a) => (
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
                  ) : exams.map((e) => (
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

      <Dialog open={contactDialogOpen} onOpenChange={setContactDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Request Contact Number Edit</DialogTitle>
            <DialogDescription>
              Approval from principal or super admin is required before this change is applied.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="grid gap-1.5">
              <label className="text-xs font-medium text-muted-foreground">Field</label>
              <select
                value={contactField}
                onChange={(e) => {
                  const next = e.target.value as (typeof CONTACT_FIELDS)[number]["value"];
                  setContactField(next);
                  setContactValue(student?.[next] || "");
                }}
                className="rounded-lg border border-input bg-background px-3 py-2 text-sm"
              >
                {CONTACT_FIELDS.map((field) => (
                  <option key={field.value} value={field.value}>{field.label}</option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <label className="text-xs font-medium text-muted-foreground">Current {selectedContactLabel}</label>
                <div className="rounded-lg border border-border bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
                  {selectedContactOldValue || "—"}
                </div>
              </div>
              <div className="grid gap-1.5">
                <label className="text-xs font-medium text-muted-foreground">New {selectedContactLabel}</label>
                <input
                  value={contactValue}
                  onChange={(e) => setContactValue(e.target.value)}
                  className="rounded-lg border border-input bg-background px-3 py-2 text-sm"
                  placeholder="Enter mobile number"
                />
              </div>
            </div>
            <div className="grid gap-1.5">
              <label className="text-xs font-medium text-muted-foreground">Reason</label>
              <textarea
                value={contactReason}
                onChange={(e) => setContactReason(e.target.value)}
                rows={3}
                className="rounded-lg border border-input bg-background px-3 py-2 text-sm"
                placeholder="Why should this number be changed?"
              />
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setContactDialogOpen(false)}>Cancel</Button>
            <Button type="button" onClick={submitContactChange} disabled={contactSaving}>
              {contactSaving && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}
              Submit Request
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
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
