import { describe, expect, it, vi } from "vitest";

const { rpcMock, state } = vi.hoisted(() => ({
  rpcMock: vi.fn(),
  state: { error: null as { message: string } | null },
}));

// Mirrors @supabase/supabase-js: `rpc` is a method that reads `this.rest`, so
// extracting it and calling it unbound throws "…reading 'rest' of undefined".
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc(this: unknown, name: string, args: unknown) {
      if (!this) throw new TypeError("Cannot read properties of undefined (reading 'rest')");
      rpcMock(name, args);
      return Promise.resolve({ data: state.error ? null : { ok: true, name }, error: state.error });
    },
  },
}));

import { fetchCbseConfiguration, fetchCbseWorkspace, performCbseAction } from "@/lib/cbseExamsClient";

describe("cbseExamsClient RPC wrapper", () => {
  it("keeps the supabase client bound when calling rpc", async () => {
    const result = await fetchCbseConfiguration();
    expect(result.error).toBeNull();
    expect(result.data).toEqual({ ok: true, name: "cbse_configuration" });
  });

  it("forwards workspace and action arguments verbatim", async () => {
    await fetchCbseWorkspace("exam-1");
    expect(rpcMock).toHaveBeenCalledWith("cbse_exam_workspace", { _exam_id: "exam-1" });
    await performCbseAction("exam-1", "open", 3, {});
    expect(rpcMock).toHaveBeenCalledWith("cbse_action", { _exam_id: "exam-1", _action: "open", _expected_version: 3, _payload: {} });
  });

  it("returns the RPC error message as a string without throwing", async () => {
    state.error = { message: "Fee clearance is required" };
    const result = await fetchCbseConfiguration();
    expect(result).toEqual({ data: null, error: "Fee clearance is required" });
    state.error = null;
  });
});
