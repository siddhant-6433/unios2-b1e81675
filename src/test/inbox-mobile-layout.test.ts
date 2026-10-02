import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const inbox = readFileSync("src/pages/Inbox.tsx", "utf8");
const appLayout = readFileSync("src/components/layout/AppLayout.tsx", "utf8");

describe("Inbox mobile navigation and layout", () => {
  it("opens the selected queue after choosing a category", () => {
    expect(inbox).toContain('setMobileView("items");');
    expect(inbox).toContain('setSelected(cat.id);');
  });

  it("opens item details through the shared item-selection handler", () => {
    expect(inbox).toContain("const openInboxItem = (item: InboxItem) => {");
    expect(inbox).toContain("setSelectedItem(item);");
    expect(inbox).toContain('setMobileView("detail");');
    expect(inbox).not.toMatch(/onClick=\{\(\) => setSelectedItem\([a-z]+\)\}/);
  });

  it("provides back actions from details to queue and queue to categories", () => {
    expect(inbox).toContain('onClick={() => setMobileView("items")} aria-label="Back to inbox items"');
    expect(inbox).toContain('onClick={() => setMobileView("categories")} aria-label="Back to inbox categories"');
  });

  it("opens directly linked categories at the queue level", () => {
    expect(inbox).toContain("if (requestedCategory) setMobileView(\"items\");");
  });

  it("shows one full-width panel at a time on narrow screens while retaining desktop columns", () => {
    expect(inbox).toContain('mobileView !== "categories" && "hidden md:flex"');
    expect(inbox).toContain('mobileView !== "items" && "hidden md:flex"');
    expect(inbox).toContain('mobileView !== "detail" && "hidden md:block"');
    expect(inbox).toContain("w-full min-w-0 shrink-0");
  });

  it("gives the inbox a bounded dynamic viewport and independently scrolling panels", () => {
    expect(appLayout).toContain('isConsole || isInbox ? "h-dvh overflow-hidden"');
    expect(appLayout).toContain('isConsole || isInbox ? "overflow-hidden p-0"');
    expect(inbox.match(/overflow-y-auto overscroll-contain/g)).toHaveLength(3);
    expect(inbox).toContain("env(safe-area-inset-bottom)");
  });
});
