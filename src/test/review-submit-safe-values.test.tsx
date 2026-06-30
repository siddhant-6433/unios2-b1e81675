import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ReviewSubmit } from "@/components/apply/ReviewSubmit";

describe("ReviewSubmit safe value rendering", () => {
  it("renders school previous-school objects without crashing", () => {
    render(
      <ReviewSubmit
        data={{
          application_id: "APP-26-76BA",
          program_category: "school",
          full_name: "Srishti Pal",
          phone: "+918130062160",
          email: "student@example.com",
          gender: "Female",
          dob: "2014-01-01",
          nationality: "Indian",
          category: "General",
          aadhaar: "123456789012",
          passport_number: "",
          apaar_id: "",
          pen_number: "",
          address: {},
          father: {
            first_name: "Ashvanik",
            last_name: "Kumar",
            current_position: "Software Engineer",
            phone_mobile: "+918130062160",
          },
          mother: {
            first_name: "Alka",
            last_name: "Pal",
          },
          guardian: {},
          course_selections: [
            {
              campus_id: "campus-1",
              course_id: "grade-vii",
              campus_name: "Ghaziabad Campus 3 (Avantika II)",
              course_name: "Grade VII",
              institution_id: "institution-1",
              preference_order: 1,
              program_category: "school",
            },
          ],
          academic_details: {
            previous_school: {
              board: "CBSE",
              last_class: "10",
              percentage: "85",
              tc_available: "no",
              academic_year: "2025",
              prev_school_name: "Shri Chaitanya Techno School GZB 2",
            },
          },
          extracurricular: {},
          result_status: {},
          school_details: {},
          completed_sections: {},
          flags: [],
          fee_amount: 0,
          payment_status: "paid",
        } as any}
        onSubmit={vi.fn()}
        saving={false}
      />,
    );

    expect(screen.getByText("Shri Chaitanya Techno School GZB 2")).toBeInTheDocument();
    expect(screen.getByText("CBSE")).toBeInTheDocument();
    expect(screen.getByText("85")).toBeInTheDocument();
  });
});
