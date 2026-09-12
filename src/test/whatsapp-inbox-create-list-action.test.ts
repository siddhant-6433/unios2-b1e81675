import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const inbox = readFileSync("src/pages/WhatsAppInbox.tsx", "utf8");
const dialog = readFileSync("src/components/admissions/AddToListDialog.tsx", "utf8");

describe("WhatsApp inbox Create List action", () => {
  it("adds a Create List button next to Bulk Assign in the admin row", () => {
    expect(inbox).toContain("Create List");
    expect(inbox).toContain("Bulk Assign"); // kept alongside
    expect(inbox).toContain("<ListPlus");
    expect(inbox).toContain("setAddToListOpen(true)");
    expect(inbox).toContain("setAddToListLeadIds(ids)");
  });

  it("collects unique lead ids from the filtered view, same as Bulk Assign", () => {
    // Engaged inbox expands 91-prefix phone variants into separate chats that
    // often share a lead_id. Unique first so the join insert cannot 23505.
    expect(inbox).toContain("uniqueLeadIds(filtered.map(c => c.lead_id))");
    expect(inbox).toContain("<AddToListDialog");
    expect(inbox).toContain("normalizeCampaignPhoneDigits");
  });
});

describe("AddToListDialog", () => {
  it("creates a lead_lists row then adds members via the resilient helper", () => {
    expect(dialog).toContain('.from("lead_lists" as any)');
    expect(dialog).toContain('source: "manual"');
    expect(dialog).toContain('supabase.rpc("add_lead_list_members" as any');
    expect(dialog).toContain("insertLeadListMembers");
    expect(dialog).not.toContain('onConflict: "list_id,lead_id"');
  });

  it("never writes leads directly when grouping — ownership is untouched", () => {
    // The whole point: grouping must not overwrite leads.counsellor_id. Only the
    // opt-in assign path may change ownership, and only via the round-robin RPC.
    expect(dialog).not.toContain('.from("leads")');
    expect(dialog).not.toContain('.update(');
    expect(dialog).toContain("uniqueLeadIds");
  });

  it("optionally hands the list to counsellors as a Cloud Dialer call list", () => {
    expect(dialog).toContain('supabase.rpc("assign_lead_list_round_robin" as any');
    expect(dialog).toContain("assignAfterCreate");
    expect(dialog).toContain("_counsellor_ids: assignCounsellorIds");
    expect(dialog).toContain("_include_terminal: false");
    expect(dialog).toContain('supabase.rpc("assignable_counsellors" as any');
  });
});
