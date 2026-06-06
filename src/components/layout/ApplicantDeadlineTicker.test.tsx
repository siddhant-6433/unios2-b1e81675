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
      data: { fee_submission_deadline: "2026-06-15" },
      error: null,
    }),
  },
}));

describe("ApplicantDeadlineTicker", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders the all-course applicant deadline in the navbar strip", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-06T00:00:00+05:30"));

    render(
      <MemoryRouter>
        <ApplicantDeadlineTicker />
      </MemoryRouter>,
    );

    expect(screen.getByText("All-course deadline")).toBeInTheDocument();
    expect(screen.getByText(/15 Jun 2026/)).toBeInTheDocument();
    expect(screen.getByText(/10 days left/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Edit" })).toHaveAttribute("href", "/settings");

  });

  it("renders the public application deadline without staff role gating", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-06T00:00:00+05:30"));

    render(
      <MemoryRouter>
        <ApplicantDeadlineTicker audience="public" />
      </MemoryRouter>,
    );

    expect(screen.getByText("Application deadline")).toBeInTheDocument();
    expect(screen.getByText(/10 Jun 2026/)).toBeInTheDocument();
    expect(screen.getByText(/5 days left/)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Edit" })).not.toBeInTheDocument();
  });
});
