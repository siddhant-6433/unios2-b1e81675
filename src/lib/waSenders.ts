import type { SupabaseClient } from "@supabase/supabase-js";

export type WaPhoneHealth = {
  phone_number_id: string;
  business_phone_number?: string | null;
  total: number;
  failed: number;
  read: number;
  failed_pct: number | null;
  read_pct: number | null;
};

export type WaSenderOption = {
  value: string;
  label: string;
  provider: "meta" | "plivo";
  phoneNumberId: string | null;
  wabaId: string | null;
  businessNumber: string | null;
  total: number | null;
  failed: number | null;
  failedPct: number | null;
  readPct: number | null;
  qualityRiskLevel: string | null;
  verifiedName: string | null;
  profilePictureUrl: string | null;
  availableTemplates: string[] | null;
};

export const DEFAULT_WA_SENDER = "__default_bulk_sender__";
export const WHATSAPP_BUSINESS_NAME = "NIMT Educational Institutions";
export const KNOWN_META_PHONE_NUMBER_ID_TO_NUMBER: Record<string, string> = {
  "1075269918995469": "917428499849",
  "970526789470416": "919599675267",
};

export const defaultWaSenderOption = (): WaSenderOption => ({
  value: DEFAULT_WA_SENDER,
  label: "Bulk default sender",
  provider: "meta",
  phoneNumberId: null,
  wabaId: null,
  businessNumber: null,
  total: null,
  failed: null,
  failedPct: null,
  readPct: null,
  qualityRiskLevel: null,
  verifiedName: null,
  profilePictureUrl: null,
  availableTemplates: null,
});

export const knownBulkSenderOptions = (): WaSenderOption[] => [
  {
    value: "meta:919667641872",
    label: "Admissions Meta sender 9667641872",
    provider: "meta",
    phoneNumberId: null,
    wabaId: null,
    businessNumber: "919667641872",
    total: null,
    failed: null,
    failedPct: null,
    readPct: null,
    qualityRiskLevel: "normal",
    verifiedName: null,
    profilePictureUrl: null,
    availableTemplates: null,
  },
  {
    value: "meta:1075269918995469",
    label: "Bulk campaign Meta sender 7428499849",
    provider: "meta",
    phoneNumberId: "1075269918995469",
    wabaId: null,
    businessNumber: "917428499849",
    total: null,
    failed: null,
    failedPct: null,
    readPct: null,
    qualityRiskLevel: "watch",
    verifiedName: null,
    profilePictureUrl: null,
    availableTemplates: null,
  },
  {
    value: "plivo:919555192192",
    label: "Admissions Plivo sender 9555192192",
    provider: "plivo",
    phoneNumberId: null,
    wabaId: null,
    businessNumber: "919555192192",
    total: null,
    failed: null,
    failedPct: null,
    readPct: null,
    qualityRiskLevel: "normal",
    verifiedName: null,
    profilePictureUrl: null,
    availableTemplates: null,
  },
];

export const digitsOnly = (value: string | null | undefined) => (value || "").replace(/[^0-9]/g, "");

export const mergeKnownBulkSenders = (options: Map<string, WaSenderOption>) => {
  for (const sender of knownBulkSenderOptions()) {
    const byValue = options.get(sender.value);
    // Dedup by phone digits regardless of provider: a synced Meta channel for a
    // number (with real identity + availableTemplates) must win over a stale
    // hardcoded entry (e.g. the dead plivo:9555192192), otherwise the picker
    // shows the number twice and the null-availableTemplates duplicate bypasses
    // the per-template guard.
    const byNumber = digitsOnly(sender.businessNumber)
      ? [...options.values()].find((option) =>
          digitsOnly(option.businessNumber) === digitsOnly(sender.businessNumber))
      : null;
    if (byValue || byNumber) continue;
    options.set(sender.value, sender);
  }
};

export const formatSenderNumber = (value: string | null | undefined) => {
  const digits = digitsOnly(value);
  if (digits.length === 12 && digits.startsWith("91")) {
    return `+91 ${digits.slice(2, 7)} ${digits.slice(7)}`;
  }
  if (digits.length === 10) return `${digits.slice(0, 5)} ${digits.slice(5)}`;
  return value || "";
};

export const formatPct = (value: number | null | undefined) =>
  typeof value === "number" ? `${value.toFixed(1)}%` : "n/a";

export const senderHealthClass = (failedPct: number | null | undefined) => {
  if (typeof failedPct !== "number") return "bg-muted text-muted-foreground";
  if (failedPct >= 10) return "bg-destructive/10 text-destructive";
  if (failedPct >= 5) return "bg-warning/10 text-warning-foreground";
  return "bg-success/10 text-success";
};

/**
 * Whether a template is known to live only on specific WABAs — true when at
 * least one loaded sender explicitly lists it in available_templates. For such
 * a template, a sender that doesn't list it (including unsynced null senders)
 * genuinely cannot send it, so the permissive null fallback must not apply.
 */
export const normWaba = (w: string | null | undefined) => w || "MAIN";

/**
 * Whether a sender can send a given template. Preferred path: compare WABA
 * ids (NULL normalised to "MAIN") — a sender can only send templates that
 * live in its own WABA. Falls back to the legacy availableTemplates-list
 * check when the template's waba_id isn't known yet.
 */
export const senderCanSendTemplate = (
  sender: Pick<WaSenderOption, "wabaId" | "availableTemplates"> | null,
  templateKey: string,
  templateWabaId?: string | null,
): boolean => {
  if (!sender) return true;
  if (templateWabaId !== undefined) return normWaba(sender.wabaId) === normWaba(templateWabaId);
  // legacy fallback (no template waba known): allow if unverified or the name is in the list
  return sender.availableTemplates == null || sender.availableTemplates.includes(templateKey);
};

export const resolveBusinessNumber = (
  phoneNumberId: string | null | undefined,
  businessNumber: string | null | undefined,
) => {
  const numberDigits = digitsOnly(businessNumber);
  if (numberDigits) return numberDigits;
  return phoneNumberId ? KNOWN_META_PHONE_NUMBER_ID_TO_NUMBER[phoneNumberId] || null : null;
};

/**
 * Loads WhatsApp bulk sender options (active channels + 7d health + known
 * fallback senders), merged and deduped by business number. Pure — does not
 * touch React state; callers apply the result.
 */
export async function loadWaSenders(
  supabase: SupabaseClient
): Promise<{ options: WaSenderOption[]; error: string | null }> {
  const [channelsRes, healthRes] = await Promise.all([
    supabase
      .from("whatsapp_channels" as any)
      .select("id,label,provider,route,business_number,meta_phone_number_id,waba_id,allow_bulk,quality_risk_level,verified_name,profile_picture_url,available_templates")
      .eq("is_active", true)
      .eq("allow_bulk", true)
      .order("label", { ascending: true }),
    supabase.rpc("fn_whatsapp_health_dashboard" as any, { p_days: 7 }),
  ]);

  const healthRows = ((healthRes.data as any)?.phones || []) as WaPhoneHealth[];
  const healthByPhone = new Map(
    healthRows
      .filter((p) => p.phone_number_id && p.phone_number_id !== "(unset)")
      .map((p) => [p.phone_number_id, p])
  );

  const options = new Map<string, WaSenderOption>();
  options.set(DEFAULT_WA_SENDER, defaultWaSenderOption());
  mergeKnownBulkSenders(options);

  if (!channelsRes.error) {
    for (const channel of ((channelsRes.data || []) as any[])) {
      const phoneNumberId = channel.meta_phone_number_id || null;
      const businessNumber = channel.business_number || null;
      if (!phoneNumberId && !businessNumber) continue;
      const value = `${channel.provider}:${phoneNumberId || businessNumber}`;
      const health = phoneNumberId ? healthByPhone.get(phoneNumberId) : undefined;
      const resolvedBusinessNumber = resolveBusinessNumber(phoneNumberId, businessNumber || health?.business_phone_number);
      options.set(value, {
        value,
        label: formatSenderNumber(resolvedBusinessNumber) || channel.label || phoneNumberId || "WhatsApp sender",
        provider: channel.provider === "plivo" ? "plivo" : "meta",
        phoneNumberId,
        wabaId: channel.waba_id ?? null,
        businessNumber: resolvedBusinessNumber,
        total: health?.total ?? null,
        failed: health?.failed ?? null,
        failedPct: health?.failed_pct ?? null,
        readPct: health?.read_pct ?? null,
        qualityRiskLevel: channel.quality_risk_level || null,
        verifiedName: channel.verified_name || null,
        profilePictureUrl: channel.profile_picture_url || null,
        availableTemplates: channel.available_templates ?? null,
      });
    }
  }

  for (const health of healthRows) {
    if (!health.phone_number_id || health.phone_number_id === "(unset)") continue;
    const value = `meta:${health.phone_number_id}`;
    const existing = options.get(value);
    const businessNumber = resolveBusinessNumber(health.phone_number_id, existing?.businessNumber || health.business_phone_number);
    const existingByNumber = businessNumber
      ? [...options.values()].find((option) =>
          option.provider === "meta" && digitsOnly(option.businessNumber) === digitsOnly(businessNumber))
      : null;
    const targetValue = existingByNumber?.value || value;
    options.set(targetValue, {
      value: targetValue,
      label: formatSenderNumber(businessNumber) || existingByNumber?.label || existing?.label || `Meta sender ${health.phone_number_id}`,
      provider: "meta",
      phoneNumberId: existingByNumber?.phoneNumberId || health.phone_number_id,
      // Preserve the channel's real WABA — nulling it here (health rows carry no
      // waba) breaks the per-template sender guard: a synced Seralis number with
      // sends would look like the MAIN WABA and be blocked from its own template.
      wabaId: existingByNumber?.wabaId ?? existing?.wabaId ?? null,
      businessNumber,
      total: health.total,
      failed: health.failed,
      failedPct: health.failed_pct,
      readPct: health.read_pct,
      qualityRiskLevel: existingByNumber?.qualityRiskLevel || existing?.qualityRiskLevel || null,
      verifiedName: existingByNumber?.verifiedName || existing?.verifiedName || null,
      profilePictureUrl: existingByNumber?.profilePictureUrl || existing?.profilePictureUrl || null,
      availableTemplates: existingByNumber?.availableTemplates ?? existing?.availableTemplates ?? null,
    });
    if (targetValue !== value) options.delete(value);
  }

  let error: string | null = null;
  if (channelsRes.error || healthRes.error) {
    error = channelsRes.error?.message || healthRes.error?.message || "Could not load WhatsApp sender health.";
  }

  mergeKnownBulkSenders(options);
  const concreteOptions = [...options.values()].filter((option) => option.value !== DEFAULT_WA_SENDER);
  const nextOptions = concreteOptions.length > 0 ? concreteOptions : [defaultWaSenderOption()];

  return { options: nextOptions, error };
}
