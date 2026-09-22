import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const inbox = readFileSync("src/pages/Inbox.tsx", "utf8");

/**
 * The Inbox sidebar/list is gated on one aggregate counts fetch that can take
 * several seconds. Before it lands the page is loading, not empty — it must
 * show a loader instead of 0 / "All clear".
 */
describe("Inbox counts loading state", () => {
  it("derives a counts-loading flag from countsLoaded", () => {
    expect(inbox).toContain("const countsLoading = !countsLoaded;");
  });

  it("shows a loader in the Open/Selected cards instead of a premature 0", () => {
    expect(inbox).toContain('{countsLoading ? <OrbLoader state="searching" size={20} /> : totalVisibleCount}');
    expect(inbox).toContain('{countsLoading ? <OrbLoader state="searching" size={20} /> : selectedDisplayCount}');
    expect(inbox).not.toContain(">{totalVisibleCount}</p>");
    expect(inbox).not.toContain(">{selectedDisplayCount}</p>");
  });

  it("shows a loader in the category nav while counts load", () => {
    expect(inbox).toContain("{countsLoading && (");
  });

  it("shows the list loader while counts load, not the All clear empty state", () => {
    expect(inbox).toContain("countsLoading || (loading && items.length === 0)");
  });
});
