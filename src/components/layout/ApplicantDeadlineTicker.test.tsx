import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ApplicantDeadlineTicker } from "./ApplicantDeadlineTicker";
import { PortalProvider } from "@/components/apply/PortalContext";
import { currentMiraiAdmissionRound } from "@/lib/deadlineRollover";

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ role: "super_admin" }),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: vi.fn().mockResolvedValue({
      data: { fee_submission_deadline: "2026-06-14" },
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
    vi.setSystemTime(new Date("2026-06-12T00:00:00+05:30"));

    render(
      <MemoryRouter>
        <ApplicantDeadlineTicker />
      </MemoryRouter>,
    );

    expect(screen.getByText("Admissions 2026-27")).toBeInTheDocument();
    expect(screen.getByText("Application Deadline for all other courses: apply by 14th June 2026")).toBeInTheDocument();
    expect(screen.getByText("UP-DELED")).toBeInTheDocument();
    expect(screen.getByText((_, element) => element?.textContent === "Deadline 9th July 2026, 11:59 PM")).toBeInTheDocument();
    expect(screen.getByText("27d 23h 59m 59s")).toBeInTheDocument();
    expect(screen.queryByText(/CAHET/)).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Apply Now/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Edit" })).not.toBeInTheDocument();
  });

  it("renders the public application deadline like the NIMT website announcement header", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-12T00:00:00+05:30"));

    render(
      <MemoryRouter initialEntries={["/apply/nimt"]}>
        <PortalProvider>
          <ApplicantDeadlineTicker audience="public" />
        </PortalProvider>
      </MemoryRouter>,
    );

    expect(screen.getByText("Admissions 2026-27")).toBeInTheDocument();
    expect(screen.getByText("Application Deadline for all other courses: apply by 14th June 2026")).toBeInTheDocument();
    expect(screen.getByText("UP-DELED")).toBeInTheDocument();
    expect(screen.getByText((_, element) => element?.textContent === "Deadline 9th July 2026, 11:59 PM")).toBeInTheDocument();
    expect(screen.getByText("27d 23h 59m 59s")).toBeInTheDocument();
    expect(screen.queryByText(/CAHET/)).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Apply Now/i })).toHaveAttribute("href", "/apply/nimt");
    expect(screen.queryByRole("link", { name: "Edit" })).not.toBeInTheDocument();
  });

  it("renders school portal deadlines without BPT or BMRIT wording", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-12T00:00:00+05:30"));

    render(
      <MemoryRouter initialEntries={["/apply/mirai"]}>
        <PortalProvider>
          <ApplicantDeadlineTicker audience="public" />
        </PortalProvider>
      </MemoryRouter>,
    );

    expect(screen.getByText("Mirai School")).toBeInTheDocument();
    expect(screen.getByText("Admissions 2027-28")).toBeInTheDocument();
    expect(screen.getByText("Round 1 Application Deadline for Admission: apply by 20th October 2026")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Apply Now/i })).toHaveAttribute("href", "/apply/mirai");
    expect(screen.queryByText("BPT & BMRIT")).not.toBeInTheDocument();
    expect(screen.queryByText("UP-DELED")).not.toBeInTheDocument();
    expect(screen.queryByText(/CAHET/)).not.toBeInTheDocument();
  });

  it("keeps school portals in Round 2 for the first five-day extension", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-15T00:00:00+05:30"));

    render(
      <MemoryRouter initialEntries={["/apply/beacon"]}>
        <PortalProvider>
          <ApplicantDeadlineTicker audience="public" />
        </PortalProvider>
      </MemoryRouter>,
    );

    expect(screen.getByText("NIMT Beacon School")).toBeInTheDocument();
    expect(screen.getByText("Round 2 Application Deadline for Admission: apply by 19th June 2026")).toBeInTheDocument();
    expect(screen.queryByText(/^Application deadline/)).not.toBeInTheDocument();
    expect(screen.queryByText("BPT & BMRIT")).not.toBeInTheDocument();
    expect(screen.queryByText("UP-DELED")).not.toBeInTheDocument();
    expect(screen.queryByText(/CAHET/)).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Apply Now/i })).toHaveAttribute("href", "/apply/beacon");
    expect(screen.getByText("4d 23h 59m 59s")).toBeInTheDocument();
  });

  it("moves Mirai through the six monthly 2027-28 application rounds", () => {
    const dates = [
      ["2026-10-06T12:00:00+05:30", 1, "2026-10-20"],
      ["2026-10-21T00:00:00+05:30", 2, "2026-11-20"],
      ["2026-11-21T00:00:00+05:30", 3, "2026-12-20"],
      ["2026-12-21T00:00:00+05:30", 4, "2027-01-20"],
      ["2027-01-21T00:00:00+05:30", 5, "2027-02-20"],
      ["2027-02-21T00:00:00+05:30", 6, "2027-03-20"],
    ] as const;
    for (const [date, round, deadline] of dates) {
      expect(currentMiraiAdmissionRound(new Date(date).getTime())).toEqual({ round, deadline });
    }
    expect(currentMiraiAdmissionRound(new Date("2027-03-21T00:00:00+05:30").getTime())).toBeNull();
  });

  it("shows the current Mirai round on the live portal ticker", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-06T12:00:00+05:30"));

    render(
      <MemoryRouter initialEntries={["/apply/mirai"]}>
        <PortalProvider>
          <ApplicantDeadlineTicker audience="public" />
        </PortalProvider>
      </MemoryRouter>,
    );

    expect(screen.getByText("Mirai School")).toBeInTheDocument();
    expect(screen.getByText("Admissions 2027-28")).toBeInTheDocument();
    expect(screen.getByText("Round 1 Application Deadline for Admission: apply by 20th October 2026")).toBeInTheDocument();
    expect(screen.queryByText(/CAHET/)).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Apply Now/i })).toHaveAttribute("href", "/apply/mirai");
  });
});
