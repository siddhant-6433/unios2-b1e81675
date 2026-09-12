import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { formatWhatsAppPreview } from "@/hooks/useLeadWhatsAppPreview";
import { pickLatestBatchAssignees, uniqueAssigneesFromReport, uniqueLatestAssigneesByList } from "@/lib/listAssignmentOwners";
import { readMigration } from "./readMigration";

const leadLists = readFileSync("src/pages/LeadLists.tsx", "utf8");
const listOwners = readFileSync("src/lib/listAssignmentOwners.ts", "utf8");
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

  it("shows the latest Assign round-robin set, not a single member owner", () => {
    const byList = pickLatestBatchAssignees([
      { list_id: "gnm", counsellor_ids: ["ashraf"], created_at: "2026-09-01T10:00:00Z" },
      { list_id: "gnm", counsellor_ids: ["ashraf", "rahul", "niharika"], created_at: "2026-09-10T07:33:00Z" },
      { list_id: "other", counsellor_ids: ["payal"], created_at: "2026-09-11T08:00:00Z" },
    ]);
    expect(byList.get("gnm")).toEqual(["ashraf", "rahul", "niharika"]);
    expect(byList.get("other")).toEqual(["payal"]);
    expect(uniqueLatestAssigneesByList([
      { list_id: "gnm", lead_id: "l1", assigned_to: "ashraf", created_at: "2026-09-01T10:00:00Z" },
      { list_id: "gnm", lead_id: "l1", assigned_to: "rahul", created_at: "2026-09-10T07:33:00Z" },
      { list_id: "gnm", lead_id: "l2", assigned_to: "niharika", created_at: "2026-09-10T07:33:00Z" },
      { list_id: "gnm", lead_id: "l3", assigned_to: "ashraf", created_at: "2026-09-10T07:33:00Z" },
    ]).get("gnm")?.sort()).toEqual(["ashraf", "niharika", "rahul"]);
    expect(uniqueAssigneesFromReport([
      { assigned_to: "ashraf", assigned_to_name: "MD. Ashraf Ali" },
      { assigned_to: "rahul", assigned_to_name: "Rahul Bhati" },
      { assigned_to: "rahul", assigned_to_name: "Rahul Bhati" },
      { assigned_to: "niharika", assigned_to_name: "Niharika Sharma" },
    ]).map((a) => a.counsellor_name)).toEqual([
      "MD. Ashraf Ali",
      "Niharika Sharma",
      "Rahul Bhati",
    ]);
    expect(leadLists).toContain("fetchListReportAssignees");
    expect(leadLists).toContain("listAssigneesFor");
    expect(listOwners).toContain("get_lead_list_assignment_report");
    expect(listOwners).toContain("uniqueAssigneesFromReport");
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
