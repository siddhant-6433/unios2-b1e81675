import type { ExportRow } from "@/lib/xlsxExport";

export type CandidateStage = "application" | "pre_admitted" | "admitted";
export type DocumentUpload = "Yes" | "No";

export interface CandidateDocumentDetail {
  key?: string | null;
  label?: string | null;
  state?: string | null;
  status?: string | null;
  file_name?: string | null;
  uploaded_at?: string | null;
}

export interface CandidateDocumentRow {
  candidate_key: string;
  application_id?: string | null;
  student_id?: string | null;
  admission_no?: string | null;
  pre_admission_no?: string | null;
  candidate_stage: CandidateStage | string;
  name: string;
  phone?: string | null;
  campus_id?: string | null;
  campus_name?: string | null;
  course_id?: string | null;
  course_name?: string | null;
  grade?: string | null;
  program_category?: string | null;
  student_status?: "active" | "archived" | "unknown" | "not_applicable";
  document_upload: DocumentUpload | string;
  uploaded_count: number;
  required_total: number;
  verified_count: number;
  pending_count: number;
  rejected_count: number;
  missing_count: number;
  complete: boolean;
  uploaded_file_names: string[];
  pending_documents: string[];
  documents: CandidateDocumentDetail[];
}

export interface CandidateDocumentFilters {
  query: string;
  stage: string;
  upload: string;
  studentStatus: string;
  pendency: string[];
  grade: string;
}

const text = (value: unknown) => String(value ?? "").trim();
const lower = (value: unknown) => text(value).toLowerCase();

export const stageLabel = (stage: string | null | undefined) => {
  switch (stage) {
    case "application":
      return "Application";
    case "pre_admitted":
      return "Pre-admitted";
    case "admitted":
      return "Admitted";
    default:
      return text(stage).replace(/_/g, " ") || "Unknown";
  }
};

export const pendencyLabel = (row: CandidateDocumentRow) => {
  if (row.complete) return "Complete";
  if (row.rejected_count > 0) return "Rejected";
  if (row.missing_count > 0) return "Missing";
  if (row.pending_count > 0) return "Pending review";
  return row.document_upload === "Yes" ? "Uploaded" : "No upload";
};

export const candidateIdentifier = (row: CandidateDocumentRow) =>
  row.admission_no || row.pre_admission_no || row.application_id || row.student_id || row.candidate_key;

export const filterCandidateDocumentRows = (
  rows: CandidateDocumentRow[],
  filters: CandidateDocumentFilters,
) => {
  const query = lower(filters.query);
  return rows.filter((row) => {
    const haystack = [
      row.name,
      row.phone,
      row.application_id,
      row.admission_no,
      row.pre_admission_no,
      row.campus_name,
      row.course_name,
      row.grade,
      row.uploaded_file_names.join(" "),
      row.pending_documents.join(" "),
    ].map(lower).join(" ");

    const matchesQuery = !query || haystack.includes(query);
    const matchesStage = filters.stage === "all" || row.candidate_stage === filters.stage;
    const matchesUpload = filters.upload === "all" || row.document_upload === filters.upload;
    const matchesStudentStatus = filters.studentStatus === "all" ||
      row.student_status === filters.studentStatus ||
      (filters.studentStatus === "active" && row.student_status === "not_applicable");
    const matchesPendency = filters.pendency.length === 0 || filters.pendency.some((status) => {
      if (status === "incomplete") return !row.complete;
      if (status === "complete") return row.complete;
      if (status === "pending") return row.pending_count > 0;
      if (status === "missing") return row.missing_count > 0;
      if (status === "rejected") return row.rejected_count > 0;
      return false;
    });
    const matchesGrade = filters.grade === "all" || text(row.grade || row.course_name) === filters.grade;

    return matchesQuery && matchesStage && matchesUpload && matchesStudentStatus && matchesPendency && matchesGrade;
  });
};

export const candidateDocumentKpis = (rows: CandidateDocumentRow[]) => ({
  total: rows.length,
  uploadedYes: rows.filter((row) => row.document_upload === "Yes").length,
  uploadedNo: rows.filter((row) => row.document_upload !== "Yes").length,
  complete: rows.filter((row) => row.complete).length,
  incomplete: rows.filter((row) => !row.complete).length,
});

export const candidateDocumentExportRows = (rows: CandidateDocumentRow[]): ExportRow[] =>
  rows.map((row) => ({
    Candidate: row.name,
    Phone: row.phone || "",
    Stage: stageLabel(row.candidate_stage),
    Campus: row.campus_name || "",
    "Course / Grade": row.grade || row.course_name || "",
    "Student Status": row.student_id ? row.student_status || "Unknown" : "N/A",
    "Application ID": row.application_id || "",
    "Admission No": row.admission_no || "",
    "Pre-admission No": row.pre_admission_no || "",
    "Document Upload": row.document_upload,
    Status: pendencyLabel(row),
    "Uploaded Count": row.uploaded_count,
    "Required Docs": row.required_total,
    Verified: row.verified_count,
    Pending: row.pending_count,
    Missing: row.missing_count,
    Rejected: row.rejected_count,
    "Uploaded File Names": row.uploaded_file_names.join(", "),
    "Outstanding Documents": row.pending_documents.join(", "),
  }));

export const candidateDocumentPdfRows = (rows: CandidateDocumentRow[]): ExportRow[] =>
  rows.map((row) => ({
    Candidate: row.name,
    ID: row.admission_no || row.pre_admission_no || row.application_id || "",
    Phone: row.phone || "",
    Campus: row.campus_name || "",
    "Grade / Course": row.grade || row.course_name || "",
    "Student Status": row.student_id ? row.student_status || "Unknown" : "N/A",
    Stage: stageLabel(row.candidate_stage),
    Upload: row.document_upload,
    Status: pendencyLabel(row),
    "Uploaded Files": row.uploaded_file_names.join(", "),
    "Outstanding Documents": row.pending_documents.join(", "),
  }));
