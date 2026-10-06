import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import InviteUserDialog from "@/components/admin/InviteUserDialog";

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({
      select: () => ({
        order: () => Promise.resolve({ data: [] }),
      }),
    }),
  },
}));

describe("InviteUserDialog", () => {
  it("renders a viewport-centered overlay in the document body", async () => {
    const { container } = render(
      <InviteUserDialog open onClose={vi.fn()} onSuccess={vi.fn()} />,
    );
    await act(async () => { await Promise.resolve(); });

    const heading = screen.getByRole("heading", { name: "Invite New User" });
    const overlay = heading.closest(".fixed.inset-0");

    expect(overlay).toBeInTheDocument();
    expect(overlay?.parentElement).toBe(document.body);
    expect(container).not.toContainElement(overlay);
    expect(overlay).toHaveClass("fixed", "inset-0", "flex", "items-center", "justify-center");
    expect(overlay?.querySelector(".max-w-md")).toHaveClass("max-h-[90vh]", "overflow-y-auto");
  });

  it("closes when the backdrop is clicked", async () => {
    const onClose = vi.fn();
    render(<InviteUserDialog open onClose={onClose} onSuccess={vi.fn()} />);
    await act(async () => { await Promise.resolve(); });

    fireEvent.click(screen.getByText("Invite New User").closest(".fixed.inset-0")!.firstElementChild!);

    expect(onClose).toHaveBeenCalledOnce();
  });

  it("closes from the close button", async () => {
    const onClose = vi.fn();
    render(<InviteUserDialog open onClose={onClose} onSuccess={vi.fn()} />);
    await act(async () => { await Promise.resolve(); });

    fireEvent.click(screen.getAllByRole("button")[0]);

    expect(onClose).toHaveBeenCalledOnce();
  });
});
