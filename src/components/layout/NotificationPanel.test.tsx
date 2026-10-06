import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NotificationPanel } from "./NotificationPanel";

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  update: vi.fn(),
  eq: vi.fn(),
  channel: vi.fn(),
  removeChannel: vi.fn(),
  onInsert: null as ((payload: { new: Record<string, unknown> }) => void) | null,
  user: { id: "user-super-admin" },
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: mocks.from,
    channel: mocks.channel,
    removeChannel: mocks.removeChannel,
  },
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: mocks.user }) }));

function CurrentPath() {
  const location = useLocation();
  return <output>{`${location.pathname}${location.search}`}</output>;
}

describe("notification toast navigation", () => {
  beforeEach(() => {
    mocks.update.mockReset();
    mocks.eq.mockReset();
    mocks.from.mockReset().mockImplementation(() => {
      let isUpdate = false;
      const query: Record<string, any> = {};
      query.select = vi.fn(() => query);
      mocks.update.mockImplementation(() => { isUpdate = true; return query; });
      mocks.eq.mockImplementation(() => isUpdate ? Promise.resolve({ error: null }) : query);
      query.update = mocks.update;
      query.eq = mocks.eq;
      query.neq = vi.fn(() => query);
      query.order = vi.fn(() => query);
      query.limit = vi.fn(async () => ({ data: [], error: null }));
      return query;
    });
    mocks.onInsert = null;
    mocks.channel.mockReset().mockImplementation(() => {
      const channel: Record<string, any> = {};
      channel.on = vi.fn((_event: unknown, _filter: unknown, callback: typeof mocks.onInsert) => {
        mocks.onInsert = callback;
        return channel;
      });
      channel.subscribe = vi.fn(() => channel);
      return channel;
    });
  });

  it("marks a clicked refund toast as read and navigates to its draft", async () => {
    render(<MemoryRouter><NotificationPanel /><CurrentPath /></MemoryRouter>);
    await waitFor(() => expect(mocks.onInsert).toBeTypeOf("function"));

    act(() => mocks.onInsert?.({ new: {
      id: "refund-notification-1",
      type: "approval_pending",
      title: "New refund request",
      body: "Asha Verma · ₹1,234.50 is awaiting approval.",
      link: "/finance?tab=refunds&status=draft&refund_id=refund-1",
      is_read: false,
      created_at: new Date().toISOString(),
    } }));

    fireEvent.click(await screen.findByText("New refund request"));

    await waitFor(() => expect(mocks.update).toHaveBeenCalledWith({ is_read: true }));
    expect(mocks.eq).toHaveBeenCalledWith("id", "refund-notification-1");
    expect(screen.getByText("/finance?tab=refunds&status=draft&refund_id=refund-1")).toBeInTheDocument();
    expect(screen.queryByText("New refund request")).not.toBeInTheDocument();
  });
});
