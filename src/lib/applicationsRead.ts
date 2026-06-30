export const APPLICATION_LIST_SELECT = "id, application_id, lead_id, full_name, phone, email, status, payment_status, payment_ref, fee_amount, program_category, course_selections, completed_sections, submitted_at, created_at, flags, dob, gender, category, father, mother, address, academic_details, form_pdf_url, fee_receipt_url";
export const APPLICATION_LIST_PAGE_SIZE = 500;

export type ApplicationsReadQuery<TRow = unknown> = {
  select(columns: string): ApplicationsReadQuery<TRow>;
  order(column: string, options: { ascending: boolean }): ApplicationsReadQuery<TRow>;
  range(from: number, to: number): Promise<{ data: TRow[] | null; error?: { message?: string } | null }>;
};

export type ApplicationsReadClient<TRow = unknown> = {
  from(table: "applications"): ApplicationsReadQuery<TRow>;
};

export async function fetchAllApplicationRows<TRow = unknown>(
  client: ApplicationsReadClient<TRow>,
  pageSize = APPLICATION_LIST_PAGE_SIZE,
): Promise<TRow[]> {
  const rows: TRow[] = [];

  for (let from = 0; ; from += pageSize) {
    const to = from + pageSize - 1;
    const { data, error } = await client
      .from("applications")
      .select(APPLICATION_LIST_SELECT)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .range(from, to);

    if (error) throw error;

    const page = data || [];
    rows.push(...page);

    if (page.length < pageSize) break;
  }

  return rows;
}
