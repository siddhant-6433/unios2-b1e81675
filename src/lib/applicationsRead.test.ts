import { describe, expect, it } from "vitest";
import {
  APPLICATION_LIST_PAGE_SIZE,
  APPLICATION_LIST_SELECT,
  fetchAllApplicationRows,
  type ApplicationsReadQuery,
} from "./applicationsRead";

class ApplicationsQueryRecorder<TRow> implements ApplicationsReadQuery<TRow> {
  calls: Array<{ method: string; args: unknown[] }> = [];

  constructor(private readonly pages: TRow[][]) {}

  select(columns: string): ApplicationsQueryRecorder<TRow> {
    this.calls.push({ method: "select", args: [columns] });
    return this;
  }

  order(column: string, options: { ascending: boolean }): ApplicationsQueryRecorder<TRow> {
    this.calls.push({ method: "order", args: [column, options] });
    return this;
  }

  async range(from: number, to: number): Promise<{ data: TRow[]; error: null }> {
    this.calls.push({ method: "range", args: [from, to] });
    const pageIndex = from / APPLICATION_LIST_PAGE_SIZE;
    return { data: this.pages[pageIndex] || [], error: null };
  }
}

describe("fetchAllApplicationRows", () => {
  it("paginates past the first 500 applications", async () => {
    const firstPage = Array.from({ length: APPLICATION_LIST_PAGE_SIZE }, (_, index) => ({ id: `app-${index}` }));
    const secondPage = [{ id: "sidra-app" }];
    const query = new ApplicationsQueryRecorder([firstPage, secondPage]);
    const client = { from: () => query };

    const rows = await fetchAllApplicationRows(client);

    expect(rows).toHaveLength(APPLICATION_LIST_PAGE_SIZE + 1);
    expect(rows.at(-1)).toEqual({ id: "sidra-app" });
    expect(query.calls).toEqual([
      { method: "select", args: [APPLICATION_LIST_SELECT] },
      { method: "order", args: ["updated_at", { ascending: false }] },
      { method: "order", args: ["id", { ascending: false }] },
      { method: "range", args: [0, APPLICATION_LIST_PAGE_SIZE - 1] },
      { method: "select", args: [APPLICATION_LIST_SELECT] },
      { method: "order", args: ["updated_at", { ascending: false }] },
      { method: "order", args: ["id", { ascending: false }] },
      { method: "range", args: [APPLICATION_LIST_PAGE_SIZE, APPLICATION_LIST_PAGE_SIZE * 2 - 1] },
    ]);
  });
});
