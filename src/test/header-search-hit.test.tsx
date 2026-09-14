import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { headerSearchIdentity, HeaderSearchHit } from "@/components/layout/HeaderSearch";

describe("headerSearchIdentity", () => {
  it("shows AN and drops PAN when both exist", () => {
    expect(headerSearchIdentity({
      admission_no: "AN-283F4F18",
      pre_admission_no: "PAN-E5B25972",
    })).toEqual({ identifier: "AN-283F4F18", identifierLabel: "AN" });
  });

  it("shows PAN only when there is no AN", () => {
    expect(headerSearchIdentity({
      pre_admission_no: "PAN-E5B25972",
    })).toEqual({ identifier: "PAN-E5B25972", identifierLabel: "PAN" });
  });
});

describe("HeaderSearchHit", () => {
  it("keeps the full name visible and does not render PAN beside an AN", () => {
    const identity = headerSearchIdentity({
      admission_no: "AN-283F4F18",
      pre_admission_no: "PAN-E5B25972",
    });
    render(
      <HeaderSearchHit
        result={{
          type: "student",
          id: "s1",
          name: "Pawan Yadav",
          phone: "+9190982470240",
          ...identity,
          status: "active",
        }}
        onClick={() => {}}
      />,
    );

    const name = screen.getByText("Pawan Yadav");
    expect(within(name.parentElement!).queryByText(/AN:/)).toBeNull();
    expect(name).not.toHaveClass("truncate");

    expect(screen.getByText("AN: AN-283F4F18")).toBeInTheDocument();
    expect(screen.queryByText(/PAN:/)).toBeNull();
    expect(screen.getByText("Student")).toBeInTheDocument();
  });

  it("masks the phone as first3****last3 for non-super-admin viewers", () => {
    render(
      <HeaderSearchHit
        result={{
          type: "lead",
          id: "l1",
          name: "Amit Kumar",
          phone: "9812345892",
        }}
        onClick={() => {}}
      />,
    );
    expect(screen.getByText(/981\*\*\*\*892/)).toBeInTheDocument();
    expect(screen.queryByText("9812345892")).toBeNull();
  });
});
