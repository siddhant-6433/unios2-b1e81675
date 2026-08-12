// Per-call Gemini token attribution.
//
// Every generateContent response carries usageMetadata for free; nothing in
// this repo was reading it, so "which function is spending?" was a guess.
// Call logGeminiUsage() after each response and the answer becomes a query.
//
// ponytail: fire-and-forget insert, no batching/queue. A dropped usage row is
// worth less than the request it describes. Batch only if the insert ever
// shows up in latency.

export interface GeminiUsage {
  promptTokenCount?: number;
  candidatesTokenCount?: number;
  thoughtsTokenCount?: number;
  totalTokenCount?: number;
}

/**
 * Record one Gemini call's token usage.
 *
 * @param source  Edge function name — the attribution key. Keep it stable.
 * @param model   Model id actually called.
 * @param data    Parsed generateContent response (or anything with usageMetadata).
 */
export function logGeminiUsage(
  source: string,
  model: string,
  data: { usageMetadata?: GeminiUsage } | null | undefined,
): void {
  const u = data?.usageMetadata;
  if (!u) return;

  const prompt = u.promptTokenCount ?? 0;
  const output = u.candidatesTokenCount ?? 0;
  const thoughts = u.thoughtsTokenCount ?? 0;

  // Always visible in edge logs even if the insert fails.
  console.log(
    `[gemini-usage] ${source} ${model} prompt=${prompt} output=${output} thoughts=${thoughts}`,
  );

  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) return;

  fetch(`${url}/rest/v1/gemini_usage_log`, {
    method: "POST",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
    body: JSON.stringify({
      source,
      model,
      prompt_tokens: prompt,
      output_tokens: output,
      thought_tokens: thoughts,
      total_tokens: u.totalTokenCount ?? prompt + output + thoughts,
    }),
  }).catch(() => { /* never let telemetry break the caller */ });
}
