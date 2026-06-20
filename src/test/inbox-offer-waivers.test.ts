import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const inbox = readFileSync("src/pages/Inbox.tsx", "utf8");

describe("Inbox offer waiver badge and reload behavior", () => {
  it("counts pending offer waivers from actual rows instead of planner estimates", () => {
    expect(inbox).not.toContain('.from("offer_waivers")\n            .select("id", { count: "planned", head: true })');
    expect(inbox).toContain('.from("offer_waivers")\n            .select("id")');
    expect(inbox).toContain("(r.value as any).count ?? (r.value as any).data?.length ?? 0");
  });

  it("reloads the selected category when it is clicked again", () => {
    expect(inbox).toContain("if (selected === cat.id)");
    expect(inbox).toContain("loadItems(cat.id);");
    expect(inbox).toContain("setSelected(cat.id);");
  });
});
