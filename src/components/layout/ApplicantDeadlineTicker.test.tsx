import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ApplicantDeadlineTicker } from "./ApplicantDeadlineTicker";

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ role: "super_admin" }),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: vi.fn().mockResolvedValue({
      data: { fee_submission_deadline: "2026-06-10" },
      error: null,
    }),
  },
}));

describe("ApplicantDeadlineTicker", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders the staff application deadline with the public announcement header", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-06T00:00:00+05:30"));

    render(
      <MemoryRouter>
        <ApplicantDeadlineTicker />
      </MemoryRouter>,
    );

    expect(screen.getByText("Admissions 2026-27")).toBeInTheDocument();
    expect(screen.getByText("Round 1 deadline: apply by 10th June 2026")).toBeInTheDocument();
    expect(screen.getByText("BPT & BMRIT")).toBeInTheDocument();
    expect(screen.getByText(/CAHET registration on ABVMU due/)).toBeInTheDocument();
    expect(screen.getByText("4d 23h 59m 59s")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Apply Now/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Edit" })).not.toBeInTheDocument();
  });

  it("renders the public application deadline like the NIMT website announcement header", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-06T00:00:00+05:30"));

    render(
      <MemoryRouter>
        <ApplicantDeadlineTicker audience="public" />
      </MemoryRouter>,
    );

    expect(screen.getByText("Admissions 2026-27")).toBeInTheDocument();
    expect(screen.getByText("Round 1 deadline: apply by 10th June 2026")).toBeInTheDocument();
    expect(screen.getByText("BPT & BMRIT")).toBeInTheDocument();
    expect(screen.getByText(/CAHET registration on ABVMU due/)).toBeInTheDocument();
    expect(screen.getByText("4d 23h 59m 59s")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Apply Now/i })).toHaveAttribute("href", "/apply/nimt");
    expect(screen.queryByRole("link", { name: "Edit" })).not.toBeInTheDocument();
  });
});
