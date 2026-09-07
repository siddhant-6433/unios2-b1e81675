import { describe, expect, it, vi } from "vitest";

const invokeEdge = vi.fn();

vi.mock("@/integrations/supabase/edge", () => ({
  invokeEdge,
}));

const { startCloudCall } = await import("@/lib/startCloudCall");

describe("startCloudCall", () => {
  it("returns the unwrapped edge error instead of a generic non-2xx", async () => {
    invokeEdge.mockResolvedValue({
      data: null,
      error: { message: "Lead is DNC — call blocked", status: 403 },
    });

    await expect(startCloudCall("lead-1")).resolves.toEqual({
      ok: false,
      error: "Lead is DNC — call blocked",
      sessionExpired: undefined,
    });
    expect(invokeEdge).toHaveBeenCalledWith("manual-call", { body: { lead_id: "lead-1" } });
  });

  it("returns the call id on success", async () => {
    invokeEdge.mockResolvedValue({
      data: { call_id: "call-1", message: "Calling your phone..." },
      error: null,
    });

    await expect(startCloudCall("lead-1")).resolves.toEqual({
      ok: true,
      callId: "call-1",
      message: "Calling your phone...",
    });
  });
});
