import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import FeeCollections from "@/pages/FeeCollections";

type Response = { data: Record<string, unknown>[] | null; error: { message: string } | null };
type Query = PromiseLike<Response> & {
  select(): Query;
  order(): Query;
  gte(): Query;
  lt(): Query;
  or(): Query;
  eq(): Query;
  limit(): Query;
};

const mock = vi.hoisted(() => ({
  receiptResponses: [] as Promise<Response>[],
  receiptQueries: 0,
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => {
      if (table === "v_all_payments") mock.receiptQueries += 1;
      const response = table === "v_all_payments"
        ? mock.receiptResponses.shift() ?? Promise.resolve({ data: [], error: null })
        : Promise.resolve({ data: [], error: null });
      const query: Query = {
        select: () => query,
        order: () => query,
        gte: () => query,
        lt: () => query,
        or: () => query,
        eq: () => query,
        limit: () => query,
        then: (resolve, reject) => response.then(resolve, reject),
      };
      return query;
    },
  },
}));
vi.mock("@/contexts/CampusContext", () => ({ useCampus: () => ({ selectedCampusId: "all" }) }));
vi.mock("@/contexts/PermissionContext", () => ({ usePermissions: () => ({ can: () => false }) }));
vi.mock("@/components/ui/thinking-orb", () => ({ OrbLoader: () => <div>Loading receipts…</div> }));
vi.mock("@/components/ui/state-fields", () => ({ FieldShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>, SelectField: () => null }));
vi.mock("@/components/receipts/ReceiptDialog", () => ({ ReceiptDialog: () => null }));
vi.mock("@/components/finance/RefundDialog", () => ({ RefundDialog: () => null }));
vi.mock("@/components/finance/RepairReceiptLinkDialog", () => ({ RepairReceiptLinkDialog: () => null }));

const ok = (data: Record<string, unknown>[] = []) => Promise.resolve({ data, error: null });

function renderPage() {
  return render(<MemoryRouter initialEntries={["/collections"]}><FeeCollections /></MemoryRouter>);
}

beforeEach(() => {
  mock.receiptResponses = [];
  mock.receiptQueries = 0;
});
afterEach(cleanup);

describe("Finance receipts read state", () => {
  it("shows a read error instead of an empty collection and retries successfully", async () => {
    mock.receiptResponses = [
      Promise.resolve({ data: null, error: { message: "Receipt service unavailable" } }),
      ok(),
    ];

    renderPage();

    expect(await screen.findByText("Could not load receipts")).toBeInTheDocument();
    expect(screen.getByText("Receipt service unavailable")).toBeInTheDocument();
    expect(screen.queryByText("No collections recorded today yet")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Retry receipts" }));

    expect(await screen.findByText("No collections recorded today yet")).toBeInTheDocument();
    expect(screen.queryByText("Could not load receipts")).not.toBeInTheDocument();
    expect(mock.receiptQueries).toBe(2);
  });

  it("turns a rejected receipt request into a retryable error state", async () => {
    mock.receiptResponses = [
      Promise.reject(new Error("Connection reset")),
      ok(),
    ];

    renderPage();

    expect(await screen.findByText("Could not load receipts")).toBeInTheDocument();
    expect(screen.getByText("Connection reset")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry receipts" }));
    expect(await screen.findByText("No collections recorded today yet")).toBeInTheDocument();
    expect(mock.receiptQueries).toBe(2);
  });

  it("explains when an exact review reference has no visible receipt", async () => {
    mock.receiptResponses = [ok()];

    render(
      <MemoryRouter initialEntries={["/finance?tab=receipts&receipt_ref=REF-MISSING"]}>
        <FeeCollections embedded fromDate="" toDate="" />
      </MemoryRouter>,
    );

    expect(await screen.findByText(
      "No visible confirmed receipt matches this reference. Check it or ask an administrator to verify access.",
    )).toBeInTheDocument();
  });
});
