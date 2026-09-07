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
// overriding the buggy fallback. It also rewrites the SDK's opaque
// "Edge Function returned a non-2xx status code" with the function's JSON
// `{ error }` body, so Cloud Dialer / WhatsApp / payments toasts show the
// real reason. Anon/public flows (no session) are untouched — they keep
// sending the publishable key, which is correct for public functions.

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
  return rewriteFunctionsError(await originalInvoke(name, options));
};

export type EdgeError = {
  message: string;
  status?: number;
  /** True when the failure is an auth rejection — prompt the user to re-login. */
  sessionExpired?: boolean;
};

function statusFromContext(ctx: unknown): number | undefined {
  if (!ctx || typeof ctx !== "object") return undefined;
  const status = (ctx as { status?: unknown }).status;
  return typeof status === "number" ? status : undefined;
}

function messageFromBody(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const record = body as { error?: unknown; message?: unknown };
  if (typeof record.error === "string" && record.error.trim()) return record.error;
  if (typeof record.message === "string" && record.message.trim()) return record.message;
  return null;
}

export async function edgeErrorFromFunctionError(error: unknown): Promise<EdgeError> {
  const baseMessage = error instanceof Error ? error.message : String(error);
  let message = baseMessage;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ctx = (error as any)?.context;
  let status = statusFromContext(ctx);

  // Pull the useful message out of the function's JSON body. Clone first so
  // later callers can still read error.context.
  if (ctx && typeof ctx.json === "function") {
    try {
      const cloned = typeof ctx.clone === "function" ? ctx.clone() : ctx;
      const fromBody = messageFromBody(await cloned.json());
      if (fromBody) message = fromBody;
    } catch {
      // Body wasn't JSON — keep the original message.
    }
  } else {
    const fromBody = messageFromBody(ctx);
    if (fromBody) message = fromBody;
  }

  const sessionExpired = status === 401;
  if (
    sessionExpired &&
    /non-2xx|unauthorized|bad_jwt|invalid jwt|jwt/i.test(message)
  ) {
    message = "Your session has expired. Please sign in again.";
  }

  return { message, status, sessionExpired };
}

function assignErrorMessage(error: { message: string }, message: string) {
  try {
    error.message = message;
  } catch {
    // Some SDK error classes freeze `message`. Fall through to defineProperty.
  }
  if (error.message === message) return;
  Object.defineProperty(error, "message", { value: message, writable: true, configurable: true });
}

/**
 * Rewrites supabase-js's opaque "non-2xx" FunctionsHttpError.message with the
 * `{ error }` / `{ message }` body the edge function actually returned.
 * Used by the patched `functions.invoke` so every CRM toast that shows
 * `error.message` gets the real reason — not only callers of `invokeEdge`.
 */
export async function rewriteFunctionsError<T>(
  result: { data: T; error: { message: string } | null },
): Promise<{ data: T; error: { message: string } | null }> {
  if (!result.error) return result;
  const parsed = await edgeErrorFromFunctionError(result.error);
  if (parsed.message && parsed.message !== result.error.message) {
    assignErrorMessage(result.error, parsed.message);
  }
  return result;
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
