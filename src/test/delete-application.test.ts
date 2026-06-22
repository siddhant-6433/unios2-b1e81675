import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

const invokeEdgeMock = vi.fn();

vi.mock("@/integrations/supabase/edge", () => ({
  invokeEdge: invokeEdgeMock,
}));

const { deleteApplication, PAID_APPLICATION_DELETE_CONFIRMATION } = await import("@/lib/deleteApplication");
const restrictLeadDeleteMigration = readFileSync("supabase/migrations/20260620113500_restrict_application_lead_delete.sql", "utf8");
const deleteApplicationEdge = readFileSync("supabase/functions/delete-application/index.ts", "utf8");

describe("deleteApplication", () => {
  beforeEach(() => {
    invokeEdgeMock.mockReset();
  });

  it("blocks paid applications without typed confirmation before calling the edge function", async () => {
    const result = await deleteApplication({
      id: "app-row-1",
      applicationId: "APP-26-001",
      paymentStatus: "paid",
    });

    expect(invokeEdgeMock).not.toHaveBeenCalled();
    expect(result.error?.message).toBe(`Type ${PAID_APPLICATION_DELETE_CONFIRMATION} to delete a paid application.`);
    expect(result.error?.status).toBe(403);
  });

  it("invokes the delete-application edge function for paid applications with typed confirmation", async () => {
    invokeEdgeMock.mockResolvedValue({
      data: {
        success: true,
        application_id: "APP-26-001",
        deleted_storage_files: 4,
      },
      error: null,
    });

    const result = await deleteApplication({
      id: "app-row-1",
      applicationId: "APP-26-001",
      paymentStatus: "paid",
      paidDeleteConfirmation: PAID_APPLICATION_DELETE_CONFIRMATION,
    });

    expect(invokeEdgeMock).toHaveBeenCalledWith("delete-application", {
      body: {
        application_row_id: "app-row-1",
        paid_delete_confirmation: PAID_APPLICATION_DELETE_CONFIRMATION,
      },
    });
    expect(result.data?.success).toBe(true);
  });

  it("invokes the delete-application edge function for unpaid applications", async () => {
    invokeEdgeMock.mockResolvedValue({
      data: {
        success: true,
        application_id: "APP-26-001",
        deleted_storage_files: 4,
      },
      error: null,
    });

    const result = await deleteApplication({
      id: "app-row-1",
      applicationId: "APP-26-001",
      paymentStatus: "pending",
    });

    expect(invokeEdgeMock).toHaveBeenCalledWith("delete-application", {
      body: {
        application_row_id: "app-row-1",
        paid_delete_confirmation: undefined,
      },
    });
    expect(result.data?.success).toBe(true);
    expect(result.data?.application_id).toBe("APP-26-001");
  });

  it("keeps linked lead deletion from orphaning applications", () => {
    expect(restrictLeadDeleteMigration).toContain("DROP CONSTRAINT IF EXISTS applications_lead_id_fkey");
    expect(restrictLeadDeleteMigration).toContain("FOREIGN KEY (lead_id)");
    expect(restrictLeadDeleteMigration).toContain("ON DELETE RESTRICT");
  });

  it("requires typed confirmation for paid application deletion in the edge function", () => {
    expect(deleteApplicationEdge).toContain('const PAID_DELETE_CONFIRMATION = "CONFIRM"');
    expect(deleteApplicationEdge).toContain('app.payment_status === "paid" && paid_delete_confirmation !== PAID_DELETE_CONFIRMATION');
  });
});
