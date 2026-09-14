import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { HeaderWalkIns } from "@/components/layout/HeaderWalkIns";

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  rpc: vi.fn(),
  toast: vi.fn(),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: mocks.from,
    rpc: mocks.rpc,
  },
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: mocks.toast }),
}));

function makeChain(selectPayload: unknown) {
  let payload: unknown = selectPayload;
  const chain: Record<string, unknown> = {};
  const self = () => chain;
  for (const m of ["select", "gte", "lte", "in", "order", "eq", "not", "limit", "is"]) {
    chain[m] = vi.fn(self);
  }
  chain.then = (resolve: (v: unknown) => void) => resolve(payload);
  return chain;
}

const liveRow = {
  id: "visit-1",
  lead_id: "lead-1",
  checked_in_at: new Date(Date.now() - 15 * 60_000).toISOString(),
  purpose: "Tour",
  leads: { name: "Asha Verma", phone: "9876543210" },
  campuses: { name: "Greater Noida", code: "GN" },
};

beforeEach(() => {
  mocks.from.mockReset();
  mocks.rpc.mockReset();
  mocks.toast.mockReset();
  mocks.from.mockImplementation(() => makeChain({ data: [liveRow], error: null }));
});

describe("HeaderWalkIns", () => {
  it("shows live walk-ins with campus code and completes via visit_check_out", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: null });

    render(<MemoryRouter><HeaderWalkIns /></MemoryRouter>);

    fireEvent.click(await screen.findByRole("button", { name: /walk-ins/i }));

    expect(await screen.findByText("Asha Verma")).toBeInTheDocument();
    expect(screen.getAllByText("GN").length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("button", { name: /^complete$/i }));

    await waitFor(() => {
      expect(mocks.rpc).toHaveBeenCalledWith("visit_check_out", { _visit_id: "visit-1" });
    });
    expect(mocks.toast).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Walk-in completed" }),
    );
  });

  it("opens Record Walk-in from the popover", async () => {
    render(<MemoryRouter><HeaderWalkIns /></MemoryRouter>);

    fireEvent.click(await screen.findByRole("button", { name: /walk-ins/i }));
    fireEvent.click(await screen.findByRole("button", { name: /^record$/i }));

    expect(await screen.findByRole("heading", { name: /record walk-in/i })).toBeInTheDocument();
  });
});
