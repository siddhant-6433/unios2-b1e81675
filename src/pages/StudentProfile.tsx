import { PageLoader } from "@/components/ui/page-loader";
import { useState, useEffect } from "react";
import type { ReactNode } from "react";
import { useParams, Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { invokeEdge } from "@/integrations/supabase/edge";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { usePermissions } from "@/contexts/PermissionContext";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ArrowLeft, User, Phone, Check, X, Clock, BookOpen, Loader2, TrendingUp, BarChart3, Activity, Users, RefreshCw, FileText, Download, ExternalLink, ShieldCheck, AlertCircle, Clock3, Upload, Camera, Edit3, History, Archive, ArchiveRestore, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { StudentFeePanel } from "@/components/finance/StudentFeePanel";
import { TransferCertificateSection } from "@/components/students/TransferCertificateSection";
import { findApplicationPhotoDoc, getApplicationPhotoUrlsByLeadId } from "@/lib/applicationPhotos";

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

interface StudentAuditRow {
  id: string;
  event_type: string;
  field_name: string | null;
  old_value: string | null;
  new_value: string | null;
  reason: string | null;
  metadata: Record<string, unknown> | null;
  actor_user_id: string | null;
  created_at: string;
}

type BatchLabelRecord = { id?: string; name: string | null; section?: string | null };

interface StudentRecord {
  id: string;
  lead_id: string | null;
  name: string;
  status: string;
  admission_no: string | null;
  pre_admission_no: string | null;
  course_id: string | null;
  batch_id: string | null;
  session_id: string | null;
  father_user_id: string | null;
  mother_user_id: string | null;
  guardian_user_id: string | null;
  photo_url?: string | null;
  courses?: { name: string | null; code?: string | null; type?: string | null } | null;
  campuses?: { name: string | null } | null;
  batches?: { name: string | null; section?: string | null } | null;
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
  semester?: string | null;
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

const clean = (value?: string | null) => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
};

const normalizedPhone = (value?: string | null) => {
  const digits = String(value || "").replace(/\D/g, "");
  if (!digits) return "";
  return digits.length === 12 && digits.startsWith("91") ? digits.slice(2) : digits;
};

const comparableName = (value?: string | null) => String(value || "").trim().toLowerCase().replace(/\s+/g, " ");

const sameName = (a?: string | null, b?: string | null) => {
  const left = comparableName(a);
  const right = comparableName(b);
  return !!left && left === right;
};

const samePhone = (a?: string | null, b?: string | null) => {
  const left = normalizedPhone(a);
  const right = normalizedPhone(b);
  return !!left && left === right;
};

const isGradeLike = (value?: string | null) =>
  !!clean(value) && /^(grade|class|std)\s*[0-9ivx]+$|^(toddler|nursery|lkg|ukg)$/i.test(clean(value)!);

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
  pre_admission_no: string | null;
  section: string | null;
  status: string | null;
  father_name: string | null;
  father_phone: string | null;
  father_user_id: string | null;
  mother_name: string | null;
  mother_phone: string | null;
  mother_user_id: string | null;
  guardian_name: string | null;
  guardian_phone: string | null;
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
const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
const isAcceptedDocument = (file: File) =>
  file.type === "application/pdf" ||
  file.type.startsWith("image/") ||
  /\.(pdf|png|jpe?g|gif|webp)$/i.test(file.name);

const isAcceptedPhoto = (file: File) =>
  file.type === "image/jpeg" ||
  file.type === "image/png" ||
  file.type === "image/webp" ||
  /\.(jpe?g|png|webp)$/i.test(file.name);

const CONTACT_FIELDS = [
  { value: "phone", label: "Student Phone" },
  { value: "whatsapp_no", label: "Student WhatsApp" },
  { value: "father_phone", label: "Father Phone" },
  { value: "father_whatsapp", label: "Father WhatsApp" },
  { value: "mother_phone", label: "Mother Phone" },
  { value: "mother_whatsapp", label: "Mother WhatsApp" },
  { value: "guardian_phone", label: "Guardian Phone" },
] as const;

const EDIT_FIELDS = [
  // Identity
  { key: "name", label: "Full Name" },
  { key: "first_name", label: "First Name" },
  { key: "middle_name", label: "Middle Name" },
  { key: "last_name", label: "Last Name" },
  { key: "dob", label: "Date of Birth", type: "date" },
  { key: "gender", label: "Gender" },
  { key: "blood_group", label: "Blood Group" },
  { key: "nationality", label: "Nationality" },
  { key: "birth_place", label: "Birth Place" },
  { key: "religion", label: "Religion" },
  { key: "caste", label: "Caste" },
  { key: "sub_caste", label: "Sub Caste" },
  { key: "caste_category", label: "Caste Category" },
  { key: "mother_tongue", label: "Mother Tongue" },
  { key: "language_spoken", label: "Language Spoken" },
  { key: "second_language", label: "Second Language" },
  { key: "third_language", label: "Third Language" },
  // Contact
  { key: "phone", label: "Student Phone" },
  { key: "whatsapp_no", label: "Student WhatsApp" },
  { key: "student_email", label: "Student Email", type: "email" },
  { key: "email", label: "Parent Email", type: "email" },
  { key: "school_email", label: "School Email", type: "email" },
  // Address
  { key: "address", label: "Address", type: "textarea" },
  { key: "city", label: "City" },
  { key: "state", label: "State" },
  { key: "country", label: "Country" },
  { key: "pincode", label: "Pincode" },
  // Identity documents
  { key: "student_aadhar", label: "Student Aadhar" },
  { key: "biometric_id", label: "Biometric ID" },
  // Medical & lifestyle
  { key: "medical_ailments", label: "Medical Ailments / Conditions", type: "textarea" },
  { key: "food_habits", label: "Food Habits" },
  { key: "house", label: "House" },
  { key: "sports", label: "Sports" },
  { key: "student_type", label: "Student Type" },
  { key: "hostel_type", label: "Hostel Type" },
  { key: "sr_number", label: "SR Number" },
  { key: "school_admission_no", label: "School Admission No" },
  { key: "class_roll_no", label: "Class Roll No" },
  // Father
  { key: "father_name", label: "Father Name" },
  { key: "father_phone", label: "Father Phone" },
  { key: "father_whatsapp", label: "Father WhatsApp" },
  { key: "father_email", label: "Father Email", type: "email" },
  { key: "father_occupation", label: "Father Occupation" },
  { key: "father_designation", label: "Father Designation" },
  { key: "father_organization", label: "Father Organization" },
  { key: "father_qualification", label: "Father Qualification" },
  { key: "father_income", label: "Father Income" },
  { key: "father_aadhar", label: "Father Aadhar" },
  // Mother
  { key: "mother_name", label: "Mother Name" },
  { key: "mother_phone", label: "Mother Phone" },
  { key: "mother_whatsapp", label: "Mother WhatsApp" },
  { key: "mother_email", label: "Mother Email", type: "email" },
  { key: "mother_occupation", label: "Mother Occupation" },
  { key: "mother_organization", label: "Mother Organization" },
  { key: "mother_aadhar", label: "Mother Aadhar" },
  // Guardian
  { key: "guardian_name", label: "Guardian Name" },
  { key: "guardian_phone", label: "Guardian Phone" },
  // Academic
  { key: "section", label: "Section" },
  { key: "admission_date", label: "Admission Date", type: "date" },
  { key: "joining_academic_year", label: "Joining Academic Year / Session" },
  { key: "semester", label: "Current Semester / Year" },
] as const;

type EditableStudentField = (typeof EDIT_FIELDS)[number]["key"];
type EditFormState = Record<EditableStudentField, string>;

const fieldLabel = (field: string | null) =>
  EDIT_FIELDS.find((item) => item.key === field)?.label || field || "Record";

const valueForAudit = (value: unknown) => {
  if (value === null || value === undefined || value === "") return "";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return String(value);
};

const fileToDataUrl = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error || new Error("Could not read image."));
    reader.readAsDataURL(file);
  });

const StudentProfile = () => {
  const { admissionNo } = useParams<{ admissionNo: string }>();
  const { toast } = useToast();
  const { can } = usePermissions();
  const { role, user } = useAuth();
  const [student, setStudent] = useState<StudentRecord | null>(null);
  const [fees, setFees] = useState<FeeLedgerRow[]>([]);
  const [attendance, setAttendance] = useState<AttendanceRow[]>([]);
  const [exams, setExams] = useState<ExamRow[]>([]);
  const [siblings, setSiblings] = useState<SiblingRecord[]>([]);
  const [leadDocs, setLeadDocs] = useState<LeadDocument[]>([]);
  const [appDocs, setAppDocs] = useState<{ name: string; url: string; path: string }[]>([]);
  const [applicationPhotoUrl, setApplicationPhotoUrl] = useState<string | null>(null);
  const [inferredBatch, setInferredBatch] = useState<BatchLabelRecord | null>(null);
  const [studentDocs, setStudentDocs] = useState<StudentDocument[]>([]);
  const [auditRows, setAuditRows] = useState<StudentAuditRow[]>([]);
  const [auditActors, setAuditActors] = useState<Record<string, string>>({});
  const [documentName, setDocumentName] = useState("");
  const [documentFile, setDocumentFile] = useState<File | null>(null);
  const [documentInputKey, setDocumentInputKey] = useState(0);
  const [uploadingDocument, setUploadingDocument] = useState(false);
  const [photoInputKey, setPhotoInputKey] = useState(0);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);
  const [contactDialogOpen, setContactDialogOpen] = useState(false);
  const [contactField, setContactField] = useState<(typeof CONTACT_FIELDS)[number]["value"]>("phone");
  const [contactValue, setContactValue] = useState("");
  const [contactReason, setContactReason] = useState("");
  const [contactSaving, setContactSaving] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editForm, setEditForm] = useState<EditFormState>(() => Object.fromEntries(EDIT_FIELDS.map((field) => [field.key, ""])) as EditFormState);
  const [editReason, setEditReason] = useState("");
  const [editSaving, setEditSaving] = useState(false);
  const [removalAction, setRemovalAction] = useState<null | "archive" | "delete">(null);
  const [removalReason, setRemovalReason] = useState("");
  const [removalBusy, setRemovalBusy] = useState(false);

  const canArchive = role === "office_assistant" || role === "school_coordinator" || role === "principal" || role === "super_admin";
  const canDelete = role === "super_admin";

  useEffect(() => { if (admissionNo) fetchStudent(); }, [admissionNo]);

  const submitRemoval = async () => {
    if (!student || !removalAction) return;
    if (!removalReason.trim()) {
      toast({ variant: "destructive", title: "Reason required", description: `Please give a reason for ${removalAction === "archive" ? "archiving" : "deleting"} this student.` });
      return;
    }
    setRemovalBusy(true);
    const rpc = removalAction === "archive" ? "archive_student" : "delete_student";
    const { error } = await supabase.rpc(rpc as never, { _student_id: student.id, _reason: removalReason.trim() } as never);
    setRemovalBusy(false);
    if (error) {
      toast({ variant: "destructive", title: "Action failed", description: error.message });
      return;
    }
    toast({ title: removalAction === "archive" ? "Student archived" : "Student deleted" });
    setRemovalAction(null);
    setRemovalReason("");
    fetchStudent();
  };

  const unarchiveStudent = async () => {
    if (!student) return;
    setRemovalBusy(true);
    const { error } = await supabase.rpc("unarchive_student" as never, { _student_id: student.id } as never);
    setRemovalBusy(false);
    if (error) {
      toast({ variant: "destructive", title: "Could not unarchive", description: error.message });
      return;
    }
    toast({ title: "Student restored" });
    fetchStudent();
  };

  const logStudentAudit = async (rows: Array<{
    event_type: string;
    field_name?: string | null;
    old_value?: string | null;
    new_value?: string | null;
    reason?: string | null;
    metadata?: Record<string, unknown>;
  }>) => {
    if (!student || rows.length === 0) return;
    const payload = rows.map((row) => ({
      student_id: student.id,
      actor_user_id: user?.id ?? null,
      event_type: row.event_type,
      field_name: row.field_name ?? null,
      old_value: row.old_value ?? null,
      new_value: row.new_value ?? null,
      reason: row.reason ?? null,
      metadata: row.metadata ?? {},
    }));
    const { error } = await supabase.from("student_audit_log" as never).insert(payload as never);
    if (error) console.error("[student-profile] audit log insert failed", error);
  };

  const fetchStudent = async () => {
    setLoading(true);
    setLeadDocs([]);
    setAppDocs([]);
    setApplicationPhotoUrl(null);
    setInferredBatch(null);
    setStudentDocs([]);
    setAuditRows([]);
    let { data } = await supabase.from("students")
      .select("*, courses:course_id(name, code, type), campuses:campus_id(name), batches:batch_id(name, section), admission_sessions:session_id(name)")
      .eq("admission_no", admissionNo)
      .maybeSingle();

    if (!data) {
      const res = await supabase.from("students")
        .select("*, courses:course_id(name, code, type), campuses:campus_id(name), batches:batch_id(name, section), admission_sessions:session_id(name)")
        .eq("pre_admission_no", admissionNo)
        .maybeSingle();
      data = res.data;
    }

    if (data) {
      const currentStudent = data as StudentRecord;
      setStudent(currentStudent);
      const isSchoolRecord =
        currentStudent.courses?.type === "school" ||
        isGradeLike(currentStudent.courses?.name) ||
        isGradeLike(currentStudent.joining_class);
      if (!isSchoolRecord && !currentStudent.batch_id && currentStudent.course_id) {
        let batchQuery = supabase
          .from("batches")
          .select("id, name, section, session_id")
          .eq("course_id", currentStudent.course_id);
        if (currentStudent.session_id) {
          batchQuery = batchQuery.eq("session_id", currentStudent.session_id);
        }
        const { data: batchRows } = await batchQuery.limit(2);
        if ((batchRows ?? []).length === 1) {
          setInferredBatch(batchRows![0]);
        }
      }
      const [feesRes, attendanceRes, examsRes, studentDocsRes, auditRes] = await Promise.all([
        supabase.from("fee_ledger").select("*, fee_codes:fee_code_id(code, name, category)").eq("student_id", currentStudent.id).order("due_date"),
        supabase.from("daily_attendance").select("*").eq("student_id", currentStudent.id).order("date", { ascending: false }).limit(50),
        supabase.from("exam_records").select("*").eq("student_id", currentStudent.id).order("exam_date", { ascending: false }),
        supabase
          .from("student_documents" as never)
          .select("id, document_name, file_url, file_name, file_size, mime_type, uploaded_at, created_at")
          .eq("student_id", currentStudent.id)
          .order("created_at", { ascending: false }),
        supabase
          .from("student_audit_log" as never)
          .select("id, event_type, field_name, old_value, new_value, reason, metadata, actor_user_id, created_at")
          .eq("student_id", currentStudent.id)
          .order("created_at", { ascending: false })
          .limit(200),
      ]);
      if (feesRes.data) setFees(feesRes.data as FeeLedgerRow[]);
      if (attendanceRes.data) setAttendance(attendanceRes.data as AttendanceRow[]);
      if (examsRes.data) setExams(examsRes.data as ExamRow[]);
      setStudentDocs((studentDocsRes.data ?? []) as StudentDocument[]);
      const auditData = (auditRes.data ?? []) as StudentAuditRow[];
      setAuditRows(auditData);
      const actorIds = [...new Set(auditData.map((r) => r.actor_user_id).filter(Boolean) as string[])];
      if (actorIds.length > 0) {
        const { data: actorRows } = await supabase
          .from("profiles")
          .select("user_id, display_name, email")
          .in("user_id", actorIds);
        setAuditActors(Object.fromEntries(
          (actorRows ?? []).map((p) => [p.user_id as string, (p.display_name || p.email || "") as string])
        ));
      } else {
        setAuditActors({});
      }

      // Sibling lookup. Parent auth IDs are best, but bulk imports usually only
      // have parent phones/names, so include those as family signals.
      const siblingSelect = "id, name, admission_no, pre_admission_no, course_id, section, status, father_name, father_phone, father_user_id, mother_name, mother_phone, mother_user_id, guardian_name, guardian_phone, guardian_user_id, courses:course_id(name)";
      const siblingMap = new Map<string, SiblingRecord>();
      const addSiblingRows = (rows: unknown[] | null | undefined) => {
        for (const row of (rows || []) as SiblingRecord[]) {
          const rels: string[] = [];
          if (currentStudent.father_user_id && row.father_user_id === currentStudent.father_user_id) rels.push("Same Father Account");
          if (currentStudent.mother_user_id && row.mother_user_id === currentStudent.mother_user_id) rels.push("Same Mother Account");
          if (currentStudent.guardian_user_id && row.guardian_user_id === currentStudent.guardian_user_id) rels.push("Same Guardian Account");
          if (samePhone(currentStudent.father_phone, row.father_phone)) rels.push("Same Father Phone");
          if (samePhone(currentStudent.mother_phone, row.mother_phone)) rels.push("Same Mother Phone");
          if (samePhone(currentStudent.guardian_phone, row.guardian_phone)) rels.push("Same Guardian Phone");
          if (sameName(currentStudent.father_name, row.father_name) && sameName(currentStudent.mother_name, row.mother_name)) rels.push("Same Parent Names");
          else if (sameName(currentStudent.guardian_name, row.guardian_name)) rels.push("Same Guardian Name");
          siblingMap.set(row.id, { ...row, relationship: rels.join(", ") || "Sibling" });
        }
      };

      const idParts: string[] = [];
      if (currentStudent.father_user_id) idParts.push(`father_user_id.eq.${currentStudent.father_user_id}`);
      if (currentStudent.mother_user_id) idParts.push(`mother_user_id.eq.${currentStudent.mother_user_id}`);
      if (currentStudent.guardian_user_id) idParts.push(`guardian_user_id.eq.${currentStudent.guardian_user_id}`);
      if (idParts.length > 0) {
        const { data: byAccount } = await supabase.from("students")
          .select(siblingSelect)
          .or(idParts.join(","))
          .neq("id", currentStudent.id);
        addSiblingRows(byAccount);
      }

      const phones = Array.from(new Set([
        normalizedPhone(currentStudent.father_phone),
        normalizedPhone(currentStudent.mother_phone),
        normalizedPhone(currentStudent.guardian_phone),
      ].filter(Boolean)));
      if (phones.length > 0) {
        const phoneParts = phones.flatMap(phone => [
          `father_phone.eq.${phone}`,
          `father_phone.eq.+91${phone}`,
          `mother_phone.eq.${phone}`,
          `mother_phone.eq.+91${phone}`,
          `guardian_phone.eq.${phone}`,
          `guardian_phone.eq.+91${phone}`,
        ]);
        const { data: byPhone } = await supabase.from("students")
          .select(siblingSelect)
          .or(phoneParts.join(","))
          .neq("id", currentStudent.id);
        addSiblingRows(byPhone);
      }

      if (clean(currentStudent.father_name) && clean(currentStudent.mother_name)) {
        const { data: byParentNames } = await supabase.from("students")
          .select(siblingSelect)
          .eq("father_name", currentStudent.father_name)
          .eq("mother_name", currentStudent.mother_name)
          .neq("id", currentStudent.id);
        addSiblingRows(byParentNames);
      }

      if (clean(currentStudent.guardian_name)) {
        const { data: byGuardianName } = await supabase.from("students")
          .select(siblingSelect)
          .eq("guardian_name", currentStudent.guardian_name)
          .neq("id", currentStudent.id);
        addSiblingRows(byGuardianName);
      }

      setSiblings(Array.from(siblingMap.values()));

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
            .order("created_at", { ascending: false })
            .limit(1),
        ]);
        setLeadDocs((ldRes.data ?? []) as LeadDocument[]);

        const applicationId = Array.isArray(appRes.data) ? appRes.data[0]?.application_id : null;
        if (applicationId) {
          const { data: fnData } = await supabase.functions.invoke("list-app-docs", {
            body: { application_id: applicationId },
          }).catch(() => ({ data: null }));
          const docs = (fnData?.docs ?? []) as { name: string; url: string; path: string }[];
          setAppDocs(docs);
          const photoDoc = findApplicationPhotoDoc(docs);
          if (photoDoc?.url) {
            setApplicationPhotoUrl(photoDoc.url);
          } else if (!currentStudent.photo_url) {
            const photoByLead = await getApplicationPhotoUrlsByLeadId([currentStudent.lead_id]);
            setApplicationPhotoUrl(photoByLead.get(currentStudent.lead_id) || null);
          }
        }
      }
    }
    setLoading(false);
  };

  if (loading) return <PageLoader />;

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
  const profilePhotoUrl = student.photo_url || applicationPhotoUrl;
  const isSchoolStudent =
    student.courses?.type === "school" ||
    isGradeLike(student.courses?.name) ||
    isGradeLike(student.joining_class);
  const displayBatch = student.batches || inferredBatch;
  const batchName = clean(displayBatch?.name);
  const batchSection = clean(displayBatch?.section);
  const batchLabel = batchName && batchSection && !batchName.toLowerCase().includes(batchSection.toLowerCase())
    ? `${batchName} (${batchSection})`
    : batchName || (!isGradeLike(student.section) ? clean(student.section) : null);
  const sessionLabel = clean(student.admission_sessions?.name) || clean(student.joining_academic_year);
  const headerAcademicItems = [
    displayNo,
    student.courses?.name,
    isSchoolStudent ? sessionLabel : batchLabel,
  ].filter(Boolean);

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
  const canUploadDocuments = can("documents", "upload");
  const canCorrectProfile = can("students", "update") || ["office_assistant", "school_coordinator", "office_admin", "principal", "campus_admin", "super_admin"].includes(role || "");
  const canUploadPhoto = canCorrectProfile;

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

      await logStudentAudit([{
        event_type: "document_upload",
        field_name: "student_documents",
        new_value: cleanName,
        metadata: {
          document_name: cleanName,
          file_name: documentFile.name,
          file_size: documentFile.size,
          mime_type: documentFile.type || null,
          file_url: data.url,
        },
      }]);

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

  const handlePhotoFileChange = async (file: File | null) => {
    if (!student || !file) return;
    if (!isAcceptedPhoto(file)) {
      toast({ title: "Unsupported photo", description: "Upload a JPG, PNG, or WebP image.", variant: "destructive" });
      setPhotoInputKey((key) => key + 1);
      return;
    }
    if (file.size > MAX_PHOTO_BYTES) {
      toast({ title: "Photo too large", description: "Upload a photo smaller than 5 MB.", variant: "destructive" });
      setPhotoInputKey((key) => key + 1);
      return;
    }

    setUploadingPhoto(true);
    try {
      const image = await fileToDataUrl(file);
      const previousPhoto = student.photo_url || "";
      const { data, error } = await invokeEdge<{ ok?: boolean; photo_url?: string; path?: string; model?: string }>("student-profile-photo-upload", {
        body: { student_id: student.id, image },
      });
      if (error) throw new Error(error.message);
      if (!data?.photo_url) throw new Error("Upload returned no photo URL.");

      await logStudentAudit([{
        event_type: "photo_upload",
        field_name: "photo_url",
        old_value: previousPhoto,
        new_value: data.photo_url,
        metadata: {
          file_name: file.name,
          file_size: file.size,
          mime_type: file.type || null,
          path: data.path || null,
          model: data.model || null,
        },
      }]);

      toast({ title: "Photo uploaded" });
      setPhotoInputKey((key) => key + 1);
      await fetchStudent();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      toast({ title: "Photo upload failed", description: message, variant: "destructive" });
      setPhotoInputKey((key) => key + 1);
    } finally {
      setUploadingPhoto(false);
    }
  };

  const openEditDialog = () => {
    if (!student) return;
    setEditForm(Object.fromEntries(
      EDIT_FIELDS.map((field) => [field.key, valueForAudit(student[field.key as keyof StudentRecord])])
    ) as EditFormState);
    setEditReason("");
    setEditDialogOpen(true);
  };

  const submitProfileCorrections = async () => {
    if (!student) return;
    const reason = editReason.trim();
    if (!reason) {
      toast({ title: "Reason required", description: "Enter a correction reason for the audit trail.", variant: "destructive" });
      return;
    }

    const changes: Partial<Record<EditableStudentField, string | null>> = {};
    const auditEvents: Array<{
      event_type: string;
      field_name: string;
      old_value: string;
      new_value: string;
      reason: string;
    }> = [];

    EDIT_FIELDS.forEach((field) => {
      const previous = valueForAudit(student[field.key as keyof StudentRecord]).trim();
      const next = editForm[field.key].trim();
      if (previous !== next) {
        changes[field.key] = next || null;
        auditEvents.push({
          event_type: "profile_update",
          field_name: field.key,
          old_value: previous,
          new_value: next,
          reason,
        });
      }
    });

    if (auditEvents.length === 0) {
      toast({ title: "No changes", description: "Update at least one field before saving.", variant: "destructive" });
      return;
    }

    setEditSaving(true);
    try {
      // .select() returns the affected rows so we can detect a silent 0-row
      // update — RLS filters the row out instead of erroring, so without this
      // the save would "succeed" and log a phantom audit entry without changing
      // anything. See student UPDATE policies (office_assistant lacks access).
      const { data: updated, error } = await supabase
        .from("students")
        .update(changes)
        .eq("id", student.id)
        .select("id");
      if (error) throw error;
      if (!updated || updated.length === 0) {
        throw new Error("You do not have permission to update this student, so no changes were saved.");
      }
      await logStudentAudit(auditEvents);
      toast({ title: "Student information updated" });
      setEditDialogOpen(false);
      await fetchStudent();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      toast({ title: "Update failed", description: message, variant: "destructive" });
    } finally {
      setEditSaving(false);
    }
  };

  const canRequestContactChange = ["office_assistant", "school_coordinator", "office_admin", "principal", "super_admin"].includes(role || "");
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

  return (
    <div className="space-y-5 animate-fade-in">
      <Link to="/students" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors">
        <ArrowLeft className="h-4 w-4" />Back to Students
      </Link>

      {/* Profile Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="relative shrink-0">
            {profilePhotoUrl ? (
              <img src={profilePhotoUrl} alt={student.name} className="h-16 w-16 rounded-2xl border border-border object-cover" />
            ) : (
              <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10 text-xl font-bold text-primary">
                {initials}
              </div>
            )}
            {canUploadPhoto && (
              <>
                <input
                  key={photoInputKey}
                  id="student-profile-photo-input"
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  className="sr-only"
                  disabled={uploadingPhoto}
                  onChange={(event) => handlePhotoFileChange(event.target.files?.[0] ?? null)}
                />
                <label
                  htmlFor="student-profile-photo-input"
                  className="absolute -bottom-1 -right-1 flex h-7 w-7 cursor-pointer items-center justify-center rounded-lg border border-border bg-background text-muted-foreground shadow-sm hover:text-primary"
                  title="Upload student photo"
                >
                  {uploadingPhoto ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Camera className="h-3.5 w-3.5" />}
                </label>
              </>
            )}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold text-foreground">{student.name}</h1>
              <span className={`rounded-md px-2 py-0.5 text-[10px] font-semibold capitalize ${student.status === "active" ? "bg-success/10 text-success" : "bg-destructive/10 text-destructive"}`}>
                {student.status.replace("_", " ")}
              </span>
              {(student as { archived_at?: string | null }).archived_at && (
                <span className="inline-flex items-center gap-1 rounded-md bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-800">
                  <Archive className="h-3 w-3" /> Archived
                </span>
              )}
            </div>
            <p className="text-sm text-muted-foreground mt-0.5">
              {headerAcademicItems.map((item, index) => (
                <span key={`${item}-${index}`} className={index === 0 ? "font-mono" : undefined}>
                  {index > 0 && <span className="px-1.5">·</span>}
                  {item}
                </span>
              ))}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {syncMsg && <span className="text-xs text-muted-foreground">{syncMsg}</span>}
          <Button variant="outline" size="sm" className="gap-2 rounded-lg" onClick={syncFromApplication} disabled={syncing}>
            {syncing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            Sync from Application
          </Button>
          {canCorrectProfile && (
            <Button variant="outline" size="sm" className="gap-2 rounded-lg" onClick={openEditDialog}>
              <Edit3 className="h-3.5 w-3.5" /> Correct Information
            </Button>
          )}
          {canArchive && (
            (student as { archived_at?: string | null }).archived_at ? (
              <Button variant="outline" size="sm" className="gap-2 rounded-lg" onClick={unarchiveStudent} disabled={removalBusy}>
                <ArchiveRestore className="h-3.5 w-3.5" /> Unarchive
              </Button>
            ) : (
              <Button variant="outline" size="sm" className="gap-2 rounded-lg" onClick={() => { setRemovalReason(""); setRemovalAction("archive"); }}>
                <Archive className="h-3.5 w-3.5" /> Archive
              </Button>
            )
          )}
          {canDelete && (
            <Button variant="outline" size="sm" className="gap-2 rounded-lg text-destructive hover:text-destructive" onClick={() => { setRemovalReason(""); setRemovalAction("delete"); }}>
              <Trash2 className="h-3.5 w-3.5" /> Delete
            </Button>
          )}
        </div>
      </div>

      {/* Stats Cards Row */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="rounded-xl bg-card card-shadow p-5 transition-all duration-280 ease-standard hover:elevation-mid hover:-translate-y-1">
          <div className="flex items-center justify-between mb-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-success/10">
              <TrendingUp className="h-4 w-4 text-success" />
            </div>
            <span className="text-[10px] font-medium text-success bg-success/10 px-2 py-0.5 rounded-full">+{attendancePct}%</span>
          </div>
          <p className="text-xs text-muted-foreground">Attendance rate</p>
          <p className="text-2xl font-bold text-foreground mt-1.5">{attendancePct}%</p>
          {/* Mini sparkline placeholder */}
          <div className="flex items-end gap-0.5 mt-3 h-6">
            {[40, 60, 45, 70, 85, 65, 90, 75, 80, 95].map((h, i) => (
              <div key={i} className="flex-1 rounded-sm bg-success/20" style={{ height: `${h}%` }} />
            ))}
          </div>
        </div>

        <div className="rounded-xl bg-card card-shadow p-5 transition-all duration-280 ease-standard hover:elevation-mid hover:-translate-y-1">
          <div className="flex items-center justify-between mb-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-chart-5/10">
              <BarChart3 className="h-4 w-4 text-chart-5" />
            </div>
            <span className="text-[10px] font-medium text-chart-5 bg-chart-5/10 px-2 py-0.5 rounded-full">{exams.length} exams</span>
          </div>
          <p className="text-xs text-muted-foreground">Average exam score</p>
          <p className="text-2xl font-bold text-foreground mt-1.5">{avgScore}%</p>
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
          <TabsTrigger value="documents" className="rounded-md text-xs data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">
            Documents{(studentDocs.length + leadDocs.length + appDocs.length) > 0 && <span className="ml-1 rounded-full bg-primary/15 px-1.5 py-0.5 text-[10px] font-semibold">{studentDocs.length + leadDocs.length + appDocs.length}</span>}
          </TabsTrigger>
          <TabsTrigger value="fees" className="rounded-md text-xs data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">Fee Ledger</TabsTrigger>
          <TabsTrigger value="attendance" className="rounded-md text-xs data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">Attendance</TabsTrigger>
          <TabsTrigger value="exams" className="rounded-md text-xs data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">Exams</TabsTrigger>
          <TabsTrigger value="audit" className="rounded-md text-xs data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">
            Audit{auditRows.length > 0 && <span className="ml-1 rounded-full bg-primary/15 px-1.5 py-0.5 text-[10px] font-semibold">{auditRows.length}</span>}
          </TabsTrigger>
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
                            <Link to={`/students/${sib.admission_no || sib.pre_admission_no}`} className="font-medium text-primary hover:underline">
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
                <Detail label="Batch" value={batchLabel || "—"} />
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
            <TransferCertificateSection studentId={student.id} leadId={student.lead_id} archived={!!(student as { archived_at?: string | null }).archived_at} />
            {canUploadDocuments && (
              <div className="rounded-xl bg-card card-shadow p-5 space-y-4">
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
                      ? <ShieldCheck className="h-4 w-4 text-success" />
                      : doc.status === "rejected"
                      ? <AlertCircle className="h-4 w-4 text-destructive" />
                      : <Clock3 className="h-4 w-4 text-warning" />;
                    const isImage = /\.(jpg|jpeg|png|gif|webp)$/i.test(doc.file_name ?? "");
                    return (
                      <div key={doc.id} className="flex items-center gap-3 py-2.5">
                        {isImage && doc.file_url
                          ? <img src={doc.file_url} alt={doc.document_name} className="h-9 w-9 rounded object-cover border border-border shrink-0" />
                          : <div className="h-9 w-9 rounded bg-muted flex items-center justify-center shrink-0"><FileText className="h-4 w-4 text-muted-foreground" /></div>
                        }
                        <div className="flex-1 min-w-0">
                          <p className="text-sm text-foreground truncate">{doc.document_name}</p>
                          {doc.rejection_reason && <p className="text-[11px] text-destructive truncate">{doc.rejection_reason}</p>}
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

        <TabsContent value="audit">
          <div className="mt-4 rounded-xl bg-card card-shadow p-5">
            <div className="mb-4 flex items-center gap-2">
              <History className="h-4 w-4 text-muted-foreground" />
              <h3 className="text-sm font-semibold text-foreground">Audit Trail</h3>
            </div>
            {auditRows.length === 0 ? (
              <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
                No profile edits, document uploads, or photo uploads have been logged for this student.
              </div>
            ) : (
              <div className="space-y-3">
                {auditRows.map((row) => (
                  <AuditEvent key={row.id} row={row} fmtDate={fmtDate} actorName={row.actor_user_id ? auditActors[row.actor_user_id] : undefined} />
                ))}
              </div>
            )}
          </div>
        </TabsContent>
      </Tabs>

      <Dialog open={removalAction !== null} onOpenChange={(o) => { if (!o) { setRemovalAction(null); setRemovalReason(""); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{removalAction === "delete" ? "Delete Student" : "Archive Student"}</DialogTitle>
            <DialogDescription>
              {removalAction === "delete"
                ? "This removes the student from active lists. Fee, attendance and audit history are preserved. A reason is required."
                : "Archiving marks the student as left/inactive. It is reversible and is required before a transfer certificate can be issued. A reason is required."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="removal-reason">Reason</Label>
            <Textarea id="removal-reason" value={removalReason} onChange={(e) => setRemovalReason(e.target.value)} rows={3}
              placeholder={removalAction === "delete" ? "Reason for deletion" : "Reason for archiving"} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setRemovalAction(null); setRemovalReason(""); }} disabled={removalBusy}>Cancel</Button>
            <Button variant={removalAction === "delete" ? "destructive" : "default"} onClick={submitRemoval} disabled={removalBusy || !removalReason.trim()}>
              {removalBusy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              {removalAction === "delete" ? "Delete" : "Archive"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle>Correct Student Information</DialogTitle>
            <DialogDescription>
              Saved corrections are written to the student audit trail with the old value, new value, and reason.
            </DialogDescription>
          </DialogHeader>

          <div className="max-h-[65vh] overflow-y-auto pr-1">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {EDIT_FIELDS.map((field) => {
                const inputType = "type" in field ? field.type : undefined;
                return (
                <div key={field.key} className={inputType === "textarea" ? "grid gap-1.5 md:col-span-2" : "grid gap-1.5"}>
                  <Label htmlFor={`edit-${field.key}`} className="text-xs">{field.label}</Label>
                  {inputType === "textarea" ? (
                    <textarea
                      id={`edit-${field.key}`}
                      value={editForm[field.key]}
                      onChange={(event) => setEditForm((current) => ({ ...current, [field.key]: event.target.value }))}
                      rows={3}
                      className="rounded-lg border border-input bg-background px-3 py-2 text-sm"
                      disabled={editSaving}
                    />
                  ) : (
                    <Input
                      id={`edit-${field.key}`}
                      type={inputType || "text"}
                      value={editForm[field.key]}
                      onChange={(event) => setEditForm((current) => ({ ...current, [field.key]: event.target.value }))}
                      disabled={editSaving}
                    />
                  )}
                </div>
              );
              })}
              <div className="grid gap-1.5 md:col-span-2">
                <Label htmlFor="student-correction-reason" className="text-xs">Correction reason</Label>
                <textarea
                  id="student-correction-reason"
                  value={editReason}
                  onChange={(event) => setEditReason(event.target.value)}
                  rows={3}
                  className="rounded-lg border border-input bg-background px-3 py-2 text-sm"
                  placeholder="Why is this information being corrected?"
                  disabled={editSaving}
                />
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setEditDialogOpen(false)} disabled={editSaving}>Cancel</Button>
            <Button type="button" onClick={submitProfileCorrections} disabled={editSaving}>
              {editSaving && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}
              Save Corrections
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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

const AuditEvent = ({ row, fmtDate, actorName }: { row: StudentAuditRow; fmtDate: (value: string | null | undefined) => string; actorName?: string }) => {
  const metadata = row.metadata || {};
  const eventLabel: Record<string, string> = {
    profile_update: "Profile updated",
    document_upload: "Document uploaded",
    photo_upload: "Photo uploaded",
  };
  const title = eventLabel[row.event_type] || row.event_type.replace(/_/g, " ");
  const documentName = typeof metadata.document_name === "string" ? metadata.document_name : null;
  const fileName = typeof metadata.file_name === "string" ? metadata.file_name : null;

  return (
    <div className="rounded-lg border border-border p-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="text-sm font-medium text-foreground">{title}</p>
          <p className="text-[11px] text-muted-foreground">
            {fmtDate(row.created_at)}
            {(actorName || row.actor_user_id) && <> · by {actorName || "Unknown user"}</>}
          </p>
        </div>
        {row.field_name && (
          <span className="w-fit rounded-md bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
            {fieldLabel(row.field_name)}
          </span>
        )}
      </div>
      {row.event_type === "profile_update" && (
        <div className="mt-3 grid gap-2 text-xs sm:grid-cols-2">
          <div className="rounded-md bg-muted/40 p-2">
            <p className="text-[10px] uppercase text-muted-foreground">Old value</p>
            <p className="mt-1 break-words text-foreground">{row.old_value || "—"}</p>
          </div>
          <div className="rounded-md bg-muted/40 p-2">
            <p className="text-[10px] uppercase text-muted-foreground">New value</p>
            <p className="mt-1 break-words text-foreground">{row.new_value || "—"}</p>
          </div>
        </div>
      )}
      {row.event_type !== "profile_update" && (
        <p className="mt-2 text-xs text-muted-foreground">
          {[documentName || row.new_value, fileName].filter(Boolean).join(" · ") || "Upload recorded"}
        </p>
      )}
      {row.reason && <p className="mt-2 text-xs text-muted-foreground">Reason: {row.reason}</p>}
    </div>
  );
};

const Detail = ({ label, value }: { label: string; value: string }) => (
  <div>
    <p className="text-[11px] text-muted-foreground">{label}</p>
    <p className="text-sm font-medium text-foreground mt-0.5">{value}</p>
  </div>
);

const StatCard = ({ label, value, icon, color }: { label: string; value: string; icon: ReactNode; color: string }) => (
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
