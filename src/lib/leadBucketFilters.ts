// Lead Buckets filter derivation — shared between the page component and its
// tests so the dropdown logic is exercised in isolation.
//
// The course and source dropdowns are LINKED: course options are scoped to the
// active source filter and vice versa. Without that scoping the page let you
// pick impossible combinations — e.g. Meta Ads lead-form leads carry no course
// (course_id IS NULL), so selecting "Meta Ads" + any course always produced an
// empty list because the intersection is empty by construction.

export interface FilterableLead {
  course_name: string | null;
  source: string | null;
}

/**
 * The web_chat chip coalesces legacy `web_chat` and current `website_chat`
 * source values, so the filter must match both when that option is chosen.
 */
export function matchesSource(lead: { source: string | null }, sourceFilter: string): boolean {
  if (sourceFilter === "all") return true;
  const src = lead.source || "";
  return sourceFilter === "web_chat"
    ? src === "web_chat" || src === "website_chat"
    : src === sourceFilter;
}

export function matchesCourse(lead: { course_name: string | null }, courseFilter: string): boolean {
  if (courseFilter === "all") return true;
  return (lead.course_name || "") === courseFilter;
}

export interface CourseOption { name: string; count: number; }
export interface SourceOption { source: string; count: number; }

/**
 * Courses that actually have leads for the active source, ordered by descending
 * count. Scoping by source is what prevents the empty-list bug: with source
 * "meta_ads" selected, no course options are offered because none of those
 * leads carry a course.
 */
export function deriveCourseOptions<T extends FilterableLead>(
  leads: T[],
  sourceFilter: string,
): CourseOption[] {
  const counts = new Map<string, number>();
  for (const l of leads) {
    if (!matchesSource(l, sourceFilter)) continue;
    const name = (l.course_name || "").trim();
    if (!name || name === "—") continue;
    counts.set(name, (counts.get(name) || 0) + 1);
  }
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([name, count]) => ({ name, count }));
}

/** Sources that have leads for the active course — mirror of deriveCourseOptions. */
export function deriveSourceOptions<T extends FilterableLead>(
  leads: T[],
  courseFilter: string,
): SourceOption[] {
  const counts = new Map<string, number>();
  for (const l of leads) {
    if (!matchesCourse(l, courseFilter)) continue;
    const src = (l.source || "").trim();
    if (!src) continue;
    counts.set(src, (counts.get(src) || 0) + 1);
  }
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([source, count]) => ({ source, count }));
}
