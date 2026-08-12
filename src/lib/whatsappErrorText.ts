/**
 * Plain-English text for WhatsApp send failures.
 *
 * Two problems this solves:
 *
 * 1. `whatsapp_messages.status_error` is written in four different shapes.
 *    `whatsapp-send` writes `{ error: {...} }`, the webhook writes Meta's raw
 *    **array** (`whatsapp-webhook/index.ts`), and older rows carry
 *    `{ meta_error }` or a bare `{ message }`. The inbox only ever read the
 *    object shapes, so async delivery failures — the common case — rendered
 *    "Message failed" with no reason at all.
 *
 * 2. Even when a reason surfaced, it was Meta's wording. "This message was not
 *    delivered to maintain healthy ecosystem engagement" tells a counsellor
 *    nothing. Most failures are not our bug and should not read like one.
 */

export interface WhatsAppErrorDetail {
  /** Meta error code, when we could find one. */
  code: string | null;
  /** Short human-readable line shown in the failure bubble. */
  text: string;
  /** Raw provider message, for the Copy button and debugging. */
  raw: string | null;
  /** True when the cause is ours (bad params/config) rather than Meta or the recipient. */
  ourFault: boolean;
}

/**
 * Meta error codes seen in production. Counts are from a 10-day window on
 * 2026-08-04, which is why the ordering here is worth keeping.
 */
const META_ERROR_TEXT: Record<string, { text: string; ourFault?: boolean }> = {
  // 2 240 hits — Meta's per-user marketing frequency cap. Not a bug.
  "131049": { text: "Meta capped marketing messages to this number today. Try again later or call instead." },
  // 600+ hits — the number cannot receive WhatsApp.
  "131026": { text: "This number can't receive WhatsApp messages." },
  // 155 hits — the free-form window closed.
  "131047": { text: "The 24-hour reply window has closed. Send a template instead." },
  "131048": { text: "Meta blocked this send (spam rate limit on our number)." },
  "130472": { text: "This number is in a Meta experiment group and was excluded." },
  "131053": { text: "Meta couldn't fetch the template's media. The image URL must be publicly reachable." },
  // Ours: the parameters we sent don't match the approved template.
  "132000": { text: "Template parameters don't match the approved template — report this.", ourFault: true },
  "132001": { text: "This template doesn't exist or isn't approved for our number.", ourFault: true },
  "132005": { text: "Template text is too long for one of the parameters.", ourFault: true },
  "132012": { text: "A template parameter is in the wrong format — report this.", ourFault: true },
  "132015": { text: "This template is paused by Meta for poor quality." },
  "132016": { text: "This template was disabled by Meta." },
  "131008": { text: "A required template parameter was missing — report this.", ourFault: true },
  "131009": { text: "A template parameter had an invalid value — report this.", ourFault: true },
  "133010": { text: "Our WhatsApp number isn't registered. Contact the admin." },
  "190": { text: "Our WhatsApp access token has expired. Contact the admin.", ourFault: true },
  // Written by whatsapp-ai-reply when generation or dispatch fails.
  ai_reply_failed: { text: "The auto-reply could not be sent.", ourFault: true },
};

function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function toCode(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number") return String(value);
  return null;
}

/**
 * Normalise any of the four `status_error` shapes into one detail object.
 * Returns null when there is genuinely nothing to show.
 */
export function describeWhatsAppError(statusError: unknown): WhatsAppErrorDetail | null {
  if (!statusError) return null;

  // Meta's webhook shape: an array of error objects.
  const source: any = Array.isArray(statusError) ? statusError[0] : statusError;
  if (!source || typeof source !== "object") {
    const raw = typeof statusError === "string" ? statusError : null;
    return raw ? { code: null, text: raw, raw, ourFault: false } : null;
  }

  // `{ error: {...} }` (whatsapp-send) unwraps one level; everything else is flat.
  const inner = source.error && typeof source.error === "object" ? source.error : source;

  const code = toCode(inner.code ?? source.code);
  const raw = firstString(
    inner.message,
    inner.title,
    inner.error_data?.details,
    source.meta_error,
    source.message,
    source.detail,
  );

  const known = code ? META_ERROR_TEXT[code] : undefined;
  if (known) {
    return { code, text: known.text, raw, ourFault: known.ourFault ?? false };
  }

  if (!raw && !code) return null;
  return { code, text: raw || `WhatsApp error ${code}`, raw, ourFault: false };
}

/** Convenience for surfaces that only want the one-line string. */
export function whatsAppErrorText(statusError: unknown): string | null {
  return describeWhatsAppError(statusError)?.text ?? null;
}
