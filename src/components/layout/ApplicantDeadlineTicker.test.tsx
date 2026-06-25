import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ApplicantDeadlineTicker } from "./ApplicantDeadlineTicker";
import { PortalProvider } from "@/components/apply/PortalContext";

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
    expect(screen.getByText("UP-DELED Deadline: apply by 9th July 2026")).toBeInTheDocument();
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
    expect(screen.getByText("UP-DELED Deadline: apply by 9th July 2026")).toBeInTheDocument();
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
    expect(screen.getByText("Round 2 Application Deadline for Admission: apply by 14th June 2026")).toBeInTheDocument();
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

  it("moves school portals to Round 3 after two Round 2 extensions", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-25T00:00:00+05:30"));

    render(
      <MemoryRouter initialEntries={["/apply/mirai"]}>
        <PortalProvider>
          <ApplicantDeadlineTicker audience="public" />
        </PortalProvider>
      </MemoryRouter>,
    );

    expect(screen.getByText("Mirai School")).toBeInTheDocument();
    expect(screen.getByText("Round 3 Application Deadline for Admission: apply by 29th June 2026")).toBeInTheDocument();
    expect(screen.queryByText(/^Application deadline/)).not.toBeInTheDocument();
    expect(screen.queryByText(/CAHET/)).not.toBeInTheDocument();
    expect(screen.getByText("4d 23h 59m 59s")).toBeInTheDocument();
  });
});
