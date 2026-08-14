import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

// The Gemini selector moved out of AdminPanel into its own Navya page.
const navyaVoiceAgent = readFileSync("src/pages/admin/NavyaVoiceAgent.tsx", "utf8");
const voiceAgent = readFileSync("voice-agent/server.ts", "utf8");
const guardMigration = readFileSync(
  "supabase/migrations/20260624120000_block_flash_live_voice_model.sql",
  "utf8",
);

describe("voice agent Gemini model guardrails", () => {
  it("does not expose flash-live-preview models in the admin selector", () => {
    const modelList = navyaVoiceAgent.slice(
      navyaVoiceAgent.indexOf("const GEMINI_MODELS = ["),
      navyaVoiceAgent.indexOf("] as const;", navyaVoiceAgent.indexOf("const GEMINI_MODELS = [")),
    );

    expect(modelList).toContain("gemini-2.5-flash-native-audio-latest");
    expect(modelList).not.toContain("flash-live-preview");
  });

  it("coerces unsafe stored Gemini model values before opening Gemini Live", () => {
    expect(voiceAgent).toContain("function normalizeGeminiAudioModel");
    expect(voiceAgent).toContain("SAFE_GEMINI_AUDIO_MODELS");
    expect(voiceAgent).toContain("normalizeGeminiAudioModel(parsed.gemini_model)");
  });

  it("heals production config and rejects flash-live-preview in the settings RPC", () => {
    expect(guardMigration).toContain("UPDATE public._app_config");
    expect(guardMigration).toContain("CREATE OR REPLACE FUNCTION public.set_voice_agent_settings");
    expect(guardMigration).toContain("gemini_model invalid for native audio path");

    const rpcAllowlist = guardMigration.slice(
      guardMigration.indexOf("IF _settings ? 'gemini_model' THEN"),
      guardMigration.indexOf("IF _settings ? 'gemini_prefix_padding_ms' THEN"),
    );

    expect(rpcAllowlist).toContain("gemini-2.5-flash-native-audio-preview-09-2025");
    expect(rpcAllowlist).not.toContain("flash-live-preview");
  });
});
