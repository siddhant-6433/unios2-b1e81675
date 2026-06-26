import { describe, expect, it } from "vitest";
import {
  admissionsLeadCursorPredicate,
  applyAdmissionsLeadEnrichment,
  applyAdmissionsLeadCursor,
  applyAdmissionsLeadSort,
  applyAdmissionsListQueryFilters,
  hasActiveAdmissionsListFilters,
  intersectLeadIdSets,
  postgrestList,
  type AdmissionsListFilterModel,
  type AdmissionsPostgrestFilterQuery,
} from "./admissionsListRead";

type QueryCall = {
  method: string;
  args: unknown[];
};

class QueryRecorder implements AdmissionsPostgrestFilterQuery<QueryRecorder> {
  calls: QueryCall[] = [];

  eq(column: string, value: unknown): QueryRecorder {
    this.calls.push({ method: "eq", args: [column, value] });
    return this;
  }

  is(column: string, value: unknown): QueryRecorder {
    this.calls.push({ method: "is", args: [column, value] });
    return this;
  }

  neq(column: string, value: unknown): QueryRecorder {
    this.calls.push({ method: "neq", args: [column, value] });
    return this;
  }

  in(column: string, values: readonly string[]): QueryRecorder {
    this.calls.push({ method: "in", args: [column, values] });
    return this;
  }

  not(column: string, operator: string, value: unknown): QueryRecorder {
    this.calls.push({ method: "not", args: [column, operator, value] });
    return this;
  }

  gte(column: string, value: unknown): QueryRecorder {
    this.calls.push({ method: "gte", args: [column, value] });
    return this;
  }

  lte(column: string, value: unknown): QueryRecorder {
    this.calls.push({ method: "lte", args: [column, value] });
    return this;
  }

  or(filters: string): QueryRecorder {
    this.calls.push({ method: "or", args: [filters] });
    return this;
  }

  order(column: string, options: { ascending: boolean }): QueryRecorder {
    this.calls.push({ method: "order", args: [column, options] });
    return this;
  }

  limit(count: number): QueryRecorder {
    this.calls.push({ method: "limit", args: [count] });
    return this;
  }
}

const baseModel = (overrides: Partial<AdmissionsListFilterModel> = {}): AdmissionsListFilterModel => ({
  role: "super_admin",
  profileId: "profile-1",
  selectedCampusId: "all",
  counsellorFilter: "all",
  stageFilter: "all",
  sourceFilter: "all",
  sourceFilterMode: "include",
  leadInstitutionType: "all",
  courseFilterMode: "include",
  debouncedCourseFilter: [],
  scopedSelectedCourseFilterIds: [],
  applicationStageFilterCount: 0,
  applicationStageLeadScope: null,
  roleFilter: "all",
  tempFilter: "all",
  debouncedSearch: "",
  fromDate: "",
  toDate: "",
  newLeadAssignmentFilter: null,
  inactiveIds: null,
  followupLeadIds: null,
  visitLeadIds: null,
  actionLeadIds: null,
  notCalledIds: null,
  ...overrides,
});

describe("admissions list read filters", () => {
  it("detects when a list query needs exact count instead of planned count", () => {
    expect(hasActiveAdmissionsListFilters(baseModel())).toBe(false);
    expect(hasActiveAdmissionsListFilters(baseModel({ fromDate: "2026-06-01" }))).toBe(true);
    expect(hasActiveAdmissionsListFilters(baseModel({ role: "counsellor" }))).toBe(true);
    expect(hasActiveAdmissionsListFilters(baseModel({ inactiveIds: new Set(["lead-1"]) }))).toBe(true);
  });

  it("applies scope, source, date, search, and intersected id filters", () => {
    const query = new QueryRecorder();
    const scope = applyAdmissionsListQueryFilters(query, baseModel({
      selectedCampusId: "campus-1",
      stageFilter: "new_lead,counsellor_call",
      sourceFilter: "meta_ads",
      sourceFilterMode: "exclude",
      fromDate: "2026-06-01",
      toDate: "2026-06-25",
      debouncedSearch: "Ann, 987",
      inactiveIds: new Set(["lead-1", "lead-2"]),
      followupLeadIds: new Set(["lead-2", "lead-3"]),
    }));

    expect(scope.empty).toBe(false);
    expect(query.calls).toEqual([
      { method: "eq", args: ["campus_id", "campus-1"] },
      { method: "in", args: ["stage", ["new_lead", "counsellor_call"]] },
      { method: "neq", args: ["source", "meta_ads"] },
      { method: "gte", args: ["created_at", "2026-06-01T00:00:00"] },
      { method: "lte", args: ["created_at", "2026-06-25T23:59:59.999"] },
      {
        method: "or",
        args: ["name.ilike.%Ann 987%,phone.ilike.%987%,email.ilike.%Ann 987%,application_id.ilike.%Ann 987%"],
      },
      { method: "in", args: ["id", ["lead-2"]] },
    ]);
  });

  it("returns empty when scoped course filters cannot match the selected institution", () => {
    const query = new QueryRecorder();
    const scope = applyAdmissionsListQueryFilters(query, baseModel({
      leadInstitutionType: "school",
      debouncedCourseFilter: ["college-course"],
      scopedSelectedCourseFilterIds: [],
    }));

    expect(scope.empty).toBe(true);
    expect(query.calls).toEqual([
      { method: "eq", args: ["lead_institution_type", "school"] },
      { method: "eq", args: ["is_mirror", false] },
    ]);
  });

  it("keeps broad application-stage exclusions chunked for PostgREST", () => {
    const query = new QueryRecorder();
    const excludedIds = Array.from({ length: 205 }, (_, index) => `lead-${index + 1}`);
    const scope = applyAdmissionsListQueryFilters(query, baseModel({
      applicationStageFilterCount: 1,
      applicationStageLeadScope: { mode: "exclude", ids: new Set(excludedIds) },
    }));

    expect(scope.empty).toBe(false);
    expect(query.calls).toHaveLength(3);
    expect(query.calls[0]).toEqual({ method: "not", args: ["id", "in", postgrestList(excludedIds.slice(0, 100))] });
    expect(query.calls[2]).toEqual({ method: "not", args: ["id", "in", postgrestList(excludedIds.slice(200, 205))] });
  });

  it("intersects active lead id sets and reports an empty intersection", () => {
    expect(intersectLeadIdSets([
      new Set(["lead-1", "lead-2"]),
      new Set(["lead-2", "lead-3"]),
      null,
    ])).toEqual(["lead-2"]);

    expect(applyAdmissionsListQueryFilters(new QueryRecorder(), baseModel({
      inactiveIds: new Set(["lead-1"]),
      followupLeadIds: new Set(["lead-2"]),
    })).empty).toBe(true);
  });

  it("applies application enrichment immutably and indexes AI summaries by lead", () => {
    const lead = {
      id: "lead-1",
      name: "Asha",
      app_completion_pct: null,
      app_payment_status: null,
      app_fee_amount: null,
    };

    const result = applyAdmissionsLeadEnrichment([lead, { id: "lead-2", name: "Ravi" }], [
      {
        lead_id: "lead-1",
        app_completion_pct: 80,
        app_payment_status: "paid",
        app_fee_amount: 5000,
        ai_summary: "Strong applicant",
      },
      { lead_id: null, ai_summary: "ignored" },
    ]);

    expect(result.rows).toEqual([
      {
        id: "lead-1",
        name: "Asha",
        app_completion_pct: 80,
        app_payment_status: "paid",
        app_fee_amount: 5000,
      },
      { id: "lead-2", name: "Ravi" },
    ]);
    expect(result.rows[0]).not.toBe(lead);
    expect(lead.app_completion_pct).toBeNull();
    expect(result.summaries).toEqual({ "lead-1": "Strong applicant" });
  });

  it("centralizes sort and keyset cursor predicates for list and export reads", () => {
    const query = new QueryRecorder();
    applyAdmissionsLeadSort(query, "oldest");
    applyAdmissionsLeadCursor(query, { created_at: "2026-06-25T10:00:00", id: "lead-9" }, "oldest");

    expect(query.calls).toEqual([
      { method: "order", args: ["created_at", { ascending: true }] },
      { method: "order", args: ["id", { ascending: true }] },
      {
        method: "or",
        args: ["created_at.gt.2026-06-25T10:00:00,and(created_at.eq.2026-06-25T10:00:00,id.gt.lead-9)"],
      },
    ]);
    expect(admissionsLeadCursorPredicate(
      { created_at: "2026-06-25T10:00:00", id: "lead-9" },
      "newest",
    )).toBe("created_at.lt.2026-06-25T10:00:00,and(created_at.eq.2026-06-25T10:00:00,id.lt.lead-9)");
  });
});
