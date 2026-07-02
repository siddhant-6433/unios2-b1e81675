import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  buildOfferWaiversFromFeeProposalChild,
  feeProposalChildKey,
  proposalFeeSnapshotDiff,
} from "@/lib/feeProposalOfferMapping";

describe("fee proposal to offer mapping", () => {
  it("groups proposal item waivers into approved offer waiver drafts with audit metadata", () => {
    const child = {
      lead_id: "lead-1",
      course_id: "course-1",
      name: "Student One",
      fee_items: [
        { code: "TUITION", name: "Tuition Fee", category: "tuition", term: "q1", headerKey: "tuition:q1", amount: 20_000, waiver: 5_000 },
        { code: "TUITION", name: "Tuition Fee", category: "tuition", term: "q1", headerKey: "tuition:q1", amount: 10_000, waiver: 2_000 },
        { code: "HOSTEL", name: "Boarding Fee", category: "hostel", term: "q2", headerKey: "boarding:q2", amount: 15_000, waiver: 0 },
        { code: "HOSTEL", name: "Boarding Fee", category: "hostel", term: "q3", headerKey: "boarding:q3", amount: 15_000, waiver: 3_000 },
      ],
    };

    const drafts = buildOfferWaiversFromFeeProposalChild({
      proposalId: "proposal-1",
      revisionNumber: 3,
      childKey: feeProposalChildKey(child, 0),
      child,
    });

    expect(drafts).toHaveLength(2);
    expect(drafts.map((draft) => [draft.term, draft.amount, draft.reason])).toEqual([
      ["q1", 7_000, "Approved fee proposal Revision 3 - Tuition Fee"],
      ["q3", 3_000, "Approved fee proposal Revision 3 - Boarding Fee"],
    ]);
    expect(drafts[0]).toMatchObject({
      source_type: "fee_proposal",
      source_fee_proposal_id: "proposal-1",
      metadata: {
        fee_head_label: "Tuition Fee",
        proposal_revision_number: 3,
        proposal_child_lead_id: "lead-1",
        proposal_child_course_id: "course-1",
        source_amount: 30_000,
        item_count: 2,
      },
    });
  });

  it("detects fee structure snapshot mismatches without blocking issue flow", () => {
    expect(proposalFeeSnapshotDiff({ totals: { annualBeforeWaiver: 100_000 } }, 100_000)).toMatchObject({
      hasMismatch: false,
      diff: 0,
    });

    expect(proposalFeeSnapshotDiff({ totals: { annualBeforeWaiver: 100_000 } }, 125_000)).toMatchObject({
      hasMismatch: true,
      proposalGross: 100_000,
      currentGross: 125_000,
      diff: 25_000,
    });
  });

  it("adds guarded database source fields for copied proposal waivers", () => {
    const migration = readFileSync("supabase/migrations/20260701150000_fee_proposal_offer_mapping.sql", "utf8");

    expect(migration).toContain("source_fee_proposal_id uuid REFERENCES public.fee_proposals");
    expect(migration).toContain("source_fee_proposal_child_key text");
    expect(migration).toContain("source_type text NOT NULL DEFAULT 'manual'");
    expect(migration).toContain("metadata jsonb NOT NULL DEFAULT '{}'::jsonb");
    expect(migration).toContain("v_source_status <> 'approved'");
    expect(migration).toContain("v_source_is_current IS NOT TRUE");
    expect(migration).toContain("NEW.status := 'approved'");
  });
});
