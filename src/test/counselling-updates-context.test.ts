import { describe, expect, it } from "vitest";
import { loadVerifiedAdmissionsContext } from "../../supabase/functions/_shared/nimt-admissions-context";

// Minimal supabase stub: every table returns empty except counselling_sources,
// whose rows are filtered by the gte("fetched_at", cutoff) the builder applies.
function fakeAdmin(counsellingRows: Array<Record<string, unknown>>) {
  const chain = (rows: any[]): any => {
    const self: any = {
      select: () => self,
      eq: () => self,
      or: () => self,
      not: () => self,
      order: () => self,
      limit: () => self,
      gte: (_col: string, cutoff: string) => chain(rows.filter((r) => String(r.fetched_at) >= cutoff)),
      maybeSingle: async () => ({ data: rows[0] ?? null }),
      then: (resolve: (v: any) => any) => resolve({ data: rows }),
    };
    return self;
  };
  return {
    from: (table: string) => chain(table === "counselling_sources" ? counsellingRows : []),
  };
}

const source = (fetchedAt: string) => ({
  label: "ABVMU Lucknow entrance counselling portal",
  url: "https://www.abvmucet26.co.in/",
  scope: "CAHET, CNET, UPGET",
  summary: "CAHET UG/PG mop-up round registration closes 10 August 2026, 6:00 PM.",
  fetched_at: fetchedAt,
});

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();

describe("live counselling updates in the admissions context", () => {
  it("injects a fresh scraped brief with its source and date", async () => {
    const context = await loadVerifiedAdmissionsContext(fakeAdmin([source(daysAgo(1))]) as any, null, null);
    expect(context).toContain("LIVE COUNSELLING UPDATES");
    expect(context).toContain("mop-up round registration closes 10 August 2026");
    expect(context).toContain("https://www.abvmucet26.co.in/");
  });

  it("drops a brief older than the freshness window — stale round dates are worse than none", async () => {
    const context = await loadVerifiedAdmissionsContext(fakeAdmin([source(daysAgo(30))]) as any, null, null);
    expect(context).not.toContain("LIVE COUNSELLING UPDATES");
    expect(context).not.toContain("mop-up round");
  });
});
