import { describe, it, expect } from "vitest";
import { senderCanSendTemplate, normWaba, senderIsConnected } from "@/lib/waSenders";

// A sender can only send templates that live in its own WABA. NULL waba on
// either side normalises to "MAIN".
const sender = (wabaId: string | null, availableTemplates: string[] | null = null) =>
  ({ wabaId, availableTemplates });

describe("senderCanSendTemplate (WABA-based)", () => {
  it("allows a sender in the template's WABA", () => {
    expect(senderCanSendTemplate(sender("W1"), "t", "W1")).toBe(true);
  });

  it("blocks a sender in a different WABA", () => {
    expect(senderCanSendTemplate(sender("W1"), "t", "W2")).toBe(false);
  });

  it("treats null waba as MAIN on both sides", () => {
    expect(senderCanSendTemplate(sender(null), "t", null)).toBe(true);   // main sender + main template
    expect(senderCanSendTemplate(sender("W1"), "t", null)).toBe(false);  // seralis sender + main template
    expect(senderCanSendTemplate(sender(null), "t", "W1")).toBe(false);  // main sender + seralis template
  });

  it("falls back to availableTemplates when no template waba is supplied", () => {
    expect(senderCanSendTemplate(sender("W1", ["a"]), "a")).toBe(true);
    expect(senderCanSendTemplate(sender("W1", ["a"]), "b")).toBe(false);
    expect(senderCanSendTemplate(sender("W1", null), "b")).toBe(true);   // unverified -> allowed
  });

  it("null sender is allowed", () => {
    expect(senderCanSendTemplate(null, "t", "W1")).toBe(true);
  });

  it("normWaba maps null to MAIN", () => {
    expect(normWaba(null)).toBe("MAIN");
    expect(normWaba("W1")).toBe("W1");
  });
});

describe("senderIsConnected", () => {
  it("treats missing status as unknown and does not block", () => {
    expect(senderIsConnected(null)).toBe(true);
    expect(senderIsConnected({ connectionStatus: null })).toBe(true);
    expect(senderIsConnected({ connectionStatus: "" })).toBe(true);
  });

  it("only CONNECTED is sendable once Meta has reported status", () => {
    expect(senderIsConnected({ connectionStatus: "CONNECTED" })).toBe(true);
    expect(senderIsConnected({ connectionStatus: "connected" })).toBe(true);
    expect(senderIsConnected({ connectionStatus: "DISCONNECTED" })).toBe(false);
    expect(senderIsConnected({ connectionStatus: "UNREGISTERED" })).toBe(false);
    expect(senderIsConnected({ connectionStatus: "PENDING" })).toBe(false);
  });
});
