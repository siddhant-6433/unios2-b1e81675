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

describe("TransferAccountDialog", () => {
  beforeEach(() => {
    mocks.from.mockReset();
    mocks.rpc.mockReset();
    mocks.toast.mockReset();

    mocks.from.mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          range: vi.fn().mockResolvedValue({
            data: [
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
            ],
            count: 3,
            error: null,
          }),
        }),
      }),
    });
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
});
