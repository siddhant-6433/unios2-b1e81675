import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  getSession: vi.fn(),
  refreshSession: vi.fn(),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      getSession: mocks.getSession,
      refreshSession: mocks.refreshSession,
    },
    functions: {
      invoke: mocks.invoke,
    },
  },
}));

const { edgeErrorFromFunctionError, rewriteFunctionsError } = await import("@/integrations/supabase/edge");
const { supabase } = await import("@/integrations/supabase/client");

function genericNon2xx(body: unknown, status = 502) {
  const error = new Error("Edge Function returned a non-2xx status code");
  Object.assign(error, {
    context: new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    }),
  });
  return error;
}

describe("edgeErrorFromFunctionError", () => {
  it("uses the edge function response body instead of the generic SDK message", async () => {
    await expect(edgeErrorFromFunctionError(genericNon2xx({ error: "extraction failed" }))).resolves.toEqual({
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

  it("maps a 401 unauthorized body to a session-expired prompt", async () => {
    await expect(edgeErrorFromFunctionError(genericNon2xx({ error: "Unauthorized" }, 401))).resolves.toEqual({
      message: "Your session has expired. Please sign in again.",
      status: 401,
      sessionExpired: true,
    });
  });
});

describe("rewriteFunctionsError", () => {
  it("rewrites error.message so raw invoke callers show the real reason", async () => {
    const result = await rewriteFunctionsError({
      data: null,
      error: genericNon2xx({ error: "Lead is DNC — call blocked" }, 403),
    });
    expect(result.error?.message).toBe("Lead is DNC — call blocked");
  });
});

describe("patched functions.invoke", () => {
  it("attaches the rewritten body message on the shared supabase client", async () => {
    mocks.getSession.mockResolvedValue({
      data: { session: { access_token: "user-jwt", expires_at: Math.floor(Date.now() / 1000) + 3600 } },
    });
    mocks.invoke.mockResolvedValue({
      data: null,
      error: genericNon2xx({ error: "Your phone number is not set in your profile. Go to Settings → Profile to add it." }, 400),
    });

    const { error } = await supabase.functions.invoke("manual-call", { body: { lead_id: "lead-1" } });
    expect(error?.message).toBe("Your phone number is not set in your profile. Go to Settings → Profile to add it.");
  });
});
