import { createClient } from "npm:@supabase/supabase-js@2";
import { isCronCaller } from "../_shared/service-auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

const MIN_ANSWER_LENGTH = 35;
const MAX_RECORDING_BYTES = 20 * 1024 * 1024; // 20MB — skip anything bigger
const DEFAULT_BATCH = 5;

// Reused verbatim from whatsapp-reply-learning: same redaction + usefulness rules.
function redactForLearning(value: string | null | undefined): string {
  return (value || "")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email]")
    .replace(/\+?\d[\d\s().-]{8,}\d/g, "[phone]")
    .replace(/\s+/g, " ")
    .trim();
}

function isUsefulReply(text: string): boolean {
  const normalized = text.toLowerCase().trim();
  if (normalized.length < MIN_ANSWER_LENGTH) return false;
  if (/^(ok|okay|yes|no|done|sent|shared|thanks?|thank you|call me)$/i.test(normalized)) return false;
  if ((normalized.match(/https?:\/\//g) || []).length > 2 && normalized.length < 100) return false;
  return true;
}

function detectLanguage(text: string): string {
  if (/[ऀ-ॿ]/.test(text)) return "hi";
  if (/\b(kya|hai|hain|nahi|karna|fees|admission|course|aap|ka|ki|ke)\b/i.test(text)) return "hinglish";
  return "en";
}

const PROMPT =
  "This is a phone call between an admissions counsellor at NIMT (an Indian educational institution) and a prospective student/parent, in Hindi/Hinglish/English.\n\n" +
  "STEP 1 — identify the speakers: the COUNSELLOR is the one representing NIMT (introduces themselves as calling from NIMT, gives information about courses/fees/process). The STUDENT/PARENT is the caller asking about admission.\n\n" +
  "STEP 2 — extract knowledge pairs. A valid pair is: a question or concern voiced by the STUDENT/PARENT, answered substantively by the COUNSELLOR with reusable admissions knowledge (fees, eligibility, entrance exams, counselling rounds, hostel, placement, documents, process, scholarships, transport, course details). The answer must be self-contained — a future agent reading ONLY this pair should be able to reuse it for another student. Merge multi-turn exchanges into one clean pair.\n\n" +
  "STRICT RULES:\n" +
  "- NEVER put a counsellor's question in either field. If the counsellor asked and the student answered, that is NOT a pair — skip it.\n" +
  "- Skip pure conversational fragments (haan, ok, theek hai), confirmations, greetings, hold music, callback scheduling.\n" +
  "- Skip anything specific only to this one student (their marks, their name, their registration status) UNLESS the counsellor's answer states general policy that applies to everyone.\n" +
  "- Preserve all facts and numbers exactly. Write in the language actually spoken (Hinglish in Latin script).\n" +
  "- Redact personal names, phone numbers, emails as [name]/[phone]/[email].\n\n" +
  "Return a JSON array of {\"student_question\": string, \"counsellor_answer\": string, \"language\": \"hi\"|\"hinglish\"|\"en\"}. Quality over quantity — 2 clean reusable pairs beat 8 noisy ones. Return [] if nothing substantive.";

interface Pair {
  student_question?: unknown;
  counsellor_answer?: unknown;
  language?: unknown;
}

// Base64 without blowing the stack on large audio buffers.
function toBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function parsePairs(raw: string): Pair[] {
  // Tolerate ```json fences and stray prose around the array.
  let text = raw.trim().replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  try {
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    const start = text.indexOf("[");
    const end = text.lastIndexOf("]");
    if (start >= 0 && end > start) {
      try {
        const parsed = JSON.parse(text.slice(start, end + 1));
        return Array.isArray(parsed) ? parsed : [];
      } catch { /* fall through */ }
    }
    return [];
  }
}

/**
 * Extract Q&A pairs from either raw audio (mp3 base64) or an existing
 * transcript. Text is ~10x cheaper — always preferred when a transcript
 * exists; audio is the fallback for the ~40% of calls never transcribed.
 */
async function extractPairs(
  apiKey: string,
  input: { mp3B64: string } | { transcript: string },
): Promise<Pair[]> {
  const parts = "transcript" in input
    ? [{ text: `CALL TRANSCRIPT:\n${input.transcript}\n\n${PROMPT}` }]
    : [
        { inline_data: { mime_type: "audio/mp3", data: input.mp3B64 } },
        { text: PROMPT },
      ];
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts }],
        generationConfig: {
          temperature: 0.2,
          // 2.5-flash "thinking" consumes maxOutputTokens BEFORE the JSON is
          // emitted — with the default budget the answer came back empty on
          // every call. Disable thinking and give the JSON ample room.
          maxOutputTokens: 8192,
          responseMimeType: "application/json",
          thinkingConfig: { thinkingBudget: 0 },
        },
      }),
    },
  );
  if (!res.ok) {
    throw new Error(`Gemini ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
  const json = await res.json();
  // With multi-part responses (or if thinking sneaks in), concatenate all
  // text parts rather than reading only the first.
  const responseParts = json?.candidates?.[0]?.content?.parts || [];
  const text = responseParts.map((p: { text?: string }) => p?.text || "").join("");
  if (!text.trim()) {
    console.log(`gemini empty response; finishReason=${json?.candidates?.[0]?.finishReason || "?"}`);
  }
  return parsePairs(text);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  // Service-role only. Accept either the runtime-injected secret (new
  // sb_secret_ format) or a legacy service-role JWT (what _app_config's
  // cron pattern sends) — same dual check as voice-call/index.ts.
  const authHeader = req.headers.get("Authorization") || req.headers.get("authorization") || "";
  const token = authHeader.replace(/^Bearer\s+/i, "");
  let isServiceRole = isCronCaller(req) || token === serviceRoleKey;
  if (!isServiceRole && token.split(".").length === 3) {
    try {
      const payload = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
      isServiceRole = payload?.role === "service_role";
    } catch { /* not a JWT */ }
  }
  if (!isServiceRole) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const admin = createClient(supabaseUrl, serviceRoleKey);
    const body = await req.json().catch(() => ({}));

    const geminiKey = Deno.env.get("GOOGLE_AI_API_KEY") || Deno.env.get("GEMINI_API_KEY");
    if (!geminiKey) throw new Error("GOOGLE_AI_API_KEY / GEMINI_API_KEY not set");

    // Kill switch: run only when enabled, or on an explicit forced seed run.
    const { data: cfg } = await admin
      .from("_app_config")
      .select("value")
      .eq("key", "counsellor_miner_enabled")
      .maybeSingle();
    const enabled = cfg?.value === "true";
    const forced = body.force === true;
    if (!enabled && !forced) {
      return new Response(JSON.stringify({ skipped: true, reason: "disabled" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const limit = Math.min(Math.max(Number(body.limit) || DEFAULT_BATCH, 1), 50);

    // Claim a batch: select unmined manual recordings, then immediately stamp
    // learning_mined_at so a concurrent run can't grab the same rows.
    const { data: batch, error: batchErr } = await admin
      .from("ai_call_records")
      .select("id, lead_id, recording_url, transcript, caller_user_id, duration_seconds, leads(course_id)")
      .is("learning_mined_at", null)
      .eq("call_type", "manual")
      .eq("status", "completed")
      .not("recording_url", "is", null)
      .gte("duration_seconds", 90)
      .order("created_at", { ascending: false })
      .limit(limit);
    if (batchErr) throw batchErr;

    const records = batch || [];
    if (records.length === 0) {
      return new Response(JSON.stringify({ processed: 0, pairs_inserted: 0, skipped: 0, errors: 0 }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const ids = records.map((r) => r.id);
    const { error: claimErr } = await admin
      .from("ai_call_records")
      .update({ learning_mined_at: new Date().toISOString() })
      .in("id", ids);
    if (claimErr) throw claimErr;

    let processed = 0;
    let pairsInserted = 0;
    let skipped = 0;
    let errors = 0;
    const errorSamples: string[] = [];
    const profileIdCache = new Map<string, string | null>();

    for (const rec of records) {
      try {
        let pairs: Pair[];
        const transcript = typeof rec.transcript === "string" ? rec.transcript.trim() : "";
        if (transcript.length > 100) {
          // Text path — ~10x cheaper, no audio download.
          pairs = await extractPairs(geminiKey, { transcript });
        } else {
          // Audio path. Skip (don't fail) oversized or unreachable recordings.
          const audioRes = await fetch(rec.recording_url as string);
          if (!audioRes.ok) {
            console.log(`skip ${rec.id}: fetch ${audioRes.status}`);
            skipped += 1;
            continue;
          }
          const buf = new Uint8Array(await audioRes.arrayBuffer());
          if (buf.length > MAX_RECORDING_BYTES) {
            console.log(`skip ${rec.id}: ${buf.length} bytes > 20MB`);
            skipped += 1;
            continue;
          }
          pairs = await extractPairs(geminiKey, { mp3B64: toBase64(buf) });
        }
        processed += 1;

        // leads(course_id) comes back as an object (or null) from the join.
        const lead = rec.leads as { course_id?: string | null } | null;
        const courseId = lead?.course_id || null;

        // counsellor_id FKs profiles.id — caller_user_id is an AUTH user id.
        // Resolve via profiles (cached per run); null when no profile found.
        let counsellorProfileId: string | null = null;
        if (rec.caller_user_id) {
          if (profileIdCache.has(rec.caller_user_id)) {
            counsellorProfileId = profileIdCache.get(rec.caller_user_id) ?? null;
          } else {
            const { data: prof } = await admin
              .from("profiles").select("id").eq("user_id", rec.caller_user_id).maybeSingle();
            counsellorProfileId = (prof as { id?: string } | null)?.id ?? null;
            profileIdCache.set(rec.caller_user_id, counsellorProfileId);
          }
        }

        let insertedForRec = 0;
        for (const pair of pairs) {
          const queryText = redactForLearning(String(pair.student_question ?? ""));
          const replyText = redactForLearning(String(pair.counsellor_answer ?? ""));
          if (queryText.length < 5) { skipped += 1; continue; }
          if (!isUsefulReply(replyText)) { skipped += 1; continue; }

          const lang = ["hi", "hinglish", "en"].includes(String(pair.language))
            ? String(pair.language)
            : detectLanguage(`${queryText} ${replyText}`);

          const { error: insErr } = await admin
            .from("admissions_ai_reply_examples")
            .insert({
              lead_id: rec.lead_id || null,
              course_id: courseId,
              counsellor_id: counsellorProfileId,
              source_channel: "voice",
              target_channels: ["whatsapp", "voice"],
              query_text: queryText,
              reply_text: replyText,
              language: lang,
              tags: ["counsellor_call"],
              status: "needs_review",
              quality_score: 0.65,
            });
          if (insErr) {
            console.error(`insert ${rec.id}:`, insErr.message);
            if (errorSamples.length < 3) errorSamples.push(`insert: ${insErr.message.slice(0, 300)}`);
            errors += 1;
            continue;
          }
          insertedForRec += 1;
          pairsInserted += 1;
        }
        console.log(`call ${rec.id}: ${pairs.length} pairs -> ${insertedForRec} inserted`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`call ${rec.id} failed:`, msg);
        if (errorSamples.length < 3) errorSamples.push(msg.slice(0, 300));
        errors += 1;
      }
    }

    return new Response(
      JSON.stringify({ processed, pairs_inserted: pairsInserted, skipped, errors, claimed: records.length, error_samples: errorSamples }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("counsellor-call-miner error:", message);
    return new Response(JSON.stringify({ error: message || "Miner failed" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
