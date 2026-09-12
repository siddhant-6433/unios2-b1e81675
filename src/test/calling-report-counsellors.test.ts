import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  callingReportByCounsellor,
  callingReportCalledCount,
  callingReportLastCallAt,
  callingReportLatestPerLead,
} from "@/lib/callingReportStats";
import { readMigration } from "./readMigration";

const leadLists = readFileSync("src/pages/LeadLists.tsx", "utf8");

describe("calling report counsellor chips", () => {
  it("keeps the latest list assignment per lead so chips are this list's split", () => {
    const latest = callingReportLatestPerLead([
      {
        lead_id: "l1",
        assigned_to: "ashraf",
        assigned_to_name: "MD. Ashraf Ali",
        assigned_at: "2026-09-01T10:00:00Z",
        latest_call_at: null,
      },
      {
        lead_id: "l1",
        assigned_to: "rahul",
        assigned_to_name: "Rahul Bhati",
        assigned_at: "2026-09-10T07:33:00Z",
        latest_call_at: "2026-09-10T09:19:00Z",
        latest_call_disposition: "answered",
      },
      {
        lead_id: "l2",
        assigned_to: "niharika",
        assigned_to_name: "Niharika Sharma",
        assigned_at: "2026-09-10T07:33:00Z",
        latest_call_at: "2026-09-10T10:22:00Z",
        latest_call_disposition: "answered",
      },
      {
        lead_id: "l3",
        assigned_to: "ashraf",
        assigned_to_name: "MD. Ashraf Ali",
        assigned_at: "2026-09-10T07:33:00Z",
        latest_call_at: null,
      },
    ]);
    expect(latest).toHaveLength(3);
    expect(latest.find((r) => r.lead_id === "l1")?.assigned_to).toBe("rahul");
    const stats = callingReportByCounsellor(latest);
    expect(stats.map((s) => s.counsellor_name).sort()).toEqual([
      "MD. Ashraf Ali",
      "Niharika Sharma",
      "Rahul Bhati",
    ]);
    expect(stats.find((s) => s.counsellor_id === "rahul")).toMatchObject({ total: 1, worked: 1 });
    expect(stats.find((s) => s.counsellor_id === "ashraf")).toMatchObject({ total: 1, worked: 0, pending: 1 });
    expect(callingReportCalledCount(latest)).toBe(2);
    expect(callingReportLastCallAt(latest)).toBe(new Date("2026-09-10T10:22:00Z").toISOString());
  });

  it("builds the Calling Report chips from this list's current assignees and filters the table", () => {
    expect(leadLists).toContain("callingReportLatestPerLead");
    expect(leadLists).toContain("callingReportByCounsellor");
    expect(leadLists).toContain("reportCounsellorStats");
    expect(leadLists).toContain("Assigned on this list");
    expect(leadLists).toContain("r.assigned_to === reportCounsellorFilter");
    expect(leadLists).not.toContain("callingReportPreviousCounsellors");
    expect(leadLists).not.toContain("reportPreviousFilter");
  });

  it("attributes call_list_progress counsellor chips from list assignment history", () => {
    const migration = readMigration("call_list_progress_history_counsellors");
    expect(migration).toContain("CREATE OR REPLACE FUNCTION public.call_list_progress");
    expect(migration).toContain("CREATE OR REPLACE FUNCTION public.call_list_overview");
    expect(migration).toContain("latest_list_assignee");
    expect(migration).toContain("lead_assignment_history");
    expect(migration).toContain("COALESCE(la.assigned_to, m2.assigned_to)");
  });

  it("returns one calling-report row per lead from the latest list assignment", () => {
    const migration = readMigration("calling_report_latest_list_assignment");
    expect(migration).toContain("CREATE OR REPLACE FUNCTION public.get_lead_list_assignment_report");
    expect(migration).toContain("DISTINCT ON (h.lead_id)");
    expect(migration).toContain("ORDER BY h.lead_id, h.created_at DESC");
  });
});
