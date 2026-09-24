// HR Job Openings (requisitions) — pure types and helpers.
//
// Nothing here touches Supabase. JobOpeningsPanel owns the I/O; the rules that
// decide what an opening means (its public slug, how its status is coloured,
// whether it is still live, how a pay band or experience range reads) live here
// so they can be unit-tested without a database.
//
// Numeric columns (experience_*_years, salary_*) arrive from Postgres as
// number-or-string, so every helper coerces with Number() before it does
// arithmetic or formatting. An unparseable value is treated as "not set".
//
// The public site reads only status='open' rows whose closes_at is in the future
// (see the "Public reads open job openings" RLS policy), which is exactly what
// isOpen() models client-side.

import { formatInr } from "./assets";

export type JobOpeningStatus = "draft" | "open" | "closed";

/** Every status the DB CHECK constraint allows, in lifecycle order. */
export const JOB_OPENING_STATUSES: readonly JobOpeningStatus[] = [
  "draft",
  "open",
  "closed",
] as const;

/** The statuses the panel's filter bar offers, with "all" in front. */
export const JOB_OPENING_FILTERS = ["all", ...JOB_OPENING_STATUSES] as const;
export type JobOpeningFilter = (typeof JOB_OPENING_FILTERS)[number];

/** Employment types the form offers; values are stored verbatim. */
export const EMPLOYMENT_TYPES = ["Full Time", "Part Time", "Contract", "Intern"] as const;
export type EmploymentType = (typeof EMPLOYMENT_TYPES)[number];

/** Where the public careers page renders a single opening. */
export const CAREERS_BASE_URL = "https://uni.nimt.ac.in/careers";

export interface JobOpening {
  id: string;
  slug: string;
  title: string;
  designation_id: string | null;
  department_id: string | null;
  campus_id: string | null;
  description: string | null;
  employment_type: string;
  experience_min_years: number | string | null;
  experience_max_years: number | string | null;
  salary_min: number | string | null;
  salary_max: number | string | null;
  salary_visible: boolean;
  location: string | null;
  openings_count: number | string;
  status: JobOpeningStatus;
  naukri_url: string | null;
  posted_at: string | null;
  closes_at: string | null;
  created_by?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}

/** Coerce a number-or-string column to a finite number, or null when unset. */
function toNumber(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** "1.5" → "1.5", "3.0" → "3" — drop the noise from numeric columns. */
function formatYears(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(2)));
}

/**
 * URL-safe slug. Lowercases, replaces every run of non-alphanumerics with a
 * single hyphen, and trims the edges, e.g.
 *   "Assistant Professor (Nursing)" → "assistant-professor-nursing"
 *   "Dean / HOD"                    → "dean-hod"
 */
export function slugify(title: string | null | undefined): string {
  if (!title) return "";
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** The public careers URL for an opening. */
export function publicOpeningUrl(slug: string | null | undefined): string {
  const clean = (slug ?? "").trim();
  return clean ? `${CAREERS_BASE_URL}/${clean}` : CAREERS_BASE_URL;
}

const EMPLOYMENT_TYPE_LABELS: Record<string, string> = {
  "full time": "Full Time",
  "part time": "Part Time",
  contract: "Contract",
  intern: "Intern",
  internship: "Intern",
};

/**
 * Human label for an employment_type. The DB stores Title Case already, so this
 * is a normaliser for snake_case ("full_time") and a guard against blanks;
 * anything unrecognised is passed through unchanged.
 */
export function employmentTypeLabel(value: string | null | undefined): string {
  if (!value) return "";
  const key = value.trim().toLowerCase().replace(/[_-]+/g, " ");
  return EMPLOYMENT_TYPE_LABELS[key] ?? value;
}

const STATUS_CLASS: Record<JobOpeningStatus, string> = {
  draft: "bg-pastel-yellow text-foreground/80 border-0 text-[10px]",
  open: "bg-pastel-green text-foreground/80 border-0 text-[10px]",
  closed: "bg-muted text-muted-foreground border-0 text-[10px]",
};

/**
 * Tailwind classes for a status pill. Pastel tokens only — the app reads them
 * as a family, so a status never invents its own colour. Unknown statuses fall
 * back to the neutral "closed" pill rather than rendering unstyled.
 */
export function openingStatusBadge(status: JobOpeningStatus | string): string {
  return STATUS_CLASS[status as JobOpeningStatus] ?? STATUS_CLASS.closed;
}

/** Human label ("draft" → "Draft"). */
export function openingStatusLabel(status: string): string {
  if (!status) return "";
  return status.charAt(0).toUpperCase() + status.slice(1);
}

/**
 * True while an opening is live on the public site: status is "open" and its
 * close date has not passed. A missing or unparseable closes_at means "no
 * deadline". Mirrors the "Public reads open job openings" RLS policy.
 */
export function isOpen(
  opening: Pick<JobOpening, "status" | "closes_at"> | null | undefined,
  now: Date | string | number = new Date(),
): boolean {
  if (!opening || opening.status !== "open") return false;
  if (!opening.closes_at) return true;
  const closesAt = new Date(opening.closes_at).getTime();
  if (!Number.isFinite(closesAt)) return true;
  const nowMs = now instanceof Date ? now.getTime() : new Date(now).getTime();
  if (!Number.isFinite(nowMs)) return true;
  return closesAt > nowMs;
}

/**
 * Human experience band:
 *   (2, 5)      → "2–5 yrs"
 *   (3, 3)      → "3 yrs"
 *   (2, null)   → "2+ yrs"
 *   (null, 5)   → "Up to 5 yrs"
 *   (null, null)→ "Not specified"
 */
export function experienceLabel(
  min: number | string | null | undefined,
  max: number | string | null | undefined,
): string {
  const lo = toNumber(min);
  const hi = toNumber(max);
  if (lo === null && hi === null) return "Not specified";
  if (lo !== null && hi !== null) {
    return lo === hi ? `${formatYears(lo)} yrs` : `${formatYears(lo)}–${formatYears(hi)} yrs`;
  }
  return lo !== null ? `${formatYears(lo)}+ yrs` : `Up to ${formatYears(hi as number)} yrs`;
}

/**
 * Pay band for display. `visible` mirrors salary_visible: when an opening does
 * not disclose pay the public site shows nothing, so the label says so instead
 * of leaking the range.
 *   (50000, 80000, true)  → "₹50,000 – ₹80,000"
 *   (50000, null, true)   → "From ₹50,000"
 *   (null, 80000, true)   → "Up to ₹80,000"
 *   (60000, 60000, true)  → "₹60,000"
 *   (null, null, true)    → "Not specified"
 *   (…, false)            → "Not disclosed"
 */
export function salaryLabel(
  min: number | string | null | undefined,
  max: number | string | null | undefined,
  visible: boolean,
): string {
  if (!visible) return "Not disclosed";
  const lo = toNumber(min);
  const hi = toNumber(max);
  if (lo === null && hi === null) return "Not specified";
  if (lo !== null && hi !== null) {
    return lo === hi ? `₹${formatInr(lo)}` : `₹${formatInr(lo)} – ₹${formatInr(hi)}`;
  }
  return lo !== null ? `From ₹${formatInr(lo)}` : `Up to ₹${formatInr(hi as number)}`;
}
