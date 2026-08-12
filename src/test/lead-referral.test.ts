import { describe, it, expect, vi, beforeEach } from "vitest";

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc } }));

import { isReferrableCourse, referLeadsToPartner } from "@/lib/leadReferral";

describe("isReferrableCourse", () => {
  it("accepts BPT and BMRIT course names", () => {
    expect(isReferrableCourse("Bachelor of Physiotherapy (BPT)")).toBe(true);
    expect(isReferrableCourse("BMRIT")).toBe(true);
    expect(isReferrableCourse("B.Sc Radiology & Imaging Technology")).toBe(true);
  });

  it("rejects everything else", () => {
    expect(isReferrableCourse("B.Sc Nursing")).toBe(false);
    expect(isReferrableCourse("BBA")).toBe(false);
    expect(isReferrableCourse(null)).toBe(false);
  });
});

describe("referLeadsToPartner", () => {
  beforeEach(() => rpc.mockReset());

  it("calls the RPC once per lead and counts successes", async () => {
    rpc.mockResolvedValue({ data: "ref-1", error: null });
    const result = await referLeadsToPartner(["lead-a", "lead-b"], "call after 5pm");

    expect(rpc).toHaveBeenCalledTimes(2);
    expect(rpc).toHaveBeenCalledWith("refer_lead_to_partner", {
      _lead_id: "lead-a",
      _note: "call after 5pm",
    });
    expect(result).toEqual({ referred: 2, failed: [] });
  });

  it("passes a null note when none was given", async () => {
    rpc.mockResolvedValue({ data: "ref-1", error: null });
    await referLeadsToPartner(["lead-a"]);
    expect(rpc).toHaveBeenCalledWith("refer_lead_to_partner", { _lead_id: "lead-a", _note: null });
  });

  it("collects per-lead failures instead of throwing", async () => {
    // The DB re-checks the BPT/BMRIT gate, so a non-referrable lead comes back
    // as an error — the other leads in the batch must still go through.
    rpc
      .mockResolvedValueOnce({ data: null, error: { message: "Only BPT / BMRIT leads can be referred" } })
      .mockResolvedValueOnce({ data: "ref-2", error: null });

    const result = await referLeadsToPartner(["bad-lead", "good-lead"]);

    expect(result.referred).toBe(1);
    expect(result.failed).toEqual([
      { leadId: "bad-lead", message: "Only BPT / BMRIT leads can be referred" },
    ]);
  });

  it("does nothing for an empty selection", async () => {
    const result = await referLeadsToPartner([]);
    expect(rpc).not.toHaveBeenCalled();
    expect(result).toEqual({ referred: 0, failed: [] });
  });
});
