import { readFileSync } from "fs";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ConsultantFeesPanel } from "@/components/finance/ConsultantFeesPanel";
import ConsultantFeeManagementPanel from "@/components/admin/ConsultantFeeManagementPanel";

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  rpc: vi.fn(),
  invoke: vi.fn(),
  toast: vi.fn(),
  openCheckout: vi.fn(),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: mocks.from,
    rpc: mocks.rpc,
    functions: { invoke: mocks.invoke },
  },
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: mocks.toast }),
}));

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ profile: { id: "admin-profile" }, role: "super_admin", session: null, user: null }),
}));

vi.mock("@/lib/razorpayCheckout", () => ({
  openRazorpayCheckout: mocks.openCheckout,
  buildRazorpayReceipt: (prefix: string, id: string) => `${prefix}_${id}`,
}));

function makeChain(selectPayload: unknown) {
  let payload: unknown = selectPayload;
  const chain: Record<string, unknown> = {};
  const self = () => chain;
  for (const m of ["select", "gte", "lte", "in", "order", "eq", "not", "limit", "maybeSingle"]) {
    chain[m] = vi.fn(self);
  }
  chain.update = vi.fn(() => {
    payload = { data: null, error: null };
    return chain;
  });
  chain.upsert = vi.fn(() => {
    payload = { data: null, error: null };
    return chain;
  });
  chain.then = (resolve: (v: unknown) => void) => resolve(payload);
  return chain;
}

const feeStudent = {
  student_id: "student-1",
  name: "Asha Verma",
  admission_no: "AN-1234",
  course_name: "B.Sc Nursing",
  session_name: "2026-27",
  due_total: 42000,
  paid_total: 8000,
  hidden: false,
  config_enabled: true,
};

beforeEach(() => {
  mocks.from.mockReset();
  mocks.rpc.mockReset();
  mocks.invoke.mockReset();
  mocks.toast.mockReset();
  mocks.openCheckout.mockReset();
});

describe("ConsultantFeesPanel", () => {
  it("lists fee-managed students with paid/due summary from consultant_fee_students", async () => {
    mocks.rpc.mockResolvedValue({ data: [feeStudent], error: null });

    render(<ConsultantFeesPanel />);

    expect(await screen.findByText("Asha Verma")).toBeInTheDocument();
    expect(screen.getByText("₹8,000")).toBeInTheDocument();
    expect(screen.getByText("₹42,000")).toBeInTheDocument();
    expect(mocks.rpc).toHaveBeenCalledWith("consultant_fee_students");
  });

  it("toggles hiding via consultant_set_fee_visibility with the flipped value", async () => {
    mocks.rpc.mockImplementation((fn: string) => {
      if (fn === "consultant_fee_students") return Promise.resolve({ data: [feeStudent], error: null });
      return Promise.resolve({ data: null, error: null });
    });

    render(<ConsultantFeesPanel />);

    fireEvent.click(await screen.findByRole("switch"));

    await waitFor(() => {
      expect(mocks.rpc).toHaveBeenCalledWith("consultant_set_fee_visibility", {
        _student_id: "student-1",
        _hidden: true,
      });
    });
    expect(mocks.toast).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Fee details hidden from student login" }),
    );
  });

  it("surfaces scope-rejection errors from the RPC (non-enabled course/session)", async () => {
    mocks.rpc.mockImplementation((fn: string) => {
      if (fn === "consultant_fee_students") return Promise.resolve({ data: [feeStudent], error: null });
      return Promise.resolve({ data: null, error: { message: "Fee management is not enabled for this course/session" } });
    });

    render(<ConsultantFeesPanel />);

    fireEvent.click(await screen.findByRole("switch"));

    await waitFor(() => {
      expect(mocks.toast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Could not update visibility",
          description: "Fee management is not enabled for this course/session",
          variant: "destructive",
        }),
      );
    });
  });

  it("pays outstanding dues through the student_fee gateway context (server computes amount)", async () => {
    mocks.rpc.mockResolvedValue({ data: [feeStudent], error: null });
    mocks.openCheckout.mockResolvedValue({ paymentId: "pay_1", orderId: "order_1" });

    render(<ConsultantFeesPanel />);

    fireEvent.click(await screen.findByRole("button", { name: /pay now/i }));

    await waitFor(() => {
      expect(mocks.openCheckout).toHaveBeenCalledWith(
        expect.objectContaining({
          context: "student_fee",
          studentId: "student-1",
          paymentScope: "due",
        }),
      );
    });
  });

  it("refuses Pay now when nothing is due", async () => {
    mocks.rpc.mockResolvedValue({ data: [{ ...feeStudent, due_total: 0 }], error: null });

    render(<ConsultantFeesPanel />);

    fireEvent.click(await screen.findByRole("button", { name: /pay now/i }));

    await waitFor(() => {
      expect(mocks.toast).toHaveBeenCalledWith(
        expect.objectContaining({ title: "No outstanding dues" }),
      );
    });
    expect(mocks.openCheckout).not.toHaveBeenCalled();
  });

  it("opens the Phase 1 send-link dialog prefilled with the due amount", async () => {
    mocks.rpc.mockResolvedValue({ data: [feeStudent], error: null });

    render(<ConsultantFeesPanel />);

    fireEvent.click(await screen.findByRole("button", { name: /send link/i }));

    expect(await screen.findByText(/send payment link/i)).toBeInTheDocument();
    expect(screen.getByPlaceholderText("0")).toHaveValue(42000);
  });
});

describe("ConsultantFeeManagementPanel", () => {
  it("requires consultant + course + session before enabling", async () => {
    mocks.from.mockImplementation(() => makeChain({ data: [], error: null }));

    render(<ConsultantFeeManagementPanel />);

    fireEvent.click(await screen.findByRole("button", { name: /^enable$/i }));

    await waitFor(() => {
      expect(mocks.toast).toHaveBeenCalledWith(
        expect.objectContaining({ title: "Pick a consultant, course and session", variant: "destructive" }),
      );
    });
  });

  it("upserts on the consultant+course+session unique key so re-enabling never duplicates", () => {
    // Source-level guard: the panel writes through UPSERT with the composite
    // conflict target that matches the migration's UNIQUE constraint.
    const panelSource = readFileSync("src/components/admin/ConsultantFeeManagementPanel.tsx", "utf8");
    expect(panelSource).toContain('{ onConflict: "consultant_id,course_id,session_id" }');
    const migration = readFileSync("supabase/migrations/20260707140000_consultant_fee_management.sql", "utf8");
    expect(migration).toContain("UNIQUE (consultant_id, course_id, session_id)");
  });

  it("toggles an existing config row and confirms students see full fees again on disable", async () => {
    const cfgRow = {
      id: "cfg-1",
      consultant_id: "cons-1",
      course_id: "course-1",
      session_id: "sess-1",
      enabled: true,
      enabled_at: new Date().toISOString(),
      consultants: { name: "Acme Consultants" },
      courses: { name: "B.Sc Nursing" },
      admission_sessions: { name: "2026-27" },
    };
    const chains: Record<string, ReturnType<typeof makeChain>> = {};
    mocks.from.mockImplementation((table: string) => {
      chains[table] ||= makeChain(
        table === "consultant_fee_management" ? { data: [cfgRow], error: null } : { data: [], error: null },
      );
      return chains[table];
    });

    render(<ConsultantFeeManagementPanel />);

    expect(await screen.findByText("Acme Consultants")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /disable/i }));

    await waitFor(() => {
      expect(chains["consultant_fee_management"].update).toHaveBeenCalledWith({ enabled: false });
    });
    expect(mocks.toast).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Disabled — students see full fees again" }),
    );
  });
});
