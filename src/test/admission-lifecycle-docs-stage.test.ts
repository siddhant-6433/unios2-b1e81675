import { describe, it, expect } from "vitest";
import { computeStages, type LifecycleInput, type DocCounts } from "@/lib/admissionLifecycle";

// Regression for the Documents/Docs inconsistency: the lifecycle "Docs" dot
// used to treat "zero documents uploaded" as done, lighting it green for
// applications that never uploaded anything — contradicting the Section
// Progress panel (which reads the applicant-declared completed_sections).
// The Docs stage must only be "done" when docs exist AND all are reviewed,
// with the approved/rejected override still forcing it done.

const docs = (over: Partial<DocCounts> = {}): DocCounts => ({
  total: 0, verified: 0, rejected: 0, pending: 0, ...over,
});

const baseInput = (over: Partial<LifecycleInput> = {}): LifecycleInput => ({
  app: { status: "draft", payment_status: "paid" },
  lead: { id: "lead-1", pre_admission_no: null, admission_no: null },
  hasLead: true,
  appFeePaid: 1000,
  hasOffer: false,
  docs: docs(),
  ...over,
});

const docsStage = (input: LifecycleInput) =>
  computeStages(input).find(s => s.key === "docs")!;

describe("admissionLifecycle — Docs stage", () => {
  it("is NOT done when no documents have been uploaded (paid, in-progress app)", () => {
    const stage = docsStage(baseInput({ docs: docs({ total: 0 }) }));
    expect(stage.state).not.toBe("done");
    // It's the current next action once the fee is paid.
    expect(stage.state).toBe("current");
  });

  it("is done when documents are uploaded and all reviewed (none pending)", () => {
    const stage = docsStage(baseInput({ docs: docs({ total: 3, verified: 3, pending: 0 }) }));
    expect(stage.state).toBe("done");
  });

  it("is current/not-done when documents are uploaded but some are pending review", () => {
    const stage = docsStage(baseInput({ docs: docs({ total: 3, verified: 1, pending: 2 }) }));
    expect(stage.state).not.toBe("done");
  });

  it("is blocked when a document was rejected (and app not yet decided)", () => {
    const stage = docsStage(baseInput({ docs: docs({ total: 3, verified: 1, rejected: 1, pending: 1 }) }));
    expect(stage.state).toBe("blocked");
  });

  it("stays done for an approved app even with zero uploaded docs (decided override)", () => {
    const stage = docsStage(baseInput({
      app: { status: "approved", payment_status: "paid" },
      docs: docs({ total: 0 }),
    }));
    expect(stage.state).toBe("done");
  });

  it("stays done for a rejected app even with zero uploaded docs (decided override)", () => {
    const stage = docsStage(baseInput({
      app: { status: "rejected", payment_status: "paid" },
      docs: docs({ total: 0 }),
    }));
    expect(stage.state).toBe("done");
  });
});
