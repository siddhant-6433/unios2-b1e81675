// Meta Lead Ads Poller
//
// Runs every 5 minutes via pg_cron. For each page in META_PAGE_IDS, discovers
// all lead forms and fetches any leads created in the last 15 minutes. The
// 15-minute window with a 5-minute cadence gives 10 minutes of overlap —
// duplicates are silently dropped by the unique index on meta_leadgen_id.
//
// Token model:
//   META_PAGE_ACCESS_TOKEN is treated as a *system user* token. The function
//   calls /me/accounts at the start of each run to exchange it for per-page
//   page access tokens, then uses those page tokens for /leadgen_forms and
//   /leads. Meta requires page-scoped tokens on those endpoints (error #190
//   "must be called with a Page Access Token" otherwise).
//
// Backfill mode:
//   POST ?lookback_days=N (or lookback_seconds=N) to override the default
//   15-min window. Useful for one-shot historical ingestion.
//
// Required env:
//   META_PAGE_ACCESS_TOKEN  — System user token with leads_retrieval + pages_show_list
//   META_PAGE_IDS           — Comma-separated page IDs (defaults to both NIMT pages)
//   CRON_SECRET             — Shared secret for cron auth
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

const GRAPH_VERSION = "v21.0";
// NIMT School + NIMT Educational Institutions — extend via META_PAGE_IDS secret
const DEFAULT_PAGE_IDS = "111711207848445,443493925579";
const DEFAULT_LOOKBACK_SECONDS = 900; // 15 min window; 10 min overlap at 5-min cadence

type PageTokenMap = Map<string, { token: string; name: string }>;

async function getPageTokens(systemUserToken: string, errors: any[]): Promise<PageTokenMap> {
  const map: PageTokenMap = new Map();
  let url: string | null =
    `https://graph.facebook.com/${GRAPH_VERSION}/me/accounts` +
    `?fields=id,name,access_token&limit=100&access_token=${encodeURIComponent(systemUserToken)}`;
  let pages = 0;
  while (url && pages < 10) {
    const res = await fetch(url);
    const json: any = await res.json().catch(() => ({}));
    if (!res.ok) {
      errors.push({ stage: "me_accounts", error: json?.error?.message || `HTTP ${res.status}` });
      console.error("[meta-leads-poll] /me/accounts failed:", json?.error);
      return map;
    }
    for (const p of json.data || []) {
      if (p?.id && p?.access_token) {
        map.set(String(p.id), { token: p.access_token, name: p.name || "" });
      }
    }
    url = json.paging?.next ?? null;
    pages++;
  }
  return map;
}

async function getLeadForms(pageId: string, token: string, errors: any[]) {
  let url: string | null =
    `https://graph.facebook.com/${GRAPH_VERSION}/${pageId}/leadgen_forms` +
    `?fields=id,name,status&limit=100&access_token=${encodeURIComponent(token)}`;
  const forms: Array<{ id: string; name: string; status: string }> = [];
  let pages = 0;
  while (url && pages < 5) {
    const res = await fetch(url);
    const json: any = await res.json().catch(() => ({}));
    if (!res.ok) {
      errors.push({ stage: "leadgen_forms", page_id: pageId, error: json?.error?.message || `HTTP ${res.status}` });
      console.error(`[meta-leads-poll] leadgen_forms error page ${pageId}:`, json?.error?.message);
      break;
    }
    forms.push(...(json.data || []));
    url = json.paging?.next ?? null;
    pages++;
  }
  return forms;
}

async function fetchLeadsSince(formId: string, sinceUnix: number, token: string, errors: any[]) {
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
  while (url && pages < 50) {
    const res = await fetch(url);
    const json: any = await res.json().catch(() => ({}));
    if (!res.ok) {
      errors.push({ stage: "leads", form_id: formId, error: json?.error?.message || `HTTP ${res.status}` });
      console.error(`[meta-leads-poll] leads error form ${formId}:`, json?.error?.message);
      break;
    }
    leads.push(...(json.data || []));
    url = json.paging?.next ?? null;
    pages++;
  }
  return leads;
}

// Return the subset of leadgen_ids that are ALREADY in the leads table, so the
// caller can skip them before spending a (rate-limited) lead-ingest invocation.
// Cheap PostgREST read against the service role; chunked to keep URLs short.
async function getExistingLeadgenIds(
  ids: string[], supabaseUrl: string, serviceKey: string,
): Promise<Set<string>> {
  const existing = new Set<string>();
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100);
    const url = `${supabaseUrl}/rest/v1/leads` +
      `?select=meta_leadgen_id&meta_leadgen_id=in.(${chunk.map(encodeURIComponent).join(",")})`;
    const res = await fetch(url, {
      headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
    });
    if (!res.ok) continue; // best-effort: on failure, fall through and let ingest dedup
    const rows: any[] = await res.json().catch(() => []);
    for (const r of rows) if (r?.meta_leadgen_id) existing.add(String(r.meta_leadgen_id));
  }
  return existing;
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

  // Lookback override (for backfill). Accept ?lookback_days=N or
  // ?lookback_seconds=N as query params; fall back to the 15-min default.
  const url = new URL(req.url);
  const lookbackDays = Number(url.searchParams.get("lookback_days") || "");
  const lookbackSecondsParam = Number(url.searchParams.get("lookback_seconds") || "");
  let lookbackSeconds = DEFAULT_LOOKBACK_SECONDS;
  if (Number.isFinite(lookbackDays) && lookbackDays > 0) {
    lookbackSeconds = Math.floor(lookbackDays * 86400);
  } else if (Number.isFinite(lookbackSecondsParam) && lookbackSecondsParam > 0) {
    lookbackSeconds = Math.floor(lookbackSecondsParam);
  }

  // Per-lead throttle before each lead-ingest call. Default 250ms is fine for the
  // 5-min cron's tiny window; bump via ?throttle_ms=2000 for large backfills to
  // stay under Supabase's function-to-function rate cap. Clamped to [100, 10000].
  const throttleMsParam = Number(url.searchParams.get("throttle_ms") || "");
  const throttleMs = Number.isFinite(throttleMsParam) && throttleMsParam > 0
    ? Math.min(10000, Math.max(100, Math.floor(throttleMsParam)))
    : 250;

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const anonKey     = Deno.env.get("SUPABASE_ANON_KEY") || serviceKey;
  const sinceUnix   = Math.floor(Date.now() / 1000) - lookbackSeconds;

  const errorsDetail: any[] = [];
  const stats: any = {
    pages: pageIds.length,
    page_ids: pageIds,
    lookback_seconds: lookbackSeconds,
    forms_discovered: 0,
    leads_found: 0,
    leads_ingested: 0,
    duplicates: 0,
    errors: 0,
    per_page: {} as Record<string, { forms: number; leads_found: number; leads_ingested: number; duplicates: number; errors: number; page_name?: string; token_resolved: boolean }>,
  };

  // Exchange the system user token for per-page tokens once per run.
  const pageTokens = await getPageTokens(accessToken, errorsDetail);
  if (pageTokens.size === 0 && errorsDetail.length > 0) {
    stats.errors = errorsDetail.length;
    return new Response(JSON.stringify({ ok: false, ...stats, errors_detail: errorsDetail }), {
      status: 200, headers: { "Content-Type": "application/json" },
    });
  }

  for (const pageId of pageIds) {
    const pageStat = { forms: 0, leads_found: 0, leads_ingested: 0, duplicates: 0, errors: 0, page_name: "", token_resolved: false };
    stats.per_page[pageId] = pageStat;

    const pageEntry = pageTokens.get(pageId);
    if (!pageEntry) {
      errorsDetail.push({ stage: "page_token_lookup", page_id: pageId, error: "No page token returned by /me/accounts — system user lacks access to this page" });
      pageStat.errors++;
      continue;
    }
    pageStat.token_resolved = true;
    pageStat.page_name = pageEntry.name;
    const pageToken = pageEntry.token;

    let forms: Awaited<ReturnType<typeof getLeadForms>>;
    try {
      forms = await getLeadForms(pageId, pageToken, errorsDetail);
    } catch (e: any) {
      errorsDetail.push({ stage: "leadgen_forms_throw", page_id: pageId, error: e.message });
      pageStat.errors++;
      continue;
    }
    pageStat.forms = forms.length;
    stats.forms_discovered += forms.length;
    console.log(`[meta-leads-poll] page ${pageId} (${pageEntry.name}): ${forms.length} forms`);

    for (const form of forms) {
      let leads: any[];
      try {
        leads = await fetchLeadsSince(form.id, sinceUnix, pageToken, errorsDetail);
      } catch (e: any) {
        errorsDetail.push({ stage: "leads_throw", form_id: form.id, error: e.message });
        pageStat.errors++;
        continue;
      }
      if (leads.length === 0) continue;

      pageStat.leads_found += leads.length;
      stats.leads_found += leads.length;
      console.log(`[meta-leads-poll] form "${form.name}" (${form.id}): ${leads.length} leads to process`);

      // Skip leads already ingested BEFORE the rate-limited lead-ingest call, so
      // re-runs spend their function-to-function budget only on missing leads
      // (and the 5-min cron stops burning invocations on its overlap window).
      const already = await getExistingLeadgenIds(
        leads.map((l) => String(l.id)), supabaseUrl, serviceKey,
      );

      for (const lead of leads) {
        if (already.has(String(lead.id))) {
          pageStat.duplicates++;
          stats.duplicates++;
          continue;
        }
        // Throttle to stay under Supabase's function-to-function rate cap
        // (observed ~30 sub-calls before a 50s cooldown). Tunable via ?throttle_ms.
        await new Promise((r) => setTimeout(r, throttleMs));
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
              // lead-ingest checks the `apikey` header against SUPABASE_ANON_KEY
              "apikey":         anonKey,
              "Authorization": `Bearer ${anonKey}`,
            },
            body: JSON.stringify(payload),
          });
          const json: any = await res.json().catch(() => ({}));
          if (json?.status === "duplicate") {
            pageStat.duplicates++;
            stats.duplicates++;
          } else if (!res.ok || json?.status === "error") {
            errorsDetail.push({ stage: "lead_ingest", leadgen_id: lead.id, error: json?.error || json?.message || `HTTP ${res.status}` });
            pageStat.errors++;
            console.error(`[meta-leads-poll] ingest error lead ${lead.id}:`, json);
          } else {
            pageStat.leads_ingested++;
            stats.leads_ingested++;
            console.log(`[meta-leads-poll] ingested lead ${lead.id} → lead_id ${json?.lead_id}`);
          }
        } catch (e: any) {
          errorsDetail.push({ stage: "lead_ingest_throw", leadgen_id: lead.id, error: e.message });
          pageStat.errors++;
          console.error(`[meta-leads-poll] fetch lead-ingest failed:`, e.message);
        }
      }
    }
  }

  stats.errors = errorsDetail.reduce((n, _) => n + 1, 0);
  console.log("[meta-leads-poll] complete:", stats);
  return new Response(JSON.stringify({ ok: true, ...stats, errors_detail: errorsDetail.slice(0, 20) }), {
    headers: { "Content-Type": "application/json" },
  });
});
