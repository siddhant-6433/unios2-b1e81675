import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Last outbound template/campaign contact per lead (for quiet-period filter).
 * Uses whatsapp_messages so 1:1 templates and bulk campaigns both count.
 */
export async function fetchLastWhatsAppMarketingAtByLeadIds(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client: SupabaseClient<any> | { from: (t: string) => any },
  leadIds: string[],
  lookbackDays = 30,
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const unique = Array.from(new Set(leadIds.filter(Boolean)));
  if (unique.length === 0) return map;

  const since = new Date(Date.now() - Math.max(1, lookbackDays) * 24 * 60 * 60 * 1000).toISOString();

  for (let i = 0; i < unique.length; i += 200) {
    const chunk = unique.slice(i, i + 200);
    const { data, error } = await (client as any)
      .from("whatsapp_messages")
      .select("lead_id, created_at")
      .in("lead_id", chunk)
      .eq("direction", "outbound")
      .not("template_key", "is", null)
      .gte("created_at", since)
      .order("created_at", { ascending: false });

    if (error) {
      console.error("fetchLastWhatsAppMarketingAtByLeadIds:", error.message);
      continue;
    }

    for (const row of (data || []) as Array<{ lead_id: string | null; created_at: string | null }>) {
      if (!row.lead_id || !row.created_at) continue;
      // First row per lead is latest because of order + we only set if missing.
      if (!map.has(row.lead_id)) map.set(row.lead_id, row.created_at);
    }
  }

  return map;
}
