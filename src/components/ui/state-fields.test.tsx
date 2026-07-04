import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { SelectField } from "./state-fields";

describe("SelectField", () => {
  it("renders grouped options when no flat options are provided", () => {
    render(
      <SelectField
        value=""
        onValueChange={vi.fn()}
        groups={[
          {
            label: "NIMT - Nursing",
            options: [{ value: "bsc-nursing", label: "B.Sc Nursing" }],
          },
        ]}
        placeholder="Select course"
      />,
    );

    expect(screen.getByRole("combobox")).toBeInTheDocument();
    expect(screen.getByText("Select course")).toBeInTheDocument();
  });

  it("does not crash when a group has no options yet", () => {
    render(
      <SelectField
        value=""
        onValueChange={vi.fn()}
        groups={[{ label: "Loading courses" }]}
        placeholder="Select course"
      />,
    );

    expect(screen.getByRole("combobox")).toBeInTheDocument();
  });

  it("renders explicit empty-value options without passing an empty value to Radix", () => {
    render(
      <SelectField
        value=""
        onValueChange={vi.fn()}
        options={[{ value: "", label: "Unassigned" }]}
        placeholder="Select counsellor"
      />,
    );

    expect(screen.getByRole("combobox")).toBeInTheDocument();
    expect(screen.getByText("Unassigned")).toBeInTheDocument();
  });
});
