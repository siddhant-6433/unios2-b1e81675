import { invokeEdge } from "@/integrations/supabase/edge";

export interface DeleteApplicationInput {
  id: string;
  applicationId: string;
  paymentStatus?: string | null;
}

export interface DeleteApplicationResult {
  success: true;
  application_id: string;
  deleted_storage_files: number;
}

export async function deleteApplication(input: DeleteApplicationInput) {
  if (input.paymentStatus === "paid") {
    return {
      data: null,
      error: {
        message: "Paid applications cannot be deleted.",
        status: 403,
        sessionExpired: false,
      },
    };
  }

  return invokeEdge<DeleteApplicationResult>("delete-application", {
    body: { application_row_id: input.id },
  });
}
