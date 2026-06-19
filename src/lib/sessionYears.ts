export const SCHOOL_SESSION_YEARS = ["2026-27", "2027-28"] as const;

export const sessionYearLabel = (name?: string | null) => {
  const trimmed = name?.trim();
  if (!trimmed) return "";
  const match = trimmed.match(/20\d{2}\s*[-/]\s*\d{2}/);
  return match ? match[0].replace(/\s+/g, "").replace("/", "-") : trimmed;
};

export const isSchoolSessionYear = (name?: string | null) =>
  SCHOOL_SESSION_YEARS.includes(sessionYearLabel(name) as (typeof SCHOOL_SESSION_YEARS)[number]);
