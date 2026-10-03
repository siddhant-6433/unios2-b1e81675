import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CreateCommunicationListButton } from "./CreateCommunicationListButton";

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  rpc: vi.fn(),
  toast: vi.fn(),
  auth: { role: "super_admin", permissions: [] as string[] },
}));
vi.mock("react-router-dom", () => ({ useNavigate: () => mocks.navigate }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => mocks.auth }));
vi.mock(
  "@/integrations/supabase/client",
  () => ({ supabase: { rpc: mocks.rpc } }),
);
vi.mock(
  "@/hooks/use-toast",
  () => ({ useToast: () => ({ toast: mocks.toast }) }),
);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.role = "super_admin";
  mocks.auth.permissions = [];
});
afterEach(cleanup);
describe("directory list creation button", () => {
  it.each(["consultants", "academic_partners"] as const)(
    "creates/opens the %s list and navigates to its preview",
    async (audience) => {
      mocks.rpc.mockResolvedValue({ data: "list-id", error: null });
      render(<CreateCommunicationListButton audience={audience} />);
      fireEvent.click(
        screen.getByRole("button", { name: "Create Communication List" }),
      );
      await waitFor(() =>
        expect(mocks.navigate).toHaveBeenCalledWith("/lists?listId=list-id")
      );
      expect(mocks.toast).not.toHaveBeenCalled();
      expect(mocks.rpc).toHaveBeenCalledWith(
        "ensure_directory_communication_list",
        { _audience: audience },
      );
    },
  );
  it("hides creation for directory users", () => {
    mocks.auth.role = "academic_partner";
    render(<CreateCommunicationListButton audience="academic_partners" />);
    expect(screen.queryByRole("button")).toBeNull();
  });
  it("prevents duplicate clicks while creation is pending and surfaces errors", async () => {
    let resolve!: (value: unknown) => void;
    mocks.rpc.mockReturnValue(
      new Promise((r) => {
        resolve = r;
      }),
    );
    render(<CreateCommunicationListButton audience="consultants" />);
    fireEvent.click(screen.getByRole("button"));
    expect(screen.getByRole("button")).toBeDisabled();
    fireEvent.click(screen.getByRole("button"));
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    resolve({ data: null, error: new Error("Access denied") });
    await waitFor(() =>
      expect(mocks.toast).toHaveBeenCalledWith(
        expect.objectContaining({
          description: "Access denied",
          variant: "destructive",
        }),
      )
    );
    expect(mocks.navigate).not.toHaveBeenCalled();
    expect(screen.getByRole("button")).not.toBeDisabled();
  });
});
