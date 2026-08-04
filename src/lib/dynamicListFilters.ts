/**
 * The canonical filter vocabulary for DYNAMIC lead lists.
 *
 * A dynamic list is re-evaluated in SQL on a cron, so its filter has to survive
 * without the page that created it. That rules out most of what the Admissions
 * list view supports:
 *
 *   - `inactiveIds`, `followupLeadIds`, `visitLeadIds`, `actionLeadIds`,
 *     `notCalledIds`, `applicationStageFilter` resolve to Set<string> of lead ids
 *     computed by *other queries on the page*. They are never serialized and
 *     cannot be re-derived later.
 *   - `counsellorFilter` fights auto-assignment: the list assigns its own owners.
 *   - free-text `search` and exclude-modes are deliberately out of v1 to keep the
 *     SQL resolver small.
 *
 * Everything here maps 1:1 to a column on public.leads, so
 * resolve_dynamic_list_members() can rebuild membership from this object alone.
 * `filters_snapshot` is NOT reused — it is audit metadata with five mutually
 * incompatible shapes across five pages, and nothing reads it.
 *
 * Keep this file and the SQL resolver in lockstep: the UI gate below and the
 * migration's WHERE clause are two views of the same contract.
 */

export interface DynamicListFilterDefinition {
  course_ids?: string[];
  sources?: string[];
  campus_ids?: string[];
  stages?: string[];
  lead_temperature?: string;
  lead_institution_type?: string;
  /** YYYY-MM-DD, inclusive. */
  created_from?: string;
  created_to?: string;
}

/** The subset of Admissions list state a dynamic list can be built from. */
export interface AdmissionsFilterStateForDynamic {
  stageFilter?: string;
  sourceFilter?: string;
  sourceFilterMode?: "include" | "exclude";
  courseFilter?: string[];
  courseFilterMode?: "include" | "exclude";
  leadInstitutionType?: string;
  tempFilter?: string;
  selectedCampusId?: string | null;
  fromDate?: string;
  toDate?: string;
  // Everything below makes a list non-dynamic.
  applicationStageFilter?: unknown[];
  roleFilter?: string;
  counsellorFilter?: string;
  sharedWithNimtFilter?: string;
  search?: string;
  inactiveIds?: Set<string> | null;
  followupLeadIds?: Set<string> | null;
  visitLeadIds?: Set<string> | null;
  actionLeadIds?: Set<string> | null;
  notCalledIds?: Set<string> | null;
  newLeadAssignmentFilter?: unknown;
}

const isAll = (v: string | null | undefined) => !v || v === "all";

/**
 * Human-readable reasons a list can't be dynamic. Empty array = it can.
 * The Add-to-List dialog disables the toggle and shows these verbatim.
 */
export function unsupportedDynamicFilters(s: AdmissionsFilterStateForDynamic): string[] {
  const reasons: string[] = [];

  if (s.applicationStageFilter && s.applicationStageFilter.length > 0) reasons.push("application stage");
  if (s.inactiveIds) reasons.push("inactive leads");
  if (s.followupLeadIds) reasons.push("follow-up due");
  if (s.visitLeadIds) reasons.push("visits");
  if (s.actionLeadIds) reasons.push("action-centre bucket");
  if (s.notCalledIds) reasons.push("not called");
  if (s.newLeadAssignmentFilter) reasons.push("new-lead assignment");
  if (!isAll(s.counsellorFilter)) reasons.push("counsellor (a dynamic list assigns its own)");
  if (!isAll(s.roleFilter)) reasons.push("person role");
  if (!isAll(s.sharedWithNimtFilter)) reasons.push("shared-with-NIMT");
  if (s.search && s.search.trim().length >= 2) reasons.push("text search");
  if (s.sourceFilterMode === "exclude" && !isAll(s.sourceFilter)) reasons.push("source exclusion");
  if (s.courseFilterMode === "exclude" && (s.courseFilter?.length ?? 0) > 0) reasons.push("course exclusion");

  return reasons;
}

/**
 * Project Admissions filter state onto the canonical definition.
 * Only call when unsupportedDynamicFilters() is empty — anything it would have
 * flagged is dropped here, which is exactly the silent-divergence we don't want.
 */
export function toFilterDefinition(s: AdmissionsFilterStateForDynamic): DynamicListFilterDefinition {
  const def: DynamicListFilterDefinition = {};

  // stageFilter is a comma-joined string in the Admissions state.
  if (!isAll(s.stageFilter)) {
    def.stages = s.stageFilter!.split(",").map((x) => x.trim()).filter(Boolean);
  }
  if (!isAll(s.sourceFilter)) def.sources = [s.sourceFilter!];
  if ((s.courseFilter?.length ?? 0) > 0) def.course_ids = [...s.courseFilter!];
  if (s.selectedCampusId) def.campus_ids = [s.selectedCampusId];
  if (!isAll(s.leadInstitutionType)) def.lead_institution_type = s.leadInstitutionType;
  if (!isAll(s.tempFilter)) def.lead_temperature = s.tempFilter;
  if (s.fromDate) def.created_from = s.fromDate;
  if (s.toDate) def.created_to = s.toDate;

  return def;
}

/** True when the definition would match every lead — a footgun worth blocking. */
export function isEmptyFilterDefinition(def: DynamicListFilterDefinition): boolean {
  return Object.keys(def).length === 0;
}

/** One-line summary for the list row tooltip. */
export function describeFilterDefinition(def: DynamicListFilterDefinition | null | undefined): string {
  if (!def) return "No filter";
  const parts: string[] = [];
  if (def.course_ids?.length) parts.push(`${def.course_ids.length} course${def.course_ids.length === 1 ? "" : "s"}`);
  if (def.sources?.length) parts.push(`source: ${def.sources.join(", ")}`);
  if (def.stages?.length) parts.push(`stage: ${def.stages.join(", ")}`);
  if (def.campus_ids?.length) parts.push(`${def.campus_ids.length} campus`);
  if (def.lead_institution_type) parts.push(def.lead_institution_type);
  if (def.lead_temperature) parts.push(`${def.lead_temperature} leads`);
  if (def.created_from || def.created_to) parts.push(`${def.created_from || "any"} → ${def.created_to || "now"}`);
  return parts.length ? parts.join(" · ") : "Matches all leads";
}
