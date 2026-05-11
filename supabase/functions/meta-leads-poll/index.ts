// Meta Lead Ads Poller
//
// Runs every 5 minutes via pg_cron. For each page in META_PAGE_IDS, discovers
// all lead forms and fetches any leads created in the last 15 minutes. The
// 15-minute window with a 5-minute cadence gives 10 minutes of overlap —
// duplicates are silently dropped by the unique index on meta_leadgen_id.
//
// This approach requires no webhook subscription, no Lead Access Manager
// config, and automatically picks up forms from future campaigns.
//
// Required env:
//   META_PAGE_ACCESS_TOKEN  — Page/System-User token with leads_retrieval
//   META_PAGE_IDS           — Comma-separated page IDs (defaults to both NIMT pages)
//   CRON_SECRET             — Shared secret for cron auth
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const GRAPH_VERSION = "v21.0";
// NIMT School + NIMT Educational Institutions — extend via META_PAGE_IDS secret
const DEFAULT_PAGE_IDS = "111711207848445,443493925579";
const LOOKBACK_SECONDS = 900; // 15 min window; 10 min overlap at 5-min cadence

async function getLeadForms(pageId: string, token: string) {
  let url: string | null =
    `https://graph.facebook.com/${GRAPH_VERSION}/${pageId}/leadgen_forms` +
    `?fields=id,name,status&limit=100&access_token=${encodeURIComponent(token)}`;
  const forms: Array<{ id: string; name: string; status: string }> = [];
  let pages = 0;
  while (url && pages < 5) {
    const res = await fetch(url);
    const json: any = await res.json().catch(() => ({}));
    if (!res.ok) {
      console.error(`[meta-leads-poll] leadgen_forms error page ${pageId}:`, json?.error?.message);
      break;
    }
    forms.push(...(json.data || []));
    url = json.paging?.next ?? null;
    pages++;
  }
  return forms;
}

async function fetchLeadsSince(formId: string, sinceUnix: number, token: string) {
  const fields = [
    "id", "created_time", "field_data",
    "form_id", "form_name",
    "ad_id", "ad_name",
    "adset_id", "adset_name",
    "campaign_id", "campaign_name",
    "platform",
  ].join(",");
  const filtering = encodeURIComponent(
    JSON.stringify([{ field: "time_created", operator: "GREATER_THAN", value: sinceUnix }]),
  );
  let url: string | null =
    `https://graph.facebook.com/${GRAPH_VERSION}/${formId}/leads` +
    `?fields=${fields}&filtering=${filtering}&limit=100&access_token=${encodeURIComponent(token)}`;

  const leads: any[] = [];
  let pages = 0;
  while (url && pages < 20) {
    const res = await fetch(url);
    const json: any = await res.json().catch(() => ({}));
    if (!res.ok) {
      console.error(`[meta-leads-poll] leads error form ${formId}:`, json?.error?.message);
      break;
    }
    leads.push(...(json.data || []));
    url = json.paging?.next ?? null;
    pages++;
  }
  return leads;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204 });

  const cronSecret = req.headers.get("x-cron-secret");
  const expectedSecret = Deno.env.get("CRON_SECRET");
  if (!cronSecret || cronSecret !== expectedSecret) {
    return new Response("Unauthorized", { status: 401 });
  }

  const accessToken = Deno.env.get("META_PAGE_ACCESS_TOKEN") || "";
  if (!accessToken) {
    console.error("[meta-leads-poll] META_PAGE_ACCESS_TOKEN not set");
    return new Response(JSON.stringify({ ok: false, error: "META_PAGE_ACCESS_TOKEN not set" }), {
      status: 500, headers: { "Content-Type": "application/json" },
    });
  }

  const pageIds = (Deno.env.get("META_PAGE_IDS") || DEFAULT_PAGE_IDS)
    .split(",").map(s => s.trim()).filter(Boolean);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const sinceUnix   = Math.floor(Date.now() / 1000) - LOOKBACK_SECONDS;

  const stats = {
    pages: pageIds.length,
    forms_discovered: 0,
    leads_found: 0,
    leads_ingested: 0,
    duplicates: 0,
    errors: 0,
  };

  for (const pageId of pageIds) {
    let forms: Awaited<ReturnType<typeof getLeadForms>>;
    try {
      forms = await getLeadForms(pageId, accessToken);
    } catch (e: any) {
      console.error(`[meta-leads-poll] getLeadForms failed for ${pageId}:`, e.message);
      stats.errors++;
      continue;
    }
    stats.forms_discovered += forms.length;
    console.log(`[meta-leads-poll] page ${pageId}: ${forms.length} forms`);

    for (const form of forms) {
      let leads: any[];
      try {
        leads = await fetchLeadsSince(form.id, sinceUnix, accessToken);
      } catch (e: any) {
        console.error(`[meta-leads-poll] fetchLeadsSince failed form ${form.id}:`, e.message);
        stats.errors++;
        continue;
      }
      if (leads.length === 0) continue;

      stats.leads_found += leads.length;
      console.log(`[meta-leads-poll] form "${form.name}" (${form.id}): ${leads.length} leads to process`);

      for (const lead of leads) {
        const payload = {
          field_data:      lead.field_data     || [],
          leadgen_id:      lead.id,
          form_id:         lead.form_id        || form.id,
          form_name:       lead.form_name      || form.name,
          ad_id:           lead.ad_id          || null,
          ad_name:         lead.ad_name        || null,
          adset_id:        lead.adset_id       || null,
          adset_name:      lead.adset_name     || null,
          campaign_id:     lead.campaign_id    || null,
          campaign_name:   lead.campaign_name  || null,
          page_id:         pageId,
          platform:        lead.platform       || null,
          created_time:    lead.created_time   || null,
        };

        try {
          const res = await fetch(`${supabaseUrl}/functions/v1/lead-ingest?source=meta_ads`, {
            method: "POST",
            headers: {
              "Content-Type":  "application/json",
              "apikey":         serviceKey,
              "Authorization": `Bearer ${serviceKey}`,
            },
            body: JSON.stringify(payload),
          });
          const json: any = await res.json().catch(() => ({}));
          if (json?.status === "duplicate") {
            stats.duplicates++;
          } else if (!res.ok || json?.status === "error") {
            console.error(`[meta-leads-poll] ingest error lead ${lead.id}:`, json);
            stats.errors++;
          } else {
            stats.leads_ingested++;
            console.log(`[meta-leads-poll] ingested lead ${lead.id} → lead_id ${json?.lead_id}`);
          }
        } catch (e: any) {
          console.error(`[meta-leads-poll] fetch lead-ingest failed:`, e.message);
          stats.errors++;
        }
      }
    }
  }

  console.log("[meta-leads-poll] complete:", stats);
  return new Response(JSON.stringify({ ok: true, ...stats }), {
    headers: { "Content-Type": "application/json" },
  });
});
