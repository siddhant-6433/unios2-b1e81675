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

    // Auth — decode JWT and verify super_admin role
    const authHeader = req.headers.get("Authorization") || req.headers.get("authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized: no auth header" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const jwt = authHeader.replace("Bearer ", "");
    let userId: string;
    try {
      const [, payloadB64] = jwt.split(".");
      const payload = JSON.parse(atob(payloadB64.replace(/-/g, "+").replace(/_/g, "/")));
      userId = payload.sub;
      if (!userId || (payload.exp && payload.exp < Date.now() / 1000)) {
        throw new Error("Invalid or expired token");
      }
    } catch {
      return new Response(JSON.stringify({ error: "Unauthorized: invalid token" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const adminClient = createClient(supabaseUrl, serviceRoleKey);
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
      const { name, category, language, body_text, header_format, buttons } = body;

      if (!name || !body_text) {
        return new Response(JSON.stringify({ error: "name and body_text are required" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Extract {{1}}, {{2}} etc from body_text for examples
      const varMatches = body_text.match(/\{\{(\d+)\}\}/g) || [];
      const varCount = varMatches.length;
      const exampleValues = Array.from({ length: varCount }, (_, i) => `example_${i + 1}`);

      const components: any[] = [];

      // Header (optional)
      if (header_format && header_format !== "none") {
        components.push({ type: "HEADER", format: header_format.toUpperCase() });
      }

      // Body
      components.push({
        type: "BODY",
        text: body_text,
        ...(varCount > 0 ? { example: { body_text: [exampleValues] } } : {}),
      });

      // Buttons (optional)
      if (buttons && buttons.length > 0) {
        components.push({
          type: "BUTTONS",
          buttons: buttons.map((b: any) => {
            if (b.type === "URL") {
              return {
                type: "URL",
                text: b.text,
                url: b.url,
                ...(b.example ? { example: [b.example] } : {}),
              };
            }
            return { type: b.type, text: b.text };
          }),
        });
      }

      const payload = {
        name: name.toLowerCase().replace(/[^a-z0-9_]/g, "_"),
        language: language || "en",
        category: (category || "UTILITY").toUpperCase(),
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

      return new Response(JSON.stringify({ success: true, ...result }), {
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
