import { describe, expect, it } from "vitest";
import { fetchAllStudentRows, STUDENT_LIST_PAGE_SIZE, type StudentsReadClient, type StudentsReadQuery } from "./studentsRead";

function mockClient(respond: (from: number, fields: string) => { data: { id: string; name: string }[] | null; error: { message: string } | null }) {
  const calls: { fields: string; campus: string | null; orders: string[]; deleted: boolean; from: number; to: number }[] = [];
  const client: StudentsReadClient<{ id: string; name: string }> = {
    from: () => {
      const call = { fields: "", campus: null as string | null, orders: [] as string[], deleted: false, from: 0, to: 0 };
      const query: StudentsReadQuery<{ id: string; name: string }> = {
        select: (fields) => { call.fields = fields; return query; },
        is: (column, value) => { call.deleted = column === "deleted_at" && value === null; return query; },
        eq: (column, value) => { expect(column).toBe("campus_id"); call.campus = value; return query; },
        order: (column, options) => { expect(options.ascending).toBe(false); call.orders.push(column); return query; },
        range: async (from, to) => { call.from = from; call.to = to; calls.push(call); return respond(from, call.fields); },
      };
      return query;
    },
  };
  return { client, calls };
}

describe("complete student roster", () => {
  it("loads and searches beyond the first 500, with stable ordering and campus scope on every page", async () => {
    const rows = Array.from({ length: 1101 }, (_, i) => ({ id: `s${i}`, name: i === 900 ? "Avni Dahima" : `Student ${i}` }));
    const { client, calls } = mockClient((from) => ({ data: rows.slice(from, from + STUDENT_LIST_PAGE_SIZE), error: null }));
    const loaded = await fetchAllStudentRows(client, "id, name", "school-campus");
    expect(loaded).toHaveLength(1101);
    expect(loaded.find((s) => s.name.toLowerCase().includes("avni"))?.id).toBe("s900");
    expect(calls.map((c) => [c.from, c.to])).toEqual([[0, 499], [500, 999], [1000, 1499]]);
    for (const call of calls) {
      expect(call.campus).toBe("school-campus");
      expect(call.orders).toEqual(["created_at", "id"]);
      expect(call.deleted).toBe(true);
      expect(call.fields).toBe("id, name"); // Contact columns stay caller-controlled.
    }
  });

  it("leaves all-campus reads unfiltered and handles an exact full last page", async () => {
    const rows = Array.from({ length: 500 }, (_, i) => ({ id: `${i}`, name: "Student" }));
    const { client, calls } = mockClient((from) => ({ data: from === 0 ? rows : [], error: null }));
    expect(await fetchAllStudentRows(client, "id, name", "all")).toHaveLength(500);
    expect(calls).toHaveLength(2);
    expect(calls.every((c) => c.campus === null)).toBe(true);
  });

  it("fails the entire load if a later page errors", async () => {
    const { client } = mockClient((from) => from === 0
      ? { data: Array.from({ length: 500 }, (_, i) => ({ id: `${i}`, name: "Student" })), error: null }
      : { data: null, error: { message: "Network unavailable" } });
    await expect(fetchAllStudentRows(client, "id, name", "all")).rejects.toEqual({ message: "Network unavailable" });
  });

  it("preserves compatibility when both optional columns are absent", async () => {
    const { client, calls } = mockClient((_, fields) => ({
      data: fields.includes("refunded_at") || fields.includes("semester") ? null : [{ id: "s1", name: "Avni" }],
      error: fields.includes("refunded_at") ? { message: "column refunded_at does not exist" }
        : fields.includes("semester") ? { message: "column semester does not exist" } : null,
    }));
    expect(await fetchAllStudentRows(client, "id, refunded_at, semester, name", "all")).toHaveLength(1);
    expect(calls.map((c) => c.fields)).toEqual(["id, refunded_at, semester, name", "id, semester, name", "id, name"]);
  });

  it("discards a response when the campus or permissions changed during loading", async () => {
    let current = true;
    const { client, calls } = mockClient(() => { current = false; return { data: [{ id: "old", name: "Old campus" }], error: null }; });
    expect(await fetchAllStudentRows(client, "id, name", "old-campus", () => current)).toEqual([]);
    expect(calls).toHaveLength(1);
  });
});
