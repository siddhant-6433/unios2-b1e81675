export const APPLICATION_LIST_SELECT = "id, application_id, lead_id, full_name, phone, email, status, payment_status, payment_ref, fee_amount, program_category, course_selections, completed_sections, submitted_at, created_at, updated_at, flags, dob, gender, category, father, mother, address, academic_details, form_pdf_url, fee_receipt_url, hold_reason";
// Supabase caps every response at db-max-rows=1000, so this is the largest a
// single .range() request can actually return. Bigger value = fewer round trips.
export const APPLICATION_LIST_PAGE_SIZE = 1000;

export type ApplicationsReadResult<TRow> = {
  data: TRow[] | null;
  count?: number | null;
  error?: { message?: string } | null;
};

export type ApplicationsReadQuery<TRow = unknown> = {
  select(columns: string, options?: { count?: "exact" }): ApplicationsReadQuery<TRow>;
  order(column: string, options: { ascending: boolean }): ApplicationsReadQuery<TRow>;
  range(from: number, to: number): Promise<ApplicationsReadResult<TRow>>;
};

export type ApplicationsReadClient<TRow = unknown> = {
  from(table: "applications"): ApplicationsReadQuery<TRow>;
};

function page<TRow>(
  client: ApplicationsReadClient<TRow>,
  from: number,
  to: number,
  withCount: boolean,
): Promise<ApplicationsReadResult<TRow>> {
  return client
    .from("applications")
    .select(APPLICATION_LIST_SELECT, withCount ? { count: "exact" } : undefined)
    .order("updated_at", { ascending: false })
    .order("id", { ascending: false })
    .range(from, to);
}

// Admins load the whole applications table (a few thousand rows, capped at 1000
// per request). The old version walked pages sequentially, so time-to-render was
// the *sum* of every page. Instead grab page 0 with an exact count, then fetch
// the remaining pages in parallel — wall-clock drops to ~2 round trips.
export async function fetchAllApplicationRows<TRow = unknown>(
  client: ApplicationsReadClient<TRow>,
  pageSize = APPLICATION_LIST_PAGE_SIZE,
): Promise<TRow[]> {
  const first = await page<TRow>(client, 0, pageSize - 1, true);
  if (first.error) throw first.error;

  const rows = first.data ? [...first.data] : [];
  const total = first.count ?? rows.length;
  if (total <= rows.length) return rows;

  const requests: Promise<ApplicationsReadResult<TRow>>[] = [];
  for (let from = rows.length; from < total; from += pageSize) {
    requests.push(page<TRow>(client, from, from + pageSize - 1, false));
  }

  for (const res of await Promise.all(requests)) {
    if (res.error) throw res.error;
    if (res.data) rows.push(...res.data);
  }

  return rows;
}
