// Public Careers portal — pure types and display helpers.
//
// Nothing in this file talks to Supabase. `Careers.tsx` and `CareerJob.tsx`
// own all network I/O; the rules that decide what a public opening looks like —
// its employment-type label, experience band, pay band, posted/closing date and
// whether it is still live — live here so they can be unit-tested without a
// database.
//
// Numeric columns (experience_*_years, salary_*, openings_count) arrive from
// Postgres as number-or-string, so every helper coerces with Number() before it
// formats. An unparseable value is treated as "not set".
//
// The public reads only status='open' rows whose closes_at is in the future
// (the "Public reads open job openings" RLS policy), which is exactly what
// isLive() models client-side.

import { formatInr } from "./assets";

/** The subset of `job_openings` the public careers pages select. */
export interface PublicJob {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  employment_type: string;
  experience_min_years: number | string | null;
  experience_max_years: number | string | null;
  salary_min: number | string | null;
  salary_max: number | string | null;
  salary_visible: boolean;
  location: string | null;
  openings_count: number | string | null;
  department_id: string | null;
  campus_id: string | null;
  posted_at: string | null;
  closes_at: string | null;
  status: string;
}

/** The value shape `isLive` needs; both endpoints accept a bare Date too. */
export type Moment = Date | string | number;

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

/** Epoch millis for a date-ish value, or null when it can't be parsed. */
function toEpoch(value: Moment | null | undefined): number | null {
  if (value === null || value === undefined || value === "") return null;
  if (value instanceof Date) {
    const t = value.getTime();
    return Number.isFinite(t) ? t : null;
  }
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const t = new Date(value).getTime();
  return Number.isFinite(t) ? t : null;
}

const EMPLOYMENT_TYPE_LABELS: Record<string, string> = {
  "full time": "Full Time",
  "part time": "Part Time",
  contract: "Contract",
  intern: "Intern",
  internship: "Intern",
  "full-time": "Full Time",
  "part-time": "Part Time",
};

/**
 * Human label for an employment_type. The DB stores Title Case already, so this
 * is a normaliser for snake_case ("full_time") and a guard against blanks;
 * anything unrecognised is passed through unchanged.
 */
export function employmentTypeLabel(t: string | null | undefined): string {
  if (!t) return "";
  const key = t.trim().toLowerCase().replace(/[_-]+/g, " ");
  return EMPLOYMENT_TYPE_LABELS[key] ?? EMPLOYMENT_TYPE_LABELS[t.trim().toLowerCase()] ?? t;
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

/**
 * Human experience band:
 *   (2, 5)      → "2–5 yrs"
 *   (3, 3)      → "3 yrs"
 *   (2, null)   → "2+ yrs"
 *   (null, 5)   → "Up to 5 yrs"
 *   (null, null) → "Not specified"
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
 * True while an opening is live on the public site: status is "open" and its
 * close date has not passed. A missing or unparseable closes_at means "no
 * deadline". Mirrors the "Public reads open job openings" RLS policy.
 */
export function isLive(
  job: Pick<PublicJob, "status" | "closes_at"> | null | undefined,
  now: Moment = new Date(),
): boolean {
  if (!job || job.status !== "open") return false;
  if (!job.closes_at) return true;
  const closesAt = toEpoch(job.closes_at);
  if (closesAt === null) return true;
  const nowMs = toEpoch(now);
  if (nowMs === null) return true;
  return closesAt > nowMs;
}

// India Standard Time is a fixed +05:30 offset (no DST), so shifting the epoch
// and reading UTC getters gives a deterministic calendar date regardless of the
// machine's timezone or ICU data — which keeps the unit tests stable.
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/** "12 Jun 2026" in IST, or "" when the value is missing/unparseable. */
function formatDay(value: Moment | null | undefined): string {
  const ms = toEpoch(value);
  if (ms === null) return "";
  const shifted = new Date(ms + IST_OFFSET_MS);
  return `${shifted.getUTCDate()} ${MONTHS[shifted.getUTCMonth()]} ${shifted.getUTCFullYear()}`;
}

/** "Posted 12 Jun 2026" (IST), or "" when there is no valid posted_at. */
export function formatPosted(date: Moment | null | undefined): string {
  const day = formatDay(date);
  return day ? `Posted ${day}` : "";
}

/** "Closes 30 Jun 2026" (IST), or "" when the role has no deadline. */
export function formatCloses(date: Moment | null | undefined): string {
  const day = formatDay(date);
  return day ? `Closes ${day}` : "";
}
