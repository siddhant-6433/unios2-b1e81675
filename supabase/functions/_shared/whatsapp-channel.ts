import { sendPlivoWhatsAppTemplate, sendPlivoWhatsAppText } from "./plivo.ts";

export type WhatsAppProvider = "meta" | "plivo";
export type WhatsAppChannelRoute =
  | "admissions"
  | "reply"
  | "otp"
  | "call"
  | "visit"
  | "bulk"
  | "hr"
  | "plivo_admissions";

export interface WhatsAppChannel {
  id: string | null;
  label: string;
  provider: WhatsAppProvider;
  route: WhatsAppChannelRoute;
  business_number: string | null;
  meta_phone_number_id: string | null;
  secret_token_name: string | null;
  allow_ai: boolean;
  allow_manual_reply: boolean;
  allow_bulk: boolean;
}

export interface WhatsAppChannelHint {
  provider?: WhatsAppProvider | null;
  route?: WhatsAppChannelRoute | null;
  businessPhoneNumberId?: string | null;
  businessNumber?: string | null;
  requireAi?: boolean;
  requireManualReply?: boolean;
  requireBulk?: boolean;
}

export interface WhatsAppSendResult {
  ok: boolean;
  provider: WhatsAppProvider;
  messageId: string | null;
  businessPhoneNumberId: string | null;
  businessNumber: string | null;
  status: number;
  raw: unknown;
  error: string | null;
}

interface SupabaseLike {
  from: (table: string) => {
    select: (columns: string) => {
      eq: (column: string, value: unknown) => {
        order: (column: string, options?: { ascending?: boolean }) => Promise<{
          data: unknown[] | null;
          error: { message?: string } | null;
        }>;
      };
    };
  };
}

const META_ROUTE_ENV: Record<WhatsAppChannelRoute, { token: string; phoneNumberId: string }> = {
  admissions: { token: "WHATSAPP_API_TOKEN", phoneNumberId: "WHATSAPP_PHONE_NUMBER_ID" },
  reply: { token: "WHATSAPP_REPLY_API_TOKEN", phoneNumberId: "WHATSAPP_REPLY_PHONE_NUMBER_ID" },
  otp: { token: "WHATSAPP_OTP_API_TOKEN", phoneNumberId: "WHATSAPP_OTP_PHONE_NUMBER_ID" },
  call: { token: "WHATSAPP_CALL_API_TOKEN", phoneNumberId: "WHATSAPP_CALL_PHONE_NUMBER_ID" },
  visit: { token: "WHATSAPP_VISIT_API_TOKEN", phoneNumberId: "WHATSAPP_VISIT_PHONE_NUMBER_ID" },
  bulk: { token: "WHATSAPP_BULK_API_TOKEN", phoneNumberId: "WHATSAPP_BULK_PHONE_NUMBER_ID" },
  hr: { token: "WHATSAPP_API_TOKEN", phoneNumberId: "WHATSAPP_PHONE_NUMBER_ID" },
  plivo_admissions: { token: "WHATSAPP_API_TOKEN", phoneNumberId: "WHATSAPP_PHONE_NUMBER_ID" },
};

export function digits(value: string | null | undefined): string {
  return (value || "").replace(/[^0-9]/g, "");
}

export function errorMessage(value: unknown, fallback: string): string {
  if (value instanceof Error) return value.message;
  if (value && typeof value === "object") {
    const record = value as { error?: unknown; message?: unknown };
    if (typeof record.error === "string") return record.error;
    if (typeof record.message === "string") return record.message;
  }
  return fallback;
}

function routeEnv(route: WhatsAppChannelRoute) {
  return META_ROUTE_ENV[route] || META_ROUTE_ENV.admissions;
}

function envMetaChannel(route: WhatsAppChannelRoute): WhatsAppChannel {
  const env = routeEnv(route);
  return {
    id: null,
    label: `${route} env fallback`,
    provider: "meta",
    route,
    business_number: null,
    meta_phone_number_id: Deno.env.get(env.phoneNumberId) || Deno.env.get("WHATSAPP_PHONE_NUMBER_ID") || null,
    secret_token_name: Deno.env.get(env.token) ? env.token : "WHATSAPP_API_TOKEN",
    allow_ai: true,
    allow_manual_reply: true,
    allow_bulk: route === "bulk",
  };
}

function envPlivoChannel(businessNumber: string | null): WhatsAppChannel {
  return {
    id: null,
    label: "plivo env fallback",
    provider: "plivo",
    route: "plivo_admissions",
    business_number: businessNumber || digits(Deno.env.get("PLIVO_WHATSAPP_NUMBER")) || null,
    meta_phone_number_id: null,
    secret_token_name: null,
    allow_ai: true,
    allow_manual_reply: true,
    allow_bulk: false,
  };
}

function channelAllowed(channel: WhatsAppChannel, hint: WhatsAppChannelHint): boolean {
  if (hint.requireAi && !channel.allow_ai) return false;
  if (hint.requireManualReply && !channel.allow_manual_reply) return false;
  if (hint.requireBulk && !channel.allow_bulk) return false;
  return true;
}

function scoreChannel(channel: WhatsAppChannel, hint: WhatsAppChannelHint): number {
  let score = 0;
  const hintedBusinessNumber = digits(hint.businessNumber);
  const channelBusinessNumber = digits(channel.business_number);

  if (hint.provider && channel.provider !== hint.provider) return -1;
  if (hint.route && channel.route === hint.route) score += 2;
  if (hint.businessPhoneNumberId && channel.meta_phone_number_id === hint.businessPhoneNumberId) score += 5;
  if (hintedBusinessNumber && channelBusinessNumber && hintedBusinessNumber === channelBusinessNumber) score += 5;
  if (!channelAllowed(channel, hint)) return -1;
  return score;
}

function parseChannel(row: unknown): WhatsAppChannel {
  const data = row as Record<string, unknown>;
  return {
    id: typeof data.id === "string" ? data.id : null,
    label: typeof data.label === "string" ? data.label : "WhatsApp channel",
    provider: data.provider === "plivo" ? "plivo" : "meta",
    route: typeof data.route === "string" ? data.route as WhatsAppChannelRoute : "admissions",
    business_number: typeof data.business_number === "string" ? data.business_number : null,
    meta_phone_number_id: typeof data.meta_phone_number_id === "string" ? data.meta_phone_number_id : null,
    secret_token_name: typeof data.secret_token_name === "string" ? data.secret_token_name : null,
    allow_ai: data.allow_ai !== false,
    allow_manual_reply: data.allow_manual_reply !== false,
    allow_bulk: data.allow_bulk === true,
  };
}

export async function resolveWhatsAppChannel(
  admin: SupabaseLike,
  hint: WhatsAppChannelHint,
): Promise<WhatsAppChannel> {
  const { data, error } = await admin
    .from("whatsapp_channels")
    .select("id,label,provider,route,business_number,meta_phone_number_id,secret_token_name,allow_ai,allow_manual_reply,allow_bulk")
    .eq("is_active", true)
    .order("route", { ascending: true });

  if (!error && data) {
    const candidates = data
      .map(parseChannel)
      .map((channel) => ({ channel, score: scoreChannel(channel, hint) }))
      .filter((item) => item.score >= 0)
      .sort((a, b) => b.score - a.score);

    if (candidates[0]) return candidates[0].channel;
  }

  if (hint.provider === "plivo" || hint.route === "plivo_admissions") {
    return envPlivoChannel(digits(hint.businessNumber));
  }

  return envMetaChannel(hint.route || "reply");
}

function metaConfig(channel: WhatsAppChannel, fallbackRoute: WhatsAppChannelRoute) {
  const env = routeEnv(channel.route || fallbackRoute);
  const token =
    (channel.secret_token_name ? Deno.env.get(channel.secret_token_name) : null) ||
    Deno.env.get(env.token) ||
    Deno.env.get("WHATSAPP_API_TOKEN");
  const phoneNumberId =
    channel.meta_phone_number_id ||
    Deno.env.get(env.phoneNumberId) ||
    Deno.env.get("WHATSAPP_PHONE_NUMBER_ID");

  return { token, phoneNumberId };
}

export async function sendWhatsAppText(
  admin: SupabaseLike,
  hint: WhatsAppChannelHint,
  to: string,
  text: string,
): Promise<WhatsAppSendResult> {
  const channel = await resolveWhatsAppChannel(admin, hint);

  if (channel.provider === "plivo") {
    const src = digits(channel.business_number || hint.businessNumber);
    if (!src) {
      return {
        ok: false,
        provider: "plivo",
        messageId: null,
        businessPhoneNumberId: null,
        businessNumber: null,
        status: 503,
        raw: null,
        error: "Plivo business number is required",
      };
    }

    const result = await sendPlivoWhatsAppText(src, digits(to), text);
    return {
      ok: result.ok,
      provider: "plivo",
      messageId: result.messageUuid,
      businessPhoneNumberId: src,
      businessNumber: src,
      status: result.ok ? 200 : 502,
      raw: result.raw,
      error: result.ok ? null : errorMessage(result.raw, "Failed to send via Plivo"),
    };
  }

  const { token, phoneNumberId } = metaConfig(channel, hint.route || "reply");
  if (!token || !phoneNumberId) {
    return {
      ok: false,
      provider: "meta",
      messageId: null,
      businessPhoneNumberId: phoneNumberId || null,
      businessNumber: channel.business_number,
      status: 503,
      raw: null,
      error: "WhatsApp channel is not configured",
    };
  }

  const response = await fetch(`https://graph.facebook.com/v21.0/${phoneNumberId}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: digits(to),
      type: "text",
      text: { body: text },
    }),
  });
  const raw = await response.json().catch(() => ({}));

  return {
    ok: response.ok,
    provider: "meta",
    messageId: (raw as { messages?: { id?: string }[] })?.messages?.[0]?.id || null,
    businessPhoneNumberId: phoneNumberId,
    businessNumber: channel.business_number,
    status: response.status,
    raw,
    error: response.ok ? null : errorMessage((raw as { error?: unknown })?.error || raw, "Failed to send via Meta"),
  };
}

export async function sendWhatsAppTemplate(
  admin: SupabaseLike,
  hint: WhatsAppChannelHint,
  to: string,
  template: { name: string; language: string; components: unknown[] },
): Promise<WhatsAppSendResult> {
  const channel = await resolveWhatsAppChannel(admin, hint);

  if (channel.provider === "plivo") {
    const src = digits(channel.business_number || hint.businessNumber);
    if (!src) {
      return {
        ok: false,
        provider: "plivo",
        messageId: null,
        businessPhoneNumberId: null,
        businessNumber: null,
        status: 503,
        raw: null,
        error: "Plivo business number is required",
      };
    }

    const result = await sendPlivoWhatsAppTemplate(src, digits(to), template.name, template.language, template.components);
    return {
      ok: result.ok,
      provider: "plivo",
      messageId: result.messageUuid,
      businessPhoneNumberId: src,
      businessNumber: src,
      status: result.ok ? 200 : 502,
      raw: result.raw,
      error: result.ok ? null : errorMessage(result.raw, "Failed to send template via Plivo"),
    };
  }

  const { token, phoneNumberId } = metaConfig(channel, hint.route || "admissions");
  if (!token || !phoneNumberId) {
    return {
      ok: false,
      provider: "meta",
      messageId: null,
      businessPhoneNumberId: phoneNumberId || null,
      businessNumber: channel.business_number,
      status: 503,
      raw: null,
      error: "WhatsApp channel is not configured",
    };
  }

  const response = await fetch(`https://graph.facebook.com/v21.0/${phoneNumberId}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: digits(to),
      type: "template",
      template: {
        name: template.name,
        language: { code: template.language },
        components: template.components,
      },
    }),
  });
  const raw = await response.json().catch(() => ({}));

  return {
    ok: response.ok,
    provider: "meta",
    messageId: (raw as { messages?: { id?: string }[] })?.messages?.[0]?.id || null,
    businessPhoneNumberId: phoneNumberId,
    businessNumber: channel.business_number,
    status: response.status,
    raw,
    error: response.ok ? null : errorMessage((raw as { error?: unknown })?.error || raw, "Failed to send template via Meta"),
  };
}
