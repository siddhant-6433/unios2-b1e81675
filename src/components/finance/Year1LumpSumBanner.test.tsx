import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { buildYear1LumpSumOffer } from "@/lib/year1LumpSumWaiver";
import {
  Year1LumpSumInfoBanner,
  Year1LumpSumYearGroupNotice,
  Year1TuitionWaiverBadge,
} from "./Year1LumpSumBanner";

const paidCollegeTuition = {
  id: "11111111-1111-1111-1111-111111111111",
  term: "year_1",
  fee_code: "TUITION-Y1",
  fee_code_name: "Year 1 Tuition (to college)",
  category: "tuition",
  balance: 0,
};

describe("Year-1 waiver banners on the fee ledger", () => {
  it("still shows an info banner when Year 1 college tuition is already cleared", () => {
    const offer = buildYear1LumpSumOffer([paidCollegeTuition], { lumpSumPct: 5 });
    render(<Year1LumpSumInfoBanner offer={offer} />);
    expect(screen.getByText("5% Year 1 tuition waiver")).toBeInTheDocument();
    expect(screen.getByText(/no remaining Year 1 college tuition/i)).toBeInTheDocument();
  });

  it("renders inside the Year 1 group so it is visible with the fee rows", () => {
    const offer = buildYear1LumpSumOffer([paidCollegeTuition], { lumpSumPct: 5 });
    render(
      <table>
        <tbody>
          <Year1LumpSumYearGroupNotice offer={offer} colSpan={8} />
        </tbody>
      </table>,
    );
    expect(screen.getByText(/5% Year 1 tuition waiver/)).toBeInTheDocument();
    render(<Year1TuitionWaiverBadge offer={offer} feeId={paidCollegeTuition.id} />);
    expect(screen.getAllByText("5% Year 1 tuition waiver").length).toBeGreaterThan(0);
  });
});
