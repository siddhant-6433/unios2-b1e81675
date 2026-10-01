import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RefundDialog } from "@/components/finance/RefundDialog";

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), toast: vi.fn(), upload: vi.fn(), getPublicUrl: vi.fn() }));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: mocks.rpc,
    storage: { from: () => ({ upload: mocks.upload, getPublicUrl: mocks.getPublicUrl }) },
  },
}));

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: mocks.toast }) }));

vi.mock("@/components/ui/thinking-orb", () => ({ ButtonOrb: () => null }));

vi.mock("@/components/bank/BankDetailsFields", () => ({
  BankDetailsFields: () => <div>Bank details</div>,
}));

describe("lead refund dialog", () => {
  beforeEach(() => {
    mocks.rpc.mockReset();
    mocks.toast.mockReset();
    mocks.upload.mockReset().mockResolvedValue({ data: null, error: null });
    mocks.getPublicUrl.mockReset().mockReturnValue({ data: { publicUrl: "https://files.example/refund-proof.pdf" } });
    mocks.rpc.mockImplementation(async (fn: string) => fn === "get_refundable_lead_payments"
      ? {
          data: [
            { lead_payment_id: "payment-a", type: "token_fee", fee_head: "Token", receipt_no: "R-101", payment_date: null, gateway: null, payment_mode: "upi", collected: 1000, already_refunded: 200, remaining: 800 },
            { lead_payment_id: "payment-b", type: "registration_fee", fee_head: "Registration", receipt_no: "R-102", payment_date: null, gateway: null, payment_mode: "cash", collected: 500, already_refunded: 0, remaining: 500 },
          ],
          error: null,
        }
      : { data: null, error: null });
  });

  it("selects partial amounts from multiple receipts and submits one draft request", async () => {
    const onOpenChange = vi.fn();
    const onDone = vi.fn();
    render(
      <RefundDialog
        leadId="lead-1"
        leadName="Asha Verma"
        open
        onOpenChange={onOpenChange}
        onDone={onDone}
      />,
    );

    expect(await screen.findByText("Receipt R-101")).toBeInTheDocument();
    expect(screen.getByText("Receipt R-102")).toBeInTheDocument();

    const checks = screen.getAllByRole("checkbox");
    fireEvent.click(checks[0]);
    fireEvent.click(checks[1]);
    const amounts = screen.getAllByRole("spinbutton");
    fireEvent.change(amounts[0], { target: { value: "300" } });
    fireEvent.change(amounts[1], { target: { value: "400" } });
    expect(screen.getByText("₹700")).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText("Why is this being refunded?"), {
      target: { value: "Duplicate payment" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create Refund ₹700" }));

    await waitFor(() => expect(mocks.rpc).toHaveBeenCalledWith("create_lead_refund", expect.objectContaining({
      _lead_id: "lead-1",
      _items: [
        { lead_payment_id: "payment-a", amount: 300 },
        { lead_payment_id: "payment-b", amount: 400 },
      ],
      _reason: "Duplicate payment",
    })));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(onDone).toHaveBeenCalledOnce();
  });

  it("caps a selected amount at the receipt's refundable balance", async () => {
    render(<RefundDialog leadId="lead-1" open onOpenChange={vi.fn()} />);
    await screen.findByText("Receipt R-101");
    fireEvent.click(screen.getAllByRole("checkbox")[0]);
    fireEvent.change(screen.getAllByRole("spinbutton")[0], { target: { value: "1200" } });
    expect(screen.getByText("₹800")).toBeInTheDocument();
  });

  it("shows the empty state when no lead receipts remain refundable", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: [], error: null });
    render(<RefundDialog leadId="lead-1" open onOpenChange={vi.fn()} />);
    expect(await screen.findByText("No refundable payments found for this candidate.")).toBeInTheDocument();
  });

  it("requires both a selected amount and a reason before submit is enabled", async () => {
    render(<RefundDialog leadId="lead-1" open onOpenChange={vi.fn()} />);
    await screen.findByText("Receipt R-101");
    const submit = screen.getByRole("button", { name: "Create Refund" });
    expect(submit).toBeDisabled();
    fireEvent.click(screen.getAllByRole("checkbox")[0]);
    expect(screen.getByRole("button", { name: "Create Refund ₹800" })).toBeDisabled();
    fireEvent.change(screen.getByPlaceholderText("Why is this being refunded?"), { target: { value: "Duplicate payment" } });
    expect(screen.getByRole("button", { name: "Create Refund ₹800" })).toBeEnabled();
  });

  it("shows other load errors and leaves the dialog recoverable", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: "500", message: "Database unavailable" } });
    render(<RefundDialog leadId="lead-1" open onOpenChange={vi.fn()} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Database unavailable");
    expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Could not load refundable payments" }));
  });

  it("keeps the dialog open and reports a failed draft creation", async () => {
    const onDone = vi.fn();
    mocks.rpc.mockImplementation(async (fn: string) => fn === "get_refundable_lead_payments"
      ? {
          data: [{ lead_payment_id: "payment-a", type: "token_fee", fee_head: "Token", receipt_no: "R-101", payment_date: null, gateway: null, payment_mode: "upi", collected: 1000, already_refunded: 0, remaining: 1000 }],
          error: null,
        }
      : { data: null, error: { message: "Refund amount exceeds remaining balance" } });
    render(<RefundDialog leadId="lead-1" open onOpenChange={vi.fn()} onDone={onDone} />);
    await screen.findByText("Receipt R-101");
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.change(screen.getByPlaceholderText("Why is this being refunded?"), { target: { value: "Duplicate payment" } });
    fireEvent.click(screen.getByRole("button", { name: "Create Refund ₹1,000" }));
    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Could not create refund" })));
    expect(onDone).not.toHaveBeenCalled();
    expect(screen.getByRole("heading", { name: /Refund Lead Payments/ })).toBeInTheDocument();
  });

  it("does not submit a refund when proof upload fails", async () => {
    mocks.upload.mockResolvedValueOnce({ data: null, error: { message: "Storage unavailable" } });
    render(<RefundDialog leadId="lead-1" open onOpenChange={vi.fn()} />);
    await screen.findByText("Receipt R-101");
    fireEvent.click(screen.getAllByRole("checkbox")[0]);
    fireEvent.change(screen.getByPlaceholderText("Why is this being refunded?"), { target: { value: "Duplicate payment" } });
    const fileInput = document.querySelector('input[type="file"]')!;
    fireEvent.change(fileInput, { target: { files: [new File(["proof"], "proof.pdf", { type: "application/pdf" })] } });
    fireEvent.click(screen.getByRole("button", { name: "Create Refund ₹800" }));
    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Proof upload failed" })));
    expect(mocks.rpc).not.toHaveBeenCalledWith("create_lead_refund", expect.anything());
  });

  it("uploads optional proof and attaches its URL to the draft", async () => {
    render(<RefundDialog leadId="lead-1" open onOpenChange={vi.fn()} />);
    await screen.findByText("Receipt R-101");
    fireEvent.click(screen.getAllByRole("checkbox")[0]);
    fireEvent.change(screen.getByPlaceholderText("Why is this being refunded?"), { target: { value: "Duplicate payment" } });
    fireEvent.change(document.querySelector('input[type="file"]')!, {
      target: { files: [new File(["proof"], "proof.pdf", { type: "application/pdf" })] },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create Refund ₹800" }));
    await waitFor(() => expect(mocks.rpc).toHaveBeenCalledWith("create_lead_refund", expect.objectContaining({
      _proof_url: "https://files.example/refund-proof.pdf",
    })));
    expect(mocks.upload).toHaveBeenCalledOnce();
  });

  it("rejects proof files larger than 10 MB", async () => {
    render(<RefundDialog leadId="lead-1" open onOpenChange={vi.fn()} />);
    await screen.findByText("Receipt R-101");
    const oversized = new File([new Uint8Array(10 * 1024 * 1024 + 1)], "large.pdf", { type: "application/pdf" });
    fireEvent.change(document.querySelector('input[type="file"]')!, { target: { files: [oversized] } });
    expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({ title: "File too large" }));
  });

  it("shows a migration hint when the lead refund RPC is missing", async () => {
    mocks.rpc.mockResolvedValueOnce({
      data: null,
      error: { code: "PGRST202", message: "Could not find the function in the schema cache" },
    });
    render(<RefundDialog leadId="lead-1" open onOpenChange={vi.fn()} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Apply the pending Supabase migrations");
  });

  it("keeps student allocation refunds on the existing RPC", async () => {
    mocks.rpc.mockImplementation(async (fn: string) => fn === "get_refundable_allocations"
      ? {
          data: [{
            fee_ledger_payment_id: "allocation-1",
            fee_ledger_id: "ledger-1",
            lead_payment_id: "payment-1",
            fee_code: "TUITION",
            fee_head: "Tuition",
            term: "Year 1",
            receipt_no: "S-101",
            payment_date: null,
            gateway: null,
            payment_mode: "upi",
            collected: 1000,
            already_refunded: 0,
            remaining: 1000,
          }],
          error: null,
        }
      : { data: null, error: null });
    render(<RefundDialog studentId="student-1" studentName="Asha" open onOpenChange={vi.fn()} />);
    expect(await screen.findByText("Receipt S-101")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.change(screen.getByPlaceholderText("Why is this being refunded?"), { target: { value: "Duplicate payment" } });
    fireEvent.click(screen.getByRole("button", { name: "Create Refund ₹1,000" }));
    await waitFor(() => expect(mocks.rpc).toHaveBeenCalledWith("create_fee_refund", expect.objectContaining({
      _student_id: "student-1",
      _items: [{ fee_ledger_payment_id: "allocation-1", amount: 1000 }],
    })));
  });
});
