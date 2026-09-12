import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { formatWhatsAppPreview } from "@/hooks/useLeadWhatsAppPreview";
import { readMigration } from "./readMigration";

const leadLists = readFileSync("src/pages/LeadLists.tsx", "utf8");
const dialer = readFileSync("src/pages/CloudDialer.tsx", "utf8");
const preview = readFileSync("src/components/dialer/DialerWhatsAppPreview.tsx", "utf8");
const hook = readFileSync("src/hooks/useLeadWhatsAppPreview.ts", "utf8");
const queueRow = readFileSync("src/components/dialer/DialerQueueRow.tsx", "utf8");

describe("assign dialog list holders", () => {
  it("loads who already holds the list even when preview RPC has no holder fields", () => {
    const migration = readMigration("preview_call_list_assignment_holders");
    expect(migration).toContain("'holders'");
    expect(migration).toContain("'unassigned'");
    expect(migration).toContain("'crm_owners'");
    expect(leadLists).toContain("Who already has these leads");
    expect(leadLists).toContain("Current CRM counsellor");
    expect(leadLists).toContain("on this list");
    expect(leadLists).toContain("fetchListAssignmentOwners");
    expect(leadLists).toContain("assignHolders");
    expect(leadLists).not.toContain("alreadyAssignedIds");
    expect(leadLists).not.toContain("Already assigned");
  });

  it("does not disable counsellors who already hold the list", () => {
    // Disabling them meant a list already with Ashraf could not be re-split
    // to include him plus two others.
    expect(leadLists).not.toContain("disabled={alreadyAssigned}");
  });
});

describe("dialer WhatsApp preview", () => {
  it("loads recent messages for the current lead only", () => {
    expect(dialer).toContain("DialerWhatsAppPreview");
    expect(preview).toContain("useLeadWhatsAppPreview");
    expect(hook).toContain(".limit(4)");
    expect(hook).toContain('queryKey: ["dialer-wa-preview"');
    expect(hook).toContain("refetchOnWindowFocus: false");
    // Queue rows must not each fetch WhatsApp — that would stall the dialer.
    expect(queueRow).not.toContain("whatsapp_messages");
    expect(queueRow).not.toContain("useLeadWhatsAppPreview");
  });

  it("falls back to template or media type when the message has no body", () => {
    expect(formatWhatsAppPreview({
      id: "1", direction: "outbound", content: null, message_type: "template",
      template_key: "course_info", created_at: "",
    })).toBe("Template: course info");
    expect(formatWhatsAppPreview({
      id: "2", direction: "inbound", content: "  hello  ", message_type: "text",
      template_key: null, created_at: "",
    })).toBe("hello");
  });
});
