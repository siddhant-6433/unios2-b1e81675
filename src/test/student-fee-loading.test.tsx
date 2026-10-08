import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StudentFeePanel } from "@/components/finance/StudentFeePanel";

type Row = Record<string, unknown>;
type ReadResponse = { data: Row[] | null; error: { message: string } | null };
type ReadQuery = PromiseLike<ReadResponse> & {
  select(): ReadQuery;
  order(): ReadQuery;
  in(): ReadQuery;
  eq(column: string, value: unknown): ReadQuery;
  maybeSingle(): Promise<ReadResponse>;
};

const mock = vi.hoisted(() => ({
  responses: new Map<string, Promise<ReadResponse>[]>(),
  filters: [] as { table: string; column: string; value: unknown }[],
}));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {
  rpc: async () => ({ data: null, error: null }),
  from: (table: string) => {
    const response = mock.responses.get(table)?.shift() ?? Promise.resolve({ data: [], error: null });
    const q: ReadQuery = {
      select: () => q, order: () => q, in: () => q,
      eq: (column: string, value: unknown) => { mock.filters.push({ table, column, value }); return q; },
      maybeSingle: () => response,
      then: (resolve, reject) => response.then(resolve, reject),
    };
    return q;
  },
} }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ role: "principal", session: null, hasPermission: () => false }) }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/components/ui/page-loader", () => ({ PageLoader: () => <div>Loading fees…</div> }));
vi.mock("@/hooks/useFeeStructureMeta", () => ({ useFeeStructureMeta: () => ({ version: null, metadata: null }) }));
vi.mock("@/components/finance/useAbvmuDeposit", () => ({ useAbvmuDeposit: () => ({ depositAmount: 0, lumpSumPct: 0, notApplicable: false }) }));
vi.mock("@/components/finance/AbvmuInlineControls", () => ({ AbvmuInlineControls: () => null, GnmDepositNotApplicableBanner: () => null }));
vi.mock("@/components/finance/PaymentEditDialog", () => ({ PaymentEditDialog: () => null }));
vi.mock("@/components/finance/RefundDialog", () => ({ RefundDialog: () => null }));
vi.mock("@/components/finance/OfflinePaymentDialog", () => ({ OfflinePaymentDialog: () => null }));
vi.mock("@/components/finance/AddChargeDialog", () => ({ AddChargeDialog: () => null }));
vi.mock("@/components/finance/SendPaymentLinkDialog", () => ({ SendPaymentLinkDialog: () => null }));
vi.mock("@/components/finance/ApplyCreditDialog", () => ({ ApplyCreditDialog: () => null }));
vi.mock("@/components/finance/TransferFeeDialog", () => ({ TransferFeeDialog: () => null }));
vi.mock("@/components/finance/FeeLedgerAuditDialog", () => ({ FeeLedgerAuditDialog: () => null }));
vi.mock("@/components/finance/RowConcessionPopover", () => ({ RowConcessionPopover: () => null }));
vi.mock("@/components/finance/PaidBreakdownPopover", () => ({ PaidBreakdownPopover: () => null }));
vi.mock("@/components/finance/AbvmuDepositPanel", () => ({ AbvmuDepositPanel: () => null }));
vi.mock("@/components/finance/Year1LumpSumBanner", () => ({ Year1LumpSumInfoBanner: () => null }));
vi.mock("@/components/finance/AssignBeaconTransportDialog", () => ({ AssignBeaconTransportDialog: () => null }));

const student = { id: "s1", lead_id: null, name: "Avni", course_id: null };
const fee = { id: "f1", term: "year_1", fee_codes: { code: "TUITION", name: "Avni tuition" }, total_amount: 59628, paid_amount: 0, concession: 0, balance: 59628, status: "due" };
const ok = (data: Row[]) => Promise.resolve({ data, error: null });
function deferred() {
  let resolve!: (value: ReadResponse | PromiseLike<ReadResponse>) => void;
  const promise = new Promise<ReadResponse>((done) => { resolve = done; });
  return { promise, resolve };
}
beforeEach(() => { mock.responses.clear(); mock.filters.length = 0; });
afterEach(cleanup);

describe("student financial loading", () => {
  it("shows a ledger error rather than zero totals and retries successfully", async () => {
    mock.responses.set("fee_ledger", [Promise.resolve({ data: null, error: { message: "Ledger unavailable" } }), ok([fee])]);
    render(<StudentFeePanel student={student} />);
    expect(await screen.findByText("Could not load fee ledger")).toBeInTheDocument();
    expect(screen.queryByText("Total Fee")).not.toBeInTheDocument();
    expect(screen.queryByText(/No fee records found/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry fee ledger" }));
    expect(await screen.findByText("Avni tuition")).toBeInTheDocument();
    expect(screen.getByText("Total Fee")).toBeInTheDocument();
    expect(mock.filters).toContainEqual({ table: "fee_ledger", column: "student_id", value: "s1" });
  });

  it("shows D.Pharma Year 1 tuition as one regular fee head when the ABVMU amount is zero", async () => {
    mock.responses.set("fee_ledger", [ok([{
      ...fee,
      fee_codes: { code: "TUITION-Y1", name: "Year 1 Tuition" },
      total_amount: 95000,
      balance: 95000,
    }])]);
    render(<StudentFeePanel student={{
      ...student,
      lead_id: "dpharma-lead",
      course_name: "Diploma in Pharmacy (D.Pharma)",
    } as any} />);

    expect(await screen.findByText("Year 1 Tuition")).toBeInTheDocument();
    expect(screen.queryByText("ABVMU Deposit (Year 1)")).not.toBeInTheDocument();
    expect(screen.getAllByText("₹95,000").length).toBeGreaterThan(0);
  });

  it("shows receipt failures independently and retries a lead-less student's receipts", async () => {
    mock.responses.set("fee_ledger", [ok([fee])]);
    mock.responses.set("lead_payments", [Promise.resolve({ data: null, error: { message: "Receipts unavailable" } }), ok([{ id: "r1", status: "confirmed", type: "other", receipt_no: "SCHOOL-001", amount: 100 }])]);
    render(<StudentFeePanel student={student} />);
    expect(await screen.findByText("Could not load receipts")).toBeInTheDocument();
    expect(screen.getByText("Avni tuition")).toBeInTheDocument();
    expect(screen.queryByText("No confirmed payments yet.")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry receipts" }));
    expect(await screen.findByText("SCHOOL-001")).toBeInTheDocument();
    expect(mock.filters.filter((f) => f.table === "lead_payments")).toEqual([
      { table: "lead_payments", column: "student_id", value: "s1" },
      { table: "lead_payments", column: "student_id", value: "s1" },
    ]);
  });

  it("does not describe receipts as empty while they are still loading", async () => {
    const pending = deferred();
    mock.responses.set("fee_ledger", [ok([])]);
    mock.responses.set("lead_payments", [pending.promise]);
    render(<StudentFeePanel student={student} />);
    await screen.findByText(/No fee records found/);
    expect(screen.getAllByText("Loading receipts…")).toHaveLength(2);
    expect(screen.queryByText("No confirmed payments yet.")).not.toBeInTheDocument();
    await act(async () => pending.resolve({ data: [], error: null }));
    expect(await screen.findByText("No confirmed payments yet.")).toBeInTheDocument();
  });

  it("handles rejected network promises and allows retry", async () => {
    const pending = deferred();
    mock.responses.set("fee_ledger", [pending.promise, ok([])]);
    render(<StudentFeePanel student={student} />);
    await act(async () => pending.resolve(Promise.reject(new Error("Network failed"))));
    expect(await screen.findByText("Network failed")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry fee ledger" }));
    expect(await screen.findByText(/No fee records found/)).toBeInTheDocument();
  });

  it("clears old data and ignores late receipts when switching students", async () => {
    const oldReceipts = deferred();
    const newLedger = deferred();
    mock.responses.set("fee_ledger", [ok([fee]), newLedger.promise]);
    mock.responses.set("lead_payments", [oldReceipts.promise, ok([])]);
    const { rerender } = render(<StudentFeePanel student={student} />);
    await screen.findByText("Avni tuition");
    rerender(<StudentFeePanel student={{ ...student, id: "s2", name: "Next student" }} />);
    expect(screen.queryByText("Avni tuition")).not.toBeInTheDocument();
    expect(screen.queryByText("Total Fee")).not.toBeInTheDocument();
    await act(async () => {
      oldReceipts.resolve({ data: [{ id: "r1", receipt_no: "OLD-STUDENT", status: "confirmed" }], error: null });
      newLedger.resolve({ data: [], error: null });
    });
    await screen.findByText(/No fee records found/);
    expect(screen.queryByText("OLD-STUDENT")).not.toBeInTheDocument();
    expect(screen.queryByText("Avni tuition")).not.toBeInTheDocument();
  });

  it("ignores a late ledger response from a previously selected student", async () => {
    const oldLedger = deferred();
    mock.responses.set("fee_ledger", [oldLedger.promise, ok([])]);
    const { rerender } = render(<StudentFeePanel student={student} />);
    rerender(<StudentFeePanel student={{ ...student, id: "s2" }} />);
    await screen.findByText(/No fee records found/);
    await act(async () => oldLedger.resolve({ data: [fee], error: null }));
    expect(screen.queryByText("Avni tuition")).not.toBeInTheDocument();
  });
});
