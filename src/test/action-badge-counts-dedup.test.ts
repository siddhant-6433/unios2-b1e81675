import { describe, expect, it, vi, beforeEach } from "vitest";

// Mock the supabase client before importing the module under test.
// vi.mock is hoisted, so the mock fn must be created via vi.hoisted.
const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc } }));

import { fetchActionBadgeCounts } from "@/lib/actionBadgeCounts";

describe("fetchActionBadgeCounts dedup", () => {
  beforeEach(() => rpc.mockReset());

  it("collapses concurrent identical calls into a single RPC", async () => {
    let resolve!: (v: unknown) => void;
    rpc.mockReturnValue(new Promise((r) => { resolve = r; }));

    const args = { p_scope_counsellor_id: null, p_include_unassigned: true };
    const a = fetchActionBadgeCounts(args);
    const b = fetchActionBadgeCounts(args);
    resolve({ data: { overdue: 3 }, error: null });

    expect(await a).toEqual(await b);
    expect(rpc).toHaveBeenCalledTimes(1); // three layout components → one query
  });

  it("does not share results across different scopes", async () => {
    rpc.mockResolvedValue({ data: {}, error: null });
    await fetchActionBadgeCounts({ p_scope_counsellor_id: "c1", p_include_unassigned: true });
    await fetchActionBadgeCounts({ p_scope_counsellor_id: "c2", p_include_unassigned: true });
    expect(rpc).toHaveBeenCalledTimes(2);
  });
});
