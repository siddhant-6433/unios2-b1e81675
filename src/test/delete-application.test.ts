import { beforeEach, describe, expect, it, vi } from "vitest";

const invokeEdgeMock = vi.fn();

vi.mock("@/integrations/supabase/edge", () => ({
  invokeEdge: invokeEdgeMock,
}));

const { deleteApplication } = await import("@/lib/deleteApplication");

describe("deleteApplication", () => {
  beforeEach(() => {
    invokeEdgeMock.mockReset();
  });

  it("blocks paid applications before calling the edge function", async () => {
    const result = await deleteApplication({
      id: "app-row-1",
      applicationId: "APP-26-001",
      paymentStatus: "paid",
    });

    expect(invokeEdgeMock).not.toHaveBeenCalled();
    expect(result.error?.message).toBe("Paid applications cannot be deleted.");
    expect(result.error?.status).toBe(403);
  });

  it("invokes the delete-application edge function for unpaid applications", async () => {
    invokeEdgeMock.mockResolvedValue({
      data: {
        success: true,
        application_id: "APP-26-001",
        deleted_storage_files: 4,
      },
      error: null,
    });

    const result = await deleteApplication({
      id: "app-row-1",
      applicationId: "APP-26-001",
      paymentStatus: "pending",
    });

    expect(invokeEdgeMock).toHaveBeenCalledWith("delete-application", {
      body: { application_row_id: "app-row-1" },
    });
    expect(result.data?.success).toBe(true);
    expect(result.data?.application_id).toBe("APP-26-001");
  });
});
