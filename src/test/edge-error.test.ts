import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      getSession: vi.fn(),
      refreshSession: vi.fn(),
    },
    functions: {
      invoke: vi.fn(),
    },
  },
}));

const { edgeErrorFromFunctionError } = await import("@/integrations/supabase/edge");

describe("edgeErrorFromFunctionError", () => {
  it("uses the edge function response body instead of the generic SDK message", async () => {
    const error = new Error("Edge Function returned a non-2xx status code");
    Object.assign(error, {
      context: new Response(JSON.stringify({ error: "extraction failed" }), {
        status: 502,
        headers: { "Content-Type": "application/json" },
      }),
    });

    await expect(edgeErrorFromFunctionError(error)).resolves.toEqual({
      message: "extraction failed",
      status: 502,
      sessionExpired: false,
    });
  });

  it("keeps the SDK message when the response body is not JSON", async () => {
    const error = new Error("Edge Function returned a non-2xx status code");
    Object.assign(error, {
      context: new Response("gateway timeout", { status: 504 }),
    });

    await expect(edgeErrorFromFunctionError(error)).resolves.toEqual({
      message: "Edge Function returned a non-2xx status code",
      status: 504,
      sessionExpired: false,
    });
  });
});
