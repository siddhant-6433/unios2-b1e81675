import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const admissions = readFileSync("src/pages/Admissions.tsx", "utf8");

describe("Admissions selected-lead list action", () => {
  it("shows Add to List in the selected-leads bulk action bar", () => {
    expect(admissions).toContain("openAddToListDialog");
    expect(admissions).toContain("Add to List");
    expect(admissions).toContain("<ListPlus");
  });

  it("can create or append to reusable lead lists without duplicate member failures", () => {
    expect(admissions).toContain('.from("lead_lists" as any)');
    expect(admissions).toContain('.from("lead_list_members" as any)');
    expect(admissions).toContain('setListMode("new")');
    expect(admissions).toContain('setListMode("existing")');
    // Members go in with a plain insert. This used to be
    // `.upsert(chunk, { onConflict: "list_id,lead_id", ignoreDuplicates: true })`,
    // but migration 20260830053655 replaced the (list_id, lead_id) primary key
    // with a surrogate id and a PARTIAL unique index (WHERE lead_id IS NOT NULL).
    // PostgREST cannot resolve a partial index as an upsert conflict target, so
    // every chunk failed and lists were created empty. Asserting the conflict
    // target is gone is what keeps that regression from coming back.
    expect(admissions).toContain(".insert(chunk)");
    expect(admissions).not.toContain('onConflict: "list_id,lead_id"');
  });

  it("can add all filtered leads to a list without selecting every page", () => {
    expect(admissions).toContain('const [listScope, setListScope] = useState<"selected" | "filtered">("selected")');
    expect(admissions).toContain('fetchLeadIdsForTransfer({ mode: "all" })');
    expect(admissions).toContain("All filtered");
    expect(admissions).toContain('source: listScope === "filtered" ? "filter" : "manual"');
  });

  it("renders the selected-leads action bar near the active lead surface", () => {
    expect(admissions).toContain("const bulkActionBar = selectedIds.size > 0 ?");
    expect(admissions).toContain("{bulkActionBar && <div className=\"mb-3\">{bulkActionBar}</div>}");
    expect(admissions).toContain("{bulkActionBar}");
  });
});
