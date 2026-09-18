import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { FeeCollectionVsDueReport } from "@/components/finance/FeeCollectionVsDueReport";
import { exportCollectionVsDuePdf } from "@/lib/feeCollectionVsDuePdf";

// Mock ResizeObserver for Recharts ResponsiveContainer in jsdom environment
class MockResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver = MockResizeObserver;

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  toast: vi.fn(),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: mocks.rpc, from: vi.fn() },
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

vi.mock("@/hooks/useFeeStructureMeta", () => ({
  useFeeStructureMetaByCourse: () => ({}),
}));

vi.mock("@/lib/xlsxExport", () => ({
  exportRowsXlsx: vi.fn(async () => ({ count: 1 })),
}));

vi.mock("@/lib/pdfExport", () => ({
  exportRowsPdf: vi.fn(async () => ({ count: 1 })),
}));

vi.mock("@/lib/feeCollectionVsDuePdf", () => ({
  exportCollectionVsDuePdf: vi.fn(async () => ({ count: 1, parts: 1 })),
}));

vi.mock("@/components/ui/thinking-orb", () => ({
  OrbLoader: () => null,
  ButtonOrb: () => null,
}));

const payload = {
  as_of: "2026-09-15",
  scope: "till_date",
  lines: [
    {
      student_id: "s1",
      name: "Asha Verma",
      admission_no: "AN-1",
      campus_name: "Greater Noida",
      course_id: "c1",
      course_name: "B.Sc Nursing",
      batch_name: "2025-26",
      session_name: "2025-26",
      fee_ledger_id: "l1",
      fee_code: "TUITION",
      fee_name: "Tuition",
      term: "year_1",
      due_amount: 40000,
      collected_amount: 15000,
      balance: 25000,
      due_date: "2026-04-01",
      collected_date: "2026-04-10",
      late_fine_due: 200,
      late_fine_collected: 50,
      is_overdue: true,
    },
    {
      student_id: "s2",
      name: "Bina Rai",
      admission_no: "AN-2",
      campus_name: "Greater Noida",
      course_id: "c2",
      course_name: "GNM",
      batch_name: "2024-25",
      session_name: "2024-25",
      fee_ledger_id: "l2",
      fee_code: "TUITION",
      fee_name: "Tuition",
      term: "year_1",
      due_amount: 35000,
      collected_amount: 35000,
      balance: 0,
      due_date: "2026-04-01",
      collected_date: "2026-03-20",
      late_fine_due: 0,
      late_fine_collected: 0,
      is_overdue: false,
    },
    {
      student_id: "s1",
      name: "Asha Verma",
      admission_no: "AN-1",
      campus_name: "Greater Noida",
      course_id: "c1",
      course_name: "B.Sc Nursing",
      batch_name: "2025-26",
      session_name: "2025-26",
      fee_ledger_id: "l3",
      fee_code: "HOSTEL",
      fee_name: "Hostel",
      term: "year_1",
      due_amount: 10000,
      collected_amount: 0,
      balance: 10000,
      due_date: "2026-05-01",
      collected_date: null,
      late_fine_due: 0,
      late_fine_collected: 0,
      is_overdue: true,
    },
  ],
};

beforeEach(() => {
  mocks.rpc.mockReset();
  mocks.toast.mockReset();
  mocks.rpc.mockResolvedValue({ data: payload, error: null });
  vi.mocked(exportCollectionVsDuePdf).mockClear();
});

describe("FeeCollectionVsDueReport", () => {
  it("loads till-date scope and sections students by programme-batch", async () => {
    render(<FeeCollectionVsDueReport />);

    await waitFor(() => {
      expect(mocks.rpc).toHaveBeenCalledWith(
        "fee_collection_vs_due_report",
        expect.objectContaining({
          _campus_ids: ["campus-1"],
          _scope: "till_date",
        }),
      );
    });

    expect(await screen.findByText("Asha Verma")).toBeInTheDocument();
    expect(screen.getAllByText("B.Sc Nursing").length).toBeGreaterThan(0);
    expect(screen.getAllByText("GNM").length).toBeGreaterThan(0);
    expect(screen.getByText("AN-1")).toBeInTheDocument();
    expect(screen.getByText("Due till date")).toBeInTheDocument();
    expect(screen.getByText("Entire batch")).toBeInTheDocument();
    expect(screen.getByText("Overdue only")).toBeInTheDocument();
  });

  it("switches to detailed view with dates and late fine columns", async () => {
    render(<FeeCollectionVsDueReport />);
    await screen.findByText("Asha Verma");

    fireEvent.click(screen.getByRole("button", { name: "Detailed" }));

    expect((await screen.findAllByText("Due Date")).length).toBeGreaterThan(0);
    expect(screen.getAllByText("Collected Date").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Late Fine Due").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Late Fine Paid").length).toBeGreaterThan(0);
  });

  it("refetches when the overdue scope is selected", async () => {
    render(<FeeCollectionVsDueReport />);
    await screen.findByText("Asha Verma");
    mocks.rpc.mockClear();
    mocks.rpc.mockResolvedValue({ data: { ...payload, lines: [payload.lines[0]] }, error: null });

    fireEvent.click(screen.getByRole("button", { name: "Overdue only" }));

    await waitFor(() => {
      expect(mocks.rpc).toHaveBeenCalledWith(
        "fee_collection_vs_due_report",
        expect.objectContaining({ _scope: "overdue" }),
      );
    });

    mocks.rpc.mockClear();
    mocks.rpc.mockResolvedValue({ data: payload, error: null });
    fireEvent.click(screen.getByRole("button", { name: "Entire batch" }));

    await waitFor(() => {
      expect(mocks.rpc).toHaveBeenCalledWith(
        "fee_collection_vs_due_report",
        expect.objectContaining({ _scope: "entire_batch" }),
      );
    });
  });

  it("shows PDF part controls in summary view and exports auto parts", async () => {
    render(<FeeCollectionVsDueReport />);
    await screen.findByText("Asha Verma");

    expect(screen.getByText("PDF parts")).toBeInTheDocument();
    expect(screen.getByText("Months / terms")).toBeInTheDocument();
    expect(screen.getByText("Fee heads")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Export to PDF/i }));

    await waitFor(() => {
      expect(exportCollectionVsDuePdf).toHaveBeenCalled();
    });
    const [, parts] = vi.mocked(exportCollectionVsDuePdf).mock.calls[0];
    expect(parts.length).toBeGreaterThan(0);
  });

  it("passes custom month selection into summary PDF export", async () => {
    render(<FeeCollectionVsDueReport />);
    await screen.findByText("Asha Verma");

    fireEvent.click(screen.getByLabelText("Apr 2026 · Year 1"));
    fireEvent.click(screen.getByRole("button", { name: /Export to PDF/i }));

    await waitFor(() => {
      expect(exportCollectionVsDuePdf).toHaveBeenCalled();
    });
    const [, parts] = vi.mocked(exportCollectionVsDuePdf).mock.calls[0];
    expect(parts.every((part) => part.periodLabel.startsWith("Apr 2026"))).toBe(true);
  });

  it("switches to Monthly view and toggles expanded state for a month", async () => {
    render(<FeeCollectionVsDueReport />);
    await screen.findByText("Asha Verma");

    // Switch to Monthly view
    fireEvent.click(screen.getByRole("button", { name: "Monthly" }));

    // Verify monthly headers/content
    expect(await screen.findByText("Monthly Fee Collection vs Due Trend")).toBeInTheDocument();
    expect(screen.getByText("Month-wise Segregation & Details")).toBeInTheDocument();
    
    // We expect "Apr 2026" and "May 2026" based on the payload due dates: "2026-04-01" and "2026-05-01"
    expect(screen.getByText("Apr 2026")).toBeInTheDocument();
    expect(screen.getByText("May 2026")).toBeInTheDocument();

    // The sub-table items should not be visible yet
    expect(screen.queryByText(/Monthly Details for Apr 2026/i)).not.toBeInTheDocument();

    // Click the month row to expand Apr 2026
    fireEvent.click(screen.getByText("Apr 2026"));

    // Verify that sub-details are now visible
    expect(await screen.findByText(/Monthly Details for Apr 2026 \(2 items\)/i)).toBeInTheDocument();
    
    // Sub-table items should be visible
    expect(screen.getAllByText("Asha Verma").length).toBeGreaterThan(0);
    expect(screen.getByText("Bina Rai")).toBeInTheDocument();

    // Click again to collapse
    fireEvent.click(screen.getByText("Apr 2026"));
    
    // Verify collapsed
    await waitFor(() => {
      expect(screen.queryByText(/Monthly Details for Apr 2026/i)).not.toBeInTheDocument();
    });
  });
});
