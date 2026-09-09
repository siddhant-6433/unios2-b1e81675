import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { cloudCallTarget as targetOf } from "@/lib/startCloudCall";
import { isContactQueueLead as isContact } from "@/lib/dialerQueue";

const dialer = readFileSync("src/pages/CloudDialer.tsx", "utf8");
const manualCall = readFileSync("supabase/functions/manual-call/index.ts", "utf8");
const server = readFileSync("voice-agent/server.ts", "utf8");
const header = readFileSync("src/components/dialer/DialerLeadHeader.tsx", "utf8");
const actions = readFileSync("src/components/dialer/DialerActionRow.tsx", "utf8");

describe("cold-call dialer (bulk-imported contacts, no lead)", () => {
  it("maps list-queue kind and member_id so contacts are not treated as leads", () => {
    expect(dialer).toContain('kind: r.kind === "contact" ? "contact" : "lead"');
    expect(dialer).toContain("member_id: r.member_id || undefined");
  });

  it("places the call with contact_id instead of looking the row up in leads", () => {
    expect(dialer).toContain("startCloudCall(cloudCallTarget(lead))");
    expect(manualCall).toContain("body.contact_id");
    expect(manualCall).toContain('.from("marketing_contacts")');
    expect(manualCall).toContain("if (leadId) callRecord.lead_id = leadId");
    expect(manualCall).toContain("else callRecord.contact_id = contactId");
    expect(manualCall).toContain("Lead not found");
  });

  it("does not write lead_activities or lead_notes for a contact-backed call", () => {
    const activityBlock = manualCall.slice(
      manualCall.indexOf("// Log activity"),
      manualCall.indexOf("return json({", manualCall.indexOf("// Log activity")),
    );
    expect(activityBlock).toContain("if (leadId)");
    expect(activityBlock).toContain('.from("lead_activities")');
  });

  it("skips list members by member_id so contact rows are skippable", () => {
    expect(dialer).toContain("p_member_id: currentLead.member_id");
    expect(dialer).toContain("cold_call_disposition");
  });

  it("hides Open Lead and lead-only actions for contacts", () => {
    expect(header).toContain('lead.kind !== "contact"');
    expect(actions).toContain('kind === "contact"');
    expect(actions).toContain('a.key !== "whatsapp"');
  });

  it("stores contactId on the bridge and writes hangup logs against it", () => {
    expect(server).toContain("contactId: ctx.contactId || undefined");
    expect(server).toContain("p_contact_id:    contactId || null");
    expect(server).toContain("if (leadId && !contactId)");
    expect(server).toContain("if (!callCtx?.leadId && !callCtx?.contactId && SUPABASE_URL)");
  });

  it("cloudCallTarget sends contactId only for contact-kind queue rows", () => {
    expect(targetOf({ id: "c1", kind: "contact" })).toEqual({ contactId: "c1" });
    expect(targetOf({ id: "l1" })).toBe("l1");
    expect(targetOf({ id: "l1", kind: "lead" })).toBe("l1");
    expect(isContact({ kind: "contact" })).toBe(true);
    expect(isContact({ kind: "lead" })).toBe(false);
    expect(isContact(null)).toBe(false);
  });
});
