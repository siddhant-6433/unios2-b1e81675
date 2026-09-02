import { describe, expect, it } from "vitest";
import {
  APPLICATION_LIST_PAGE_SIZE,
  APPLICATION_LIST_SELECT,
  fetchAllApplicationRows,
  type ApplicationsReadQuery,
  type ApplicationsReadResult,
} from "./applicationsRead";

class ApplicationsQueryRecorder<TRow> implements ApplicationsReadQuery<TRow> {
  constructor(
    private readonly pages: TRow[][],
    private readonly total: number,
    private readonly calls: Array<{ method: string; args: unknown[] }>,
  ) {}

  select(columns: string, options?: { count?: "exact" }): ApplicationsQueryRecorder<TRow> {
    this.calls.push({ method: "select", args: options ? [columns, options] : [columns] });
    return this;
  }

  order(column: string, options: { ascending: boolean }): ApplicationsQueryRecorder<TRow> {
    this.calls.push({ method: "order", args: [column, options] });
    return this;
  }

  async range(from: number, to: number): Promise<ApplicationsReadResult<TRow>> {
    this.calls.push({ method: "range", args: [from, to] });
    const pageIndex = from / APPLICATION_LIST_PAGE_SIZE;
    return { data: this.pages[pageIndex] || [], count: from === 0 ? this.total : null, error: null };
  }
}

describe("fetchAllApplicationRows", () => {
  it("fetches every page and returns all rows in order", async () => {
    const firstPage = Array.from({ length: APPLICATION_LIST_PAGE_SIZE }, (_, i) => ({ id: `app-${i}` }));
    const secondPage = [{ id: "sidra-app" }];
    const calls: Array<{ method: string; args: unknown[] }> = [];
    const query = new ApplicationsQueryRecorder(
      [firstPage, secondPage],
      APPLICATION_LIST_PAGE_SIZE + 1,
      calls,
    );
    const client = { from: () => query };

    const rows = await fetchAllApplicationRows(client);

    expect(rows).toHaveLength(APPLICATION_LIST_PAGE_SIZE + 1);
    expect(rows.at(-1)).toEqual({ id: "sidra-app" });
    // Page 0 is fetched with an exact count; the remaining page follows.
    expect(calls[0]).toEqual({ method: "select", args: [APPLICATION_LIST_SELECT, { count: "exact" }] });
    expect(calls).toContainEqual({ method: "range", args: [0, APPLICATION_LIST_PAGE_SIZE - 1] });
    expect(calls).toContainEqual({
      method: "range",
      args: [APPLICATION_LIST_PAGE_SIZE, APPLICATION_LIST_PAGE_SIZE * 2 - 1],
    });
  });

  it("stops after one request when the first page covers the whole table", async () => {
    const onlyPage = [{ id: "a" }, { id: "b" }];
    const calls: Array<{ method: string; args: unknown[] }> = [];
    const query = new ApplicationsQueryRecorder([onlyPage], 2, calls);
    const client = { from: () => query };

    const rows = await fetchAllApplicationRows(client);

    expect(rows).toEqual(onlyPage);
    expect(calls.filter((c) => c.method === "range")).toHaveLength(1);
  });
});
