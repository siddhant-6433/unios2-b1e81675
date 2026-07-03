// Shared course ordering used by every "pick a course" UI in the CRM.
//
// Hierarchy:  Campus  →  Program section  →  Course
// For school courses, program sections follow the natural progression of a
// student (Toddlers → Montessori → EYP → PYP → MYP for Mirai;
//  Toddler → Pre-Nursery → LKG → UKG → Classes I–XII for NIMT Beacon).
//
// Classification is driven primarily off the course `code` (deterministic),
// with a name-based fallback for seed rows that pre-date the code scheme.
//
// Keep this file dependency-free so it can be reused on the server too.

export interface CourseLike {
  id: string;
  name: string;
  code?: string | null;
  campus_name?: string | null;
  department_name?: string | null;
  institution_name?: string | null;
  institution_type?: string | null;
}

export type CourseSectionKey =
  | "toddlers" | "montessori"
  | "eyp" | "pyp" | "myp"
  | "toddler_beacon" | "pre_nursery" | "lkg" | "ukg" | "grades"
  | "other";

interface Classification {
  section: CourseSectionKey;
  sectionLabel: string;       // "EYP", "PYP", "Classes", etc.
  orderInSection: number;     // 1, 2, 3 — used for ascending sort
  campusGroup: string;        // Campus name (top-level header)
  institutionGroup: string;   // Institution name within campus (sub-header). "" when same as campus or unset.
}

const SECTION_ORDER: Record<CourseSectionKey, number> = {
  toddlers: 10,
  montessori: 20,
  eyp: 30,
  pyp: 40,
  myp: 50,
  toddler_beacon: 110,
  pre_nursery: 120,
  lkg: 130,
  ukg: 140,
  grades: 150,
  other: 900,
};

const SECTION_LABEL: Record<CourseSectionKey, string> = {
  toddlers: "Toddlers",
  montessori: "Montessori",
  eyp: "EYP",
  pyp: "PYP",
  myp: "MYP",
  toddler_beacon: "Toddler",
  pre_nursery: "Pre-Nursery",
  lkg: "LKG",
  ukg: "UKG",
  grades: "Classes",
  other: "Other",
};

// Strip campus prefix from a Beacon code: "BSAV-G3" → "G3", "BSA-LKG" → "LKG".
const BEACON_PREFIX = /^(BSAV?-)/i;

export function classifyCourse(c: CourseLike): Classification {
  const code = (c.code || "").toUpperCase().trim();
  const name = (c.name || "").trim();
  const lowerName = name.toLowerCase();
  const isBeacon = BEACON_PREFIX.test(code);
  const raw = code.replace(BEACON_PREFIX, "");

  // Campus group (top-level header). For Beacon codes we already encode
  // the campus in the code prefix, so prefer that over a generic
  // "Ghaziabad Campus N" — keeps the heading meaningful.
  let campusGroup: string;
  if (c.campus_name) campusGroup = c.campus_name;
  else if (code.startsWith("BSAV")) campusGroup = "NIMT Beacon Avantika";
  else if (code.startsWith("BSA-")) campusGroup = "NIMT Beacon Arthala";
  else campusGroup = "Other";

  // Institution sub-header — only set when the institution differs from
  // the campus name itself. Multiple institutions can share a single
  // physical campus (e.g. Mirai Experiential School and Campus School
  // Dept of Education both on Ghaziabad Campus 2 / Avantika); each
  // should appear as its own sub-section under the campus.
  let institutionGroup = "";
  if (c.institution_name && c.institution_name !== c.campus_name) {
    institutionGroup = c.institution_name;
  }

  // Mirai program detection (code-first, name-fallback so seed rows with
  // a NULL or non-standard code still order correctly).
  const matchEyp = raw.match(/^EYP\s*(\d+)/) || lowerName.match(/^eyp\s*(\d+)/);
  const matchPyp = raw.match(/^PYP\s*(\d+)/) || lowerName.match(/^pyp\s*(\d+)/);
  const matchMyp = raw.match(/^MYP\s*(\d+)/) || lowerName.match(/^myp\s*(\d+)/);

  if (!isBeacon) {
    if (raw === "TOD" || /^toddler/i.test(lowerName)) {
      return { section: "toddlers", sectionLabel: SECTION_LABEL.toddlers, orderInSection: 0, campusGroup, institutionGroup };
    }
    if (raw === "MON" || /^montessori/i.test(lowerName)) {
      return { section: "montessori", sectionLabel: SECTION_LABEL.montessori, orderInSection: 0, campusGroup, institutionGroup };
    }
    if (matchEyp) return { section: "eyp", sectionLabel: SECTION_LABEL.eyp, orderInSection: parseInt(matchEyp[1], 10), campusGroup, institutionGroup };
    if (matchPyp) return { section: "pyp", sectionLabel: SECTION_LABEL.pyp, orderInSection: parseInt(matchPyp[1], 10), campusGroup, institutionGroup };
    if (matchMyp) return { section: "myp", sectionLabel: SECTION_LABEL.myp, orderInSection: parseInt(matchMyp[1], 10), campusGroup, institutionGroup };
  }

  // Beacon program detection (or any school course using these labels).
  if (raw === "TOD" || (isBeacon && /toddler/i.test(lowerName))) {
    return { section: "toddler_beacon", sectionLabel: SECTION_LABEL.toddler_beacon, orderInSection: 0, campusGroup, institutionGroup };
  }
  if (raw === "NUR" || /^(pre[-\s]?(nursery|nur)|nursery)/i.test(lowerName)) {
    return { section: "pre_nursery", sectionLabel: SECTION_LABEL.pre_nursery, orderInSection: 0, campusGroup, institutionGroup };
  }
  if (raw === "LKG" || /\blkg\b/i.test(lowerName)) {
    return { section: "lkg", sectionLabel: SECTION_LABEL.lkg, orderInSection: 0, campusGroup, institutionGroup };
  }
  if (raw === "UKG" || /\bukg\b/i.test(lowerName)) {
    return { section: "ukg", sectionLabel: SECTION_LABEL.ukg, orderInSection: 0, campusGroup, institutionGroup };
  }
  const grade = raw.match(/^G(\d+)$/) || lowerName.match(/(?:class|grade)\s+([ivx]+|\d+)/i);
  if (grade) {
    const v = grade[1];
    const n = /^\d+$/.test(v) ? parseInt(v, 10) : romanToInt(v);
    return { section: "grades", sectionLabel: SECTION_LABEL.grades, orderInSection: n, campusGroup, institutionGroup };
  }

  return { section: "other", sectionLabel: SECTION_LABEL.other, orderInSection: 0, campusGroup, institutionGroup };
}

function romanToInt(r: string): number {
  const map: Record<string, number> = { I: 1, V: 5, X: 10, L: 50, C: 100 };
  const s = r.toUpperCase();
  let total = 0;
  for (let i = 0; i < s.length; i++) {
    const cur = map[s[i]] || 0;
    const next = map[s[i + 1]] || 0;
    total += cur < next ? -cur : cur;
  }
  return total || 999;
}

// Stable comparator used everywhere we render a flat list of courses.
export function compareCourses(a: CourseLike, b: CourseLike): number {
  const ca = classifyCourse(a);
  const cb = classifyCourse(b);
  if (ca.campusGroup !== cb.campusGroup) return ca.campusGroup.localeCompare(cb.campusGroup);
  if (ca.institutionGroup !== cb.institutionGroup) return ca.institutionGroup.localeCompare(cb.institutionGroup);
  const sa = SECTION_ORDER[ca.section];
  const sb = SECTION_ORDER[cb.section];
  if (sa !== sb) return sa - sb;
  if (ca.orderInSection !== cb.orderInSection) return ca.orderInSection - cb.orderInSection;
  return (a.name || "").localeCompare(b.name || "");
}

export interface CourseSection<T extends CourseLike> {
  campusGroup: string;
  institutionGroup: string;   // "" when there is no separate institution sub-header
  sectionLabel: string;
  sectionKey: CourseSectionKey;
  items: T[];
}

// Group + sort for hierarchical rendering (campus → institution → section → items asc).
export function groupCourses<T extends CourseLike>(courses: T[]): CourseSection<T>[] {
  const sorted = [...courses].sort(compareCourses);
  const sections: CourseSection<T>[] = [];
  let current: CourseSection<T> | null = null;
  for (const c of sorted) {
    const cls = classifyCourse(c);
    if (
      !current ||
      current.campusGroup !== cls.campusGroup ||
      current.institutionGroup !== cls.institutionGroup ||
      current.sectionKey !== cls.section
    ) {
      current = {
        campusGroup: cls.campusGroup,
        institutionGroup: cls.institutionGroup,
        sectionLabel: cls.sectionLabel,
        sectionKey: cls.section,
        items: [],
      };
      sections.push(current);
    }
    current.items.push(c);
  }
  return sections;
}
