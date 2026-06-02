import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const serverSource = readFileSync("voice-agent/server.ts", "utf8");

describe("voice-agent bridge-hangup Cloud Dialer call logging", () => {
  it("attributes auto-created call_logs rows to cloud_dialer", () => {
    const bridgeHangup = serverSource.slice(
      serverSource.indexOf('if (path.startsWith("/bridge-hangup/"))'),
      serverSource.indexOf("// WebSocket upgrade for Plivo audio stream"),
    );

    const rpcPayloads = [
      ...bridgeHangup.matchAll(/rpc\/record_cloud_call_log[\s\S]*?body: JSON\.stringify\((\{[\s\S]*?\})\)/g),
    ].map((match) => match[1]);

    expect(rpcPayloads).toHaveLength(2);
    for (const payload of rpcPayloads) {
      expect(payload).toMatch(/p_call_source:\s+"cloud_dialer"/);
    }
  });
});
