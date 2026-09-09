import { invokeEdge } from "@/integrations/supabase/edge";

export type StartCloudCallResult =
  | { ok: true; callId: string; message: string }
  | { ok: false; error: string; sessionExpired?: boolean };

export type StartCloudCallTarget =
  | string
  | { leadId: string; contactId?: never }
  | { contactId: string; leadId?: never };

export function cloudCallTarget(lead: { id: string; kind?: "lead" | "contact" }): StartCloudCallTarget {
  return lead.kind === "contact" ? { contactId: lead.id } : lead.id;
}

function manualCallBody(target: StartCloudCallTarget): { lead_id: string } | { contact_id: string } | null {
  if (typeof target === "string") return { lead_id: target };
  if (target.contactId) return { contact_id: target.contactId };
  if (target.leadId) return { lead_id: target.leadId };
  return null;
}

/**
 * Place a counsellor-initiated Plivo bridge call through `manual-call`.
 *
 * Every CRM surface that can start a cloud call (dialer, lead page, missed
 * calls, follow-ups, CAHET/UPDELED sprints, academic partner portal) must
 * go through this helper so a non-2xx from the edge function always surfaces
 * the real `{ error }` body — never the opaque SDK "non-2xx status code".
 *
 * Call-list members imported as marketing contacts (no lead yet) pass
 * `{ contactId }` so the edge function does not look them up in `leads`.
 */
export async function startCloudCall(target: StartCloudCallTarget): Promise<StartCloudCallResult> {
  const body = manualCallBody(target);
  if (!body) return { ok: false, error: "lead_id or contact_id required" };

  const { data, error } = await invokeEdge<{
    call_id?: string;
    message?: string;
    error?: string;
  }>("manual-call", { body });

  if (error) {
    return { ok: false, error: error.message, sessionExpired: error.sessionExpired };
  }
  if (data?.error) {
    return { ok: false, error: data.error };
  }
  if (!data?.call_id) {
    return { ok: false, error: "Call started but no call id was returned. Try again." };
  }
  return {
    ok: true,
    callId: data.call_id,
    message: data.message || "Pick up your phone to connect.",
  };
}
