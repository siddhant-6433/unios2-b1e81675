import { supabase } from "@/integrations/supabase/client";

export type StudentArchiveStatus = "active" | "archived";

export async function fetchReportStudentArchiveStatuses(studentIds: string[]) {
  if (studentIds.length === 0) return new Map<string, StudentArchiveStatus>();

  const { data, error } = await (supabase.rpc as unknown as (
    this: typeof supabase,
    fn: string,
    args: { _student_ids: string[] },
  ) => Promise<{
    data: { statuses?: { student_id: string; student_status: StudentArchiveStatus }[] } | null;
    error: { message: string } | null;
  }>).call(supabase, "report_student_archive_status", { _student_ids: studentIds });

  if (error) throw new Error(error.message);

  return new Map(
    (data?.statuses ?? []).map(({ student_id, student_status }) => [student_id, student_status] as const),
  );
}
