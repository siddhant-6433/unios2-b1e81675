import { invokeEdge } from "@/integrations/supabase/edge";

export const PAID_APPLICATION_DELETE_CONFIRMATION = "CONFIRM";

export interface DeleteApplicationInput {
  id: string;
  applicationId: string;
  paymentStatus?: string | null;
  paidDeleteConfirmation?: string;
}

export interface DeleteApplicationResult {
  success: true;
  application_id: string;
  deleted_storage_files: number;
}

export async function deleteApplication(input: DeleteApplicationInput) {
  if (
    input.paymentStatus === "paid" &&
    input.paidDeleteConfirmation !== PAID_APPLICATION_DELETE_CONFIRMATION
  ) {
    return {
      data: null,
      error: {
        message: `Type ${PAID_APPLICATION_DELETE_CONFIRMATION} to delete a paid application.`,
        status: 403,
        sessionExpired: false,
      },
    };
  }

  return invokeEdge<DeleteApplicationResult>("delete-application", {
    body: {
      application_row_id: input.id,
      paid_delete_confirmation: input.paidDeleteConfirmation,
    },
  });
}
