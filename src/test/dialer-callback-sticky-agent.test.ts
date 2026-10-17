import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const server = readFileSync("voice-agent/server.ts", "utf8");
const brand = readFileSync("supabase/functions/_shared/mirai-brand.ts", "utf8");

describe("dialer callback → sticky agent, never AI", () => {
  it("treats both brand caller IDs as dialer callback numbers", () => {
    for (const n of ["918065538511", "918065535001"]) {
      expect(server).toContain(`"${n}"`);
      expect(brand).toContain(`"${n}"`);
    }
  });

  it("rings the last cloud-dialer counsellor ahead of the assigned one", () => {
    const sticky = server.indexOf("Sticky agent:");
    expect(sticky).toBeGreaterThan(-1);
    expect(sticky).toBeLessThan(server.indexOf("fn_intake_round_robin_assign"));
    expect(server).toContain("call_type=eq.manual&caller_user_id=not.is.null&order=created_at.desc");
  });

  it("never streams to Navya on a dialer callback", () => {
    expect(server).toContain('const aiHandlesFromStart = !isDialerCallback && (!counsellorPhone || !leadId);');
    expect(server).toContain('${isDialerCallback ? "?noai=1" : ""}');
    const noAiBranch = server.indexOf("if (noAi) {");
    expect(noAiBranch).toBeGreaterThan(-1);
    expect(noAiBranch).toBeLessThan(server.indexOf("// Fall through to AI voice agent"));
  });

  it("WhatsApps the sticky agent on a missed callback via the approved staff template, outside the lead thread", () => {
    const helper = server.slice(server.indexOf("function sendMissedCallbackWhatsApp"), server.indexOf("// In-memory store for active call contexts"));
    expect(helper).toContain('template_key: "counsellor_call_lead"');
    expect(helper).toContain("button_urls: [leadId]");
    expect(helper).not.toContain("lead_id:");
    expect(server.match(/if \(noAi\) sendMissedCallbackWhatsApp\(/g)?.length).toBe(2);
  });
});
