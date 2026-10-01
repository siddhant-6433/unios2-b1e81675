import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import Refunds from "@/pages/Refunds";

const mocks = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn(), invoke: vi.fn(), upload: vi.fn(), getPublicUrl: vi.fn(), toast: vi.fn(), status: "draft" as string, auth: { role: "accountant" as string | null, hasPermission: vi.fn(() => true) } }));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: mocks.from,
    rpc: mocks.rpc,
    functions: { invoke: mocks.invoke },
    storage: { from: vi.fn(() => ({ upload: mocks.upload, getPublicUrl: mocks.getPublicUrl })) },
  },
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => mocks.auth }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: mocks.toast }) }));
vi.mock("@/components/ui/page-loader", () => ({ PageLoader: () => <div>Loading refunds</div> }));
vi.mock("@/components/ui/thinking-orb", () => ({ ButtonOrb: () => null }));
vi.mock("@/components/bank/BankCopyPopover", () => ({ BankCopyPopover: () => null }));

function refundRowsQuery(rows: unknown[]) {
  const chain: Record<string, unknown> = {};
  chain.select = vi.fn(() => chain);
  chain.order = vi.fn(() => chain);
  chain.then = (resolve: (value: unknown) => void) => resolve({ data: rows, error: null });
  return chain;
}

beforeEach(() => {
  mocks.from.mockReset();
  mocks.rpc.mockReset().mockResolvedValue({ data: null, error: null });
  mocks.invoke.mockReset().mockResolvedValue({ data: {}, error: null });
  mocks.upload.mockReset().mockResolvedValue({ data: null, error: null });
  mocks.getPublicUrl.mockReset().mockReturnValue({ data: { publicUrl: "https://files.example/lead-refund-proof.pdf" } });
  mocks.toast.mockReset();
  mocks.status = "draft";
  mocks.auth.role = "accountant";
  mocks.auth.hasPermission.mockReturnValue(true);
  mocks.from.mockImplementation(() => refundRowsQuery([{
    id: "refund-1",
    student_id: null,
    lead_id: "lead-1",
    total_amount: 2500,
    reason: "Duplicate token receipt",
    status: mocks.status,
    bank_account_name: null,
    bank_account_number: null,
    bank_ifsc: null,
    bank_name: null,
    bank_upi: null,
    created_at: "2026-09-30T10:00:00.000Z",
    approved_at: null,
    paid_at: null,
    payment_mode: null,
    payment_reference: null,
    payment_date: null,
    payment_proof_url: null,
    zoho_bill_id: null,
    zoho_bill_number: null,
    zoho_payment_id: null,
    zoho_synced_at: null,
    zoho_sync_error: null,
    students: null,
    leads: { name: "Asha Verma", admission_no: null, pre_admission_no: "PA-2048" },
  }]));
});

describe("Finance refunds page lead rows", () => {
  it("renders the lead identity and pre-admission ID when there is no student link", async () => {
    render(<MemoryRouter><Refunds /></MemoryRouter>);

    fireEvent.click(await screen.findByRole("button", { name: "Draft" }));
    expect(await screen.findByText("Asha Verma")).toBeInTheDocument();
    expect(screen.getByText("PA-2048")).toBeInTheDocument();
    expect(screen.getByText("Duplicate token receipt")).toBeInTheDocument();
    expect(screen.getByText("Awaiting super admin approval")).toBeInTheDocument();
  });

  it("keeps the finance permission gate in front of the refund query", () => {
    mocks.auth.hasPermission.mockReturnValue(false);
    mocks.auth.role = "admission_head";

    render(<MemoryRouter><Refunds /></MemoryRouter>);

    expect(screen.queryByRole("heading", { name: "Refunds" })).not.toBeInTheDocument();
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it("records the payout details for an approved lead refund", async () => {
    mocks.status = "approved";
    render(<MemoryRouter><Refunds /></MemoryRouter>);

    fireEvent.click(await screen.findByRole("button", { name: /Mark Paid/ }));
    fireEvent.change(screen.getByPlaceholderText("e.g. UTR 402931..."), { target: { value: "UTR-LEAD-55" } });
    fireEvent.click(screen.getByRole("button", { name: "Mark paid" }));

    await waitFor(() => expect(mocks.rpc).toHaveBeenCalledWith("mark_fee_refund_paid", expect.objectContaining({
        _refund_id: "refund-1",
        _payment_reference: "UTR-LEAD-55",
      })));
    expect(screen.queryByRole("heading", { name: "Mark refund paid" })).not.toBeInTheDocument();
  });

  it("requires a transaction reference before allowing payout recording", async () => {
    mocks.status = "approved";
    render(<MemoryRouter><Refunds /></MemoryRouter>);

    fireEvent.click(await screen.findByRole("button", { name: /Mark Paid/ }));
    fireEvent.click(screen.getByRole("button", { name: "Mark paid" }));

    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Transaction reference is required" }));
    expect(screen.getByRole("heading", { name: "Mark refund paid" })).toBeInTheDocument();
  });

  it("keeps payout details open and reports a payout RPC failure", async () => {
    mocks.status = "approved";
    mocks.rpc.mockResolvedValue({ error: { message: "Refund is no longer approved" } });
    render(<MemoryRouter><Refunds /></MemoryRouter>);

    fireEvent.click(await screen.findByRole("button", { name: /Mark Paid/ }));
    fireEvent.change(screen.getByPlaceholderText("e.g. UTR 402931..."), { target: { value: "UTR-LEAD-55" } });
    fireEvent.click(screen.getByRole("button", { name: "Mark paid" }));

    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Couldn't mark paid", description: "Refund is no longer approved" })));
    expect(screen.getByRole("heading", { name: "Mark refund paid" })).toBeInTheDocument();
  });

  it("stops payout recording when optional proof upload fails", async () => {
    mocks.status = "approved";
    mocks.upload.mockResolvedValue({ data: null, error: { message: "Storage unavailable" } });
    render(<MemoryRouter><Refunds /></MemoryRouter>);

    fireEvent.click(await screen.findByRole("button", { name: /Mark Paid/ }));
    fireEvent.change(screen.getByPlaceholderText("e.g. UTR 402931..."), { target: { value: "UTR-LEAD-55" } });
    fireEvent.change(document.querySelector('input[type="file"]')!, {
      target: { files: [new File(["proof"], "lead-proof.pdf", { type: "application/pdf" })] },
    });
    fireEvent.click(screen.getByRole("button", { name: "Mark paid" }));

    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Proof upload failed", description: "Storage unavailable" })));
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(screen.getByRole("heading", { name: "Mark refund paid" })).toBeInTheDocument();
  });

  it("uploads payout proof under the lead and attaches the public URL", async () => {
    mocks.status = "approved";
    render(<MemoryRouter><Refunds /></MemoryRouter>);

    fireEvent.click(await screen.findByRole("button", { name: /Mark Paid/ }));
    fireEvent.change(screen.getByPlaceholderText("e.g. UTR 402931..."), { target: { value: "UTR-LEAD-55" } });
    fireEvent.change(document.querySelector('input[type="file"]')!, {
      target: { files: [new File(["proof"], "lead-proof.pdf", { type: "application/pdf" })] },
    });
    fireEvent.click(screen.getByRole("button", { name: "Mark paid" }));

    await waitFor(() => expect(mocks.rpc).toHaveBeenCalledWith("mark_fee_refund_paid", expect.objectContaining({
      _proof_url: "https://files.example/lead-refund-proof.pdf",
      _payment_reference: "UTR-LEAD-55",
    })));
    expect(mocks.upload).toHaveBeenCalledWith(expect.stringContaining("refunds/lead-1/payment-refund-1-"), expect.any(File), expect.objectContaining({ contentType: "application/pdf" }));
  });

  it("reports Zoho sync success and service failures from the refund row", async () => {
    mocks.status = "approved";
    render(<MemoryRouter><Refunds /></MemoryRouter>);

    fireEvent.click(await screen.findByRole("button", { name: "Zoho: Create Bill" }));
    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith("zoho-refund-sync", { body: { action: "create_bill", refund_id: "refund-1" } }));
    expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Bill created in Zoho" }));
  });

  it("keeps Zoho sync errors visible to finance users", async () => {
    mocks.status = "approved";
    mocks.invoke.mockResolvedValue({ data: { error: "Zoho is unavailable" }, error: null });
    render(<MemoryRouter><Refunds /></MemoryRouter>);

    fireEvent.click(await screen.findByRole("button", { name: "Zoho: Create Bill" }));

    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Zoho sync failed", description: "Zoho is unavailable", variant: "destructive" })));
  });
});
