// Keep each request below the API row cap. The roster's search and academic
// filters run locally, so they need every accessible row, not just page one.
export const STUDENT_LIST_PAGE_SIZE = 500;

type ReadResult<T> = { data: T[] | null; error: { message: string } | null };
export type StudentsReadQuery<T> = {
  select(fields: string): StudentsReadQuery<T>;
  is(column: string, value: null): StudentsReadQuery<T>;
  eq(column: string, value: string): StudentsReadQuery<T>;
  order(column: string, options: { ascending: boolean }): StudentsReadQuery<T>;
  range(from: number, to: number): PromiseLike<ReadResult<T>>;
};
export type StudentsReadClient<T> = {
  from(table: "students"): { select(fields: string): StudentsReadQuery<T> };
};

export async function fetchAllStudentRows<T>(
  client: StudentsReadClient<T>,
  selectFields: string,
  selectedCampusId: string,
  isCurrent = () => true,
): Promise<T[]> {
  let fields = selectFields;
  // Retry the entire roster with the compatible projection if an older schema
  // lacks optional columns. Never publish a partially loaded roster.
  for (;;) {
    const rows: T[] = [];
    let retry = false;
    for (let from = 0; isCurrent(); from += STUDENT_LIST_PAGE_SIZE) {
      let query = client.from("students").select(fields).is("deleted_at", null)
        .order("created_at", { ascending: false }).order("id", { ascending: false });
      if (selectedCampusId !== "all") query = query.eq("campus_id", selectedCampusId);
      const { data, error } = await query.range(from, from + STUDENT_LIST_PAGE_SIZE - 1);
      if (!isCurrent()) return [];
      if (error) {
        const missing = ["refunded_at", "semester"].find((column) =>
          fields.split(", ").includes(column) && error.message.toLowerCase().includes(column),
        );
        if (!missing) throw error;
        fields = fields.split(", ").filter((field) => field !== missing).join(", ");
        retry = true;
        break;
      }
      rows.push(...(data ?? []));
      if ((data?.length ?? 0) < STUDENT_LIST_PAGE_SIZE) return rows;
    }
    if (!retry) return [];
  }
}
