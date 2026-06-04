import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const liveCallBarSource = readFileSync("src/components/layout/LiveCallBar.tsx", "utf8");
const voiceAgentSource = readFileSync("voice-agent/server.ts", "utf8");
const staleLiveCallMigration = readFileSync("supabase/migrations/20260618194000_reconcile_stale_live_calls.sql", "utf8");

describe("LiveCallBar lifecycle guards", () => {
  it("uses a short stale initiated-call display cutoff", () => {
    expect(liveCallBarSource).toContain("UNCONNECTED_RING_DISPLAY_MS = 75 * 1000");
    expect(liveCallBarSource).toContain("LIVE_CALL_LOOKBACK_MS = 10 * 60 * 1000");
    expect(liveCallBarSource).not.toContain("7 * 60 * 1000");
  });

  it("reconciles stale live-call rows instead of only hiding them", () => {
    expect(liveCallBarSource).toContain('rpc("reconcile_stale_live_calls"');
    expect(staleLiveCallMigration).toContain("CREATE OR REPLACE FUNCTION public.reconcile_stale_live_calls");
    expect(staleLiveCallMigration).toContain("SECURITY DEFINER");
    expect(staleLiveCallMigration).toContain("acr.caller_user_id = v_uid");
    expect(staleLiveCallMigration).toContain("status = 'no_answer'");
    expect(staleLiveCallMigration).toContain("disposition = COALESCE(acr.disposition, 'not_answered')");
  });

  it("closes live-transfer marker rows when the voice stream ends", () => {
    expect(voiceAgentSource).toContain("closeLiveTransferMarker");
    expect(voiceAgentSource).toContain('bridgeCallUuids.add(`${callCtx.plivoCallUuid}-bridge`)');
    expect(voiceAgentSource).toContain("is_live_transfer=eq.true");
    expect(voiceAgentSource).toContain("Live transfer marker closed when AI stream ended");
  });
});
