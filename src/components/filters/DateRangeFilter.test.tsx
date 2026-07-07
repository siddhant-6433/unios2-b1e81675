import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { DateRangeFilter } from "@/components/filters/DateRangeFilter";
import { DatePickerField, formatIsoDate, parseIsoDate } from "@/components/ui/state-fields";

describe("DateRangeFilter", () => {
  it("renders shadcn-backed custom date controls with accessible labels", () => {
    render(
      <DateRangeFilter
        preset="custom"
        fromDate="2026-07-01"
        toDate="2026-07-03"
        onPresetChange={vi.fn()}
        onFromDateChange={vi.fn()}
        onToDateChange={vi.fn()}
        ariaPrefix="Campaign"
      />,
    );

    expect(screen.getByLabelText("Campaign range")).toBeInTheDocument();
    expect(screen.getByLabelText("Campaign start date")).toHaveTextContent("01 Jul 2026");
    expect(screen.getByLabelText("Campaign end date")).toHaveTextContent("03 Jul 2026");
  });

  it("keeps date values as local YYYY-MM-DD strings", () => {
    const parsed = parseIsoDate("2026-07-03");

    expect(parsed).toBeInstanceOf(Date);
    expect(formatIsoDate(parsed!)).toBe("2026-07-03");
  });
});

describe("DatePickerField", () => {
  it("accepts typed dates without converting through UTC", () => {
    const onValueChange = vi.fn();

    render(
      <DatePickerField
        value=""
        onValueChange={onValueChange}
        ariaLabel="Manual date"
        allowManualInput
      />,
    );

    fireEvent.click(screen.getByLabelText("Manual date"));
    fireEvent.change(screen.getByPlaceholderText("or type dd/mm/yyyy"), {
      target: { value: "03/07/2026" },
    });

    expect(onValueChange).toHaveBeenCalledWith("2026-07-03");
  });
});
