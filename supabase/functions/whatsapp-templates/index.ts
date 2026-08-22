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

async function registerApprovedTemplateVisibilityRows(adminClient: any, templates: Array<{
  name: string;
  status: string;
  category?: string | null;
}>) {
  const approved = templates.filter((template) =>
    template.name && normalizeTemplateStatus(template.status) === "APPROVED"
  );
  if (approved.length === 0) return { registered: 0 };

  const keys = [...new Set(approved.map((template) => template.name))];
  const { data: existing, error: existingErr } = await adminClient
    .from("whatsapp_template_settings")
    .select("template_key")
    .in("template_key", keys);

  if (existingErr) {
    if (isMissingSettingsTable(existingErr)) {
      console.warn("whatsapp_template_settings unavailable during template sync:", existingErr.message);
      return { registered: 0, warning: "whatsapp_template_settings table is not deployed yet." };
    }
    throw existingErr;
  }

  const existingKeys = new Set(((existing || []) as Array<{ template_key: string }>).map((row) => row.template_key));
  const rows = approved
    .filter((template) => !existingKeys.has(template.name))
    .map((template) => ({
      template_key: template.name,
      display_name: displayNameForTemplate(template.name),
      description: "Approved Meta template. Configure parameters before enabling if it uses variables.",
      category: String(template.category || "general").toLowerCase(),
      visibility: 'hidden',
    }));

  if (rows.length === 0) return { registered: 0 };

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

  return { registered: rows.length };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const wabaId = Deno.env.get("WHATSAPP_WABA_ID");
    const waToken = Deno.env.get("WHATSAPP_API_TOKEN");

    if (!wabaId || !waToken) {
      return new Response(
        JSON.stringify({ error: "WhatsApp Business Account not configured" }),
        { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

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

    const metaUrl = `https://graph.facebook.com/v21.0/${wabaId}/message_templates`;

    console.log("Action:", action, "User:", user.id ?? "cron", "Role:", role);

    // ── LIST: List all templates ──
    if (action === "list") {
      const res = await fetch(`${metaUrl}?limit=100&access_token=${waToken}`);
      const data = await res.json();

      if (!res.ok) {
        return new Response(JSON.stringify({ error: data?.error?.message || "Meta API error" }), {
          status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const templates = (data.data || []).map((t: any) => ({
        id: t.id,
        name: t.name,
        status: normalizeTemplateStatus(t.status),
        category: t.category,
        language: t.language,
        components: t.components,
      }));

      const visibility = await registerApprovedTemplateVisibilityRows(adminClient, templates);

      return new Response(JSON.stringify({ templates, visibility_registered: visibility.registered, visibility_warning: visibility.warning }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── CREATE: Create a new template ──
    if (action === "create") {
      const {
        name, category, language, body_text,
        header_format, header_text, header_example, header_handle,
        body_examples, footer_text, buttons,
      } = body;

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

      const res = await fetch(`${metaUrl}?access_token=${waToken}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
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
          created_by: userId,
          submitted_at: new Date().toISOString(),
          status_updated_at: new Date().toISOString(),
        }, { onConflict: "name,language" });
      if (upsertErr) console.error("whatsapp_templates upsert failed:", upsertErr.message);

      return new Response(JSON.stringify({ success: true, ...result }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── SYNC: Reconcile local rows with Meta's current template state ──
    if (action === "sync") {
      const res = await fetch(
        `${metaUrl}?fields=id,name,status,category,language,components,quality_score&limit=200&access_token=${waToken}`
      );
      const data = await res.json();
      if (!res.ok) {
        return new Response(JSON.stringify({ error: data?.error?.message || "Meta API error" }), {
          status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const rows = (data.data || []).map((t: any) => {
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
          status_updated_at: new Date().toISOString(),
        };
      });

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
        visibility_registered: visibility.registered,
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
        const search = new URLSearchParams({ ...params, access_token: waToken });
        const res = await fetch(`${metaUrl}?${search.toString()}`, { method: "DELETE" });
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
    console.error("WhatsApp templates error:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
