import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const MIN_REPLY_LENGTH = 35;
const MAX_EXAMPLES_PER_RUN = 500;

function digits(value: string | null | undefined): string {
  return (value || "").replace(/[^0-9]/g, "");
}

function redactForLearning(value: string | null | undefined): string {
  return (value || "")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email]")
    .replace(/\+?\d[\d\s().-]{8,}\d/g, "[phone]")
    .replace(/\s+/g, " ")
    .trim();
}

function isUsefulReply(text: string): boolean {
  const normalized = text.toLowerCase().trim();
  if (normalized.length < MIN_REPLY_LENGTH) return false;
  if (/^(ok|okay|yes|no|done|sent|shared|thanks?|thank you|call me)$/i.test(normalized)) return false;
  if (/(^|\s)(stop|dnc|do not contact|not interested)(\s|$)/i.test(normalized)) return false;
  if ((normalized.match(/https?:\/\//g) || []).length > 2 && normalized.length < 100) return false;
  return true;
}

function detectLanguage(text: string): string {
  if (/[\u0900-\u097F]/.test(text)) return "hi";
  if (/\b(kya|hai|hain|nahi|karna|fees|admission|course|aap|ka|ki|ke)\b/i.test(text)) return "hinglish";
  return "en";
}

async function userRole(
  admin: ReturnType<typeof createClient>,
  authHeader: string,
  serviceRoleKey: string,
): Promise<{ ok: boolean; userId: string | null; role: string | null; error?: string; status?: number }> {
  if (authHeader === `Bearer ${serviceRoleKey}`) {
    return { ok: true, userId: null, role: "service_role" };
  }

  if (!authHeader) return { ok: false, userId: null, role: null, error: "Unauthorized", status: 401 };

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user }, error } = await userClient.auth.getUser();
  if (error || !user) return { ok: false, userId: null, role: null, error: "Unauthorized", status: 401 };

  const { data: role } = await admin.rpc("get_user_role", { _user_id: user.id });
  const roleName = typeof role === "string" ? role : null;
  if (roleName !== "super_admin" && roleName !== "admission_head") {
    return { ok: false, userId: user.id, role: roleName, error: "Forbidden", status: 403 };
  }
  return { ok: true, userId: user.id, role: roleName };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(supabaseUrl, serviceRoleKey);
    const authHeader = req.headers.get("Authorization") || req.headers.get("authorization") || "";
    const auth = await userRole(admin, authHeader, serviceRoleKey);
    if (!auth.ok) {
      return new Response(JSON.stringify({ error: auth.error || "Unauthorized" }), {
        status: auth.status || 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json().catch(() => ({}));
    const action = body.action || "ingest_recent";
    if (action !== "ingest_recent") {
      return new Response(JSON.stringify({ error: "Unsupported action" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const days = Math.min(Math.max(Number(body.days || 30), 1), 180);
    const limit = Math.min(Math.max(Number(body.limit || 200), 1), MAX_EXAMPLES_PER_RUN);
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

    const { data: replies, error: repliesError } = await admin
      .from("whatsapp_messages")
      .select("id, lead_id, phone, content, created_at, sender_user_id")
      .eq("direction", "outbound")
      .eq("template_key", "manual_reply")
      .not("sender_user_id", "is", null)
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (repliesError) throw repliesError;

    let considered = 0;
    let inserted = 0;
    let skipped = 0;

    for (const reply of replies || []) {
      considered += 1;
      const replyText = redactForLearning(reply.content);
      if (!isUsefulReply(replyText)) {
        skipped += 1;
        continue;
      }

      const phone = digits(reply.phone);
      const { data: inboundRows } = await admin
        .from("whatsapp_messages")
        .select("content, created_at")
        .eq("phone", phone || reply.phone)
        .eq("direction", "inbound")
        .lt("created_at", reply.created_at)
        .order("created_at", { ascending: false })
        .limit(1);

      const queryText = redactForLearning(inboundRows?.[0]?.content);
      if (queryText.length < 5) {
        skipped += 1;
        continue;
      }

      let courseId: string | null = null;
      if (reply.lead_id) {
        const { data: lead } = await admin
        .from("leads")
          .select("course_id")
          .eq("id", reply.lead_id)
          .maybeSingle();
        courseId = lead?.course_id || null;
      }

      const status = replyText.length >= 55 && queryText.length >= 8 ? "active" : "needs_review";
      const { error: upsertError } = await admin
        .from("admissions_ai_reply_examples")
        .upsert({
          source_message_id: reply.id,
          lead_id: reply.lead_id || null,
          course_id: courseId,
          counsellor_id: reply.sender_user_id || null,
          source_channel: "whatsapp",
          target_channels: ["whatsapp", "voice"],
          phone,
          query_text: queryText,
          reply_text: replyText,
          language: detectLanguage(`${queryText} ${replyText}`),
          tags: courseId ? ["manual_reply", "course_scoped"] : ["manual_reply"],
          status,
          quality_score: status === "active" ? 0.7 : 0.5,
          updated_at: new Date().toISOString(),
        }, { onConflict: "source_message_id" });

      if (upsertError) throw upsertError;
      inserted += 1;
    }

    return new Response(JSON.stringify({ ok: true, considered, inserted, skipped, days, limit }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("whatsapp-reply-learning error:", message);
    return new Response(JSON.stringify({ error: message || "Reply learning failed" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
