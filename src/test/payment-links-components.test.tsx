import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { SendPaymentLinkDialog } from "@/components/finance/SendPaymentLinkDialog";
import PayLink from "@/pages/PayLink";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  toast: vi.fn(),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: { invoke: mocks.invoke },
  },
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: mocks.toast }),
}));

vi.mock("@/assets/unios-logo.png", () => ({ default: "logo.png" }));

describe("SendPaymentLinkDialog", () => {
  beforeEach(() => {
    mocks.invoke.mockReset();
    mocks.toast.mockReset();
  });

  it("rejects a missing/zero amount without calling the edge function", async () => {
    render(
      <SendPaymentLinkDialog open onOpenChange={vi.fn()} leadId="lead-1" />,
    );

    fireEvent.click(screen.getByRole("button", { name: /create link/i }));

    await waitFor(() => {
      expect(mocks.toast).toHaveBeenCalledWith(
        expect.objectContaining({ title: "Enter a valid amount", variant: "destructive" }),
      );
    });
    expect(mocks.invoke).not.toHaveBeenCalled();
  });

  it("sends the custom amount + default token purpose for a lead to create-payment-link", async () => {
    mocks.invoke.mockResolvedValue({ data: { pay_url: "https://pay.test/abc" }, error: null });

    render(
      <SendPaymentLinkDialog open onOpenChange={vi.fn()} leadId="lead-1" />,
    );

    fireEvent.change(screen.getByPlaceholderText("0"), { target: { value: "5000" } });
    fireEvent.click(screen.getByRole("button", { name: /create link/i }));

    await waitFor(() => {
      expect(mocks.invoke).toHaveBeenCalledWith("create-payment-link", {
        body: expect.objectContaining({
          purpose: "pre_admission_token",
          lead_id: "lead-1",
          amount: 5000,
          expires_days: 7,
          send_channel: "whatsapp",
        }),
      });
    });
    // The created URL is surfaced for copying.
    expect(await screen.findByText("https://pay.test/abc")).toBeInTheDocument();
  });

  it("prefills the due amount and fee_due purpose when opened from a student fee panel", async () => {
    mocks.invoke.mockResolvedValue({ data: { pay_url: "https://pay.test/def" }, error: null });

    render(
      <SendPaymentLinkDialog
        open
        onOpenChange={vi.fn()}
        studentId="student-1"
        defaultAmount={42000}
        defaultPurpose="fee_due"
      />,
    );

    expect(screen.getByPlaceholderText("0")).toHaveValue(42000);

    fireEvent.click(screen.getByRole("button", { name: /create link/i }));

    await waitFor(() => {
      expect(mocks.invoke).toHaveBeenCalledWith("create-payment-link", {
        body: expect.objectContaining({
          purpose: "fee_due",
          student_id: "student-1",
          amount: 42000,
        }),
      });
    });
  });

  it("shows a destructive toast when the edge function rejects", async () => {
    mocks.invoke.mockResolvedValue({ data: { error: "Not authorised to send payment links" }, error: null });

    render(
      <SendPaymentLinkDialog open onOpenChange={vi.fn()} leadId="lead-1" />,
    );

    fireEvent.change(screen.getByPlaceholderText("0"), { target: { value: "100" } });
    fireEvent.click(screen.getByRole("button", { name: /create link/i }));

    await waitFor(() => {
      expect(mocks.toast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Payment link failed",
          description: "Not authorised to send payment links",
          variant: "destructive",
        }),
      );
    });
  });
});

function renderPayLink(token = "tok123") {
  return render(
    <MemoryRouter initialEntries={[`/pay/${token}`]}>
      <Routes>
        <Route path="/pay/:token" element={<PayLink />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("PayLink public page", () => {
  beforeEach(() => {
    mocks.invoke.mockReset();
  });

  it("renders the server-resolved payer, amount, and purpose for an active link", async () => {
    mocks.invoke.mockResolvedValue({
      data: {
        payer_name: "Asha Verma",
        amount: 5000,
        purpose: "pre_admission_token",
        purpose_label: "Token fee prior to admission",
        note: null,
        status: "active",
        gateway: null,
        short_url: null,
      },
      error: null,
    });

    renderPayLink();

    expect(await screen.findByText("Token fee prior to admission")).toBeInTheDocument();
    expect(screen.getByText("₹5,000")).toBeInTheDocument();
    expect(screen.getByText("Asha Verma")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /pay ₹5,000/i })).toBeInTheDocument();
    expect(mocks.invoke).toHaveBeenCalledWith("pay-link", {
      body: expect.objectContaining({ action: "resolve", token: "tok123" }),
    });
  });

  it("shows the done state for an already-paid link instead of a pay button", async () => {
    mocks.invoke.mockResolvedValue({
      data: { payer_name: "Asha", amount: 5000, purpose: "custom", purpose_label: "Payment", note: null, status: "paid", gateway: null, short_url: null },
      error: null,
    });

    renderPayLink();

    expect(await screen.findByText("Payment received")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /pay/i })).not.toBeInTheDocument();
  });

  it("blocks expired and cancelled links", async () => {
    mocks.invoke.mockResolvedValue({
      data: { payer_name: "Asha", amount: 5000, purpose: "custom", purpose_label: "Payment", note: null, status: "expired", gateway: null, short_url: null },
      error: null,
    });

    renderPayLink();

    expect(await screen.findByText("This link is expired.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /pay/i })).not.toBeInTheDocument();
  });
});
