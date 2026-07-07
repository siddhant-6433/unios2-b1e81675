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
  if (!["super_admin", "campus_admin", "admission_head", "counsellor"].includes(roleName || "")) {
    return { ok: false, userId: user.id, role: roleName, error: "Forbidden", status: 403 };
  }
  return { ok: true, userId: user.id, role: roleName };
}

async function ingestReplyExample(
  admin: ReturnType<typeof createClient>,
  reply: {
    id: string;
    lead_id: string | null;
    phone: string | null;
    content: string | null;
    created_at: string;
    sender_user_id: string | null;
  },
): Promise<"inserted" | "skipped"> {
  const replyText = redactForLearning(reply.content);
  if (!isUsefulReply(replyText)) return "skipped";

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
  if (queryText.length < 5) return "skipped";

  let courseId: string | null = null;
  if (reply.lead_id) {
    const { data: lead } = await admin
      .from("leads")
      .select("course_id")
      .eq("id", reply.lead_id)
      .maybeSingle();
    courseId = lead?.course_id || null;
  }

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
      tags: courseId ? ["manual_reply", "corrected_reply", "course_scoped"] : ["manual_reply", "corrected_reply"],
      status: "needs_review",
      review_reason: "manual_or_corrected_whatsapp_reply",
      quality_score: 0.5,
      updated_at: new Date().toISOString(),
    }, { onConflict: "source_message_id" });

  if (upsertError) throw upsertError;
  return "inserted";
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
    if (!["ingest_recent", "ingest_message", "review_example", "answer_gap", "add_golden_answer", "ingest_ai_verified"].includes(action)) {
      return new Response(JSON.stringify({ error: "Unsupported action" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── answer_gap: admin answers a knowledge gap → auto-ingest as learning example ──
    if (action === "answer_gap") {
      if (auth.role !== "service_role" && auth.role !== "super_admin" && auth.role !== "admission_head") {
        return new Response(JSON.stringify({ error: "Forbidden" }), {
          status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const gapId = String(body.gap_id || "");
      const answerText = String(body.answer_text || "").trim();
      if (!gapId || answerText.length < 20) {
        return new Response(JSON.stringify({ error: "gap_id and answer_text (min 20 chars) required" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const { data: gap, error: gapErr } = await admin
        .from("knowledge_gaps")
        .select("id, query_text, context, source")
        .eq("id", gapId)
        .maybeSingle();
      if (gapErr || !gap) {
        return new Response(JSON.stringify({ error: "Knowledge gap not found" }), {
          status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      await admin.from("knowledge_gaps").update({
        status: "answered",
        answer_text: answerText,
        answered_by: auth.userId,
        answered_at: new Date().toISOString(),
      }).eq("id", gapId);

      let courseId: string | null = null;
      const courseName = (gap.context as Record<string, unknown>)?.course;
      if (courseName && typeof courseName === "string" && courseName !== "unknown") {
        const { data: course } = await admin
          .from("courses")
          .select("id")
          .ilike("name", `%${courseName}%`)
          .limit(1)
          .maybeSingle();
        courseId = course?.id || null;
      }

      const { data: example, error: exErr } = await admin
        .from("admissions_ai_reply_examples")
        .insert({
          query_text: gap.query_text,
          reply_text: redactForLearning(answerText),
          course_id: courseId,
          counsellor_id: auth.userId,
          source_channel: gap.source || "whatsapp",
          target_channels: ["whatsapp", "voice"],
          language: detectLanguage(`${gap.query_text} ${answerText}`),
          tags: ["knowledge_gap_answer", "admin_verified"],
          status: "active",
          quality_score: body.quality_score ?? 0.90,
          review_reason: "answered_knowledge_gap",
          reviewed_by: auth.userId,
          reviewed_at: new Date().toISOString(),
        })
        .select("id")
        .maybeSingle();

      if (exErr) throw exErr;
      return new Response(JSON.stringify({ ok: true, gap_id: gapId, example_id: example?.id }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── add_golden_answer: admin provides a model answer for any query ──
    if (action === "add_golden_answer") {
      if (auth.role !== "service_role" && auth.role !== "super_admin" && auth.role !== "admission_head") {
        return new Response(JSON.stringify({ error: "Forbidden" }), {
          status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const queryText = String(body.query_text || "").trim();
      const answerText = String(body.answer_text || "").trim();
      if (queryText.length < 5 || answerText.length < 20) {
        return new Response(JSON.stringify({ error: "query_text (min 5 chars) and answer_text (min 20 chars) required" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const courseId = body.course_id || null;
      const userTags = Array.isArray(body.tags) ? body.tags.filter((t: unknown) => typeof t === "string") : [];

      const { data: example, error: exErr } = await admin
        .from("admissions_ai_reply_examples")
        .insert({
          query_text: redactForLearning(queryText),
          reply_text: redactForLearning(answerText),
          course_id: courseId,
          counsellor_id: auth.userId,
          source_channel: "admin_override",
          target_channels: ["whatsapp", "voice"],
          language: detectLanguage(`${queryText} ${answerText}`),
          tags: ["golden_answer", "admin_verified", ...userTags],
          status: "active",
          quality_score: body.quality_score ?? 0.95,
          review_reason: "admin_golden_answer",
          reviewed_by: auth.userId,
          reviewed_at: new Date().toISOString(),
        })
        .select("id")
        .maybeSingle();

      if (exErr) throw exErr;

      // Auto-close matching pending knowledge gaps
      await admin
        .from("knowledge_gaps")
        .update({
          status: "answered",
          answer_text: answerText,
          answered_by: auth.userId,
          answered_at: new Date().toISOString(),
        })
        .eq("status", "pending")
        .textSearch("query_text", queryText.split(/\s+/).filter((w: string) => w.length > 2).slice(0, 5).join(" & "), { type: "plain" });

      return new Response(JSON.stringify({ ok: true, example_id: example?.id }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── ingest_ai_verified: ingest AI replies that got positive implicit feedback ──
    if (action === "ingest_ai_verified") {
      if (auth.role !== "service_role" && auth.role !== "super_admin" && auth.role !== "admission_head") {
        return new Response(JSON.stringify({ error: "Forbidden" }), {
          status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const days = Math.min(Math.max(Number(body.days || 30), 1), 180);
      const limit = Math.min(Math.max(Number(body.limit || 100), 1), MAX_EXAMPLES_PER_RUN);
      const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

      const { data: aiReplies, error: aiErr } = await admin
        .from("whatsapp_messages")
        .select("id, lead_id, phone, content, created_at, sender_user_id")
        .eq("direction", "outbound")
        .eq("template_key", "ai_auto_reply")
        .eq("ai_feedback", "helpful")
        .gte("created_at", since)
        .order("created_at", { ascending: false })
        .limit(limit);

      if (aiErr) throw aiErr;

      let considered = 0;
      let inserted = 0;
      let skipped = 0;

      for (const reply of aiReplies || []) {
        considered += 1;
        const replyText = redactForLearning(reply.content);
        if (!isUsefulReply(replyText)) { skipped += 1; continue; }

        const phone = digits(reply.phone);
        const { data: inboundRows } = await admin
          .from("whatsapp_messages")
          .select("content")
          .eq("phone", phone || reply.phone)
          .eq("direction", "inbound")
          .lt("created_at", reply.created_at)
          .order("created_at", { ascending: false })
          .limit(1);

        const queryText = redactForLearning(inboundRows?.[0]?.content);
        if (queryText.length < 5) { skipped += 1; continue; }

        let courseId: string | null = null;
        if (reply.lead_id) {
          const { data: lead } = await admin.from("leads").select("course_id").eq("id", reply.lead_id).maybeSingle();
          courseId = lead?.course_id || null;
        }

        const { error: upsertErr } = await admin
          .from("admissions_ai_reply_examples")
          .upsert({
            source_message_id: reply.id,
            lead_id: reply.lead_id || null,
            course_id: courseId,
            source_channel: "whatsapp",
            target_channels: ["whatsapp", "voice"],
            phone,
            query_text: queryText,
            reply_text: replyText,
            language: detectLanguage(`${queryText} ${replyText}`),
            tags: courseId ? ["ai_verified", "course_scoped"] : ["ai_verified"],
            status: "needs_review",
            review_reason: "ai_reply_with_positive_feedback",
            quality_score: 0.6,
            updated_at: new Date().toISOString(),
          }, { onConflict: "source_message_id" });

        if (upsertErr) { console.error("AI verified upsert error:", upsertErr.message); skipped += 1; }
        else inserted += 1;
      }

      return new Response(JSON.stringify({ ok: true, considered, inserted, skipped, days, limit }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "review_example") {
      if (auth.role !== "service_role" && auth.role !== "super_admin" && auth.role !== "admission_head") {
        return new Response(JSON.stringify({ error: "Forbidden" }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const exampleId = String(body.example_id || body.id || "");
      const decision = String(body.decision || "");
      if (!exampleId || !["approve", "reject"].includes(decision)) {
        return new Response(JSON.stringify({ error: "example_id and decision=approve|reject are required" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const { data, error } = await admin.rpc("review_admissions_ai_reply_example", {
        p_example_id: exampleId,
        p_decision: decision,
        p_quality_score: body.quality_score ?? null,
        p_reviewer_note: body.reviewer_note || null,
      });
      if (error) throw error;
      return new Response(JSON.stringify({ ok: true, example: data }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "ingest_message") {
      const messageId = String(body.message_id || "");
      if (!messageId) {
        return new Response(JSON.stringify({ error: "message_id is required" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const { data: reply, error: replyError } = await admin
        .from("whatsapp_messages")
        .select("id, lead_id, phone, content, created_at, sender_user_id, direction, template_key")
        .eq("id", messageId)
        .maybeSingle();
      if (replyError) throw replyError;
      if (!reply || reply.direction !== "outbound" || reply.template_key !== "manual_reply") {
        return new Response(JSON.stringify({ ok: true, inserted: 0, skipped: 1, reason: "not_manual_reply" }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (auth.role === "counsellor" && reply.sender_user_id && reply.sender_user_id !== auth.userId) {
        return new Response(JSON.stringify({ error: "Forbidden" }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const outcome = await ingestReplyExample(admin, reply);
      return new Response(JSON.stringify({
        ok: true,
        considered: 1,
        inserted: outcome === "inserted" ? 1 : 0,
        skipped: outcome === "skipped" ? 1 : 0,
      }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (auth.role !== "service_role" && auth.role !== "super_admin" && auth.role !== "admission_head") {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403,
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
      const outcome = await ingestReplyExample(admin, reply);
      if (outcome === "inserted") inserted += 1;
      else skipped += 1;
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
