import { useState, useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Upload, FileText, Loader2, CheckCircle, XCircle, Download, AlertTriangle, Users,
} from "lucide-react";

interface Course    { id: string; name: string; code: string; }
interface Campus    { id: string; name: string; }
interface Institution { id: string; name: string; code: string; type: string; }
interface Session   { id: string; name: string; }

interface ParsedRow {
  name: string;
  dob: string;
  gender: string;
  grade: string;         // raw grade/course string from CSV
  section: string;
  admission_no: string;  // existing admission no from previous system
  father_name: string;
  father_phone: string;
  mother_name: string;
  mother_phone: string;
  fee_type: string;
  // Resolved
  course_id: string | null;
  fee_version: "new_admission" | "existing_parent" | "standard";
  // Status
  valid: boolean;
  error: string;
}

interface BulkStudentImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
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

export function BulkStudentImportDialog({ open, onOpenChange, onSuccess }: BulkStudentImportDialogProps) {
  const { user } = useAuth();
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [parsed, setParsed] = useState<ParsedRow[]>([]);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<{ success: number; failed: number } | null>(null);

  const [allCampuses,   setAllCampuses]   = useState<Campus[]>([]);
  const [institutions,  setInstitutions]  = useState<Institution[]>([]);
  const [courses,       setCourses]       = useState<Course[]>([]);
  const [sessions,      setSessions]      = useState<Session[]>([]);

  const [selectedCampusId,      setSelectedCampusId]      = useState("");
  const [selectedInstitutionId, setSelectedInstitutionId] = useState("");
  const [selectedSessionId,     setSelectedSessionId]     = useState("");
  const [applyExistingFeeToAll, setApplyExistingFeeToAll] = useState(false);

  // Load campuses + sessions on open
  useEffect(() => {
    if (!open) return;
    setParsed([]); setResult(null); setApplyExistingFeeToAll(false);
    Promise.all([
      supabase.from("campuses").select("id, name").order("name"),
      supabase.from("admission_sessions").select("id, name").eq("is_active", true),
    ]).then(([cam, ses]) => {
      if (cam.data) { setAllCampuses(cam.data); if (cam.data.length === 1) setSelectedCampusId(cam.data[0].id); }
      if (ses.data) { setSessions(ses.data); if (ses.data.length === 1) setSelectedSessionId(ses.data[0].id); }
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
    supabase.from("courses")
      .select("id, name, code, departments!inner(institution_id)")
      .eq("departments.institution_id", selectedInstitutionId)
      .order("code")
      .then(({ data }) => setCourses((data as any) || []));
  }, [selectedInstitutionId]);

  const selectedCampus      = allCampuses.find(c => c.id === selectedCampusId) || null;
  const selectedInstitution = institutions.find(i => i.id === selectedInstitutionId) || null;
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
      const headers = rows[0].map(h => h.toLowerCase().replace(/\s+/g, "_"));
      const idx = (col: string) => headers.indexOf(col);

      if (idx("name") === -1) {
        toast({ title: "Error", description: "CSV must have a 'name' column", variant: "destructive" });
        return;
      }

      const data: ParsedRow[] = rows.slice(1).map(cols => {
        const get = (col: string) => (cols[idx(col)] || "").trim();
        const name         = get("name");
        const dob          = get("dob");
        const gender       = get("gender");
        const grade        = get("grade") || get("class") || get("course") || get("programme");
        const section      = get("section");
        const admission_no = get("admission_no") || get("admissionno") || get("admission_number");
        const father_name  = get("father_name") || get("father");
        const father_phone = get("father_phone") || get("father_mobile");
        const mother_name  = get("mother_name") || get("mother");
        const mother_phone = get("mother_phone") || get("mother_mobile");
        const fee_type     = get("fee_type") || get("applicant_type");

        const course_id = grade
          ? isSchool
            ? resolveGrade(grade, courses)
            : resolveCourse(grade, courses)
          : null;

        let valid = true, error = "";
        if (!name)               { valid = false; error = "Name required"; }
        else if (grade && !course_id) {
          valid = false;
          error = isSchool ? `Unknown grade: "${grade}"` : `Unknown course: "${grade}"`;
        }

        const fee_version: "new_admission" | "existing_parent" | "standard" = isSchool
          ? ((applyExistingFeeToAll || admission_no || fee_type === "existing")
              ? "existing_parent" : "new_admission")
          : "standard";

        return {
          name, dob, gender, grade, section, admission_no,
          father_name, father_phone, mother_name, mother_phone, fee_type,
          course_id, fee_version, valid, error,
        };
      });

      setParsed(data);
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

    for (let i = 0; i < valid.length; i += 50) {
      const batch = valid.slice(i, i + 50).map((r, j) => ({
        name: r.name,
        dob:  r.dob  || null,
        gender: r.gender || null,
        course_id: r.course_id,
        campus_id: selectedCampusId,
        session_id: selectedSessionId || null,
        admission_no: (isSchool && r.admission_no) ? r.admission_no : null,
        school_admission_no: (isSchool && r.admission_no) ? r.admission_no : null,
        pre_admission_no: (isSchool && r.admission_no)
          ? null
          : `IMP-${Date.now().toString(36).toUpperCase()}-${i + j}`,
        section: r.section || null,
        father_name:  r.father_name  || null,
        father_phone: r.father_phone || null,
        mother_name:  r.mother_name  || null,
        mother_phone: r.mother_phone || null,
        guardian_name:  r.father_name  || null,
        guardian_phone: r.father_phone || null,
        fee_structure_version: r.fee_version,
        status: "active",
        created_by: user?.id || null,
      }));

      const { error, data } = await supabase.from("students").insert(batch as any).select("id");
      if (error) { failed += batch.length; console.error(error); }
      else { success += (data?.length || 0); }
    }

    setResult({ success, failed });
    setImporting(false);
    if (success > 0) onSuccess();
  };

  const downloadTemplate = () => {
    const schoolHeader = "name,dob,gender,grade,section,admission_no,father_name,father_phone,mother_name,mother_phone,fee_type";
    const collegeHeader = "name,dob,gender,course,section,father_name,father_phone,mother_name,mother_phone";
    const header = isSchool ? schoolHeader : collegeHeader;
    const ex1 = isSchool
      ? "Rohan Sharma,2016-06-12,Male,Grade III,A,1803188,Rajesh Sharma,9876543210,Priya Sharma,9876543211,existing"
      : "Rohan Sharma,2004-06-12,Male,BCA,A,Rajesh Sharma,9876543210,Priya Sharma,9876543211";
    const ex2 = isSchool
      ? "Ananya Singh,2017-09-01,Female,Grade II,B,,Amit Singh,9876543212,Sunita Singh,9876543213,new"
      : "Ananya Singh,2005-09-01,Female,B.Sc Computer Science,,Amit Singh,9876543212,Sunita Singh,9876543213";
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

  const canImport = validCount > 0 && !!selectedCampusId && !!selectedInstitutionId && !!selectedSessionId;

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
            <CheckCircle className="h-12 w-12 text-primary mx-auto" />
            <p className="text-lg font-semibold text-foreground">Import Complete</p>
            <p className="text-sm text-muted-foreground">{result.success} students imported · {result.failed} failed</p>
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
                  {sessions.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
            </div>

            {/* Fee override toggle — school institutions only */}
            {isSchool && (
              <label className="flex items-start gap-3 p-3 rounded-xl border border-amber-200 bg-amber-50 cursor-pointer select-none">
                <input type="checkbox" checked={applyExistingFeeToAll}
                  onChange={e => setApplyExistingFeeToAll(e.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded border-amber-300 text-amber-600" />
                <div>
                  <p className="text-xs font-semibold text-amber-800">Apply existing parent fee structure to all rows</p>
                  <p className="text-[11px] text-amber-700 mt-0.5">
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
                      ? <>Required: <code className="bg-muted px-1 rounded">name</code>. Optional: dob, gender, grade, section, admission_no, father_name, father_phone, mother_name, mother_phone, fee_type</>
                      : <>Required: <code className="bg-muted px-1 rounded">name</code>. Optional: dob, gender, course, section, father_name, father_phone, mother_name, mother_phone</>
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
                  {isSchool && existingCount > 0 && <Badge className="bg-amber-100 text-amber-700 border-amber-200">{existingCount} existing parent rates</Badge>}
                  {isSchool && newCount > 0 && <Badge className="bg-blue-100 text-blue-700 border-blue-200">{newCount} new admission rates</Badge>}
                  <span className="text-xs text-muted-foreground ml-auto">{parsed.length} rows total</span>
                </div>

                {(!selectedCampusId || !selectedInstitutionId || !selectedSessionId) && (
                  <div className="flex items-center gap-2 p-3 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-700">
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
                        {isSchool && <th className="px-3 py-2 text-left font-semibold text-muted-foreground">Admission No.</th>}
                        {isSchool && <th className="px-3 py-2 text-left font-semibold text-muted-foreground">Fee Structure</th>}
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
                          {isSchool && (
                            <td className="px-3 py-2 font-mono text-muted-foreground">{r.admission_no || "—"}</td>
                          )}
                          {isSchool && (
                            <td className="px-3 py-2">
                              {r.fee_version === "existing_parent"
                                ? <span className="px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 font-medium">Existing</span>
                                : <span className="px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 font-medium">New</span>}
                            </td>
                          )}
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
                    {importing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
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
