// Edge-function invocation hardening — port of src/integrations/supabase/edge.ts.
//
// The publishable key (`sb_publishable_…`) is not a JWT. When supabase-js's
// internal auth listener hasn't synced (fresh launch, session restored from
// SecureStore, refresh race), `functions.invoke` falls back to sending the
// publishable key as the bearer token and GoTrue rejects it with `bad_jwt`,
// so every authenticated edge function 401s. Importing this module patches
// the shared client so invoke always carries the current session's real JWT.

import { supabase } from './supabase';

/**
 * Returns a valid access token for the current session, refreshing
 * proactively if it expires within the next minute. Null when anonymous.
 */
async function freshAccessToken(): Promise<string | null> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return null;

  const expiresInMs = (session.expires_at ?? 0) * 1000 - Date.now();
  if (expiresInMs < 60_000) {
    const { data } = await supabase.auth.refreshSession();
    return data.session?.access_token ?? session.access_token ?? null;
  }
  return session.access_token ?? null;
}

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
      // Caller-supplied Authorization wins.
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

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ctx = (error as any)?.context;
  if (ctx && typeof ctx.json === 'function') {
    status = typeof ctx.status === 'number' ? ctx.status : undefined;
    try {
      const cloned = typeof ctx.clone === 'function' ? ctx.clone() : ctx;
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
 * Guarantees a real user JWT (never the publishable key) and surfaces the
 * function's JSON `{ error }` body instead of the opaque non-2xx message.
 * Pass `requireAuth: false` for public/anon functions (OTP, payments).
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
          message: 'Your session has expired. Please sign in again.',
          status: 401,
          sessionExpired: true,
        },
      };
    }
  }

  const { data, error } = await supabase.functions.invoke(name, {
    body: body as Record<string, unknown> | undefined,
    headers,
  });
  if (!error) return { data: data as T, error: null };

  return { data: null, error: await edgeErrorFromFunctionError(error) };
}
