import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { callingReportByCounsellor, callingReportCalledCount, callingReportLastCallAt } from "@/lib/callingReportStats";
import { callingReportPreviousCounsellors } from "@/lib/listAssignmentOwners";
import { readMigration } from "./readMigration";

const leadLists = readFileSync("src/pages/LeadLists.tsx", "utf8");

describe("calling report counsellor chips", () => {
  it("lists every counsellor who appears on the assignment report, not just members.assigned_to", () => {
    const stats = callingReportByCounsellor([
      { assigned_to: "ashraf", assigned_to_name: "MD. Ashraf Ali", latest_call_at: null },
      { assigned_to: "rahul", assigned_to_name: "Rahul Bhati", latest_call_at: "2026-09-10T09:19:00Z", latest_call_disposition: "answered" },
      { assigned_to: "niharika", assigned_to_name: "Niharika Sharma", latest_call_at: "2026-09-10T10:22:00Z", latest_call_disposition: "answered" },
      { assigned_to: "rahul", assigned_to_name: "Rahul Bhati", latest_call_at: null },
    ]);
    expect(stats.map((s) => s.counsellor_name).sort()).toEqual([
      "MD. Ashraf Ali",
      "Niharika Sharma",
      "Rahul Bhati",
    ]);
    expect(stats.find((s) => s.counsellor_id === "rahul")).toMatchObject({ total: 2, worked: 1, pending: 1 });
    expect(stats.find((s) => s.counsellor_id === "ashraf")).toMatchObject({ total: 1, worked: 0, pending: 1 });
    expect(callingReportCalledCount([
      { lead_id: "l1", assigned_to: "rahul", assigned_to_name: "Rahul Bhati", latest_call_at: "2026-09-10T09:19:00Z" },
      { lead_id: "l1", assigned_to: "rahul", assigned_to_name: "Rahul Bhati", latest_call_at: "2026-09-10T09:20:00Z" },
      { lead_id: "l2", assigned_to: "niharika", assigned_to_name: "Niharika Sharma", latest_call_at: "2026-09-10T10:22:00Z" },
    ])).toBe(2);
    expect(callingReportLastCallAt([
      { assigned_to: "rahul", assigned_to_name: "Rahul Bhati", latest_call_at: "2026-09-10T09:19:00Z" },
      { assigned_to: "niharika", assigned_to_name: "Niharika Sharma", latest_call_at: "2026-09-10T10:22:00Z" },
    ])).toBe(new Date("2026-09-10T10:22:00Z").toISOString());
    expect(callingReportPreviousCounsellors([
      { previous_counsellor_name: "Rahul Bhati" },
      { previous_counsellor_name: "Rahul Bhati" },
      { previous_counsellor_name: "MD. Ashraf Ali" },
      { previous_counsellor_name: null },
    ])).toEqual([
      { name: "Rahul Bhati", count: 2 },
      { name: "MD. Ashraf Ali", count: 1 },
    ]);
  });

  it("builds the Calling Report chips from the assignment report rows", () => {
    expect(leadLists).toContain("callingReportByCounsellor");
    expect(leadLists).toContain("reportCounsellorStats");
    expect(leadLists).toContain("reportPreviousCounsellors");
    expect(leadLists).toContain("callingReportPreviousCounsellors");
  });

  it("attributes call_list_progress counsellor chips from list assignment history", () => {
    const migration = readMigration("call_list_progress_history_counsellors");
    expect(migration).toContain("CREATE OR REPLACE FUNCTION public.call_list_progress");
    expect(migration).toContain("CREATE OR REPLACE FUNCTION public.call_list_overview");
    expect(migration).toContain("latest_list_assignee");
    expect(migration).toContain("lead_assignment_history");
    expect(migration).toContain("COALESCE(la.assigned_to, m2.assigned_to)");
  });
});
