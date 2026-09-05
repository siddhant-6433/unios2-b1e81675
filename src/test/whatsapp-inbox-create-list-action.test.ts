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

  it("collects lead ids from the filtered view, same as Bulk Assign", () => {
    // Both actions map the filtered conversations to lead ids.
    expect(inbox).toContain("filtered.map(c => c.lead_id).filter(Boolean) as string[]");
    expect(inbox).toContain("<AddToListDialog");
  });
});

describe("AddToListDialog", () => {
  it("creates a lead_lists row and links members via the join table", () => {
    expect(dialog).toContain('.from("lead_lists" as any)');
    expect(dialog).toContain('.from("lead_list_members" as any)');
    expect(dialog).toContain('source: "manual"');
  });

  it("uses a plain chunked insert (partial unique index is not an upsert target)", () => {
    // See Admissions.tsx:1148-1157 / migration 20260830053655. A plain insert
    // on a brand-new list is correct; an onConflict target would 400.
    expect(dialog).toContain(".insert(members.slice(i, i + 500))");
    expect(dialog).not.toContain('onConflict: "list_id,lead_id"');
    expect(dialog).toContain("i += 500");
  });

  it("never writes leads directly when grouping — ownership is untouched", () => {
    // The whole point: grouping must not overwrite leads.counsellor_id. Only the
    // opt-in assign path may change ownership, and only via the round-robin RPC.
    expect(dialog).not.toContain('.from("leads")');
    expect(dialog).not.toContain('.update(');
  });

  it("optionally hands the list to counsellors as a Cloud Dialer call list", () => {
    expect(dialog).toContain('supabase.rpc("assign_lead_list_round_robin" as any');
    expect(dialog).toContain("assignAfterCreate");
    expect(dialog).toContain("_counsellor_ids: assignCounsellorIds");
  });
});
