import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { WalkInDialog } from "@/components/visits/WalkInDialog";
import { VisitCompleteDialog } from "@/components/visits/VisitCompleteDialog";
import { TodayVisitBoard } from "@/components/visits/TodayVisitBoard";
import { PostVisitQueue } from "@/components/visits/PostVisitQueue";
import { WalkInsBoard } from "@/components/visits/WalkInsBoard";
import { PreviousWalkInDialog } from "@/components/visits/PreviousWalkInDialog";

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  rpc: vi.fn(),
  invoke: vi.fn(),
  toast: vi.fn(),
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

// Chainable thenable query mock: every builder method returns the chain, and
// awaiting it resolves the configured payload. `update` swaps the payload to a
// plain success so `.update().eq()` writes resolve cleanly.
function makeChain(selectPayload: unknown) {
  let payload: unknown = selectPayload;
  const chain: Record<string, unknown> = {};
  const self = () => chain;
  for (const m of ["select", "gte", "lte", "in", "order", "eq", "not", "limit"]) {
    chain[m] = vi.fn(self);
  }
  chain.update = vi.fn(() => {
    payload = { data: null, error: null };
    return chain;
  });
  chain.then = (resolve: (v: unknown) => void) => resolve(payload);
  return chain;
}

const visitRow = {
  id: "visit-1",
  lead_id: "lead-1",
  visit_date: new Date(Date.now() + 3600_000).toISOString(),
  status: "scheduled",
  visit_type: "walk_in",
  checked_in_at: null,
  purpose: "Campus tour",
  leads: { name: "Asha Verma", phone: "9876543210" },
  campuses: { name: "Greater Noida" },
};

beforeEach(() => {
  mocks.from.mockReset();
  mocks.rpc.mockReset();
  mocks.invoke.mockReset();
  mocks.toast.mockReset();
});

describe("WalkInDialog", () => {
  const props = {
    open: true,
    onOpenChange: vi.fn(),
    courses: [{ id: "course-1", name: "B.Sc Nursing" }],
    campuses: [{ id: "campus-1", name: "Greater Noida" }],
  };

  it("requires name and phone before calling the RPC", async () => {
    render(<MemoryRouter><WalkInDialog {...props} /></MemoryRouter>);

    fireEvent.click(screen.getByRole("button", { name: /check in/i }));
    await waitFor(() => {
      expect(mocks.toast).toHaveBeenCalledWith(
        expect.objectContaining({ title: "Name is required", variant: "destructive" }),
      );
    });

    fireEvent.change(screen.getByPlaceholderText("Candidate name"), { target: { value: "Asha" } });
    fireEvent.click(screen.getByRole("button", { name: /check in/i }));
    await waitFor(() => {
      expect(mocks.toast).toHaveBeenCalledWith(
        expect.objectContaining({ title: "Phone is required", variant: "destructive" }),
      );
    });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("creates the walk-in via create_walk_in_visit and offers the token link + candidate shortcut", async () => {
    mocks.rpc.mockResolvedValue({ data: { lead_id: "lead-9", visit_id: "visit-9" }, error: null });

    render(<MemoryRouter><WalkInDialog {...props} /></MemoryRouter>);

    fireEvent.change(screen.getByPlaceholderText("Candidate name"), { target: { value: "Asha Verma" } });
    fireEvent.change(screen.getByPlaceholderText("Mobile number"), { target: { value: "9876543210" } });
    fireEvent.click(screen.getByRole("button", { name: /check in/i }));

    await waitFor(() => {
      expect(mocks.rpc).toHaveBeenCalledWith("create_walk_in_visit", {
        _name: "Asha Verma",
        _phone: "9876543210",
        _email: null,
        _course_id: null,
        _campus_id: null,
        _purpose: null,
        _notes: null,
        _already_left: false,
      });
    });

    // Token-at-visit moment: send-link offer + deep link to the (possibly
    // deduped, pre-existing) lead returned by the RPC.
    expect(await screen.findByRole("button", { name: /send token payment link/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /open candidate/i })).toHaveAttribute("href", "/admissions/lead-9");
  });

  it("records an already-left walk-in without keeping them live", async () => {
    mocks.rpc.mockResolvedValue({
      data: { lead_id: "lead-9", visit_id: "visit-9", already_left: true },
      error: null,
    });

    render(<MemoryRouter><WalkInDialog {...props} /></MemoryRouter>);

    fireEvent.change(screen.getByPlaceholderText("Candidate name"), { target: { value: "Asha Verma" } });
    fireEvent.change(screen.getByPlaceholderText("Mobile number"), { target: { value: "9876543210" } });
    fireEvent.click(screen.getByText("Already left"));
    fireEvent.click(screen.getByRole("button", { name: /record & mark left/i }));

    await waitFor(() => {
      expect(mocks.rpc).toHaveBeenCalledWith(
        "create_walk_in_visit",
        expect.objectContaining({ _already_left: true }),
      );
    });
    expect(await screen.findByText(/has left/i)).toBeInTheDocument();
  });

  it("prefills and locks identity when opened from an existing lead", () => {
    render(
      <MemoryRouter>
        <WalkInDialog
          {...props}
          defaults={{ name: "Asha Verma", phone: "9876543210", campusId: "campus-1" }}
          lockIdentity
        />
      </MemoryRouter>,
    );

    expect(screen.getByPlaceholderText("Candidate name")).toHaveValue("Asha Verma");
    expect(screen.getByPlaceholderText("Mobile number")).toHaveValue("9876543210");
    expect(screen.getByPlaceholderText("Candidate name")).toBeDisabled();
    expect(screen.getByPlaceholderText("Mobile number")).toBeDisabled();
  });

  it("surfaces RPC failures as a destructive toast", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: "Phone is required" } });

    render(<MemoryRouter><WalkInDialog {...props} /></MemoryRouter>);

    fireEvent.change(screen.getByPlaceholderText("Candidate name"), { target: { value: "Asha" } });
    fireEvent.change(screen.getByPlaceholderText("Mobile number"), { target: { value: "98765" } });
    fireEvent.click(screen.getByRole("button", { name: /check in/i }));

    await waitFor(() => {
      expect(mocks.toast).toHaveBeenCalledWith(
        expect.objectContaining({ title: "Could not record walk-in", variant: "destructive" }),
      );
    });
  });
});

describe("VisitCompleteDialog", () => {
  it("completes with the selected outcome and no follow-up by default", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: null });
    const onCompleted = vi.fn();

    render(
      <VisitCompleteDialog open onOpenChange={vi.fn()} visitId="visit-1" leadName="Asha" onCompleted={onCompleted} />,
    );

    fireEvent.click(screen.getByRole("button", { name: /complete visit/i }));

    await waitFor(() => {
      expect(mocks.rpc).toHaveBeenCalledWith("visit_complete", {
        _visit_id: "visit-1",
        _outcome: "interested",
        _feedback: null,
        _followup_at: null,
        _followup_type: "call",
      });
    });
    expect(onCompleted).toHaveBeenCalled();
  });

  it("sends a follow-up timestamp when the follow-up option is enabled", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: null });

    render(<VisitCompleteDialog open onOpenChange={vi.fn()} visitId="visit-2" />);

    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: /complete visit/i }));

    await waitFor(() => {
      expect(mocks.rpc).toHaveBeenCalledWith(
        "visit_complete",
        expect.objectContaining({
          _visit_id: "visit-2",
          _followup_type: "call",
          _followup_at: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
        }),
      );
    });
  });
});

describe("TodayVisitBoard", () => {
  it("lists upcoming visits and checks in through the visit_check_in RPC", async () => {
    mocks.from.mockImplementation(() => makeChain({ data: [visitRow], error: null }));
    mocks.rpc.mockResolvedValue({ data: null, error: null });

    render(<MemoryRouter><TodayVisitBoard /></MemoryRouter>);

    expect(await screen.findByText("Asha Verma")).toBeInTheDocument();
    expect(screen.getByText("Walk-in")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /check in/i }));

    await waitFor(() => {
      expect(mocks.rpc).toHaveBeenCalledWith("visit_check_in", { _visit_id: "visit-1" });
    });
  });

  it("marks a visit no-show with a direct status update (fires the DB trigger)", async () => {
    const chain = makeChain({ data: [visitRow], error: null });
    mocks.from.mockImplementation(() => chain);

    render(<MemoryRouter><TodayVisitBoard /></MemoryRouter>);

    fireEvent.click(await screen.findByRole("button", { name: /no-show/i }));

    await waitFor(() => {
      expect(chain.update).toHaveBeenCalledWith({ status: "no_show" });
    });
    expect(mocks.toast).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Marked no-show" }),
    );
  });

  it("shows the empty state when nothing is scheduled", async () => {
    mocks.from.mockImplementation(() => makeChain({ data: [], error: null }));

    render(<MemoryRouter><TodayVisitBoard /></MemoryRouter>);

    expect(await screen.findByText(/no upcoming visits/i)).toBeInTheDocument();
  });
});

describe("PostVisitQueue", () => {
  const followupRow = {
    id: "fu-1",
    lead_id: "lead-1",
    scheduled_at: new Date().toISOString(),
    notes: "Post-visit follow-up",
    leads: { name: "Asha Verma", phone: "9876543210" },
  };

  it("renders visit-linked follow-ups and completes them inline", async () => {
    const chain = makeChain({ data: [followupRow], error: null });
    mocks.from.mockImplementation(() => chain);

    render(<MemoryRouter><PostVisitQueue /></MemoryRouter>);

    expect(await screen.findByText("Asha Verma")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /done/i }));

    await waitFor(() => {
      expect(chain.update).toHaveBeenCalledWith(
        expect.objectContaining({ status: "completed", completed_at: expect.any(String) }),
      );
    });
  });

  it("reschedules with the picked datetime", async () => {
    const chain = makeChain({ data: [followupRow], error: null });
    mocks.from.mockImplementation(() => chain);

    render(<MemoryRouter><PostVisitQueue /></MemoryRouter>);

    fireEvent.click(await screen.findByRole("button", { name: /reschedule/i }));
    const input = document.querySelector('input[type="datetime-local"]') as HTMLInputElement;
    fireEvent.change(input, { target: { value: "2026-07-10T11:00" } });
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));

    await waitFor(() => {
      expect(chain.update).toHaveBeenCalledWith({
        scheduled_at: new Date("2026-07-10T11:00").toISOString(),
      });
    });
  });
});

describe("WalkInsBoard", () => {
  it("lists recorded and previous walk-ins with campus and comments", async () => {
    mocks.from.mockImplementation(() => makeChain({
      data: [{
        id: "visit-w",
        lead_id: "lead-1",
        visit_date: "2026-09-10T06:30:00.000Z",
        status: "completed",
        checked_in_at: "2026-09-10T06:30:00.000Z",
        checked_out_at: "2026-09-10T06:30:00.000Z",
        purpose: null,
        feedback: "Liked the hostel",
        leads: { name: "Asha Verma", phone: "9876543210" },
        campuses: { name: "Greater Noida", code: "GN" },
      }],
      error: null,
    }));

    render(<MemoryRouter><WalkInsBoard /></MemoryRouter>);

    expect(await screen.findByText("Asha Verma")).toBeInTheDocument();
    expect(screen.getByText("GN")).toBeInTheDocument();
    expect(screen.getByText("Liked the hostel")).toBeInTheDocument();
  });
});

describe("PreviousWalkInDialog", () => {
  it("shows existing walk-in history and blocks logging the same date again", async () => {
    mocks.from.mockImplementation(() => makeChain({
      data: [{
        id: "visit-old",
        visit_date: "2026-09-10T06:30:00.000Z",
        checked_in_at: "2026-09-10T06:30:00.000Z",
        checked_out_at: "2026-09-10T06:30:00.000Z",
        purpose: null,
        feedback: "Campus tour",
        status: "completed",
        campuses: { name: "Greater Noida", code: "GN" },
      }],
      error: null,
    }));

    render(
      <PreviousWalkInDialog
        open
        onOpenChange={vi.fn()}
        leadId="lead-1"
        leadName="Asha Verma"
        userId="user-1"
        counsellorLabel="Payal"
        campuses={[{ id: "campus-1", name: "Greater Noida", code: "GN" }]}
      />,
    );

    expect(await screen.findByText("Campus tour")).toBeInTheDocument();
    expect(screen.getByText("GN")).toBeInTheDocument();

    const dateInput = document.querySelector('input[type="date"]') as HTMLInputElement;
    fireEvent.change(dateInput, { target: { value: "2026-09-10" } });

    expect(await screen.findByText(/already logged for this date/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /log a previous walk-in/i })).toBeDisabled();
  });
});
