import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LifecyclePanel } from "@/components/hr/LifecyclePanel";

const mocks = vi.hoisted(() => ({
  toast: vi.fn(),
  insert: vi.fn(),
  update: vi.fn(),
  exits: [] as Array<Record<string, unknown>>,
  insertError: null as { message: string } | null,
  updateError: null as { message: string } | null,
}));

type QueryResult = {
  data: Array<Record<string, unknown>> | null;
  error: { message: string } | null;
};

type ExitQuery = {
  select: (columns: string) => ExitQuery;
  eq: (column: string, value: unknown) => ExitQuery;
  is: (column: string, value: unknown) => ExitQuery;
  neq: (column: string, value: unknown) => ExitQuery;
  order: (...args: unknown[]) => ExitQuery;
  limit: () => Promise<QueryResult>;
  insert: (payload: Record<string, unknown>) => {
    select: () => { single: () => Promise<{ data: { id: string } | null; error: { message: string } | null }> };
  };
  update: (payload: Record<string, unknown>) => {
    eq: (column: string, id: string) => {
      select: () => Promise<{ data: Array<{ id: string }> | null; error: { message: string } | null }>;
    };
  };
};

function queryFor(table: string): ExitQuery {
  const filters = new Map<string, unknown>();
  let selection = "";
  const query: ExitQuery = {
    select(columns: string) { selection = columns; return query; },
    eq(column: string, value: unknown) { filters.set(column, value); return query; },
    is(column: string, value: unknown) { filters.set(column, value); return query; },
    neq(column: string, value: unknown) { filters.set(column, value); return query; },
    order() { return query; },
    limit: async () => {
      if (table === "employee_profiles" && filters.get("verification_status") === "verified") {
        return { data: [{ id: "emp-1", display_name: "QA Employee", employee_number: "QA-1", job_title: "QA role" }], error: null };
      }
      if (table === "employee_exits" && selection === "employee_profile_id") {
        return { data: mocks.exits.map(({ employee_profile_id }) => ({ employee_profile_id })), error: null };
      }
      if (table === "employee_exits") return { data: mocks.exits, error: null };
      return { data: [], error: null };
    },
    insert(payload: Record<string, unknown>) {
      mocks.insert(payload);
      return { select: () => ({ single: async () => ({ data: mocks.insertError ? null : { id: "exit-1" }, error: mocks.insertError }) }) };
    },
    update(payload: Record<string, unknown>) {
      mocks.update(payload);
      return { eq: (_column: string, id: string) => ({
        select: async () => {
          if (mocks.updateError) return { data: null, error: mocks.updateError };
          mocks.exits = mocks.exits.map((exit) => exit.id === id ? { ...exit, ...payload } : exit);
          return { data: [{ id }], error: null };
        },
      }) };
    },
  };
  return query;
}

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: (table: string) => queryFor(table) },
}));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: mocks.toast }) }));

describe("HR exit intake", () => {
  beforeEach(() => {
    mocks.toast.mockReset();
    mocks.insert.mockReset();
    mocks.update.mockReset();
    mocks.exits = [];
    mocks.insertError = null;
    mocks.updateError = null;
  });

  async function openExitDialog() {
    render(<LifecyclePanel />);
    const button = await screen.findByRole("button", { name: "Record exit" });
    fireEvent.click(button);
    return within(await screen.findByRole("dialog"));
  }

  it("rejects a last working day earlier than the notice date", async () => {
    const dialog = await openExitDialog();
    fireEvent.change(dialog.getByLabelText("Employee"), { target: { value: "emp-1" } });
    fireEvent.change(dialog.getByLabelText("Resignation / notice date"), { target: { value: "2026-10-10" } });
    fireEvent.change(dialog.getByLabelText("Last working day"), { target: { value: "2026-10-09" } });
    fireEvent.click(dialog.getByRole("button", { name: "Record exit" }));

    expect(mocks.insert).not.toHaveBeenCalled();
    expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Check the exit dates" }));
  });

  it("submits the selected employee and exit details as an in-progress exit", async () => {
    const dialog = await openExitDialog();
    fireEvent.change(dialog.getByLabelText("Employee"), { target: { value: "emp-1" } });
    fireEvent.change(dialog.getByLabelText("Resignation / notice date"), { target: { value: "2026-10-01" } });
    fireEvent.change(dialog.getByLabelText("Last working day"), { target: { value: "2026-10-15" } });
    fireEvent.change(dialog.getByLabelText("Reason"), { target: { value: "QA-only test" } });
    fireEvent.click(dialog.getByRole("checkbox", { name: "Notice period waived" }));
    fireEvent.change(dialog.getByPlaceholderText("Equipment, access, handover, or other clearance details"), {
      target: { value: "Return QA laptop" },
    });
    fireEvent.click(dialog.getByRole("button", { name: "Record exit" }));

    await waitFor(() => expect(mocks.insert).toHaveBeenCalledWith({
      employee_profile_id: "emp-1",
      exit_type: "resignation",
      resignation_date: "2026-10-01",
      last_working_day: "2026-10-15",
      reason: "QA-only test",
      notice_waived: true,
      clearance: { notes: "Return QA laptop" },
      status: "in_progress",
    }));
    expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Exit recorded" }));
  });

  it("shows an insert error and leaves the exit unrecorded", async () => {
    mocks.insertError = { message: "permission denied" };
    const dialog = await openExitDialog();
    fireEvent.change(dialog.getByLabelText("Employee"), { target: { value: "emp-1" } });
    fireEvent.change(dialog.getByLabelText("Last working day"), { target: { value: "2026-10-15" } });
    fireEvent.click(dialog.getByRole("button", { name: "Record exit" }));

    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({
      title: "Could not record the exit",
      description: "permission denied",
      variant: "destructive",
    })));
  });

  it("completes an in-progress exit and refreshes its status", async () => {
    mocks.exits = [{
      id: "exit-1",
      employee_profile_id: "emp-1",
      exit_type: "resignation",
      resignation_date: "2026-10-01",
      last_working_day: "2026-10-15",
      reason: "QA-only test",
      notice_waived: false,
      clearance: { notes: "Return QA laptop" },
      status: "in_progress",
      employee_profiles: { display_name: "QA Employee", job_title: "QA role" },
    }];
    render(<LifecyclePanel />);
    fireEvent.click(await screen.findByRole("button", { name: "Complete" }));

    await waitFor(() => expect(mocks.update).toHaveBeenCalledWith({ status: "completed" }));
    expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Exit completed" }));
    await waitFor(() => expect(screen.getByText("completed")).toBeInTheDocument());
  });
});
