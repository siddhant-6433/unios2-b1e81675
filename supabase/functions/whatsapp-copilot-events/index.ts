import { createClient } from "npm:@supabase/supabase-js@2";
import { agUiSse, type AgUiEvent } from "../_shared/copilotkit-agui.ts";
import { digits } from "../_shared/whatsapp-channel.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function isServiceRole(req: Request): boolean {
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const auth = req.headers.get("Authorization") || "";
  return !!serviceRoleKey && auth === `Bearer ${serviceRoleKey}`;
}

function parseRequestUrl(req: Request): URL {
  try {
    return new URL(req.url);
  } catch {
    return new URL("http://localhost");
  }
}

function isAgUiTrace(value: unknown): value is { events: AgUiEvent[] } {
  if (!value || typeof value !== "object") return false;
  const record = value as { protocol?: unknown; events?: unknown };
  return record.protocol === "ag-ui" && Array.isArray(record.events);
}

type AutomationEventRow = {
  id: string;
  created_at: string;
  phone: string;
  business_number: string | null;
  provider: string | null;
  lead_id: string | null;
  decision: string | null;
  reason: string | null;
  confidence: number | null;
  metadata: { copilotkit?: unknown } | null;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (!isServiceRole(req)) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(supabaseUrl, serviceRoleKey);
  const url = parseRequestUrl(req);
  const body = req.method === "POST"
    ? await req.json().catch((): Record<string, unknown> => ({}))
    : {};

  const phone = digits(String(body.phone || url.searchParams.get("phone") || ""));
  const businessNumberRaw = String(body.business_number || url.searchParams.get("business_number") || "");
  const businessNumber = businessNumberRaw ? digits(businessNumberRaw) || businessNumberRaw : null;
  const limit = Math.min(
    Number(body.limit || url.searchParams.get("limit") || 10) || 10,
    50,
  );

  if (!phone) {
    return new Response(JSON.stringify({ error: "phone required" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let query = admin
    .from("whatsapp_automation_events")
    .select("id,created_at,phone,business_number,provider,lead_id,event_type,decision,reason,confidence,metadata")
    .eq("phone", phone)
    .eq("event_type", "ai_reply_sent")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (businessNumber) query = query.eq("business_number", businessNumber);

  const { data, error } = await query;
  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const runs = ((data || []) as AutomationEventRow[])
    .map((row) => ({
      id: row.id,
      created_at: row.created_at,
      phone: row.phone,
      business_number: row.business_number,
      provider: row.provider,
      lead_id: row.lead_id,
      decision: row.decision,
      reason: row.reason,
      confidence: row.confidence,
      copilotkit: isAgUiTrace(row.metadata?.copilotkit) ? row.metadata.copilotkit : null,
    }))
    .filter((row) => row.copilotkit);

  const events = runs.flatMap((row) => row.copilotkit?.events || []);
  const wantsSse = (req.headers.get("accept") || "").includes("text/event-stream")
    || url.searchParams.get("format") === "sse";

  if (wantsSse) {
    return new Response(agUiSse(events), {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  }

  return new Response(JSON.stringify({ ok: true, runs, events }), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
