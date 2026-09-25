// resume-parse — parse a candidate's resume with Gemini and store a structured
// profile + fit score on job_applicants.
//
// Auth: caller must hold hr:recruitment_edit (or be super admin).
// Body: { applicant_id }
// Stores: parsed_profile (jsonb), ai_summary, ai_rank_score, ai_parsed_at,
//         ai_parse_error.

import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (p: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(p), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const SYSTEM_PROMPT = `You screen job applications. From the candidate's resume and the role context, return ONLY a single JSON object (no prose, no markdown fences):
{
  "current_role": string | null,
  "total_experience_years": number,
  "companies": string[],
  "skills": string[],
  "education": string[],
  "location": string | null,
  "strengths": string[],
  "gaps": string[],
  "fit_score": number,      // 0-100, how well the candidate fits the role + experience band
  "summary": string         // 1-2 sentences for a recruiter
}
Rules: infer experience only from evidence; do not invent skills. fit_score should weigh the role title, the required experience band and the relevant skills. Keep arrays to the most relevant 6-10 items.`;

const mimeFor = (url: string, contentType: string | null): string => {
  const ct = (contentType || "").split(";")[0].trim();
  if (ct) return ct;
  const u = url.toLowerCase();
  if (u.endsWith(".pdf")) return "application/pdf";
  if (u.endsWith(".png")) return "image/png";
  if (u.endsWith(".jpg") || u.endsWith(".jpeg")) return "image/jpeg";
  return "application/octet-stream";
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const geminiKey = Deno.env.get("GEMINI_API_KEY") || Deno.env.get("GOOGLE_AI_API_KEY");
    const authHeader = req.headers.get("Authorization") || "";
    const caller = createClient(supabaseUrl, serviceKey, {
      global: { headers: { Authorization: authHeader } }, auth: { persistSession: false },
    });
    const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

    const { data: userData } = await caller.auth.getUser();
    const uid = userData?.user?.id;
    if (!uid) return json({ error: "Unauthorized" }, 401);
    const { data: can } = await admin.rpc("has_permission", { _user_id: uid, _perm: "hr:recruitment_edit" });
    if (!can) return json({ error: "Forbidden" }, 403);
    if (!geminiKey) return json({ error: "AI not configured (set GEMINI_API_KEY)" }, 503);

    const { applicant_id } = await req.json().catch(() => ({}));
    if (!applicant_id) return json({ error: "applicant_id required" }, 400);

    const { data: a } = await admin
      .from("job_applicants")
      .select("id, name, desired_role, resume_url, job_opening_id, job_openings(title, description, experience_min_years, experience_max_years)")
      .eq("id", applicant_id).maybeSingle();
    if (!a) return json({ error: "Applicant not found" }, 404);
    if (!a.resume_url) return json({ error: "No resume on file" }, 400);

    const opening = (a as unknown as { job_openings?: { title?: string; description?: string; experience_min_years?: number; experience_max_years?: number } | null }).job_openings;
    const roleContext = [
      `Role: ${opening?.title || a.desired_role || "unspecified"}`,
      opening?.experience_min_years != null || opening?.experience_max_years != null
        ? `Experience band: ${opening?.experience_min_years ?? 0}-${opening?.experience_max_years ?? "?"} years`
        : "",
      opening?.description ? `Description: ${String(opening.description).slice(0, 1500)}` : "",
      `Candidate name: ${a.name || "unknown"}`,
    ].filter(Boolean).join("\n");

    // Fetch the resume.
    const res = await fetch(a.resume_url);
    if (!res.ok) {
      await admin.from("job_applicants").update({ ai_parse_error: `resume fetch ${res.status}` }).eq("id", applicant_id);
      return json({ error: "Could not fetch resume" }, 400);
    }
    const mime = mimeFor(a.resume_url, res.headers.get("content-type"));
    const buf = new Uint8Array(await res.arrayBuffer());

    const parts: Array<Record<string, unknown>> = [{ text: roleContext }];
    const isText = mime.startsWith("text/") || mime === "application/json";
    if (isText) {
      parts.push({ text: `Resume:\n${new TextDecoder().decode(buf).slice(0, 40000)}` });
    } else if (mime === "application/pdf" || mime.startsWith("image/")) {
      let bin = "";
      for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode.apply(null, Array.from(buf.subarray(i, i + 0x8000)));
      parts.push({ inline_data: { mime_type: mime, data: btoa(bin) } });
    } else {
      return json({ error: `Unsupported resume type: ${mime}` }, 415);
    }

    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
          contents: [{ role: "user", parts }],
          generationConfig: {
            temperature: 0.1, maxOutputTokens: 2048,
            thinkingConfig: { thinkingBudget: 0 },
            responseMimeType: "application/json",
          },
        }),
      },
    );
    if (!geminiRes.ok) {
      const detail = (await geminiRes.text()).slice(0, 500);
      await admin.from("job_applicants").update({ ai_parse_error: `gemini ${geminiRes.status}` }).eq("id", applicant_id);
      return json({ error: "AI parse failed", detail }, 502);
    }
    const gdata = await geminiRes.json();
    const rawText = gdata?.candidates?.[0]?.content?.parts?.[0]?.text || "";
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(rawText);
    } catch {
      await admin.from("job_applicants").update({ ai_parse_error: "unparseable AI response" }).eq("id", applicant_id);
      return json({ error: "AI returned an unparseable response" }, 502);
    }

    const score = Number(parsed.fit_score);
    await admin.from("job_applicants").update({
      parsed_profile: parsed,
      ai_summary: typeof parsed.summary === "string" ? parsed.summary : null,
      ai_rank_score: Number.isFinite(score) ? Math.max(0, Math.min(100, score)) : null,
      ai_parsed_at: new Date().toISOString(),
      ai_parse_error: null,
    }).eq("id", applicant_id);

    return json({ ok: true, rank_score: parsed.fit_score ?? null, summary: parsed.summary ?? null, profile: parsed });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
