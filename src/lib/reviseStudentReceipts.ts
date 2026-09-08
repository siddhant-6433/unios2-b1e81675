import { supabase } from "@/integrations/supabase/client";

export type ReviseReceiptsResult = {
  attempted: number;
  revised: number;
  failed: number;
};

const RECEIPT_GEN_GAP_MS = 400;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function listConfirmedReceiptPayments(opts: {
  studentId: string;
  leadId?: string | null;
}): Promise<Array<{ id: string }>> {
  const select = "id, status, receipt_no";
  const byLead = opts.leadId
    ? supabase.from("lead_payments").select(select).eq("lead_id", opts.leadId)
    : null;
  const byStudent = supabase.from("lead_payments").select(select).eq("student_id", opts.studentId);

  const [leadRows, studentRows] = await Promise.all([
    byLead ?? Promise.resolve({ data: [] as Array<{ id: string; status: string | null; receipt_no: string | null }> }),
    byStudent,
  ]);

  const seen = new Set<string>();
  const out: Array<{ id: string }> = [];
  const rows = [
    ...((leadRows.data || []) as Array<{ id: string; status: string | null; receipt_no: string | null }>),
    ...((studentRows.data || []) as Array<{ id: string; status: string | null; receipt_no: string | null }>),
  ];
  for (const row of rows) {
    if (!row?.id || seen.has(row.id)) continue;
    if (row.status !== "confirmed" || !row.receipt_no) continue;
    seen.add(row.id);
    out.push({ id: row.id });
  }
  return out;
}

// Re-runs generate-payment-receipt for every confirmed receipt on this student.
// The generator upserts the PDF and stamps receipt_course_id, so a course
// migration can reprint earlier receipts with the current programme + note.
export async function reviseStudentReceiptPdfs(opts: {
  studentId: string;
  leadId?: string | null;
  paymentIds?: string[];
}): Promise<ReviseReceiptsResult> {
  const payments = opts.paymentIds
    ? opts.paymentIds.filter(Boolean).map((id) => ({ id }))
    : await listConfirmedReceiptPayments(opts);
  let revised = 0;
  let failed = 0;
  for (const [index, payment] of payments.entries()) {
    const { error } = await supabase.functions.invoke("generate-payment-receipt", {
      body: { payment_id: payment.id },
    });
    if (error) failed += 1;
    else revised += 1;
    if (index < payments.length - 1) await sleep(RECEIPT_GEN_GAP_MS);
  }
  return { attempted: payments.length, revised, failed };
}
