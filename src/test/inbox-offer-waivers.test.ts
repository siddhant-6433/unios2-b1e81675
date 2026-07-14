import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const inbox = readFileSync("src/pages/Inbox.tsx", "utf8");

describe("Inbox offer waiver badge and reload behavior", () => {
  it("counts pending offer waivers from actual rows instead of planner estimates", () => {
    expect(inbox).not.toContain('.from("offer_waivers")\n            .select("id", { count: "planned", head: true })');
    expect(inbox).toContain('.from("offer_waivers")\n            .select("id")');
    expect(inbox).toContain("(r.value as any).count ?? (r.value as any).data?.length ?? 0");
  });

  it("keeps sidebar counts tied to the fetched inbox rows", () => {
    expect(inbox).not.toContain('{ count: "planned", head: true }');
    expect(inbox).toContain("const commitItems = useCallback");
    expect(inbox).toContain("setCounts((prev) => prev[cat] === nextItems.length");
    expect(inbox).toContain("const categoryDisplayCount = (cat: InboxCategory)");
    expect(inbox).toContain("cat.id === selected && !loading ? items.length : cat.count");
    expect(inbox).toContain('.from("whatsapp_conversations" as any)\n            .select("phone")');
  });

  it("loads pending waiver rows before resolving related offer data", () => {
    expect(inbox).toContain("const waiverRows = (data || []) as any[]");
    expect(inbox).toContain(".from(\"offer_letters\")\n            .select(\"id, lead_id, course_id, session_id\")");
    expect(inbox).not.toContain("offer_letters!offer_letter_id");
  });

  it("lets WhatsApp inbox notifications be marked read from the detail pane", () => {
    expect(inbox).toContain('("mark_whatsapp_conversation_read"');
    expect(inbox).toContain("const markWhatsAppRead = async");
    expect(inbox).toContain("Mark read");
    expect(inbox).toContain("setCounts((prev) => ({ ...prev, whatsapp: Math.max(0, prev.whatsapp - 1) }))");
  });

  it("reloads the selected category when it is clicked again", () => {
    expect(inbox).toContain("if (selected === cat.id)");
    expect(inbox).toContain("loadItems(cat.id);");
    expect(inbox).toContain("setSelected(cat.id);");
  });
});
