// Edge-function invocation hardening.
//
// Root cause this fixes:
// The frontend ships the new Supabase key format (`sb_publishable_…`), which
// is NOT a JWT. supabase-js attaches the user's session access_token to
// `functions.invoke` via its internal auth-state listener — but when that
// listener hasn't synced (fresh tab, session restored from storage, or a
// refresh race across the several app tabs counsellors keep open), invoke
// falls back to sending the *publishable key* as the bearer token. With the
// old legacy JWT anon key that was a silent no-op (getUser → no user → 401).
// With `sb_publishable_…` it's a single-segment string, so GoTrue rejects it
// with `bad_jwt: token contains an invalid number of segments` and every
// authenticated edge function returns 401 — surfacing as
// "Failed to send: Edge Function returned a non-2xx status code".
//
// Importing this module patches the shared client so `functions.invoke`
// always attaches the *current* session's real JWT when a session exists,
// overriding the buggy fallback. Anon/public flows (no session) are untouched
// — they keep sending the publishable key, which is correct for public
// functions.

import { supabase } from "@/integrations/supabase/client";

/**
 * Returns a valid access token for the current session, refreshing
 * proactively if it expires within the next minute. Returns null when there
 * is no session (anonymous caller).
 */
async function freshAccessToken(): Promise<string | null> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return null;

  const expiresInMs = (session.expires_at ?? 0) * 1000 - Date.now();
  if (expiresInMs < 60_000) {
    const { data, error } = await supabase.auth.refreshSession();
    const refreshed = data.session?.access_token ?? null;
    if (refreshed) return refreshed;

    // Refresh failed. Only give up if the token we hold is ACTUALLY expired.
    // Inside the 60s pre-expiry window it is usually still valid, and a
    // transient failure (offline blip, GoTrue 429 across the several tabs
    // counsellors keep open) must not throw away a working token — every
    // direct `supabase.functions.invoke` caller would then fall back to
    // sending the publishable key and hard-401.
    if (expiresInMs > 0) return session.access_token ?? null;

    // Genuinely expired: return null so invokeEdge raises a real
    // "session expired, sign in again" instead of the edge function rejecting
    // a stale token as a confusing 401.
    if (error) console.warn("Session refresh failed and token is expired:", error.message);
    return null;
  }
  return session.access_token ?? null;
}

// Patch the shared singleton once. Any module importing `supabase` gets the
// patched instance because it's the same object.
const originalInvoke = supabase.functions.invoke.bind(supabase.functions);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(supabase.functions as any).invoke = async function patchedInvoke(
  name: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  options: any = {},
) {
  const token = await freshAccessToken();
  if (token) {
    options = {
      ...options,
      // Caller-supplied Authorization wins (e.g. service-role / voice-agent key).
      headers: { Authorization: `Bearer ${token}`, ...(options.headers ?? {}) },
    };
  }
  return originalInvoke(name, options);
};

export type EdgeError = {
  message: string;
  status?: number;
  /** True when the failure is an auth rejection — prompt the user to re-login. */
  sessionExpired?: boolean;
};

export async function edgeErrorFromFunctionError(error: unknown): Promise<EdgeError> {
  const baseMessage = error instanceof Error ? error.message : String(error);
  let message = baseMessage;
  let status: number | undefined;

  // Pull the useful message out of the function's JSON body.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ctx = (error as any)?.context;
  if (ctx && typeof ctx.json === "function") {
    status = typeof ctx.status === "number" ? ctx.status : undefined;
    try {
      const cloned = typeof ctx.clone === "function" ? ctx.clone() : ctx;
      const errBody = await cloned.json();
      if (errBody?.error) message = errBody.error;
    } catch {
      // Body wasn't JSON — keep the original message.
    }
  }

  return { message, status, sessionExpired: status === 401 };
}

/**
 * Drop-in wrapper around `supabase.functions.invoke` for authenticated calls.
 *
 * - Guarantees a real user JWT is sent (never the publishable key). When the
 *   user is genuinely logged out it returns a clear `sessionExpired` error
 *   instead of letting the function reject a malformed token.
 * - Reads the function's JSON `{ error }` body so callers can show the real
 *   reason instead of the opaque "Edge Function returned a non-2xx status code".
 *
 * Pass `requireAuth: false` for public/anon functions (OTP, ingest, payment
 * webhooks) that are meant to run without a session.
 */
export async function invokeEdge<T = unknown>(
  name: string,
  options: { body?: unknown; headers?: Record<string, string>; requireAuth?: boolean } = {},
): Promise<{ data: T | null; error: EdgeError | null }> {
  const { body, headers, requireAuth = true } = options;

  if (requireAuth) {
    const token = await freshAccessToken();
    if (!token) {
      return {
        data: null,
        error: {
          message: "Your session has expired. Please sign in again.",
          status: 401,
          sessionExpired: true,
        },
      };
    }
  }

  const { data, error } = await supabase.functions.invoke(name, { body, headers });
  if (!error) return { data: data as T, error: null };

  return { data: null, error: await edgeErrorFromFunctionError(error) };
}
