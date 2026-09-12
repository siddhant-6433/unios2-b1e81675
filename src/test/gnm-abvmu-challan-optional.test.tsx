import { readFileSync } from "node:fs";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { AbvmuInlineControls } from "@/components/finance/AbvmuInlineControls";
import { TooltipProvider } from "@/components/ui/tooltip";
import { isGnmCourseName } from "@/lib/examRegistration";

const migration = readFileSync(
  "supabase/migrations/20260912054908_gnm_abvmu_deposit_not_applicable.sql",
  "utf8",
);
const inline = readFileSync("src/components/finance/AbvmuInlineControls.tsx", "utf8");
const panel = readFileSync("src/components/finance/StudentFeePanel.tsx", "utf8");
const hook = readFileSync("src/components/finance/useAbvmuDeposit.ts", "utf8");
const depositPanel = readFileSync("src/components/finance/AbvmuDepositPanel.tsx", "utf8");

vi.mock("@/components/ui/thinking-orb", () => ({
  ButtonOrb: () => null,
}));

function stubAbvmu(overrides: Record<string, unknown> = {}) {
  return {
    depositAmount: 5000,
    lumpSumPct: 5,
    approvedCredit: 0,
    firstYearDue: 113000,
    claims: [],
    loading: false,
    openClaim: undefined,
    rejected: undefined,
    settledClaim: undefined,
    settledAmount: 0,
    directCollectDeduction: 0,
    canSettle: false,
    notApplicable: false,
    challanOptional: true,
    viewChallan: vi.fn(),
    settle: vi.fn(),
    submitClaim: vi.fn(),
    setDepositNotApplicable: vi.fn(),
    refresh: vi.fn(),
    ...overrides,
  } as any;
}

describe("GNM ABVMU challan is optional for direct admits", () => {
  it("treats GNM course names as the only optional-challan course", () => {
    expect(isGnmCourseName("Diploma in General Nursing & Midwifery (GNM)")).toBe(true);
    expect(isGnmCourseName("Bachelor of Physiotherapy (BPT)")).toBe(false);
    expect(isGnmCourseName("B.Sc Nursing")).toBe(false);
  });

  it("zeroes the deposit in SQL when GNM is marked not applicable", () => {
    expect(migration).toContain("abvmu_deposit_not_applicable");
    expect(migration).toContain("lead_course_is_gnm");
    expect(migration).toContain("set_abvmu_deposit_not_applicable");
    expect(migration).toContain("University-deposit not-applicable is only for GNM");
    expect(migration).toContain("RETURN 0");
    expect(migration).toContain("Cannot mark not applicable while an ABVMU challan is pending, approved, or settled");
    expect(migration).toContain("amount included in Year 1 tuition");
  });

  it("does not reuse the BPT/BMRIT CAHET flag for GNM", () => {
    expect(migration).not.toContain("abvmu_cahet_allotted");
    expect(hook).toContain("set_abvmu_deposit_not_applicable");
    expect(hook).toContain("isGnmCourseName");
  });

  it("offers not-applicable next to Record ABVMU challan on the student fee tab", () => {
    expect(inline).toContain("Not applicable (no counselling)");
    expect(inline).toContain("Include in Year 1 fee");
    expect(inline).toContain("challanOptional");
    expect(inline).toContain("University deposit not applicable (direct admission / no counselling)");
    expect(panel).toContain("GnmDepositNotApplicableBanner");
    expect(depositPanel).toContain("Not applicable — include in Year 1 fee");
  });

  it("shows the GNM not-applicable action and hides it for counselling-mandatory courses", () => {
    const { rerender } = render(
      <TooltipProvider>
        <AbvmuInlineControls abvmu={stubAbvmu({ challanOptional: true })} />
      </TooltipProvider>,
    );
    expect(screen.getByText("Record ABVMU challan")).toBeInTheDocument();
    expect(screen.getByText("Not applicable (no counselling)")).toBeInTheDocument();

    rerender(
      <TooltipProvider>
        <AbvmuInlineControls abvmu={stubAbvmu({ challanOptional: false })} />
      </TooltipProvider>,
    );
    expect(screen.getByText("Record ABVMU challan")).toBeInTheDocument();
    expect(screen.queryByText("Not applicable (no counselling)")).not.toBeInTheDocument();
  });

  it("confirms folding the deposit into Year 1 tuition", async () => {
    const setDepositNotApplicable = vi.fn().mockResolvedValue({});
    render(
      <TooltipProvider>
        <AbvmuInlineControls abvmu={stubAbvmu({ setDepositNotApplicable })} />
      </TooltipProvider>,
    );
    fireEvent.click(screen.getByText("Not applicable (no counselling)"));
    expect(screen.getByText(/collected as part of Year 1 tuition/)).toBeInTheDocument();
    fireEvent.click(screen.getByText("Include in Year 1 fee"));
    await waitFor(() => {
      expect(setDepositNotApplicable).toHaveBeenCalledWith(true);
    });
  });
});
