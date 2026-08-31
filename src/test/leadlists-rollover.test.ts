import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const leadLists = readFileSync("src/pages/LeadLists.tsx", "utf8");
const marketing = readFileSync("src/pages/Marketing.tsx", "utf8");

describe("lead list archive + roll-forward", () => {
  it("hides archived lists by default and can show them on demand", () => {
    expect(leadLists).toContain('.is("archived_at", null)');
    expect(leadLists).toContain('.not("archived_at", "is", null)');
    // The query changes with the segment, so the effect has to refetch.
    expect(leadLists).toContain("[role, showArchived]");
  });

  it("archives through the permission-checked RPC, not a bare update", () => {
    // RLS lets any of the six can_manage_lead_lists() roles UPDATE lead_lists,
    // which would let a counsellor archive someone else's list.
    expect(leadLists).toContain('supabase.rpc("set_lead_list_archived" as any');
    expect(leadLists).not.toContain('.update({ archived_at');
  });

  it("rolls forward server-side with every argument the RPC needs", () => {
    expect(leadLists).toContain('supabase.rpc("build_followup_list" as any');
    for (const arg of ["_source_list_id", "_buckets", "_due_date", "_list_name", "_archive_source"]) {
      expect(leadLists).toContain(arg);
    }
    // The old client-side path built the list from a capped report page.
    expect(leadLists).not.toContain("followupLeadIds");
  });

  it("pages the calling report instead of showing only the first 500", () => {
    // followupLeadIds used to derive from this array, so a list over 500 leads
    // silently dropped everyone past row 500.
    expect(leadLists).toContain("_limit: PAGE, _offset: offset");
    // The report RPC is never called with a bare cap and no offset.
    expect(leadLists).not.toMatch(/_limit:\s*500\s*,\s*\n?\s*\}\)/);
  });

  it("filters the CSV export with the same bucketer the chips use", () => {
    // Chips are built from reportBucket(); the export recomputed a different
    // expression, so the "not_called" chip exported an empty file.
    expect(leadLists).toContain("reportBucket(r) === reportDispositionFilter");
  });

  it("pages lead_lists past the PostgREST 1000-row ceiling", () => {
    // db-max-rows=1000 truncates silently, so dropping the old .limit(200)
    // alone would reintroduce the same bug once the project passes 1000 lists.
    expect(marketing).toContain(".range(from, from + PAGE - 1)");
    expect(marketing).toContain("fetchAllLists");
    expect(leadLists).toContain(".range(from, from + PAGE - 1)");
  });
});
