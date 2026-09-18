import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const navyaVoiceAgent = readFileSync("src/pages/admin/NavyaVoiceAgent.tsx", "utf8");
const migration = readFileSync("supabase/migrations/20260918100808_navya_auto_outreach_controls.sql", "utf8");
const leadIngest = readFileSync("supabase/functions/lead-ingest/index.ts", "utf8");
const aiReply = readFileSync("supabase/functions/whatsapp-ai-reply/index.ts", "utf8");

describe("Navya auto outreach controls", () => {
  it("exposes an admin switch for automatic outbound calls", () => {
    expect(navyaVoiceAgent).toContain("auto_outbound_calls_enabled");
    expect(navyaVoiceAgent).toContain("Automatic outbound calls");
    expect(navyaVoiceAgent).toContain("Toggle Navya automatic outbound calls");
    expect(navyaVoiceAgent).toContain("New auto-call queueing is paused and pending queued calls have been marked skipped.");
  });

  it("stores the call switch in voice_agent_settings and skips pending calls when disabled", () => {
    expect(migration).toContain("'auto_outbound_calls_enabled'");
    expect(migration).toContain("CREATE OR REPLACE FUNCTION public.set_voice_agent_settings");
    expect(migration).toContain("v_auto_calls := (_settings->>'auto_outbound_calls_enabled')::boolean");
    expect(migration).toContain("UPDATE public.ai_call_queue");
    expect(migration).toContain("SET status = 'skipped'");
    expect(migration).toContain("AND requested_by IS NULL");
    expect(migration).toContain("Skipped because Navya automatic outbound calls were disabled by admin");
  });

  it("guards automatic queue creation in database triggers and lead ingest", () => {
    expect(migration).toContain("CREATE OR REPLACE FUNCTION public.fn_auto_ai_call_new_lead");
    expect(migration).toContain("v_auto_calls_enabled");
    expect(migration).toContain("IF v_auto_calls_enabled = false THEN RETURN NEW; END IF;");
    expect(leadIngest).toContain("navyaAutoOutboundCallsEnabled");
    expect(leadIngest).toContain("skipAiCallSources.includes(leadSource) && await navyaAutoOutboundCallsEnabled(supabase)");
  });

  it("disables Navya AI auto replies for Mirai and Seralis sender channels", () => {
    expect(migration).toContain("SET allow_ai = false");
    expect(migration).toContain("1110238142172240");
    expect(migration).toContain("762544046936970");
    expect(migration).toContain("836776566178513");
    expect(migration).toContain("919220522282");
    expect(migration).toContain("919220522281");
    expect(migration).toContain("919599931471");
  });

  it("keeps explicit AI reply guards for Mirai and Seralis", () => {
    expect(aiReply).toContain("const MIRAI_PNIDS = new Set([\"1110238142172240\"])");
    expect(aiReply).toContain("mirai_channel_ai_disabled");
    expect(aiReply).toContain("const SERALIS_PNIDS = new Set([\"762544046936970\", \"836776566178513\"])");
    expect(aiReply).toContain("seralis_channel_ai_disabled");
  });
});
