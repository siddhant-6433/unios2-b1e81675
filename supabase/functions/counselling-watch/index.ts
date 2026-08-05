// Scrapes official counselling portals (ABVMU: CAHET / CNET / UPGET) and keeps
// a short, dated brief of the live round + deadlines in counselling_sources.
// whatsapp-ai-reply and whatsapp-copilot-assist read it through
// loadVerifiedAdmissionsContext, so Navya stops answering round questions from
// a hand-maintained knowledge file.
//
// Called by pg_cron ('counselling-watch') with the service-role key.
// POST { source_key?: string, force?: boolean } to run one source on demand.
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const FETCH_TIMEOUT_MS = 20_000;
const MAX_TEXT_CHARS = 20_000;

function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_TEXT_CHARS);
}

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function summarise(source: { label: string; url: string; scope: string | null }, text: string): Promise<string> {
  const apiKey = Deno.env.get("GEMINI_API_KEY") || Deno.env.get("GOOGLE_AI_API_KEY");
  if (!apiKey) throw new Error("GEMINI_API_KEY missing");

  const today = new Date().toISOString().slice(0, 10);
  const prompt = `Today is ${today}. Below is the plain text of ${source.label} (${source.url}), the official counselling portal covering: ${source.scope || "entrance counselling"}.

Write a factual brief for an admissions assistant, max 12 bullet lines, covering ONLY what the page actually states:
- which counselling round is currently open, per exam (CAHET / CNET / UPGET) and per course where stated
- exact dates and deadlines (registration, choice filling, seat allocation, reporting) with times if given
- any notice about a schedule change
- official helpline numbers if listed

Rules: copy dates verbatim, never estimate or infer a date that is not on the page, and do not add advice or marketing. If the page states nothing about a round, write "No round information published on the page." Output plain bullet lines, no headings, no markdown bold.

PAGE TEXT:
${text}`;

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0, maxOutputTokens: 800 },
      }),
    },
  );
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const json = await res.json();
  const summary = (json?.candidates?.[0]?.content?.parts || [])
    .map((p: { text?: string }) => p.text || "")
    .join("")
    .trim();
  if (!summary) throw new Error("Gemini returned an empty summary");
  return summary;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  if ((req.headers.get("Authorization") || "") !== `Bearer ${serviceRoleKey}`) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const body = await req.json().catch(() => ({}));
  const admin = createClient(supabaseUrl, serviceRoleKey);

  let query = admin
    .from("counselling_sources")
    .select("id,source_key,label,url,scope,content_hash")
    .eq("is_active", true);
  if (body.source_key) query = query.eq("source_key", body.source_key);
  const { data: sources, error } = await query;
  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const results = [];
  for (const source of sources || []) {
    const now = new Date().toISOString();
    try {
      const res = await fetch(source.url, {
        headers: { "User-Agent": "Mozilla/5.0 (compatible; UniOsCounsellingWatch/1.0)" },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = htmlToText(await res.text());
      if (text.length < 200) throw new Error(`page text too short (${text.length} chars) — layout may have changed`);

      const hash = await sha256(text);
      if (hash === source.content_hash && !body.force) {
        await admin.from("counselling_sources")
          .update({ fetched_at: now, last_error: null })
          .eq("id", source.id);
        results.push({ source_key: source.source_key, status: "unchanged" });
        continue;
      }

      const summary = await summarise(source, text);
      await admin.from("counselling_sources")
        .update({ content_hash: hash, summary, fetched_at: now, changed_at: now, last_error: null })
        .eq("id", source.id);
      results.push({ source_key: source.source_key, status: "updated" });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // Keep the last good summary — a stale brief beats no brief, and
      // loadVerifiedAdmissionsContext drops it once it ages past its window.
      await admin.from("counselling_sources")
        .update({ fetched_at: now, last_error: message })
        .eq("id", source.id);
      results.push({ source_key: source.source_key, status: "error", error: message });
    }
  }

  return new Response(JSON.stringify({ ok: true, results }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
