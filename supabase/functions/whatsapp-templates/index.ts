/**
 * WhatsApp Templates Management
 * ─────────────────────────────────────────────────────────────
 * Proxies Meta Graph API for WhatsApp template CRUD.
 * GET  — list all templates with status
 * POST — create/submit a new template for approval
 * DELETE — delete a template
 *
 * Auth: requires authenticated user with super_admin role.
 */

import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

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

    // Auth — verify JWT with Supabase Auth, then verify super_admin role
    const authHeader = req.headers.get("Authorization") || req.headers.get("authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized: no auth header" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const jwt = authHeader.replace(/^Bearer\s+/i, "");
    const { data: authData, error: authError } = await adminClient.auth.getUser(jwt);
    const userId = authData.user?.id;
    if (authError || !userId) {
      return new Response(JSON.stringify({ error: "Unauthorized: invalid token" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: role } = await adminClient.rpc("get_user_role", { _user_id: userId });
    if (role !== "super_admin") {
      return new Response(JSON.stringify({ error: "Forbidden: super_admin only" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const user = { id: userId };

    const metaUrl = `https://graph.facebook.com/v21.0/${wabaId}/message_templates`;

    let body: any = {};
    try { body = await req.json(); } catch { body = {}; }
    const action = body.action || "list";
    console.log("Action:", action, "User:", user.id, "Role:", role);

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
        status: t.status,
        category: t.category,
        language: t.language,
        components: t.components,
      }));

      return new Response(JSON.stringify({ templates }), {
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
          status: (t.status || "PENDING").toUpperCase(),
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
          return new Response(JSON.stringify({ error: syncErr.message }), {
            status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      }

      return new Response(JSON.stringify({ success: true, synced: rows.length }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── DELETE: Delete a template ──
    if (action === "delete") {
      const { name } = body;
      if (!name) {
        return new Response(JSON.stringify({ error: "name is required" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const res = await fetch(
        `${metaUrl}?name=${encodeURIComponent(name)}&access_token=${waToken}`,
        { method: "DELETE" }
      );
      const result = await res.json();

      if (!res.ok) {
        return new Response(JSON.stringify({ error: result?.error?.message || "Delete failed" }), {
          status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      return new Response(JSON.stringify({ success: true }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
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
