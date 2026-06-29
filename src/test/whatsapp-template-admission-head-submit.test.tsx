import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { WhatsAppTemplateTab } from "@/components/templates/WhatsAppTemplateTab";

const mocks = vi.hoisted(() => ({
  invokeEdge: vi.fn(),
  from: vi.fn(),
  removeChannel: vi.fn(),
}));

vi.mock("@/integrations/supabase/edge", () => ({
  invokeEdge: mocks.invokeEdge,
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: mocks.from,
    channel: vi.fn(() => ({
      on: vi.fn().mockReturnThis(),
      subscribe: vi.fn().mockReturnThis(),
    })),
    removeChannel: mocks.removeChannel,
  },
}));

describe("WhatsApp template submission as admission head", () => {
  beforeEach(() => {
    mocks.invokeEdge.mockReset();
    mocks.from.mockReset();
    mocks.removeChannel.mockReset();

    mocks.from.mockReturnValue({
      select: vi.fn().mockReturnValue({
        order: vi.fn().mockResolvedValue({ data: [], error: null }),
      }),
    });

    mocks.invokeEdge.mockImplementation(async (_name: string, options?: { body?: { action?: string } }) => {
      if (options?.body?.action === "create") {
        return { data: { success: true, id: "meta-template-1", status: "PENDING" }, error: null };
      }
      return { data: { templates: [] }, error: null };
    });
  });

  it("submits a complete text template through the authenticated template manager flow", async () => {
    render(<WhatsAppTemplateTab />);

    await waitFor(() => {
      expect(mocks.invokeEdge).toHaveBeenCalledWith("whatsapp-templates", {
        body: { action: "list" },
      });
    });

    fireEvent.click(screen.getByRole("button", { name: /submit new template/i }));

    fireEvent.change(screen.getByPlaceholderText("my_template_name"), {
      target: { value: "admission_head_test_template" },
    });
    fireEvent.change(screen.getByPlaceholderText("Hi {{1}}, thank you for your interest in {{2}} at NIMT."), {
      target: { value: "Hi {{1}}, your counselling slot for {{2}} is confirmed." },
    });

    fireEvent.change(await screen.findByPlaceholderText("Sample value for {{1}}"), {
      target: { value: "Riya" },
    });
    fireEvent.change(screen.getByPlaceholderText("Sample value for {{2}}"), {
      target: { value: "B.Sc Nursing" },
    });

    fireEvent.change(screen.getByPlaceholderText("e.g. NIMT Educational Institutions"), {
      target: { value: "NIMT Admissions" },
    });

    fireEvent.click(screen.getByRole("button", { name: /^submit to meta$/i }));

    await waitFor(() => {
      expect(mocks.invokeEdge).toHaveBeenCalledWith("whatsapp-templates", {
        body: {
          action: "create",
          name: "admission_head_test_template",
          category: "UTILITY",
          body_text: "Hi {{1}}, your counselling slot for {{2}} is confirmed.",
          body_examples: ["Riya", "B.Sc Nursing"],
          footer_text: "NIMT Admissions",
        },
      });
    });

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

    const listCalls = mocks.invokeEdge.mock.calls.filter(
      ([name, options]) => name === "whatsapp-templates" && options?.body?.action === "list",
    );
    expect(listCalls.length).toBeGreaterThanOrEqual(2);
  });
});
