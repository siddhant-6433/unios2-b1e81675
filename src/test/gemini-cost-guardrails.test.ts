import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

// Regression guards for the Gemini spend cuts. Each of these was a real,
// measured cost leak — the test exists so a future edit can't silently
// reintroduce it.

const callback = readFileSync("supabase/functions/voice-call-callback/index.ts", "utf8");
const waReply = readFileSync("supabase/functions/whatsapp-ai-reply/index.ts", "utf8");
const faceMatch = readFileSync("supabase/functions/face-match/index.ts", "utf8");
const copilot = readFileSync("supabase/functions/whatsapp-copilot-assist/index.ts", "utf8");
const webChat = readFileSync("web-chat-server/server.ts", "utf8");
const voiceAgent = readFileSync("voice-agent/server.ts", "utf8");
const migration = readFileSync(
  "supabase/migrations/20260806130230_gemini_usage_log_and_transcribe_attempts.sql",
  "utf8",
);

/** Every generationConfig block in a file must disable thinking. */
function everyGenerationConfigDisablesThinking(source: string): boolean {
  const blocks = source.split("generationConfig:").slice(1);
  return blocks.length > 0 && blocks.every((block) =>
    // thinkingConfig should appear before the block's config object closes.
    block.slice(0, 400).includes("thinkingBudget: 0")
  );
}

describe("Gemini cost guardrails", () => {
  it("keeps call transcription off the premium reasoning model", () => {
    expect(callback).toContain("models/gemini-2.5-flash:generateContent");
    expect(callback).not.toContain("gemini-3-flash-preview");
  });

  it("disables thinking on every extraction/reply call site", () => {
    // Thinking bills at the output rate and buys nothing on these tasks.
    for (const [name, src] of Object.entries({ callback, waReply, faceMatch, copilot, webChat })) {
      expect(everyGenerationConfigDisablesThinking(src), `${name} has a thinking-enabled call`).toBe(true);
    }
  });

  it("disables thinking on the latency-critical mid-call cascade", () => {
    const cascadeBlocks = voiceAgent.split("temperature: cascadeSettings.cascadeTemperature").slice(1);
    expect(cascadeBlocks.length).toBe(2);
    for (const block of cascadeBlocks) {
      expect(block.slice(0, 400)).toContain("thinkingBudget: 0");
    }
  });

  it("does not transcribe recordings too short to contain a conversation", () => {
    expect(callback).toContain("const MIN_TRANSCRIBABLE_SECONDS = 30");
    // A null/0 duration must be treated as untranscribable, not as a bypass.
    // The old `durationSeconds > 0` condition let unknown durations through.
    expect(callback).not.toMatch(/durationSeconds > 0 && durationSeconds < MIN_TRANSCRIBABLE_SECONDS/);
    expect(callback).toContain("dur < MIN_TRANSCRIBABLE_SECONDS");
  });

  it("caps transcription retries so failures cannot loop forever", () => {
    expect(callback).toContain("MAX_TRANSCRIBE_ATTEMPTS");
    expect(callback).toContain('.lt("transcribe_attempts", MAX_TRANSCRIBE_ATTEMPTS)');
    // The attempt must be counted before the billed call, not after.
    const scan = callback.slice(callback.indexOf("TRANSCRIBE SCAN"));
    expect(scan.indexOf("transcribe_attempts:")).toBeLessThan(scan.indexOf("await transcribeAndSummarize"));
    expect(migration).toContain("ADD COLUMN IF NOT EXISTS transcribe_attempts");
  });

  it("attributes token usage per call site", () => {
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS public.gemini_usage_log");
    expect(migration).toContain("GRANT SELECT, INSERT ON public.gemini_usage_log TO service_role");
    expect(callback).toContain('logGeminiUsage("voice-call-callback"');
    expect(waReply).toContain('logGeminiUsage("whatsapp-ai-reply"');
    // The Live path is the biggest spender — it must report too.
    expect(voiceAgent).toContain('source: "voice-agent-live"');
    expect(voiceAgent).toContain("callCtx.lastUsageMetadata = msg.usageMetadata");
  });
});
