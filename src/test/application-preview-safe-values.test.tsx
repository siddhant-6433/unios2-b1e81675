import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ApplicationPreview } from "@/components/applicant/ApplicationPreview";

describe("ApplicationPreview safe value rendering", () => {
  it("renders object-shaped application values without crashing", () => {
    render(
      <ApplicationPreview
        docs={[]}
        app={{
          completed_sections: { personal: true },
          full_name: { name: "Aarav Student" },
          dob: "2020-04-01",
          father: {
            name: { label: "Father Name" },
            annual_income: { label: "5-10 lakh" },
          },
          mother: {
            name: "Mother Name",
            current_position: { value: "Teacher" },
          },
          course_selections: [
            {
              preference_order: 1,
              course_name: { label: "Nursery" },
              campus_name: { name: "NIMT Beacon Arthala" },
            },
          ],
        }}
      />,
    );

    expect(screen.getByText("Aarav Student")).toBeInTheDocument();
    expect(screen.getByText("Father Name")).toBeInTheDocument();
    expect(screen.getByText("5-10 lakh")).toBeInTheDocument();
    expect(screen.getByText("Teacher")).toBeInTheDocument();
    expect(screen.getByText("Nursery")).toBeInTheDocument();
    expect(screen.getByText("NIMT Beacon Arthala")).toBeInTheDocument();
  });
});
