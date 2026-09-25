import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { CandidateDocumentPendencyReport } from "@/components/reports/CandidateDocumentPendencyReport";
import {
  candidateDocumentExportRows,
  filterCandidateDocumentRows,
  type CandidateDocumentRow,
} from "@/lib/candidateDocumentReport";
import { exportRowsXlsx } from "@/lib/xlsxExport";
import { readMigration } from "./readMigration";

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  toast: vi.fn(),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: mocks.rpc },
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: mocks.toast }),
}));

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ role: "accountant" }),
}));

vi.mock("@/contexts/CampusContext", () => ({
  useCampus: () => ({ selectedCampusId: "campus-1" }),
}));

vi.mock("@/lib/xlsxExport", () => ({
  exportRowsXlsx: vi.fn(async () => ({ count: 1 })),
}));

vi.mock("@/components/ui/thinking-orb", () => ({
  OrbLoader: () => <div data-testid="loader" />,
  ButtonOrb: () => <span data-testid="button-orb" />,
}));

const rows: CandidateDocumentRow[] = [
  {
    candidate_key: "application:app-1",
    application_id: "APP-1",
    candidate_stage: "application",
    name: "Asha Verma",
    phone: "9876543210",
    campus_id: "campus-1",
    campus_name: "Greater Noida",
    course_name: "Class 1",
    grade: "Class 1",
    student_status: "active",
    program_category: "school",
    document_upload: "Yes",
    uploaded_count: 1,
    required_total: 3,
    verified_count: 1,
    pending_count: 0,
    rejected_count: 0,
    missing_count: 2,
    complete: false,
    uploaded_file_names: ["aadhaar.pdf"],
    pending_documents: ["Student Photograph", "Previous Class Report Card"],
    documents: [
      { key: "aadhaar", label: "Student Aadhaar Card", state: "verified", file_name: "aadhaar.pdf" },
      { key: "student_photo", label: "Student Photograph", state: "missing" },
    ],
  },
  {
    candidate_key: "student:stu-1",
    student_id: "stu-1",
    admission_no: "AN-1",
    candidate_stage: "admitted",
    student_status: "active",
    name: "Bina Rai",
    phone: "9876500000",
    campus_id: "campus-1",
    campus_name: "Greater Noida",
    course_name: "B.Sc Nursing",
    grade: null,
    program_category: null,
    document_upload: "No",
    uploaded_count: 0,
    required_total: 0,
    verified_count: 0,
    pending_count: 0,
    rejected_count: 0,
    missing_count: 1,
    complete: false,
    uploaded_file_names: [],
    pending_documents: ["Student Documents"],
    documents: [{ key: "student_documents", label: "Student Documents", state: "missing" }],
  },
];

beforeEach(() => {
  mocks.rpc.mockReset();
  mocks.toast.mockReset();
  vi.mocked(exportRowsXlsx).mockClear();
  mocks.rpc.mockImplementation((fn: string) => fn === "report_student_archive_status"
    ? Promise.resolve({ data: { statuses: [{ student_id: "stu-1", student_status: "active" }] }, error: null })
    : Promise.resolve({ data: { rows }, error: null }));
});

describe("candidate document pendency report migration", () => {
  const migration = readMigration("candidate_document_pendency_report");

  it("adds an authenticated campus-scoped RPC", () => {
    expect(migration).toContain("CREATE OR REPLACE FUNCTION public.candidate_document_pendency_report");
    expect(migration).toContain("_campus_ids uuid[] DEFAULT NULL");
    expect(migration).toContain("public.user_can_access_record_campus(auth.uid()");
    expect(migration).toContain("campus.id = ANY(_campus_ids)");
    expect(migration).toContain("GRANT EXECUTE ON FUNCTION public.candidate_document_pendency_report(uuid[]) TO authenticated");
  });

  it("uses application and student document sources", () => {
    expect(migration).toContain("FROM public.application_documents d");
    expect(migration).toContain("FROM public.student_documents sd");
    expect(migration).toContain("public.application_mandatory_doc_specs");
    expect(migration).toContain("public.compute_application_admission_doc_status");
    expect(migration).toContain("public.application_canonical_doc_key");
  });
});

describe("candidate document report helpers", () => {
  it("filters uploaded candidates with pending school grade documents", () => {
    const filtered = filterCandidateDocumentRows(rows, {
      query: "",
      stage: "all",
      upload: "Yes",
      studentStatus: "active",
      pendency: ["missing"],
      grade: "Class 1",
    });

    expect(filtered).toHaveLength(1);
    expect(filtered[0].name).toBe("Asha Verma");
  });

  it("exports distinct application and admitted student rows", () => {
    const exported = candidateDocumentExportRows(rows);

    expect(exported).toHaveLength(2);
    expect(exported[0]["Document Upload"]).toBe("Yes");
    expect(exported[0]["Uploaded File Names"]).toBe("aadhaar.pdf");
    expect(exported[1]["Admission No"]).toBe("AN-1");
    expect(exported[1]["Document Upload"]).toBe("No");
  });
});

describe("CandidateDocumentPendencyReport", () => {
  it("loads campus-scoped rows and renders upload vs pendency", async () => {
    render(<CandidateDocumentPendencyReport />);

    await waitFor(() => {
      expect(mocks.rpc).toHaveBeenCalledWith("candidate_document_pendency_report", {
        _campus_ids: ["campus-1"],
      });
    });

    expect(await screen.findByText("Asha Verma")).toBeInTheDocument();
    expect(screen.getByText("Bina Rai")).toBeInTheDocument();
    expect(screen.getByText("aadhaar.pdf")).toBeInTheDocument();
    expect(screen.getByText("Student Photograph, Previous Class Report Card")).toBeInTheDocument();
  });

  it("searches rows and expands document details", async () => {
    render(<CandidateDocumentPendencyReport />);
    await screen.findByText("Asha Verma");

    fireEvent.change(screen.getByLabelText("Search candidates"), { target: { value: "Bina" } });

    expect(screen.queryByText("Asha Verma")).not.toBeInTheDocument();
    expect(screen.getByText("Bina Rai")).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText("Toggle documents for Bina Rai"));

    expect(screen.getAllByText("Student Documents").length).toBeGreaterThan(0);
    expect(screen.getByText("No file uploaded")).toBeInTheDocument();
  });

  it("exports the visible filtered rows", async () => {
    render(<CandidateDocumentPendencyReport />);
    await screen.findByText("Asha Verma");

    fireEvent.change(screen.getByLabelText("Search candidates"), { target: { value: "Asha" } });
    fireEvent.click(screen.getByRole("button", { name: "Excel" }));

    await waitFor(() => {
      expect(exportRowsXlsx).toHaveBeenCalledWith(
        [expect.objectContaining({ Candidate: "Asha Verma", "Uploaded File Names": "aadhaar.pdf" })],
        "Document Pendency",
        "candidate-document-pendency",
        { unmask: false },
      );
    });
  });
});
