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

  it("masks phones for staff CRM views and leaves them visible on the apply portal", () => {
    const { rerender } = render(
      <ApplicationPreview
        docs={[]}
        maskPhones
        app={{
          completed_sections: {},
          full_name: "Aarav Student",
          phone: "+919812345892",
          father: { name: "Father", phone: "9871763193" },
          mother: { name: "Mother", phone_mobile: "9998887776" },
        }}
      />,
    );

    expect(screen.getByText("981****892")).toBeInTheDocument();
    expect(screen.getByText("987****193")).toBeInTheDocument();
    expect(screen.getByText("999****776")).toBeInTheDocument();
    expect(screen.queryByText("+919812345892")).toBeNull();
    expect(screen.queryByText("9871763193")).toBeNull();
    expect(screen.queryByText("9998887776")).toBeNull();

    rerender(
      <ApplicationPreview
        docs={[]}
        app={{
          completed_sections: {},
          full_name: "Aarav Student",
          phone: "+919812345892",
        }}
      />,
    );
    expect(screen.getByText("+919812345892")).toBeInTheDocument();
  });
});
