export type AdmissionsFilterMode = "include" | "exclude";
export type AdmissionsLeadInstitutionType = "all" | "school" | "college";
export type AdmissionsNewLeadAssignmentFilter = "assigned" | "unassigned";
export type AdmissionsLeadSortOrder = "newest" | "oldest";

export interface AdmissionsLeadCursor {
  created_at: string;
  id: string;
}

export const ADMISSIONS_LEAD_LIST_SELECT = `id, name, phone, email, stage, source, person_role, created_at,
           application_id, pre_admission_no, admission_no, course_id, campus_id, lead_institution_type, is_mirror,
           counsellor_id, lead_score, lead_temperature, ai_called,
           courses:course_id(name), campuses:campus_id(name), profiles:counsellor_id(display_name)`;

export type AdmissionsApplicationStageLeadScope = {
  mode: "include" | "exclude";
  ids: Set<string>;
};

export interface AdmissionsListFilterModel {
  role: string | null | undefined;
  profileId: string | null | undefined;
  selectedCampusId: string;
  counsellorFilter: string;
  stageFilter: string;
  sourceFilter: string;
  sourceFilterMode: AdmissionsFilterMode;
  leadInstitutionType: AdmissionsLeadInstitutionType;
  courseFilterMode: AdmissionsFilterMode;
  debouncedCourseFilter: readonly string[];
  scopedSelectedCourseFilterIds: readonly string[];
  applicationStageFilterCount: number;
  applicationStageLeadScope: AdmissionsApplicationStageLeadScope | null;
  roleFilter: string;
  tempFilter: string;
  debouncedSearch: string;
  fromDate: string;
  toDate: string;
  newLeadAssignmentFilter: AdmissionsNewLeadAssignmentFilter | null;
  inactiveIds: Set<string> | null;
  followupLeadIds: Set<string> | null;
  visitLeadIds: Set<string> | null;
  actionLeadIds: Set<string> | null;
  notCalledIds: Set<string> | null;
}

export interface AdmissionsPostgrestFilterQuery<TQuery> {
  eq(column: string, value: unknown): TQuery;
  is(column: string, value: unknown): TQuery;
  neq(column: string, value: unknown): TQuery;
  in(column: string, values: readonly string[]): TQuery;
  not(column: string, operator: string, value: unknown): TQuery;
  gte(column: string, value: unknown): TQuery;
  lte(column: string, value: unknown): TQuery;
  or(filters: string): TQuery;
}

export interface AdmissionsPostgrestReadQuery<TQuery> extends AdmissionsPostgrestFilterQuery<TQuery> {
  order(column: string, options: { ascending: boolean }): TQuery;
  limit(count: number): TQuery;
}

export interface AdmissionsListQueryScope<TQuery> {
  query: TQuery;
  empty: boolean;
}

export interface AdmissionsLeadEnrichmentRow {
  lead_id: string | null;
  app_completion_pct?: number | null;
  app_payment_status?: string | null;
  app_fee_amount?: number | null;
  ai_summary?: string | null;
}

export type AdmissionsLeadEnrichable = {
  id: string;
  app_completion_pct?: number | null;
  app_payment_status?: string | null;
  app_fee_amount?: number | null;
};

export interface AdmissionsLeadEnrichmentResult<TLead> {
  rows: TLead[];
  summaries: Record<string, string>;
}

export function postgrestList(values: readonly string[]): string {
  return `(${values.join(",")})`;
}

export function applyAdmissionsLeadEnrichment<TLead extends AdmissionsLeadEnrichable>(
  rows: readonly TLead[],
  enrichmentRows: readonly AdmissionsLeadEnrichmentRow[] | null | undefined,
): AdmissionsLeadEnrichmentResult<TLead> {
  if (rows.length === 0) return { rows: [], summaries: {} };

  const byLead = new Map<string, AdmissionsLeadEnrichmentRow>();
  const summaries: Record<string, string> = {};

  for (const row of enrichmentRows || []) {
    if (!row?.lead_id) continue;
    byLead.set(row.lead_id, row);
    if (row.ai_summary) summaries[row.lead_id] = row.ai_summary;
  }

  return {
    rows: rows.map((lead) => {
      const enrichment = byLead.get(lead.id);
      if (!enrichment) return { ...lead };
      return {
        ...lead,
        app_completion_pct: enrichment.app_completion_pct ?? null,
        app_payment_status: enrichment.app_payment_status ?? null,
        app_fee_amount: enrichment.app_fee_amount ?? null,
      };
    }),
    summaries,
  };
}

export function applyAdmissionsLeadSort<TQuery extends AdmissionsPostgrestReadQuery<TQuery>>(
  query: TQuery,
  sortOrder: AdmissionsLeadSortOrder,
): TQuery {
  const ascending = sortOrder === "oldest";
  return query
    .order("created_at", { ascending })
    .order("id", { ascending });
}

export function admissionsLeadCursorPredicate(
  cursor: AdmissionsLeadCursor,
  sortOrder: AdmissionsLeadSortOrder,
): string {
  return sortOrder === "oldest"
    ? `created_at.gt.${cursor.created_at},and(created_at.eq.${cursor.created_at},id.gt.${cursor.id})`
    : `created_at.lt.${cursor.created_at},and(created_at.eq.${cursor.created_at},id.lt.${cursor.id})`;
}

export function applyAdmissionsLeadCursor<TQuery extends AdmissionsPostgrestFilterQuery<TQuery>>(
  query: TQuery,
  cursor: AdmissionsLeadCursor | null,
  sortOrder: AdmissionsLeadSortOrder,
): TQuery {
  if (!cursor) return query;
  return query.or(admissionsLeadCursorPredicate(cursor, sortOrder));
}

export function hasActiveAdmissionsListFilters(model: AdmissionsListFilterModel): boolean {
  return model.stageFilter !== "all" ||
    model.sourceFilter !== "all" ||
    model.roleFilter !== "all" ||
    model.tempFilter !== "all" ||
    model.leadInstitutionType !== "all" ||
    model.debouncedCourseFilter.length > 0 ||
    model.applicationStageFilterCount > 0 ||
    model.counsellorFilter !== "all" ||
    model.selectedCampusId !== "all" ||
    model.role === "counsellor" ||
    model.debouncedSearch.length >= 2 ||
    !!model.fromDate ||
    !!model.toDate ||
    model.newLeadAssignmentFilter !== null ||
    model.inactiveIds !== null ||
    model.followupLeadIds !== null ||
    model.visitLeadIds !== null ||
    model.actionLeadIds !== null ||
    model.notCalledIds !== null;
}

export function intersectLeadIdSets(
  sets: readonly (Set<string> | null)[],
): string[] | null {
  const activeSets = sets.filter((set): set is Set<string> => set !== null);
  if (activeSets.length === 0) return null;

  let intersection = Array.from(activeSets[0]);
  for (let i = 1; i < activeSets.length; i += 1) {
    const other = activeSets[i];
    intersection = intersection.filter((id) => other.has(id));
  }
  return intersection;
}

export function applyAdmissionsListQueryFilters<TQuery extends AdmissionsPostgrestFilterQuery<TQuery>>(
  query: TQuery,
  model: AdmissionsListFilterModel,
): AdmissionsListQueryScope<TQuery> {
  if (model.role === "counsellor" && model.profileId) {
    query = query.eq("counsellor_id", model.profileId);
  } else if (model.counsellorFilter === "unassigned") {
    query = query.is("counsellor_id", null);
  } else if (model.counsellorFilter !== "all") {
    query = query.eq("counsellor_id", model.counsellorFilter);
  } else if (model.selectedCampusId !== "all") {
    query = query.eq("campus_id", model.selectedCampusId);
  }

  if (model.stageFilter !== "all") {
    const stages = model.stageFilter.split(",").map((stage) => stage.trim()).filter(Boolean);
    if (stages.length === 1) query = query.eq("stage", stages[0]);
    else if (stages.length > 1) query = query.in("stage", stages);
  }

  if (model.sourceFilter !== "all") {
    query = model.sourceFilterMode === "exclude"
      ? query.neq("source", model.sourceFilter)
      : query.eq("source", model.sourceFilter);
  }

  if (model.leadInstitutionType !== "all") {
    query = query.eq("lead_institution_type", model.leadInstitutionType).eq("is_mirror", false);
    if (model.courseFilterMode === "include") {
      if (model.scopedSelectedCourseFilterIds.length > 0) {
        query = query.in("course_id", model.scopedSelectedCourseFilterIds);
      } else if (model.debouncedCourseFilter.length > 0) {
        return { query, empty: true };
      }
    } else if (model.scopedSelectedCourseFilterIds.length > 0) {
      query = query.not("course_id", "in", postgrestList(model.scopedSelectedCourseFilterIds));
    } else if (model.debouncedCourseFilter.length > 0) {
      return { query, empty: true };
    }
  } else if (model.debouncedCourseFilter.length > 0) {
    query = model.courseFilterMode === "exclude"
      ? query.not("course_id", "in", postgrestList(model.debouncedCourseFilter))
      : query.in("course_id", model.debouncedCourseFilter);
  }

  if (model.roleFilter !== "all") query = query.eq("person_role", model.roleFilter);
  if (model.tempFilter !== "all") query = query.eq("lead_temperature", model.tempFilter);

  if (model.newLeadAssignmentFilter) {
    query = query.eq("stage", "new_lead").eq("is_mirror", false);
    query = model.newLeadAssignmentFilter === "assigned"
      ? query.not("counsellor_id", "is", null)
      : query.is("counsellor_id", null);
  }

  if (model.fromDate) query = query.gte("created_at", `${model.fromDate}T00:00:00`);
  if (model.toDate) query = query.lte("created_at", `${model.toDate}T23:59:59.999`);

  if (model.debouncedSearch.length >= 2) {
    const queryText = model.debouncedSearch;
    const digits = queryText.replace(/\D/g, "");
    const phoneTerm = digits.length >= 3 ? digits : queryText;
    const safe = (value: string) => value.replace(/,/g, "");
    query = query.or(
      `name.ilike.%${safe(queryText)}%,phone.ilike.%${safe(phoneTerm)}%,email.ilike.%${safe(queryText)}%,application_id.ilike.%${safe(queryText)}%`,
    );
  }

  if (model.applicationStageFilterCount > 0 && model.applicationStageLeadScope === null) {
    return { query, empty: true };
  }

  const intersection = intersectLeadIdSets([
    model.inactiveIds,
    model.followupLeadIds,
    model.visitLeadIds,
    model.actionLeadIds,
    model.notCalledIds,
    model.applicationStageLeadScope?.mode === "include" ? model.applicationStageLeadScope.ids : null,
  ]);
  if (intersection !== null) {
    if (intersection.length === 0) return { query, empty: true };
    query = query.in("id", intersection);
  }

  if (model.applicationStageLeadScope?.mode === "exclude" && model.applicationStageLeadScope.ids.size > 0) {
    const ids = Array.from(model.applicationStageLeadScope.ids);
    for (let i = 0; i < ids.length; i += 100) {
      query = query.not("id", "in", postgrestList(ids.slice(i, i + 100)));
    }
  }

  return { query, empty: false };
}
