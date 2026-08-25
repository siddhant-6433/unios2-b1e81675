import { useState, useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ButtonOrb } from "@/components/ui/thinking-orb";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { isSchoolSessionYear, sessionYearLabel } from "@/lib/sessionYears";
import { normalizeStudentImportDate, resolveStudentImportAdmissionDate } from "@/lib/studentImportDate";
import { Upload, FileText, CheckCircle, XCircle, Download, AlertTriangle, Users } from "lucide-react";

interface Course    { id: string; name: string; code: string; }
interface Campus    { id: string; name: string; }
interface Institution { id: string; name: string; code: string; type: string; }
interface Session   { id: string; name: string; }

interface ParsedRow {
  name: string;
  first_name: string;
  middle_name: string;
  last_name: string;
  dob: string;
  gender: string;
  grade: string;         // raw grade/course string from CSV
  current_term: string;
  section: string;
  class_roll_no: string;
  admission_date: string;
  admission_no: string;  // existing admission no from previous system
  father_name: string;
  father_phone: string;
  father_email: string;
  father_occupation: string;
  father_qualification: string;
  father_income: string;
  father_aadhar: string;
  mother_name: string;
  mother_phone: string;
  mother_email: string;
  mother_occupation: string;
  mother_aadhar: string;
  guardian_name: string;
  guardian_phone: string;
  address: string;
  city: string;
  state: string;
  country: string;
  pincode: string;
  student_aadhar: string;
  nationality: string;
  religion: string;
  caste: string;
  sub_caste: string;
  caste_category: string;
  mother_tongue: string;
  student_type: string;
  school_admission_no: string;
  whatsapp_no: string;
  student_email: string;
  previous_school: string;
  previous_class: string;
  joining_academic_year: string;
  house: string;
  blood_group: string;
  height: string;
  weight: string;
  identification_marks_1: string;
  identification_marks_2: string;
  food_habits: string;
  state_enrollment_no: string;
  birth_place: string;
  language_spoken: string;
  sports: string;
  second_language: string;
  third_language: string;
  bank_name: string;
  ifsc_code: string;
  bank_account_no: string;
  fee_remarks: string;
  transport_required: boolean | null;
  tc_submitted: boolean | null;
  dob_certificate_submitted: boolean | null;
  marksheet_submitted: boolean | null;
  rte_student: boolean | null;
  pen: string;
  udise: string;
  apaar_id: string;
  is_asthmatic: boolean | null;
  allergies_medicine: string;
  allergies_food: string;
  vision: string;
  medical_ailments: string;
  physical_handicap: string;
  fee_type: string;
  family_key: string;
  sibling_count: number;
  // Resolved
  course_id: string | null;
  fee_version: "new_admission" | "existing_parent" | "standard" | "stetho_batch";
  // Status
  valid: boolean;
  error: string;
}

const HIGHER_ED_TERMS = [
  "Sem 1", "Sem 2", "Sem 3", "Sem 4", "Sem 5", "Sem 6", "Sem 7", "Sem 8", "Sem 9", "Sem 10",
  "Year 1", "Year 2", "Year 3", "Year 4", "Year 5",
];

interface BulkStudentImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}

interface ImportResult {
  success: number;
  failed: number;
  errors: string[];
}

// Grade name variants → course code suffix (for school institutions)
const GRADE_MAP: Record<string, string> = {
  "toddler": "TOD", "tod": "TOD",
  "nursery": "NUR", "nur": "NUR",
  "lkg": "LKG", "lower kg": "LKG", "lower kindergarten": "LKG",
  "ukg": "UKG", "upper kg": "UKG", "upper kindergarten": "UKG",
  "grade i": "G1",   "grade 1": "G1",   "class i": "G1",   "class 1": "G1",   "1": "G1",   "i": "G1",
  "grade ii": "G2",  "grade 2": "G2",   "class ii": "G2",  "class 2": "G2",   "2": "G2",   "ii": "G2",
  "grade iii": "G3", "grade 3": "G3",   "class iii": "G3", "class 3": "G3",   "3": "G3",   "iii": "G3",
  "grade iv": "G4",  "grade 4": "G4",   "class iv": "G4",  "class 4": "G4",   "4": "G4",   "iv": "G4",
  "grade v": "G5",   "grade 5": "G5",   "class v": "G5",   "class 5": "G5",   "5": "G5",   "v": "G5",
  "grade vi": "G6",  "grade 6": "G6",   "class vi": "G6",  "class 6": "G6",   "6": "G6",   "vi": "G6",
  "grade vii": "G7", "grade 7": "G7",   "class vii": "G7", "class 7": "G7",   "7": "G7",   "vii": "G7",
  "grade viii": "G8","grade 8": "G8",   "class viii": "G8","class 8": "G8",   "8": "G8",   "viii": "G8",
  "grade ix": "G9",  "grade 9": "G9",   "class ix": "G9",  "class 9": "G9",   "9": "G9",   "ix": "G9",
  "grade x": "G10",  "grade 10": "G10", "class x": "G10",  "class 10": "G10", "10": "G10", "x": "G10",
  "grade xi": "G11", "grade 11": "G11", "class xi": "G11", "class 11": "G11", "11": "G11", "xi": "G11",
  "grade xii": "G12","grade 12": "G12", "class xii": "G12","class 12": "G12", "12": "G12", "xii": "G12",
};

// Grade string suffix labels for display
const GRADE_LABELS: Record<string, string> = {
  TOD: "Toddler", NUR: "Nursery", LKG: "LKG", UKG: "UKG",
  G1: "Grade I",   G2: "Grade II",  G3: "Grade III", G4: "Grade IV",
  G5: "Grade V",   G6: "Grade VI",  G7: "Grade VII", G8: "Grade VIII",
  G9: "Grade IX",  G10: "Grade X",  G11: "Grade XI", G12: "Grade XII",
};

function isSchoolInstitution(inst: Institution | null) {
  if (!inst) return false;
  return inst.type === "school" ||
    /bsa|bsav|mirai|beacon/i.test(inst.code) ||
    /school/i.test(inst.name);
}

function courseLabel(c: Course) {
  const suffix = c.code.split("-").pop() || "";
  return GRADE_LABELS[suffix] ? `${GRADE_LABELS[suffix]} (${c.code})` : c.name;
}

/** Resolve a grade string to a course_id for school institutions */
function resolveGrade(raw: string, courses: Course[]): string | null {
  const key = raw.trim().toLowerCase();
  const suffix = GRADE_MAP[key];
  if (!suffix) return null;
  // Prefer exact code ending match; fallback to first suffix match
  return courses.find(c => c.code.endsWith(`-${suffix}`))?.id || null;
}

/** Resolve a course/programme name/code to a course_id for non-school institutions */
function resolveCourse(raw: string, courses: Course[]): string | null {
  const key = raw.trim().toLowerCase();
  return (
    courses.find(c => c.code.toLowerCase() === key)?.id ||
    courses.find(c => c.name.toLowerCase() === key)?.id ||
    courses.find(c => c.name.toLowerCase().includes(key) || key.includes(c.code.toLowerCase()))?.id ||
    null
  );
}

function isDaottCourse(course: Course | undefined) {
  const code = String(course?.code || "").toUpperCase();
  const name = String(course?.name || "").toLowerCase();
  return code.includes("DAOTT") || code.includes("DOTT") || /ana?esthesia.*operation theatre/.test(name);
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const cols: string[] = [];
    let cur = "", inQ = false;
    for (let i = 0; i < trimmed.length; i++) {
      const ch = trimmed[i];
      if (ch === '"') { inQ = !inQ; }
      else if (ch === "," && !inQ) { cols.push(cur.trim()); cur = ""; }
      else cur += ch;
    }
    cols.push(cur.trim());
    rows.push(cols);
  }
  return rows;
}

function headerKey(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

function compactName(parts: Array<string | null | undefined>) {
  return parts.map(p => String(p || "").trim()).filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
}

function normalizePhone(value: string) {
  const digits = value.replace(/\D/g, "");
  if (!digits) return "";
  if (digits.length === 12 && digits.startsWith("91")) return digits.slice(2);
  return digits;
}

function normalizeGender(value: string) {
  const key = value.trim().toLowerCase();
  if (key === "m" || key === "male") return "male";
  if (key === "f" || key === "female") return "female";
  if (key === "o" || key === "other") return "other";
  return key;
}

function normalizeStudentType(value: string) {
  const key = value.trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (key === "day_scholar" || key === "dayscholar") return "day_scholar";
  if (key === "boarder" || key === "hosteller" || key === "hostel") return "boarder";
  return value.trim();
}

function parseYesNo(value: string): boolean | null {
  const key = value.trim().toLowerCase();
  if (["yes", "y", "true", "1"].includes(key)) return true;
  if (["no", "n", "false", "0"].includes(key)) return false;
  return null;
}

function familyKeyFor(row: Pick<ParsedRow, "father_phone" | "mother_phone" | "guardian_phone" | "father_name" | "mother_name" | "guardian_name">) {
  const phone = [row.father_phone, row.mother_phone, row.guardian_phone].map(normalizePhone).find(Boolean);
  if (phone) return `phone:${phone}`;

  const father = row.father_name.trim().toLowerCase();
  const mother = row.mother_name.trim().toLowerCase();
  const guardian = row.guardian_name.trim().toLowerCase();
  if (father && mother) return `parents:${father}|${mother}`;
  if (guardian) return `guardian:${guardian}`;
  if (father.length > 4) return `father:${father}`;
  if (mother.length > 4) return `mother:${mother}`;
  return "";
}

function withSiblingCounts(rows: ParsedRow[]) {
  const counts = new Map<string, number>();
  rows.forEach(row => {
    if (!row.family_key) return;
    counts.set(row.family_key, (counts.get(row.family_key) || 0) + 1);
  });
  return rows.map(row => ({ ...row, sibling_count: row.family_key ? counts.get(row.family_key) || 1 : 1 }));
}

export function BulkStudentImportDialog({ open, onOpenChange, onSuccess }: BulkStudentImportDialogProps) {
  const { user } = useAuth();
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [parsed, setParsed] = useState<ParsedRow[]>([]);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);

  const [allCampuses,   setAllCampuses]   = useState<Campus[]>([]);
  const [institutions,  setInstitutions]  = useState<Institution[]>([]);
  const [courses,       setCourses]       = useState<Course[]>([]);
  const [sessions,      setSessions]      = useState<Session[]>([]);

  const [selectedCampusId,      setSelectedCampusId]      = useState("");
  const [selectedInstitutionId, setSelectedInstitutionId] = useState("");
  const [selectedSessionId,     setSelectedSessionId]     = useState("");
  const [selectedCurrentTerm,   setSelectedCurrentTerm]   = useState("");
  const [selectedAdmissionDate, setSelectedAdmissionDate] = useState(new Date().toISOString().slice(0, 10));
  const [batchLabel,            setBatchLabel]            = useState("");
  const [applyExistingFeeToAll, setApplyExistingFeeToAll] = useState(false);

  // Load campuses + sessions on open
  useEffect(() => {
    if (!open) return;
    setParsed([]); setResult(null); setApplyExistingFeeToAll(false); setSelectedCurrentTerm(""); setBatchLabel(""); setSelectedAdmissionDate(new Date().toISOString().slice(0, 10));
    Promise.all([
      supabase.from("campuses").select("id, name").order("name"),
      supabase.from("admission_sessions").select("id, name").eq("is_active", true).order("start_date"),
    ]).then(([cam, ses]) => {
      if (cam.data) { setAllCampuses(cam.data); if (cam.data.length === 1) setSelectedCampusId(cam.data[0].id); }
      if (ses.data) {
        const schoolSessions = ses.data.filter((session) => isSchoolSessionYear(session.name));
        setSessions(schoolSessions);
        if (schoolSessions.length === 1) setSelectedSessionId(schoolSessions[0].id);
      }
    });
  }, [open]);

  // Campus changed → load institutions
  useEffect(() => {
    if (!selectedCampusId) { setInstitutions([]); setCourses([]); setSelectedInstitutionId(""); return; }
    setSelectedInstitutionId("");
    setCourses([]);
    supabase.from("institutions").select("id, name, code, type")
      .eq("campus_id", selectedCampusId).order("name")
      .then(({ data }) => {
        const insts = data || [];
        setInstitutions(insts);
        if (insts.length === 1) setSelectedInstitutionId(insts[0].id);
      });
  }, [selectedCampusId]);

  // Institution changed → load courses
  useEffect(() => {
    if (!selectedInstitutionId) { setCourses([]); setParsed([]); return; }
    setParsed([]);
    setSelectedCurrentTerm("");
    supabase.from("courses")
      .select("id, name, code, departments!inner(institution_id)")
      .eq("departments.institution_id", selectedInstitutionId)
      .order("code")
      .then(({ data }) => setCourses((data as any) || []));
  }, [selectedInstitutionId]);

  const selectedCampus      = allCampuses.find(c => c.id === selectedCampusId) || null;
  const selectedInstitution = institutions.find(i => i.id === selectedInstitutionId) || null;
  const selectedSession     = sessions.find(s => s.id === selectedSessionId) || null;
  const isSchool            = isSchoolInstitution(selectedInstitution);

  const reparse = (rows: ParsedRow[], forceExisting: boolean) =>
    rows.map(r => ({
      ...r,
      fee_version: isSchool
        ? ((forceExisting || r.admission_no.trim() || r.fee_type === "existing")
            ? "existing_parent" as const
            : "new_admission" as const)
        : "standard" as const,
    }));

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      const rows = parseCsv(text);
      if (rows.length < 2) {
        toast({ title: "Error", description: "CSV must have a header row and data rows", variant: "destructive" });
        return;
      }
      const headers = rows[0].map(headerKey);
      const idx = (col: string) => headers.indexOf(headerKey(col));

      const hasAny = (...cols: string[]) => cols.some(col => idx(col) !== -1);
      if (!hasAny("name", "full_name", "student_first_name", "first_name")) {
        toast({ title: "Error", description: "CSV must have a name, full_name, or student_first_name column", variant: "destructive" });
        return;
      }

      const data: ParsedRow[] = rows.slice(1).map(cols => {
        const get = (...names: string[]) => {
          for (const col of names) {
            const index = idx(col);
            if (index !== -1) {
              const value = (cols[index] || "").trim();
              if (value) return value;
            }
          }
          return "";
        };
        const first_name   = get("first_name", "student_first_name");
        const middle_name  = get("middle_name");
        const last_name    = get("last_name", "surname");
        const name         = get("name", "full_name", "student_name") || compactName([first_name, middle_name, last_name]);
        const rawDob       = get("dob", "date_of_birth", "birth_date");
        const dob          = normalizeStudentImportDate(rawDob);
        const gender       = normalizeGender(get("gender"));
        const grade        = get("grade", "class", "class_name", "course", "programme", "admitted_class", "attendance_class", "joining_class");
        const current_term = get("current_term") || get("current_semester") || get("semester") || get("year");
        const section      = get("section");
        const class_roll_no = get("class_roll_no", "class_roll_number");
        const rawAdmissionDate = get("admission_date") || get("admissiondate") || get("date_of_admission") || get("dateofadmission");
        const admission_date = normalizeStudentImportDate(rawAdmissionDate);
        const admission_no = get("admission_no", "admissionno", "admision_no", "admission_number", "student_admission_number");
        const school_admission_no = get("school_admission_no", "school_admission_number") || admission_no;
        const father_name  = get("father_name", "father");
        const father_phone = normalizePhone(get("father_phone", "father_mobile", "father_s_mobile", "father_other_mobile"));
        const father_email = get("father_email");
        const father_occupation = get("father_occupation");
        const father_qualification = get("father_qualification");
        const father_income = get("father_income");
        const father_aadhar = get("father_aadhar", "father_aadhaar", "father_aadhaar_number", "father_aadhar_number");
        const mother_name  = get("mother_name", "mother");
        const mother_phone = normalizePhone(get("mother_phone", "mother_mobile", "mother_s_mobile", "mother_other_mobile"));
        const mother_email = get("mother_email");
        const mother_occupation = get("mother_occupation");
        const mother_aadhar = get("mother_aadhar", "mother_aadhaar", "mother_aadhaar_number", "mother_aadhar_number");
        const guardian_name = get("guardian_name");
        const guardian_phone = normalizePhone(get("guardian_phone", "guardian_mobile"));
        const address = get("address", "residence_address", "correspondence_address");
        const city = get("city");
        const state = get("state");
        const country = get("country");
        const pincode = get("pincode", "pin_code");
        const student_aadhar = get("student_aadhar", "student_aadhaar", "aadhar_number", "aadhaar_number");
        const nationality = get("nationality");
        const religion = get("religion");
        const caste = get("caste");
        const sub_caste = get("sub_caste");
        const caste_category = get("caste_category");
        const mother_tongue = get("mother_tongue");
        const student_type = normalizeStudentType(get("student_type"));
        const whatsapp_no = normalizePhone(get("whatsapp_no", "whatsapp"));
        const student_email = get("student_email");
        const previous_school = get("previous_school");
        const previous_class = get("previous_class", "last_class_attended");
        const joining_academic_year = get("joining_academic_year", "academic_year");
        const house = get("house");
        const blood_group = get("blood_group");
        const height = get("height");
        const weight = get("weight");
        const identification_marks_1 = get("identification_marks", "identification_marks_1");
        const identification_marks_2 = get("identification_marks1", "identification_marks_2");
        const food_habits = get("food_habits", "food_habbits");
        const state_enrollment_no = get("state_enrollment_number", "state_enrollment_no");
        const birth_place = get("birth_place");
        const language_spoken = get("language_spoken");
        const sports = get("sports", "sports_games");
        const second_language = get("ii_language", "second_language");
        const third_language = get("iii_language", "third_language");
        const bank_name = get("bank_name");
        const ifsc_code = get("ifsc_code", "ifsc");
        const bank_account_no = get("bank_account_number", "bank_account_no");
        const fee_remarks = get("fee_remarks");
        const transport_required = parseYesNo(get("transport_required", "transport_status"));
        const tc_submitted = parseYesNo(get("tc_submitted", "check_transfer_certificate"));
        const dob_certificate_submitted = parseYesNo(get("dob_certificate_submitted", "check_date_of_birth"));
        const marksheet_submitted = parseYesNo(get("marksheet_submitted", "check_marksheet_of_previous_school", "check_report_card"));
        const rte_student = parseYesNo(get("rte_student"));
        const pen = get("pen", "pen_no");
        const udise = get("udise", "udise_no");
        const apaar_id = get("apaar_id");
        const is_asthmatic = parseYesNo(get("asthmatic", "asthama", "asthma"));
        const allergies_medicine = get("allergies_medicine");
        const allergies_food = get("allergies_food");
        const vision = compactName([get("vision"), get("vision_type"), get("vision_right") && `Right: ${get("vision_right")}`, get("vision_left") && `Left: ${get("vision_left")}`]);
        const medical_ailments = get("medical_ailments", "physical_ailment", "asthamatic_details");
        const physical_handicap = get("physical_handicap", "disability");
        const fee_type     = get("fee_type") || get("applicant_type");
        const family_key = familyKeyFor({ father_phone, mother_phone, guardian_phone, father_name, mother_name, guardian_name });

        const course_id = grade
          ? isSchool
            ? resolveGrade(grade, courses)
            : resolveCourse(grade, courses)
          : null;

        let valid = true, error = "";
        if (!name)               { valid = false; error = "Name required"; }
        else if (rawDob && !dob)  { valid = false; error = `Invalid date of birth: "${rawDob}"`; }
        else if (grade && !course_id) {
          valid = false;
          error = isSchool ? `Unknown grade: "${grade}"` : `Unknown course: "${grade}"`;
        } else if (rawAdmissionDate && !admission_date) {
          valid = false;
          error = `Invalid admission date: "${rawAdmissionDate}"`;
        }

        const resolvedCourse = course_id ? courses.find(c => c.id === course_id) : undefined;
        const fee_version: "new_admission" | "existing_parent" | "standard" | "stetho_batch" = isSchool
          ? ((applyExistingFeeToAll || admission_no || fee_type === "existing")
              ? "existing_parent" : "new_admission")
          : isDaottCourse(resolvedCourse) ? "stetho_batch" : "standard";

        return {
          name, first_name, middle_name, last_name, dob, gender, grade, current_term, section, class_roll_no, admission_date, admission_no,
          father_name, father_phone, father_email, father_occupation, father_qualification, father_income, father_aadhar,
          mother_name, mother_phone, mother_email, mother_occupation, mother_aadhar,
          guardian_name, guardian_phone, address, city, state, country, pincode, student_aadhar, nationality, religion,
          caste, sub_caste, caste_category, mother_tongue, student_type, school_admission_no, whatsapp_no, student_email,
          previous_school, previous_class, joining_academic_year, house, blood_group, height, weight, identification_marks_1,
          identification_marks_2, food_habits, state_enrollment_no, birth_place, language_spoken, sports, second_language,
          third_language, bank_name, ifsc_code, bank_account_no, fee_remarks, transport_required, tc_submitted,
          dob_certificate_submitted, marksheet_submitted, rte_student, pen, udise, apaar_id, is_asthmatic,
          allergies_medicine, allergies_food, vision, medical_ailments, physical_handicap, fee_type, family_key,
          sibling_count: 1, course_id, fee_version, valid, error,
        };
      });

      setParsed(withSiblingCounts(data));
      setResult(null);
    };
    reader.readAsText(file);
  };

  // Recompute fee versions when toggle or institution changes
  useEffect(() => {
    if (parsed.length) setParsed(prev => reparse(prev, applyExistingFeeToAll));
  }, [applyExistingFeeToAll, isSchool]);

  const handleImport = async () => {
    const valid = parsed.filter(r => r.valid);
    if (!valid.length || !selectedCampusId || !selectedInstitutionId || !selectedSessionId) return;
    setImporting(true);
    let success = 0, failed = 0;
    const errors: string[] = [];

    // Resolve a batch per course from the typed label (e.g. "2025-27"). One
    // label spans the whole file, but batches are course-scoped, so get-or-create
    // one batch per distinct course under the chosen session. Empty label keeps
    // the old behaviour (no batch assigned). Non-school only — school cohorts use
    // joining_academic_year, not batches.
    const batchByCourse: Record<string, string> = {};
    const label = batchLabel.trim();
    if (label && !isSchool) {
      const courseIds = [...new Set(valid.map(r => r.course_id).filter(Boolean))];
      for (const cid of courseIds) {
        const { data: bid, error } = await (supabase.rpc as any)("get_or_create_batch", {
          _course_id: cid, _session_id: selectedSessionId, _name: label,
        });
        if (error) { errors.push(`Batch "${label}": ${error.message}`); continue; }
        if (bid) batchByCourse[cid as string] = bid as string;
      }
    }

    for (let i = 0; i < valid.length; i += 50) {
      const batch = valid.slice(i, i + 50).map((r, j) => ({
        name: r.name,
        first_name: r.first_name || null,
        middle_name: r.middle_name || null,
        last_name: r.last_name || null,
        dob:  r.dob  || null,
        gender: r.gender || null,
        course_id: r.course_id,
        campus_id: selectedCampusId,
        session_id: selectedSessionId || null,
        batch_id: batchByCourse[r.course_id] ?? null,
        joining_academic_year: isSchool ? (r.joining_academic_year || sessionYearLabel(selectedSession?.name) || null) : null,
        semester: !isSchool ? (selectedCurrentTerm || r.current_term || null) : null,
        admission_date: resolveStudentImportAdmissionDate(r.admission_date, selectedAdmissionDate),
        date_of_admission: resolveStudentImportAdmissionDate(r.admission_date, selectedAdmissionDate),
        admission_no: r.admission_no || null, // ponytail: preserve CSV admission_no for all institution types
        school_admission_no: (isSchool && r.school_admission_no) ? r.school_admission_no : null,
        pre_admission_no: r.admission_no
          ? null
          : `IMP-${Date.now().toString(36).toUpperCase()}-${i + j}`,
        section: r.section || null,
        class_roll_no: r.class_roll_no || null,
        father_name:  r.father_name  || null,
        father_phone: r.father_phone || null,
        father_email: r.father_email || null,
        father_occupation: r.father_occupation || null,
        father_qualification: r.father_qualification || null,
        father_income: r.father_income || null,
        father_aadhar: r.father_aadhar || null,
        mother_name:  r.mother_name  || null,
        mother_phone: r.mother_phone || null,
        mother_email: r.mother_email || null,
        mother_occupation: r.mother_occupation || null,
        mother_aadhar: r.mother_aadhar || null,
        guardian_name:  r.guardian_name || r.father_name || null,
        guardian_phone: r.guardian_phone || r.father_phone || r.mother_phone || null,
        address: r.address || null,
        city: r.city || null,
        state: r.state || null,
        country: r.country || null,
        pincode: r.pincode || null,
        student_aadhar: r.student_aadhar || null,
        nationality: r.nationality || null,
        religion: r.religion || null,
        caste: r.caste || null,
        sub_caste: r.sub_caste || null,
        caste_category: r.caste_category || null,
        mother_tongue: r.mother_tongue || null,
        student_type: r.student_type || null,
        whatsapp_no: r.whatsapp_no || null,
        student_email: r.student_email || null,
        previous_school: r.previous_school || null,
        previous_class: r.previous_class || null,
        joining_class: isSchool ? r.grade || null : null,
        house: r.house || null,
        blood_group: r.blood_group || null,
        identification_marks_1: r.identification_marks_1 || null,
        identification_marks_2: r.identification_marks_2 || null,
        food_habits: r.food_habits || null,
        state_enrollment_no: r.state_enrollment_no || null,
        birth_place: r.birth_place || null,
        language_spoken: r.language_spoken || null,
        sports: r.sports || null,
        second_language: r.second_language || null,
        third_language: r.third_language || null,
        bank_name: r.bank_name || null,
        ifsc_code: r.ifsc_code || null,
        bank_account_no: r.bank_account_no || null,
        fee_remarks: r.fee_remarks || null,
        transport_required: r.transport_required ?? false,
        tc_submitted: r.tc_submitted ?? false,
        dob_certificate_submitted: r.dob_certificate_submitted ?? false,
        marksheet_submitted: r.marksheet_submitted ?? false,
        rte_student: r.rte_student ?? null,
        pen: r.pen || null,
        udise: r.udise || null,
        apaar_id: r.apaar_id || null,
        is_asthmatic: r.is_asthmatic ?? false,
        allergies_medicine: r.allergies_medicine || null,
        allergies_food: r.allergies_food || null,
        vision: r.vision || null,
        medical_ailments: r.medical_ailments || null,
        physical_handicap: r.physical_handicap || null,
        fee_structure_version: r.fee_version,
        status: "active",
        created_by: user?.id || null,
      }));

      const { error, data } = await supabase.from("students").insert(batch as any).select("id");
      if (error) {
        failed += batch.length;
        errors.push(error.message || `Batch ${Math.floor(i / 50) + 1} failed`);
        console.error(error);
      } else if (!data?.length) {
        failed += batch.length;
        errors.push(`Batch ${Math.floor(i / 50) + 1} returned no inserted student IDs.`);
        console.error("[bulk-student-import] insert returned no rows", { batchStart: i, batchSize: batch.length });
      } else {
        success += data.length;
        if (data.length !== batch.length) {
          failed += batch.length - data.length;
          errors.push(`Batch ${Math.floor(i / 50) + 1} inserted ${data.length} of ${batch.length} students.`);
        }
        // ponytail: auto-provision fees for imported students (same as Beacon dialog)
        const studentIds = data.map((s: any) => s.id);
        supabase.functions.invoke("provision-student-fees", {
          body: { student_ids: studentIds },
        }).catch(err => console.error("Fee provisioning failed:", err));
      }
    }

    setResult({ success, failed, errors });
    setImporting(false);
    if (success > 0) onSuccess();
  };

  const downloadTemplate = () => {
    const schoolHeader = "name,dob,gender,grade,section,admission_date,admission_no,father_name,father_phone,mother_name,mother_phone,fee_type";
    const collegeHeader = "name,dob,gender,course,current_term,section,admission_date,father_name,father_phone,mother_name,mother_phone";
    const header = isSchool ? schoolHeader : collegeHeader;
    const ex1 = isSchool
      ? "Rohan Sharma,2016-06-12,Male,Grade III,A,2024-04-01,1803188,Rajesh Sharma,9876543210,Priya Sharma,9876543211,existing"
      : "Rohan Sharma,2004-06-12,Male,BCA,Sem 1,A,2024-04-01,Rajesh Sharma,9876543210,Priya Sharma,9876543211";
    const ex2 = isSchool
      ? "Ananya Singh,2017-09-01,Female,Grade II,B,,,Amit Singh,9876543212,Sunita Singh,9876543213,new"
      : "Ananya Singh,2005-09-01,Female,B.Sc Computer Science,Year 1,,,Amit Singh,9876543212,Sunita Singh,9876543213";
    const csv = [header, ex1, ex2].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href     = url;
    a.download = "student_import_template.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  const validCount    = parsed.filter(r => r.valid).length;
  const invalidCount  = parsed.filter(r => !r.valid).length;
  const existingCount = parsed.filter(r => r.valid && r.fee_version === "existing_parent").length;
  const newCount      = parsed.filter(r => r.valid && r.fee_version === "new_admission").length;
  const siblingGroupCount = new Set(parsed.filter(r => r.sibling_count > 1).map(r => r.family_key)).size;

  const canImport = validCount > 0 && !!selectedCampusId && !!selectedInstitutionId && !!selectedSessionId && !!selectedAdmissionDate && (
    isSchool || !!selectedCurrentTerm || parsed.filter(r => r.valid).every(r => !!r.current_term)
  );

  const handleClose = (o: boolean) => {
    if (!importing) { onOpenChange(o); setParsed([]); setResult(null); }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Users className="h-5 w-5" /> Bulk Import Students
          </DialogTitle>
        </DialogHeader>

        {result ? (
          <div className="text-center py-10 space-y-3">
            {result.failed > 0
              ? <AlertTriangle className="h-12 w-12 text-warning mx-auto" />
              : <CheckCircle className="h-12 w-12 text-primary mx-auto" />}
            <p className="text-lg font-semibold text-foreground">
              {result.failed > 0 ? "Import Finished with Issues" : "Import Complete"}
            </p>
            <p className="text-sm text-muted-foreground">{result.success} students imported · {result.failed} failed</p>
            {result.errors.length > 0 && (
              <div className="mx-auto max-w-lg rounded-lg border border-warning/20 bg-warning/5 p-3 text-left">
                <p className="text-xs font-semibold text-warning-foreground">Database response</p>
                <ul className="mt-2 space-y-1 text-xs text-warning-foreground">
                  {result.errors.slice(0, 5).map((error, index) => <li key={index}>{error}</li>)}
                </ul>
              </div>
            )}
            <Button onClick={() => { onOpenChange(false); setParsed([]); setResult(null); }}>Done</Button>
          </div>
        ) : (
          <div className="space-y-4 mt-2">
            {/* Campus → Institution → Session selectors */}
            <div className="grid grid-cols-2 gap-3 p-3 rounded-xl bg-muted/40">
              <div>
                <label className="block text-[11px] font-medium text-muted-foreground mb-1">Campus <span className="text-destructive">*</span></label>
                <select value={selectedCampusId} onChange={e => setSelectedCampusId(e.target.value)}
                  className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring/20">
                  <option value="">Select campus</option>
                  {allCampuses.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-[11px] font-medium text-muted-foreground mb-1">Institution <span className="text-destructive">*</span></label>
                <select value={selectedInstitutionId} onChange={e => setSelectedInstitutionId(e.target.value)}
                  disabled={!selectedCampusId}
                  className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring/20 disabled:opacity-50">
                  <option value="">{selectedCampusId ? "Select institution" : "Select campus first"}</option>
                  {institutions.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}
                </select>
              </div>
              <div className="col-span-2">
                <label className="block text-[11px] font-medium text-muted-foreground mb-1">Session <span className="text-destructive">*</span></label>
                <select value={selectedSessionId} onChange={e => setSelectedSessionId(e.target.value)}
                  className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring/20">
                  <option value="">Select session</option>
                  {sessions.map(s => <option key={s.id} value={s.id}>{sessionYearLabel(s.name)}</option>)}
                </select>
              </div>
              <div className="col-span-2">
                <label className="block text-[11px] font-medium text-muted-foreground mb-1">Admission Date <span className="text-destructive">*</span></label>
                <input type="date" value={selectedAdmissionDate} onChange={e => setSelectedAdmissionDate(e.target.value)}
                  className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring/20" />
              </div>
              {!isSchool && selectedInstitutionId && (
                <div className="col-span-2">
                  <label className="block text-[11px] font-medium text-muted-foreground mb-1">Current Semester / Year <span className="text-destructive">*</span></label>
                  <select value={selectedCurrentTerm} onChange={e => setSelectedCurrentTerm(e.target.value)}
                    className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring/20">
                    <option value="">Use CSV current_term column or select for all rows</option>
                    {HIGHER_ED_TERMS.map(term => <option key={term} value={term}>{term}</option>)}
                  </select>
                </div>
              )}
              {!isSchool && (
                <div className="col-span-2">
                  <label className="block text-[11px] font-medium text-muted-foreground mb-1">Batch</label>
                  <input type="text" value={batchLabel} onChange={e => setBatchLabel(e.target.value)}
                    placeholder="e.g. 2025-27 (admission–graduation year) — optional"
                    className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring/20" />
                  <p className="mt-1 text-[10px] text-muted-foreground">Creates/assigns this batch per course under the selected session. Leave blank to skip.</p>
                </div>
              )}
            </div>

            {/* Fee override toggle — school institutions only */}
            {isSchool && (
              <label className="flex items-start gap-3 p-3 rounded-xl border border-warning/20 bg-warning/5 cursor-pointer select-none">
                <input type="checkbox" checked={applyExistingFeeToAll}
                  onChange={e => setApplyExistingFeeToAll(e.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded border-warning/30 text-warning-foreground" />
                <div>
                  <p className="text-xs font-semibold text-warning-foreground">Apply existing parent fee structure to all rows</p>
                  <p className="text-[11px] text-warning-foreground mt-0.5">
                    Use CPI-revised rates (2026–27) for all imported students. Rows with an admission number already auto-apply existing rates.
                    Without this, rows without an admission no. receive new admission rates.
                  </p>
                </div>
              </label>
            )}

            {!parsed.length ? (
              <div className="border-2 border-dashed border-border rounded-2xl p-12 text-center">
                <Upload className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
                <p className="text-sm font-medium text-foreground mb-1">Upload CSV file</p>
                {selectedInstitution ? (
                  <p className="text-xs text-muted-foreground mb-1">
                    {isSchool
                      ? <>Required: <code className="bg-muted px-1 rounded">name</code> or <code className="bg-muted px-1 rounded">full_name</code>. Optional: dob, gender, grade/class_name, section, admission_date, admission_no, parent phones, address, Aadhaar and profile columns</>
                      : <>Required: <code className="bg-muted px-1 rounded">name</code>. Optional: dob, gender, course, current_term, section, admission_date, father_name, father_phone, mother_name, mother_phone</>
                    }
                  </p>
                ) : (
                  <p className="text-xs text-muted-foreground mb-1">Select campus and institution above, then upload your CSV.</p>
                )}
                {isSchool && (
                  <p className="text-[11px] text-muted-foreground mb-4">
                    Rows with <code className="bg-muted px-1 rounded">admission_no</code> automatically get <strong>existing parent</strong> fee rates.
                  </p>
                )}
                <div className="flex gap-2 justify-center mt-4">
                  <Button onClick={() => fileRef.current?.click()} disabled={!selectedInstitutionId} className="gap-1.5">
                    <FileText className="h-4 w-4" />Select File
                  </Button>
                  <Button variant="outline" onClick={downloadTemplate} disabled={!selectedInstitutionId} className="gap-1.5">
                    <Download className="h-4 w-4" />Template
                  </Button>
                </div>
                <input ref={fileRef} type="file" accept=".csv" className="hidden" onChange={handleFile} />
              </div>
            ) : (
              <>
                {/* Summary badges */}
                <div className="flex flex-wrap items-center gap-2">
                  <Badge className="bg-pastel-green text-foreground/70 border-0">{validCount} valid</Badge>
                  {invalidCount > 0 && <Badge className="bg-pastel-red text-foreground/70 border-0">{invalidCount} invalid</Badge>}
                  {isSchool && existingCount > 0 && <Badge className="bg-warning/10 text-warning-foreground border-warning/20">{existingCount} existing parent rates</Badge>}
                  {isSchool && newCount > 0 && <Badge className="bg-info/10 text-info-foreground border-info/20">{newCount} new admission rates</Badge>}
                  {siblingGroupCount > 0 && <Badge className="bg-primary/10 text-primary border-primary/20">{siblingGroupCount} sibling groups detected</Badge>}
                  <span className="text-xs text-muted-foreground ml-auto">{parsed.length} rows total</span>
                </div>

                {(!selectedCampusId || !selectedInstitutionId || !selectedSessionId) && (
                  <div className="flex items-center gap-2 p-3 rounded-xl bg-warning/5 border border-warning/20 text-xs text-warning-foreground">
                    <AlertTriangle className="h-4 w-4 shrink-0" />
                    Please select campus, institution and session above before importing.
                  </div>
                )}

                {/* Preview table */}
                <div className="max-h-[320px] overflow-y-auto rounded-xl border border-border">
                  <table className="w-full text-xs">
                    <thead className="sticky top-0">
                      <tr className="border-b border-border bg-muted/60">
                        <th className="px-3 py-2 text-left font-semibold text-muted-foreground w-8"></th>
                        <th className="px-3 py-2 text-left font-semibold text-muted-foreground">Name</th>
                        <th className="px-3 py-2 text-left font-semibold text-muted-foreground">
                          {isSchool ? "Grade" : "Course"}
                        </th>
                        {!isSchool && <th className="px-3 py-2 text-left font-semibold text-muted-foreground">Current</th>}
                        <th className="px-3 py-2 text-left font-semibold text-muted-foreground">Admission Date</th>
                        {isSchool && <th className="px-3 py-2 text-left font-semibold text-muted-foreground">Admission No.</th>}
                        {isSchool && <th className="px-3 py-2 text-left font-semibold text-muted-foreground">Fee Structure</th>}
                        <th className="px-3 py-2 text-left font-semibold text-muted-foreground">Siblings</th>
                        <th className="px-3 py-2 text-left font-semibold text-muted-foreground">Father</th>
                        <th className="px-3 py-2 text-left font-semibold text-muted-foreground">Error</th>
                      </tr>
                    </thead>
                    <tbody>
                      {parsed.slice(0, 200).map((r, i) => (
                        <tr key={i} className="border-b border-border last:border-0 hover:bg-muted/20">
                          <td className="px-3 py-2">
                            {r.valid
                              ? <CheckCircle className="h-3.5 w-3.5 text-primary" />
                              : <XCircle    className="h-3.5 w-3.5 text-destructive" />}
                          </td>
                          <td className="px-3 py-2 font-medium text-foreground">{r.name}</td>
                          <td className="px-3 py-2 text-muted-foreground">
                            {r.course_id
                              ? courseLabel(courses.find(c => c.id === r.course_id)!)
                              : r.grade || "—"}
                          </td>
                          {!isSchool && (
                            <td className="px-3 py-2 text-muted-foreground">{selectedCurrentTerm || r.current_term || "—"}</td>
                          )}
                          <td className="px-3 py-2 text-muted-foreground">{r.admission_date || selectedAdmissionDate || "—"}</td>
                          {isSchool && (
                            <td className="px-3 py-2 font-mono text-muted-foreground">{r.admission_no || "—"}</td>
                          )}
                          {isSchool && (
                            <td className="px-3 py-2">
                              {r.fee_version === "existing_parent"
                                ? <span className="px-1.5 py-0.5 rounded bg-warning/10 text-warning-foreground font-medium">Existing</span>
                                : <span className="px-1.5 py-0.5 rounded bg-info/5 text-info-foreground font-medium">New</span>}
                            </td>
                          )}
                          <td className="px-3 py-2 text-muted-foreground">
                            {r.sibling_count > 1 ? `${r.sibling_count} in family` : "—"}
                          </td>
                          <td className="px-3 py-2 text-muted-foreground">
                            {r.father_name || "—"}{r.father_phone ? ` (${r.father_phone})` : ""}
                          </td>
                          <td className="px-3 py-2 text-destructive">{r.error}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="flex justify-between items-center gap-2">
                  <Button variant="outline" onClick={() => { setParsed([]); setResult(null); if (fileRef.current) fileRef.current.value = ""; }}>
                    Re-upload
                  </Button>
                  <Button onClick={handleImport} disabled={importing || !canImport} className="gap-1.5">
                    {importing ? <ButtonOrb state="solving" onFilled /> : <Upload className="h-4 w-4" />}
                    Import {validCount} Student{validCount !== 1 ? "s" : ""}
                  </Button>
                </div>
              </>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
