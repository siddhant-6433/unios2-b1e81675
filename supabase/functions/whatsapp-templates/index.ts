/**
 * WhatsApp Templates Management
 * ─────────────────────────────────────────────────────────────
 * Proxies Meta Graph API for WhatsApp template CRUD.
 * GET  — list all templates with status
 * POST — create/submit a new template for approval
 * DELETE — delete a template
 *
 * Auth: requires authenticated user with super_admin or admission_head role.
 */

import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-cron-secret, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const json = (payload: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const isMissingMirrorTable = (error: any) => {
  const code = String(error?.code || "");
  const message = String(error?.message || "").toLowerCase();
  return (
    code === "42P01" ||
    code === "PGRST205" ||
    (message.includes("whatsapp_templates") &&
      (message.includes("does not exist") ||
        message.includes("could not find the table") ||
        message.includes("schema cache")))
  );
};

const isMissingSettingsTable = (error: any) => {
  const code = String(error?.code || "");
  const message = String(error?.message || "").toLowerCase();
  return (
    code === "42P01" ||
    code === "PGRST205" ||
    (message.includes("whatsapp_template_settings") &&
      (message.includes("does not exist") ||
        message.includes("could not find the table") ||
        message.includes("schema cache")))
  );
};

const normalizeTemplateStatus = (status: unknown) => {
  const value = String(status || "PENDING").toUpperCase();
  const known = new Set([
    "PENDING",
    "APPROVED",
    "REJECTED",
    "PAUSED",
    "DISABLED",
    "IN_APPEAL",
    "FLAGGED",
  ]);
  return known.has(value) ? value : "FLAGGED";
};

const TEMPLATE_MANAGER_ROLES = new Set(["super_admin", "admission_head"]);

const displayNameForTemplate = (name: string) =>
  name
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");

/** Map header_format to a file extension for storage. */
const HEADER_EXT: Record<string, string> = { IMAGE: "jpg", VIDEO: "mp4", DOCUMENT: "pdf" };

/**
 * Extract the example media URL from a template's components JSONB.
 * Meta stores it at components[type=HEADER].example.header_handle[0].
 */
function extractHeaderMediaUrl(components: any[] | null): string | null {
  if (!Array.isArray(components)) return null;
  const header = components.find((c: any) => c.type === "HEADER");
  const handle = header?.example?.header_handle;
  return Array.isArray(handle) && handle.length > 0 ? String(handle[0]) : null;
}

/**
 * Download media from Meta's scontent URL and re-upload to Supabase Storage.
 * Returns the public URL on success, null on failure (non-fatal).
 */
async function rehostHeaderMedia(
  adminClient: any,
  supabaseUrl: string,
  templateKey: string,
  sourceUrl: string,
  headerFormat: string,
): Promise<string | null> {
  try {
    const res = await fetch(sourceUrl);
    if (!res.ok) {
      console.warn(`[media-rehost] Failed to download ${templateKey}: ${res.status}`);
      return null;
    }
    const blob = await res.blob();
    const ext = HEADER_EXT[headerFormat] || "bin";
    const storagePath = `template-headers/${templateKey}.${ext}`;

    // ponytail: upsert so re-syncs overwrite stale files
    const { error: uploadErr } = await adminClient.storage
      .from("whatsapp-media")
      .upload(storagePath, blob, { contentType: blob.type || "application/octet-stream", upsert: true });
    if (uploadErr) {
      console.warn(`[media-rehost] Storage upload failed for ${templateKey}:`, uploadErr.message);
      return null;
    }

    return `${supabaseUrl}/storage/v1/object/public/whatsapp-media/${storagePath}`;
  } catch (err) {
    console.warn(`[media-rehost] Unexpected error for ${templateKey}:`, err);
    return null;
  }
}

async function registerApprovedTemplateVisibilityRows(adminClient: any, templates: Array<{
  name: string;
  status: string;
  category?: string | null;
  header_format?: string;
  has_media?: boolean;
  components?: any[] | null;
}>) {
  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const approved = templates.filter((template) =>
    template.name && normalizeTemplateStatus(template.status) === "APPROVED"
  );
  if (approved.length === 0) return { registered: 0 };

  const keys = [...new Set(approved.map((template) => template.name))];
  const { data: existing, error: existingErr } = await adminClient
    .from("whatsapp_template_settings")
    .select("template_key, media_url")
    .in("template_key", keys);

  if (existingErr) {
    if (isMissingSettingsTable(existingErr)) {
      console.warn("whatsapp_template_settings unavailable during template sync:", existingErr.message);
      return { registered: 0, warning: "whatsapp_template_settings table is not deployed yet." };
    }
    throw existingErr;
  }

  const existingByKey = new Map(
    ((existing || []) as Array<{ template_key: string; media_url: string | null }>)
      .map((row) => [row.template_key, row]),
  );
  const newTemplates = approved.filter((template) => !existingByKey.has(template.name));
  const rows = newTemplates.map((template) => ({
    template_key: template.name,
    display_name: displayNameForTemplate(template.name),
    description: "Approved Meta template. Configure parameters before enabling if it uses variables.",
    category: String(template.category || "general").toLowerCase(),
    visibility: 'hidden',
  }));

  if (rows.length > 0) {
    const { error: insertErr } = await adminClient
      .from("whatsapp_template_settings")
      .insert(rows);
    if (insertErr) {
      if (isMissingSettingsTable(insertErr)) {
        console.warn("whatsapp_template_settings unavailable during template sync:", insertErr.message);
        return { registered: 0, warning: "whatsapp_template_settings table is not deployed yet." };
      }
      throw insertErr;
    }
  }

  // ── Auto-populate media_url for templates with media headers ──
  // Covers both newly registered AND existing rows that lack a media_url.
  let mediaPopulated = 0;
  if (supabaseUrl) {
    const mediaTemplates = approved.filter((t) =>
      t.has_media && t.components && !existingByKey.get(t.name)?.media_url
    );
    for (const t of mediaTemplates) {
      const sourceUrl = extractHeaderMediaUrl(t.components || null);
      if (!sourceUrl) continue;
      const publicUrl = await rehostHeaderMedia(adminClient, supabaseUrl, t.name, sourceUrl, t.header_format || "IMAGE");
      if (publicUrl) {
        await adminClient
          .from("whatsapp_template_settings")
          .update({ media_url: publicUrl, updated_at: new Date().toISOString() })
          .eq("template_key", t.name);
        mediaPopulated++;
      }
    }
  }

  return { registered: rows.length, media_populated: mediaPopulated };
}

const templatesUrl = (wabaId: string) =>
  `https://graph.facebook.com/v21.0/${wabaId}/message_templates`;

/** Meta paging cursors are absolute URLs; only ever follow one back to Graph. */
function isGraphUrl(value: string): boolean {
  try { return new URL(value).host === "graph.facebook.com"; } catch { return false; }
}

/** Strip any access token that leaked into an error string before it escapes. */
const redactToken = (message: string) =>
  String(message ?? "")
    .replace(/access_token=[^&\s)]+/gi, "access_token=REDACTED")
    .replace(/Bearer\s+[A-Za-z0-9._-]{20,}/gi, "Bearer REDACTED");

type WabaTarget = {
  wabaId: string;
  token: string;
  /** The WHATSAPP_WABA_ID account. Its rows keep waba_id NULL — see syncWabaRows. */
  isDefault: boolean;
  label: string;
};

/**
 * Every WABA we can read templates from: the env default plus every distinct
 * waba_id on an active whatsapp_channels row, each with its OWN token.
 *
 * Before this, list/sync only ever queried WHATSAPP_WABA_ID, so a template
 * approved under any other WABA could never appear no matter how many times
 * "Sync from Meta" was pressed — e.g. WABA 963503789849531 (the 9555192192
 * coexistence sender) had zero templates mirrored despite being bulk-enabled.
 */
async function resolveWabaTargets(
  adminClient: any,
  defaultWabaId: string,
  defaultToken: string,
): Promise<WabaTarget[]> {
  const targets = new Map<string, WabaTarget>();
  targets.set(defaultWabaId, {
    wabaId: defaultWabaId, token: defaultToken, isDefault: true, label: "Default WABA",
  });

  const { data: channels, error } = await adminClient
    .from("whatsapp_channels")
    .select("label, waba_id, secret_token_name, is_active")
    .not("waba_id", "is", null)
    .eq("is_active", true);
  if (error) {
    console.warn("Could not read whatsapp_channels for WABA fan-out:", error.message);
    return [...targets.values()];
  }

  for (const ch of (channels || []) as Array<{
    label?: string | null; waba_id?: string | null; secret_token_name?: string | null;
  }>) {
    const waba = ch.waba_id ? String(ch.waba_id) : "";
    if (!waba || targets.has(waba)) continue;
    // Each channel names its own secret; fall back to the shared token so a
    // channel with no dedicated secret still syncs if the main token covers it.
    const token = (ch.secret_token_name ? Deno.env.get(ch.secret_token_name) : null) || defaultToken;
    if (!token) continue;
    targets.set(waba, { wabaId: waba, token, isDefault: false, label: ch.label || waba });
  }
  return [...targets.values()];
}

/**
 * All templates for one WABA, following Meta's paging cursor.
 *
 * The old code passed limit=200 and read only the first page, so any WABA with
 * more than 200 templates silently lost the tail — and Meta orders by creation,
 * so the lost tail is exactly the newly approved ones.
 */
async function fetchTemplatesForWaba(
  target: WabaTarget,
  fields: string,
): Promise<{ templates: any[]; error?: string }> {
  const collected: any[] = [];
  // Token rides in the Authorization header, never the query string: fetch's
  // failure message embeds the full URL, and the outer catch both console.errors
  // it into permanent edge logs and returns it to the browser — which would leak
  // a live WABA token on any network blip.
  let url = `${templatesUrl(target.wabaId)}?fields=${fields}&limit=200`;
  const auth = { Authorization: `Bearer ${target.token}` };
  // ponytail: 25-page ceiling (5000 templates) so a broken cursor can't spin forever.
  for (let page = 0; page < 25 && url; page++) {
    const res = await fetch(url, { headers: auth });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return {
        templates: collected,
        error: data?.error?.message || `Meta API error ${res.status}`,
      };
    }
    collected.push(...(data.data || []));
    // Meta's cursor is an absolute URL. Pin the host before following it —
    // an unvalidated redirect target would receive the Authorization header.
    const next = data?.paging?.next;
    url = next && isGraphUrl(next) ? next : "";
  }
  return { templates: collected };
}

/** Meta template → whatsapp_templates row. */
function toTemplateRow(t: any, wabaId: string | null) {
  const header = (t.components || []).find((c: any) => c.type === "HEADER");
  const headerFormat = (header?.format || "NONE").toUpperCase();
  const bodyComp = (t.components || []).find((c: any) => c.type === "BODY");
  const placeholderCount = (String(bodyComp?.text || "").match(/\{\{(\d+)\}\}/g) || []).length;
  return {
    meta_template_id: String(t.id),
    name: t.name,
    language: t.language || "en",
    category: t.category || null,
    status: normalizeTemplateStatus(t.status),
    header_format: ["TEXT", "IMAGE", "VIDEO", "DOCUMENT"].includes(headerFormat) ? headerFormat : "NONE",
    has_media: ["IMAGE", "VIDEO", "DOCUMENT"].includes(headerFormat),
    placeholder_count: placeholderCount,
    components: t.components || null,
    quality_score: typeof t.quality_score === "object" ? t.quality_score?.score || null : t.quality_score || null,
    waba_id: wabaId,
    status_updated_at: new Date().toISOString(),
  };
}

/**
 * Fan out across every WABA and return de-duplicated rows.
 *
 * whatsapp_templates is unique on (name, language), so the same template name
 * living in two WABAs can only be mirrored once. The default WABA wins, since
 * that is the account every legacy sender resolves against.
 *
 * ponytail: if two WABAs ever genuinely need the same template name at once,
 * the unique constraint has to become (waba_id, name, language) and every
 * name-only lookup has to carry a WABA — a much larger change than this.
 */
async function collectRowsAcrossWabas(targets: WabaTarget[], fields: string) {
  const byKey = new Map<string, any>();
  const perWaba: Array<{ waba_id: string; label: string; fetched: number; error?: string }> = [];
  const skipped: string[] = [];

  for (const target of targets) {
    const { templates, error } = await fetchTemplatesForWaba(target, fields);
    perWaba.push({ waba_id: target.wabaId, label: target.label, fetched: templates.length, ...(error ? { error } : {}) });
    if (error) console.warn(`[template-sync] ${target.label} (${target.wabaId}): ${error}`);

    for (const t of templates) {
      if (!t?.name) continue;
      const key = `${t.name}:${t.language || "en"}`;
      // Default-WABA templates keep waba_id NULL. The sender-matching helper
      // normalises NULL to "MAIN", and the main senders have no waba_id set —
      // stamping a real id here would make them fail senderCanSendTemplate.
      const row = toTemplateRow(t, target.isDefault ? null : target.wabaId);
      const existing = byKey.get(key);
      if (!existing) { byKey.set(key, row); continue; }
      if (existing.waba_id !== null && row.waba_id === null) {
        byKey.set(key, row);              // default wins
        skipped.push(`${key}@${existing.waba_id}`);
      } else {
        skipped.push(`${key}@${target.wabaId}`);
      }
    }
  }
  return { rows: [...byKey.values()], perWaba, skipped };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const envWabaId = Deno.env.get("WHATSAPP_WABA_ID");
    const envToken = Deno.env.get("WHATSAPP_API_TOKEN");

    if (!envWabaId || !envToken) {
      return new Response(
        JSON.stringify({ error: "WhatsApp Business Account not configured" }),
        { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Mutable per-request: create/delete may retarget these at a specific WABA.
    const defaultWabaId: string = envWabaId;
    let wabaId: string = envWabaId;
    let waToken: string = envToken;

    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    let body: any = {};
    try { body = await req.json(); } catch { body = {}; }
    const action = body.action || "list";

    // The nightly sync cron has no user JWT. It may only run `sync`, which is a
    // read from Meta plus an upsert into our own mirror — no Meta mutation.
    const cronSecret = Deno.env.get("CRON_SECRET");
    const isCron = !!cronSecret && req.headers.get("x-cron-secret") === cronSecret;
    if (isCron && action !== "sync") {
      return new Response(JSON.stringify({ error: "Cron may only run the sync action" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Auth — verify JWT with Supabase Auth, then verify template-manager role.
    const authHeader = req.headers.get("Authorization") || req.headers.get("authorization");
    if (!isCron && !authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized: no auth header" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let userId: string | null = null;
    let role: unknown = "cron";

    if (!isCron) {
      const jwt = (authHeader || "").replace(/^Bearer\s+/i, "");
      const { data: authData, error: authError } = await adminClient.auth.getUser(jwt);
      userId = authData.user?.id || null;
      if (authError || !userId) {
        return new Response(JSON.stringify({ error: "Unauthorized: invalid token" }), {
          status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const { data: userRole } = await adminClient.rpc("get_user_role", { _user_id: userId });
      role = userRole;
      if (!TEMPLATE_MANAGER_ROLES.has(String(userRole || ""))) {
        return new Response(JSON.stringify({ error: "Forbidden: super_admin or admission_head only" }), {
          status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    const user = { id: userId };

    console.log("Action:", action, "User:", user.id ?? "cron", "Role:", role);

    // ── LIST: List all templates, across every WABA we can read ──
    if (action === "list") {
      const targets = await resolveWabaTargets(adminClient, wabaId, waToken);
      const { rows, perWaba, skipped } = await collectRowsAcrossWabas(
        targets, "id,name,status,category,language,components",
      );

      // Every target failed — surface it instead of pretending there are no templates.
      if (rows.length === 0 && perWaba.every((w) => w.error)) {
        return json({ error: perWaba[0]?.error || "Meta API error", per_waba: perWaba }, 502);
      }

      const templates = rows.map((r: any) => ({
        id: r.meta_template_id,
        name: r.name,
        status: r.status,
        category: r.category,
        language: r.language,
        components: r.components,
        waba_id: r.waba_id,
      }));

      const visibility = await registerApprovedTemplateVisibilityRows(adminClient, templates);

      return json({
        templates,
        per_waba: perWaba,
        ...(skipped.length ? { duplicate_names_skipped: skipped } : {}),
        visibility_registered: visibility.registered,
        visibility_warning: visibility.warning,
      });
    }

    // ── WABAS: the accounts we hold a usable token for ──
    // Drives the sync/submit pickers. Never returns tokens — labels and ids only.
    if (action === "wabas") {
      const targets = await resolveWabaTargets(adminClient, wabaId, waToken);
      return json({
        wabas: targets.map((t) => ({
          waba_id: t.wabaId,
          label: t.isDefault ? "NIMT (default)" : t.label,
          is_default: t.isDefault,
        })),
      });
    }

    // ── CREATE: Create a new template ──
    if (action === "create") {
      const {
        name, category, language, body_text,
        header_format, header_text, header_example, header_handle,
        body_examples, footer_text, buttons, waba_id,
      } = body;

      // ponytail: resolve per-WABA token when a specific WABA is requested
      if (waba_id && waba_id !== wabaId) {
        const { data: ch } = await adminClient
          .from("whatsapp_channels")
          .select("secret_token_name")
          .eq("waba_id", waba_id)
          .eq("is_active", true)
          .limit(1)
          .single();
        const resolved = ch?.secret_token_name ? Deno.env.get(ch.secret_token_name) : null;
        if (!resolved) {
          return new Response(
            JSON.stringify({ error: `No API token configured for WABA ${waba_id}` }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
          );
        }
        wabaId = waba_id;
        waToken = resolved;
      }

      if (!name || !body_text) {
        return new Response(JSON.stringify({ error: "name and body_text are required" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Extract {{1}}, {{2}} … from body_text. Use caller-supplied sample
      // values when present; otherwise fall back to synthetic placeholders.
      const varCount = (body_text.match(/\{\{(\d+)\}\}/g) || []).length;
      const suppliedExamples = Array.isArray(body_examples)
        ? body_examples.map((v: unknown) => String(v ?? "").trim())
        : [];
      const exampleValues = Array.from({ length: varCount }, (_, i) =>
        suppliedExamples[i] && suppliedExamples[i].length > 0 ? suppliedExamples[i] : `example_${i + 1}`
      );

      const normHeaderFormat = (header_format || "none").toString().toUpperCase();
      const components: any[] = [];

      // Header (optional) — TEXT carries its own example; media carries a handle.
      if (normHeaderFormat && normHeaderFormat !== "NONE") {
        if (normHeaderFormat === "TEXT") {
          const headerVarCount = (String(header_text || "").match(/\{\{(\d+)\}\}/g) || []).length;
          components.push({
            type: "HEADER",
            format: "TEXT",
            text: header_text || "",
            ...(headerVarCount > 0
              ? { example: { header_text: [header_example || "example"] } }
              : {}),
          });
        } else if (["IMAGE", "VIDEO", "DOCUMENT"].includes(normHeaderFormat)) {
          if (!header_handle) {
            return new Response(
              JSON.stringify({ error: `${normHeaderFormat} header requires an uploaded media handle` }),
              { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }
          components.push({
            type: "HEADER",
            format: normHeaderFormat,
            example: { header_handle: [header_handle] },
          });
        }
      }

      // Body
      components.push({
        type: "BODY",
        text: body_text,
        ...(varCount > 0 ? { example: { body_text: [exampleValues] } } : {}),
      });

      // Footer (optional)
      if (footer_text && String(footer_text).trim()) {
        components.push({ type: "FOOTER", text: String(footer_text).trim() });
      }

      // Buttons (optional)
      if (buttons && buttons.length > 0) {
        components.push({
          type: "BUTTONS",
          buttons: buttons.map((b: any) => {
            const t = String(b.type || "").toUpperCase();
            if (t === "URL") {
              return {
                type: "URL",
                text: b.text,
                url: b.url,
                ...(b.example ? { example: [b.example] } : {}),
              };
            }
            if (t === "PHONE_NUMBER") {
              return { type: "PHONE_NUMBER", text: b.text, phone_number: b.phone_number };
            }
            return { type: "QUICK_REPLY", text: b.text };
          }),
        });
      }

      const safeName = name.toLowerCase().replace(/[^a-z0-9_]/g, "_");
      const safeLanguage = language || "en";
      const safeCategory = (category || "UTILITY").toUpperCase();

      const payload = {
        name: safeName,
        language: safeLanguage,
        category: safeCategory,
        components,
      };

      // Built here, not above: the waba_id override lands earlier in this block,
      // so a URL captured before it would submit to the default WABA and quietly
      // ignore whichever account the submitter picked.
      const res = await fetch(templatesUrl(wabaId), {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${waToken}` },
        body: JSON.stringify(payload),
      });

      const result = await res.json();

      if (!res.ok) {
        return new Response(
          JSON.stringify({
            error: result?.error?.error_user_msg || result?.error?.message || "Template submission failed",
            details: result?.error,
          }),
          { status: res.status >= 400 && res.status < 500 ? res.status : 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Mirror the submission locally (status starts PENDING). The webhook flips
      // it on Meta's decision. Upsert on (name, language) so re-submits update.
      const { error: upsertErr } = await adminClient
        .from("whatsapp_templates")
        .upsert({
          meta_template_id: result?.id ? String(result.id) : null,
          name: safeName,
          language: safeLanguage,
          category: safeCategory,
          status: (result?.status || "PENDING").toUpperCase(),
          header_format: normHeaderFormat,
          has_media: ["IMAGE", "VIDEO", "DOCUMENT"].includes(normHeaderFormat),
          placeholder_count: varCount,
          components,
          reject_reason: null,
          // NULL for the default account, matching what sync writes — the
          // sender-matching helper normalises NULL to "MAIN" and the main
          // senders carry no waba_id of their own.
          waba_id: wabaId === defaultWabaId ? null : wabaId,
          created_by: userId,
          submitted_at: new Date().toISOString(),
          status_updated_at: new Date().toISOString(),
        }, { onConflict: "name,language" });
      if (upsertErr) console.error("whatsapp_templates upsert failed:", upsertErr.message);

      return new Response(JSON.stringify({ success: true, ...result }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── SYNC: Reconcile local rows with Meta, across every readable WABA ──
    // Syncs ALL accounts by default. Pass waba_id to sync just one — useful when
    // a single account has a token problem and you want a fast, isolated retry.
    if (action === "sync") {
      const onlyWaba = body.waba_id ? String(body.waba_id) : null;
      const allTargets = await resolveWabaTargets(adminClient, wabaId, waToken);
      const targets = onlyWaba
        ? allTargets.filter((t) => t.wabaId === onlyWaba)
        : allTargets;

      if (onlyWaba && targets.length === 0) {
        return json({ error: `WABA ${onlyWaba} is not a known active WhatsApp account` }, 400);
      }

      const { rows, perWaba, skipped } = await collectRowsAcrossWabas(
        targets, "id,name,status,category,language,components,quality_score",
      );

      // Only bail when EVERY account failed. One dead token (e.g. a channel whose
      // secret was never set) must not block the accounts that do work.
      if (rows.length === 0 && perWaba.every((w) => w.error)) {
        return json({ error: perWaba[0]?.error || "Meta API error", per_waba: perWaba }, 502);
      }

      if (rows.length > 0) {
        const { error: syncErr } = await adminClient
          .from("whatsapp_templates")
          .upsert(rows, { onConflict: "name,language" });
        if (syncErr) {
          if (isMissingMirrorTable(syncErr)) {
            console.warn("whatsapp_templates mirror unavailable during sync:", syncErr.message);
            return json({
              success: true,
              synced: 0,
              fetched: rows.length,
              warning: "Fetched templates from Meta, but the local whatsapp_templates mirror table is not deployed yet. Apply migration 20260624100800_whatsapp_templates.sql to persist sync results.",
            });
          }
          return json({ error: syncErr.message, details: syncErr }, 500);
        }
      }

      const visibility = await registerApprovedTemplateVisibilityRows(adminClient, rows);

      return json({
        success: true,
        synced: rows.length,
        fetched: rows.length,
        per_waba: perWaba,
        ...(skipped.length ? { duplicate_names_skipped: skipped } : {}),
        // Newly approved templates are registered hidden on purpose; this is how
        // many now need a visibility decision before campaigns can use them.
        visibility_registered: visibility.registered,
        media_populated: visibility.media_populated || 0,
        ...(visibility.warning ? { warning: visibility.warning } : {}),
      });
    }

    // ── DELETE: Delete a template ──
    if (action === "delete") {
      const { name, language, meta_template_id, id } = body;
      if (!name) {
        return new Response(JSON.stringify({ error: "name is required" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const templateId = String(meta_template_id || id || "").trim();
      const safeLanguage = language ? String(language).trim() : "";

      // Delete has to hit the account the template actually lives in, with that
      // account's token — otherwise a non-default-WABA template gets a 404 from
      // the default account and the row is never removed.
      const { data: ownerRow } = await adminClient
        .from("whatsapp_templates")
        .select("waba_id")
        .eq("name", String(name))
        .limit(1)
        .maybeSingle();
      const ownerWaba = ownerRow?.waba_id ? String(ownerRow.waba_id) : null;
      if (ownerWaba && ownerWaba !== defaultWabaId) {
        const target = (await resolveWabaTargets(adminClient, wabaId, waToken))
          .find((t) => t.wabaId === ownerWaba);
        if (target) { wabaId = target.wabaId; waToken = target.token; }
      }

      const attempts: Record<string, string>[] = [];
      if (templateId) {
        attempts.push({
          name: String(name),
          ...(safeLanguage ? { language: safeLanguage } : {}),
          hsm_id: templateId,
        });
        attempts.push({ name: String(name), hsm_id: templateId });
        attempts.push({ hsm_id: templateId });
      }
      if (safeLanguage) attempts.push({ name: String(name), language: safeLanguage });
      attempts.push({ name: String(name) });

      const uniqueAttempts = attempts.filter((params, index) => {
        const key = JSON.stringify(params);
        return attempts.findIndex((candidate) => JSON.stringify(candidate) === key) === index;
      });

      let result: any = null;
      let status = 502;
      for (const params of uniqueAttempts) {
        const search = new URLSearchParams(params);
        const res = await fetch(`${templatesUrl(wabaId)}?${search.toString()}`, {
          method: "DELETE",
          headers: { Authorization: `Bearer ${waToken}` },
        });
        result = await res.json().catch(() => ({}));
        status = res.status;
        if (res.ok) {
          const localDelete = adminClient
            .from("whatsapp_templates")
            .delete()
            .eq("name", String(name));
          const { error: localDeleteErr } = await (safeLanguage
            ? localDelete.eq("language", safeLanguage)
            : localDelete);
          if (localDeleteErr && !isMissingMirrorTable(localDeleteErr)) {
            console.error("whatsapp_templates local delete failed:", localDeleteErr.message);
          }

          const { error: settingsDeleteErr } = await adminClient
            .from("whatsapp_template_settings")
            .delete()
            .eq("template_key", String(name));
          if (settingsDeleteErr && !isMissingSettingsTable(settingsDeleteErr)) {
            console.error("whatsapp_template_settings local delete failed:", settingsDeleteErr.message);
          }

          return new Response(JSON.stringify({ success: true }), {
            status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      }

      return new Response(JSON.stringify({
        error: result?.error?.error_user_msg || result?.error?.message || "Delete failed",
        details: result?.error || result,
      }), {
        status: status >= 400 && status < 500 ? status : 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    // Redact before BOTH sinks: console.error writes to permanent edge logs and
    // the body goes straight to the browser.
    const safe = redactToken(err?.message);
    console.error("WhatsApp templates error:", safe);
    return new Response(JSON.stringify({ error: safe }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
