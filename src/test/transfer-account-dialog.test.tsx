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

const staffDirectory = [
  { profile_id: "source-profile", user_id: "source-user", display_name: "Khyati Sagar", role: "counsellor", login_disabled: false },
  { profile_id: "target-arushi", user_id: "user-arushi", display_name: "Arushi Tyagi", role: "counsellor", login_disabled: false },
  { profile_id: "target-neha", user_id: "user-neha", display_name: "Neha Garg", role: "counsellor", login_disabled: false },
];

const multiStaffDirectory = [
  { profile_id: "source-profile", user_id: "source-user", display_name: "Shivam Gupta", role: "counsellor", login_disabled: false },
  { profile_id: "target-ananya", user_id: "user-ananya", display_name: "Ananya Rao", role: "counsellor", login_disabled: false },
  { profile_id: "target-rahul", user_id: "user-rahul", display_name: "Rahul Mehta", role: "admission_head", login_disabled: false },
];

function mockRpc(options?: {
  staff?: typeof staffDirectory;
  transfer?: { data: unknown; error: { message: string } | null };
  transferReject?: Error;
}) {
  const staff = options?.staff ?? staffDirectory;
  mocks.rpc.mockImplementation((fn: string) => {
    if (fn === "admin_user_directory") {
      return Promise.resolve({ data: staff, error: null });
    }
    if (options?.transferReject) return Promise.reject(options.transferReject);
    return Promise.resolve(options?.transfer ?? { data: { leads_transferred: 3 }, error: null });
  });
}

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
    mockRpc({ staff: multiStaffDirectory });
  });

  it("loads every active employee instead of the current Users & Roles page", async () => {
    render(
      <TransferAccountDialog
        source={{ profileId: "source-profile", userId: "source-user", name: "Rahul Bhati" }}
        onClose={vi.fn()}
        onDone={vi.fn()}
      />,
    );

    expect(await screen.findByLabelText(/Ananya Rao/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Rahul Mehta/i)).toBeInTheDocument();
    expect(screen.queryByText(/No eligible staff members found/i)).not.toBeInTheDocument();

    expect(mocks.rpc).toHaveBeenCalledWith("admin_user_directory", {
      _show_archived: false,
      _category: "employees",
      _status: "active",
      _limit: 1000,
      _offset: 0,
    });
  });

  it("submits selected counsellors and course-wise routing to the multi-transfer RPC", async () => {
    const onDone = vi.fn();

    render(
      <TransferAccountDialog
        source={{ profileId: "source-profile", userId: "source-user", name: "Shivam Gupta" }}
        onClose={vi.fn()}
        onDone={onDone}
      />,
    );

    expect(await screen.findByText(/3/)).toBeInTheDocument();

    fireEvent.click(await screen.findByLabelText(/Ananya Rao/i));
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
    mockRpc({ staff: staffDirectory, transfer: { data: { leads_transferred: 0 }, error: null } });
    const onDone = vi.fn();

    render(
      <TransferAccountDialog
        source={{ profileId: "source-profile", userId: "source-user", name: "Khyati Sagar" }}
        onClose={vi.fn()}
        onDone={onDone}
      />,
    );

    expect(await screen.findByText(/0 leads/i)).toBeInTheDocument();
    fireEvent.click(await screen.findByLabelText(/Arushi Tyagi/i));

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
    mockRpc({ staff: staffDirectory, transferReject: new Error("network down") });
    const onDone = vi.fn();

    render(
      <TransferAccountDialog
        source={{ profileId: "source-profile", userId: "source-user", name: "Khyati Sagar" }}
        onClose={vi.fn()}
        onDone={onDone}
      />,
    );

    expect(await screen.findByText(/0 leads/i)).toBeInTheDocument();
    fireEvent.click(await screen.findByLabelText(/Arushi Tyagi/i));
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
    mockRpc({
      staff: staffDirectory,
      transfer: { data: null, error: { message: "Only super admins can transfer accounts" } },
    });

    render(
      <TransferAccountDialog
        source={{ profileId: "source-profile", userId: "source-user", name: "Khyati Sagar" }}
        onClose={vi.fn()}
        onDone={vi.fn()}
      />,
    );

    expect(await screen.findByText(/0 leads/i)).toBeInTheDocument();
    fireEvent.click(await screen.findByLabelText(/Arushi Tyagi/i));
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
