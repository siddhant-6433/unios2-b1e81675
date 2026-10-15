import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OfflinePaymentDialog } from "@/components/finance/OfflinePaymentDialog";

type QueryResult = { data: unknown; error: { message: string } | null };
type Query = PromiseLike<QueryResult> & {
  select(columns?: string): Query;
  eq(column: string, value: unknown): Query;
  or(filter: string): Query;
  limit(): Query;
  gte(): Query;
  order(): Query;
  maybeSingle(): Promise<QueryResult>;
};

const mock = vi.hoisted(() => ({
  confirmedResponses: [] as Promise<QueryResult>[],
  referenceFilters: [] as string[],
  tableReads: [] as string[],
  equalityFilters: [] as { table: string; column: string; value: unknown }[],
  navigate: vi.fn(),
  onOpenChange: vi.fn(),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => {
      mock.tableReads.push(table);
      const queryResult = table === "v_all_payments"
        ? mock.confirmedResponses.shift() ?? Promise.resolve({ data: null, error: null })
        : Promise.resolve({ data: null, error: null });
      const query: Query = {
        select: () => query,
        eq: (column: string, value: unknown) => { mock.equalityFilters.push({ table, column, value }); return query; },
        or: (filter: string) => { mock.referenceFilters.push(filter); return query; },
        limit: () => query,
        gte: () => query,
        order: () => query,
        maybeSingle: () => queryResult,
        then: (resolve, reject) => queryResult.then(resolve, reject),
      };
      return query;
    },
    rpc: async () => ({ data: null, error: null }),
  },
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ profile: { id: "finance-user" }, role: "accountant" }) }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/hooks/useCashReceiptGate", () => ({ useCashReceiptGate: () => ({ blocked: false, reason: null }) }));
vi.mock("react-router-dom", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router-dom")>();
  return { ...actual, useNavigate: () => mock.navigate };
});
vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ open, children }: { open: boolean; children: React.ReactNode }) => open ? <div role="dialog">{children}</div> : null,
  DialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
  DialogFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/ui/state-fields", () => ({
  FieldShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SelectField: ({ value, onValueChange, options, label, disabled }: { value: string; onValueChange: (value: string) => void; options: { value: string; label: string }[]; label: string; disabled?: boolean }) => (
    <label>{label}<select aria-label={label} value={value} disabled={disabled} onChange={(event) => onValueChange(event.target.value)}>
      {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
    </select></label>
  ),
  TextField: ({ value, onValueChange, label, ...props }: { value: string; onValueChange: (value: string) => void; label: string; disabled?: boolean; placeholder?: string }) => (
    <label>{label}<input aria-label={label} value={value} onChange={(event) => onValueChange(event.target.value)} {...props} /></label>
  ),
  TextAreaField: () => null,
}));
vi.mock("@/components/finance/FeeHeadAllocationField", () => ({ FeeHeadAllocationField: () => null }));
vi.mock("@/components/finance/Year1LumpSumBanner", () => ({ Year1LumpSumInfoBanner: () => null }));
vi.mock("@/components/ui/thinking-orb", () => ({ ButtonOrb: () => null }));

function renderDialog({ leadId = "lead-1", studentId }: { leadId?: string; studentId?: string } = {}) {
  return render(
    <OfflinePaymentDialog
      open
      onOpenChange={mock.onOpenChange}
      leadId={leadId}
      studentId={studentId}
      defaultType="other"
      defaultAmount={100}
    />,
  );
}

function enterOnlineReference() {
  fireEvent.change(screen.getByLabelText("Payment Mode"), { target: { value: "online" } });
  fireEvent.change(screen.getByLabelText("Reference / Receipt Number"), { target: { value: "950497896988" } });
}

beforeEach(() => {
  mock.confirmedResponses = [];
  mock.referenceFilters.length = 0;
  mock.tableReads.length = 0;
  mock.equalityFilters.length = 0;
  mock.navigate.mockReset();
  mock.onOpenChange.mockReset();
});
afterEach(cleanup);

describe("offline payment duplicate reference guard", () => {
  it("fails closed on lookup errors and lets Finance retry before recording", async () => {
    mock.confirmedResponses = [
      Promise.resolve({ data: null, error: { message: "Payment lookup unavailable" } }),
      Promise.resolve({ data: null, error: null }),
    ];
    renderDialog();
    enterOnlineReference();

    fireEvent.click(screen.getByRole("button", { name: "Mark as Paid" }));

    expect(await screen.findByText("Could not verify payment reference")).toBeInTheDocument();
    expect(screen.getByText(/No payment was recorded/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Mark as Paid" })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Retry reference check" }));

    await waitFor(() => expect(screen.queryByText("Could not verify payment reference")).not.toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Mark as Paid" })).toBeEnabled();
    expect(mock.referenceFilters).toEqual([
      'transaction_ref.eq."950497896988",bank_ref_num.eq."950497896988"',
      'transaction_ref.eq."950497896988",bank_ref_num.eq."950497896988"',
    ]);
    expect(mock.tableReads).toContain("v_all_payments");
    expect(mock.equalityFilters.filter((filter) => filter.table === "v_all_payments")).toEqual([
      { table: "v_all_payments", column: "status", value: "confirmed" },
      { table: "v_all_payments", column: "status", value: "confirmed" },
    ]);
  });

  it("keeps a confirmed duplicate warning and opens the exact Finance receipt search", async () => {
    mock.confirmedResponses = [Promise.resolve({
      data: { id: "payment-1", receipt_no: "N565", amount: 100 },
      error: null,
    })];
    renderDialog();
    enterOnlineReference();

    fireEvent.click(screen.getByRole("button", { name: "Mark as Paid" }));

    expect(await screen.findByText("Payment reference already recorded")).toBeInTheDocument();
    expect(screen.getByText(/Receipt: N565/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Mark as Paid" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Review existing receipt" }));

    expect(mock.navigate).toHaveBeenCalledWith("/finance?tab=receipts&receipt_ref=950497896988");
    expect(mock.onOpenChange).toHaveBeenCalledWith(false);
  });

  it("checks lead-less student payments against the shared cross-source reference index", async () => {
    mock.confirmedResponses = [Promise.resolve({
      data: { id: "native-payment", receipt_no: "N600", person_name: "Prashasti", admission_no: "RPR-001" },
      error: null,
    })];
    renderDialog({ leadId: undefined, studentId: "student-1" });
    enterOnlineReference();

    fireEvent.click(screen.getByRole("button", { name: "Mark as Paid" }));

    expect(await screen.findByText("Payment reference already recorded")).toBeInTheDocument();
    expect(screen.getByText(/Receipt: N600/)).toBeInTheDocument();
    expect(mock.tableReads).toContain("v_all_payments");
    expect(mock.tableReads).not.toContain("lead_payments");
  });
});
