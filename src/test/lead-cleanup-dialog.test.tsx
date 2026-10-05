import { fireEvent, render, screen, waitFor, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LeadCleanupDialog } from "@/components/leads/LeadCleanupDialog";

const mocks = vi.hoisted(() => ({ role: "super_admin", rpc: vi.fn(), runs: [] as unknown[] }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ role: mocks.role }) }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {
  rpc: mocks.rpc,
  from: () => ({ select: () => ({ order: () => ({ limit: async () => ({ data: mocks.runs, error: null }) }) }) }),
} }));
const preview = { cutoff: "2026-10-05T08:00:00Z", digest: "reviewed-digest", items: [{ lead_id: "lead-1", name: "Nursing prospect", action: "retain", reason: "ashish", destination: "ashish-id" }], staff: [{ id: "ashish-id", name: "Ashish" }] };
const report = { run: { id: "run-1", status: "applied", archive_list_id: "archive-list" }, counts: { applied: 1 }, assignments: [{ name: "Ashish", count: 1 }], exceptions: [], mirai_balanced: true };

beforeEach(() => {
  mocks.role = "super_admin"; mocks.runs = []; mocks.rpc.mockReset();
  mocks.rpc.mockImplementation(async (name: string) => ({ data: name === "preview_lead_cleanup" ? preview : name === "prepare_lead_cleanup" ? "run-1" : name === "lead_cleanup_report" ? report : { remaining: 0, processed: 1 }, error: null }));
});
afterEach(cleanup);
function mount() { return render(<MemoryRouter><LeadCleanupDialog onChanged={vi.fn()} /></MemoryRouter>); }

describe("lead cleanup review controls", () => {
  it("hides the cleanup entry point from counsellors", () => {
    mocks.role = "counsellor"; mount();
    expect(screen.queryByText("Archive old leads")).not.toBeInTheDocument();
  });
  it("requires review before apply and submits the exact cutoff and digest", async () => {
    mount(); fireEvent.click(screen.getByText("Archive old leads"));
    fireEvent.click(await screen.findByText("Build read-only preview"));
    const apply = await screen.findByText("Apply reviewed cleanup");
    expect(apply).toBeDisabled();
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("link", { name: "Nursing prospect" })).toHaveAttribute("href", "/admissions/lead-1");
    fireEvent.click(screen.getByRole("checkbox")); fireEvent.click(apply);
    await screen.findByText("Open marketing archive list");
    expect(mocks.rpc).toHaveBeenCalledWith("prepare_lead_cleanup", { _cutoff: preview.cutoff, _expected_digest: preview.digest });
    expect(mocks.rpc).toHaveBeenCalledWith("apply_lead_cleanup", { _run_id: "run-1", _limit: 100 });
  });
  it("shows stale-preview errors without applying and keeps the fixed cutoff on refresh", async () => {
    mocks.rpc.mockImplementation(async (name: string) => name === "prepare_lead_cleanup" ? { data: null, error: { message: "Preview changed. Review a fresh preview before applying" } } : { data: preview, error: null });
    mount(); fireEvent.click(screen.getByText("Archive old leads"));
    fireEvent.click(await screen.findByText("Build read-only preview"));
    await screen.findByText("Apply reviewed cleanup");
    fireEvent.click(screen.getByRole("checkbox")); fireEvent.click(screen.getByText("Apply reviewed cleanup"));
    expect(await screen.findByRole("alert")).toHaveTextContent("Preview changed");
    expect(mocks.rpc.mock.calls.some(([name]) => name === "apply_lead_cleanup")).toBe(false);
    fireEvent.click(screen.getByText("Refresh this preview"));
    await waitFor(() => expect(mocks.rpc).toHaveBeenLastCalledWith("preview_lead_cleanup", { _cutoff: preview.cutoff }));
  });
  it("recovers a saved interrupted run and resumes the existing snapshot", async () => {
    mocks.runs = [{ id: "run-1", cutoff: preview.cutoff, status: "applying" }];
    mocks.rpc.mockImplementation(async (name: string) => ({ data: name === "lead_cleanup_report" ? { ...report, run: { ...report.run, status: "applying" } } : { remaining: 0, processed: 1 }, error: null }));
    mount(); fireEvent.click(screen.getByText("Archive old leads"));
    fireEvent.click(await screen.findByText(/· applying/));
    fireEvent.click(await screen.findByText("Resume cleanup"));
    await waitFor(() => expect(mocks.rpc).toHaveBeenCalledWith("apply_lead_cleanup", { _run_id: "run-1", _limit: 100 }));
    expect(mocks.rpc.mock.calls.some(([name]) => name === "prepare_lead_cleanup")).toBe(false);
  });
});
