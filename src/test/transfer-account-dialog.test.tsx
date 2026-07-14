import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { TransferAccountDialog } from "@/components/admin/TransferAccountDialog";

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

function mockLeadRows(rows: Array<{ id: string; course_id: string | null; courses: unknown }>, count?: number) {
  mocks.from.mockReturnValue({
    select: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        range: vi.fn().mockResolvedValue({
          data: rows,
          count: count ?? rows.length,
          error: null,
        }),
      }),
    }),
  });
}

const staff = [
  { profile_id: "source-profile", user_id: "source-user", name: "Khyati Sagar", role: "counsellor" },
  { profile_id: "target-arushi", user_id: "user-arushi", name: "Arushi Tyagi", role: "counsellor" },
  { profile_id: "target-neha", user_id: "user-neha", name: "Neha Garg", role: "counsellor" },
];

describe("TransferAccountDialog", () => {
  beforeEach(() => {
    mocks.from.mockReset();
    mocks.rpc.mockReset();
    mocks.toast.mockReset();

    mockLeadRows([
      {
        id: "lead-1",
        course_id: "course-nursing",
        courses: { id: "course-nursing", name: "B.Sc Nursing", code: "BSCN-GN" },
      },
      {
        id: "lead-2",
        course_id: "course-nursing",
        courses: { id: "course-nursing", name: "B.Sc Nursing", code: "BSCN-GN" },
      },
      {
        id: "lead-3",
        course_id: "course-law",
        courses: { id: "course-law", name: "LLB", code: "LLB-GN" },
      },
    ], 3);
    mocks.rpc.mockResolvedValue({ data: { leads_transferred: 3 }, error: null });
  });

  it("submits selected counsellors and course-wise routing to the multi-transfer RPC", async () => {
    const onDone = vi.fn();

    render(
      <TransferAccountDialog
        source={{ profileId: "source-profile", userId: "source-user", name: "Shivam Gupta" }}
        allUsers={[
          { profile_id: "source-profile", user_id: "source-user", name: "Shivam Gupta", role: "counsellor" },
          { profile_id: "target-ananya", user_id: "user-ananya", name: "Ananya Rao", role: "counsellor" },
          { profile_id: "target-rahul", user_id: "user-rahul", name: "Rahul Mehta", role: "admission_head" },
        ]}
        onClose={vi.fn()}
        onDone={onDone}
      />,
    );

    expect(await screen.findByText(/3/)).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText(/Ananya Rao/i));
    fireEvent.click(screen.getByLabelText(/Rahul Mehta/i));
    fireEvent.click(screen.getByRole("button", { name: /course-wise/i }));

    const nursingRouting = await screen.findByTestId("course-routing-course-nursing");
    fireEvent.click(within(nursingRouting).getByLabelText(/Ananya Rao/i));

    fireEvent.click(screen.getByRole("button", { name: /^transfer$/i }));

    await waitFor(() => {
      expect(mocks.rpc).toHaveBeenCalledWith("transfer_counsellor_account_multi", {
        source_profile_id: "source-profile",
        target_profile_ids: ["target-ananya", "target-rahul"],
        disable_source: true,
        course_target_map: [
          { course_id: "course-nursing", target_profile_ids: ["target-ananya"] },
        ],
      });
    });
    expect(onDone).toHaveBeenCalled();
  });

  it("finishes a 0-lead single-target transfer via the simple RPC", async () => {
    mockLeadRows([], 0);
    mocks.rpc.mockResolvedValue({ data: { leads_transferred: 0 }, error: null });
    const onDone = vi.fn();

    render(
      <TransferAccountDialog
        source={{ profileId: "source-profile", userId: "source-user", name: "Khyati Sagar" }}
        allUsers={staff}
        onClose={vi.fn()}
        onDone={onDone}
      />,
    );

    expect(await screen.findByText(/0 leads/i)).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText(/Arushi Tyagi/i));

    fireEvent.click(await screen.findByRole("button", { name: /finish transfer/i }));

    await waitFor(() => {
      expect(mocks.rpc).toHaveBeenCalledWith("transfer_counsellor_account", {
        source_profile_id: "source-profile",
        target_profile_id: "target-arushi",
        disable_source: true,
      });
    });

    expect(onDone).toHaveBeenCalled();
    expect(mocks.toast).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Transfer complete",
        description: expect.stringMatching(/No leads were assigned/i),
      }),
    );
  });

  it("shows failure toast and clears spinner when RPC throws", async () => {
    mockLeadRows([], 0);
    mocks.rpc.mockRejectedValue(new Error("network down"));
    const onDone = vi.fn();

    render(
      <TransferAccountDialog
        source={{ profileId: "source-profile", userId: "source-user", name: "Khyati Sagar" }}
        allUsers={staff}
        onClose={vi.fn()}
        onDone={onDone}
      />,
    );

    expect(await screen.findByText(/0 leads/i)).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText(/Arushi Tyagi/i));
    fireEvent.click(await screen.findByRole("button", { name: /finish transfer/i }));

    await waitFor(() => {
      expect(mocks.toast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Transfer failed",
          description: "network down",
        }),
      );
    });

    expect(onDone).not.toHaveBeenCalled();
    await waitFor(() => {
      const btn = screen.getByRole("button", { name: /finish transfer/i });
      expect(btn).not.toBeDisabled();
      expect(btn).not.toHaveTextContent("Transferring");
    });
  });

  it("shows failure toast when RPC returns an error payload", async () => {
    mockLeadRows([], 0);
    mocks.rpc.mockResolvedValue({ data: null, error: { message: "Only super admins can transfer accounts" } });

    render(
      <TransferAccountDialog
        source={{ profileId: "source-profile", userId: "source-user", name: "Khyati Sagar" }}
        allUsers={staff}
        onClose={vi.fn()}
        onDone={vi.fn()}
      />,
    );

    expect(await screen.findByText(/0 leads/i)).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText(/Arushi Tyagi/i));
    fireEvent.click(await screen.findByRole("button", { name: /finish transfer/i }));

    await waitFor(() => {
      expect(mocks.toast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Transfer failed",
          description: "Only super admins can transfer accounts",
        }),
      );
    });
    await waitFor(() => {
      const btn = screen.getByRole("button", { name: /finish transfer/i });
      expect(btn).not.toBeDisabled();
      expect(btn).not.toHaveTextContent("Transferring");
    });
  });
});
