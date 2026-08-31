import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const applications = readFileSync("src/pages/Applications.tsx", "utf8");

// Mirror of admissions-add-to-list-bulk-action.test.ts. Applications.tsx carried
// the exact same "Add to List" bug and the exact same fix, but had no test — so
// only one of the two copies was actually guarded against regression.
describe("Applications selected-application list action", () => {
  it("adds members with a plain insert, not a partial-index upsert", () => {
    expect(applications).toContain('.from("lead_list_members" as any)');
    // Migration 20260830053655 swapped lead_list_members' (list_id, lead_id)
    // primary key for a surrogate id plus a PARTIAL unique index
    // (WHERE lead_id IS NOT NULL). PostgREST cannot use a partial index as an
    // upsert conflict target, so `onConflict: "list_id,lead_id"` failed for
    // every chunk and the list was created with zero members.
    expect(applications).toContain(".insert(chunk)");
    expect(applications).not.toContain('onConflict: "list_id,lead_id"');
    expect(applications).not.toContain("ignoreDuplicates: true");
  });

  it("chunks members so a large selection cannot exceed the request limit", () => {
    expect(applications).toContain("i += 500");
    expect(applications).toContain("members.slice(i, i + 500)");
  });
});
