// Plivo WhatsApp send adapter — used for the coexistence number (9555192192)
// that runs through Plivo's BSP API instead of Meta's Graph API.
//
// Endpoint: POST https://api.plivo.com/v1/Account/{auth_id}/Message/
// Auth:     HTTP Basic (auth_id:auth_token)
// Body:     { src, dst, type: "whatsapp", text } | { ..., template }
//
// src/dst must be E.164 with leading '+'. Secrets PLIVO_AUTH_ID / PLIVO_AUTH_TOKEN
// already exist in Supabase (shared with the voice integration).

export interface PlivoSendResult {
  ok: boolean;
  messageUuid: string | null;
  raw: unknown;
}

function e164(value: string): string {
  const digits = (value || "").replace(/[^0-9]/g, "");
  return digits.startsWith("+") ? digits : `+${digits}`;
}

async function plivoSend(body: Record<string, unknown>): Promise<PlivoSendResult> {
  const authId = Deno.env.get("PLIVO_AUTH_ID");
  const authToken = Deno.env.get("PLIVO_AUTH_TOKEN");
  if (!authId || !authToken) {
    throw new Error("PLIVO_AUTH_ID / PLIVO_AUTH_TOKEN not configured");
  }

  const res = await fetch(`https://api.plivo.com/v1/Account/${authId}/Message/`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Basic ${btoa(`${authId}:${authToken}`)}`,
    },
    body: JSON.stringify(body),
  });

  const raw = await res.json().catch(() => ({}));
  // Plivo returns message_uuid as an array on the send response.
  const messageUuid = Array.isArray((raw as any)?.message_uuid)
    ? (raw as any).message_uuid[0] ?? null
    : (raw as any)?.message_uuid ?? null;

  return { ok: res.ok, messageUuid, raw };
}

/** Send a free-text WhatsApp message via Plivo. */
export function sendPlivoWhatsAppText(
  src: string,
  dst: string,
  text: string,
): Promise<PlivoSendResult> {
  return plivoSend({ src: e164(src), dst: e164(dst), type: "whatsapp", text });
}

/** Send a WhatsApp template via Plivo. `components` follows Plivo's template schema. */
export function sendPlivoWhatsAppTemplate(
  src: string,
  dst: string,
  name: string,
  language: string,
  components: unknown[],
): Promise<PlivoSendResult> {
  return plivoSend({
    src: e164(src),
    dst: e164(dst),
    type: "whatsapp",
    template: { name, language, components },
  });
}
