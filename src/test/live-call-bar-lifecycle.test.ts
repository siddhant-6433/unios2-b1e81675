import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const liveCallBarSource = readFileSync("src/components/layout/LiveCallBar.tsx", "utf8");
const voiceAgentSource = readFileSync("voice-agent/server.ts", "utf8");

describe("LiveCallBar lifecycle guards", () => {
  it("uses a short stale initiated-call display cutoff", () => {
    expect(liveCallBarSource).toContain("2 * 60 * 1000");
    expect(liveCallBarSource).not.toContain("7 * 60 * 1000");
  });

  it("closes live-transfer marker rows when the voice stream ends", () => {
    expect(voiceAgentSource).toContain("closeLiveTransferMarker");
    expect(voiceAgentSource).toContain('bridgeCallUuids.add(`${callCtx.plivoCallUuid}-bridge`)');
    expect(voiceAgentSource).toContain("is_live_transfer=eq.true");
    expect(voiceAgentSource).toContain("Live transfer marker closed when AI stream ended");
  });
});
