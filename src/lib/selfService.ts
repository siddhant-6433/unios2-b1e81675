// Employee self-service request helpers.
//
// The approval queues already exist (ProfileChangeRequests, RegularisationQueue);
// these helpers are the producer half. buildChangeDiff is deliberately the only
// place that decides what "changed" means, because the server-side apply RPC
// re-reads the same field allow-list and a mismatch here would either smuggle a
// non-editable field into the request or drop a real edit on the floor.

/** A single field's before/after pair. `null` means empty/cleared. */
export interface FieldChange {
  from: string | null;
  to: string | null;
}

/** The `changes` jsonb payload: only fields that actually changed. */
export type ChangeDiff = Record<string, FieldChange>;

/**
 * Human label for every value in the `employee_self_editable_fields()` allow-list.
 * Falls back to the raw column name so an RPC that grows a field never renders
 * a blank row in a reviewer's queue.
 */
export const FIELD_LABEL: Record<string, string> = {
  personal_email: "Personal email",
  mobile_number: "Mobile",
  work_number: "Work number",
  residence_number: "Residence number",
  current_address: "Current address",
  permanent_address: "Permanent address",
  marital_status: "Marital status",
  blood_group: "Blood group",
  date_of_birth: "Date of birth",
  gender: "Gender",
  nationality: "Nationality",
  education: "Education",
  experience: "Experience",
  emergency_contact_name: "Emergency contact",
  emergency_contact_phone: "Emergency phone",
};

/**
 * Reasons an employee can pick for an attendance correction. Kept as a closed
 * list so reviewers can triage by reason instead of reading 1,500 free-text
 * variants of "forgot".
 */
export const REGULARISATION_REASONS = [
  "Missed punch-in",
  "Missed punch-out",
  "Forgot to punch",
  "Biometric / machine error",
  "On duty / official work",
  "Work from home",
  "Other",
] as const;

export type RegularisationReason = (typeof REGULARISATION_REASONS)[number];

/**
 * Normalise a profile value into the string form stored in `changes`.
 * Empty strings and missing values both collapse to `null`, so clearing a
 * field reads as a change and whitespace-only edits do not.
 */
export function normalizeFieldValue(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed === "" ? null : trimmed;
  }
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  // Json columns (addresses, education, experience) are stored as objects; a
  // stable string keeps them diffable rather than "[object Object]".
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/**
 * Build the request payload from the employee's current profile and their
 * proposed edits. Only `editableFields` are considered, and only fields whose
 * normalised value actually changed are emitted.
 */
export function buildChangeDiff(
  before: Record<string, unknown> | null | undefined,
  after: Record<string, unknown> | null | undefined,
  editableFields: readonly string[],
): ChangeDiff {
  const from = before ?? {};
  const to = after ?? {};
  const diff: ChangeDiff = {};
  const seen = new Set<string>();

  for (const field of editableFields) {
    if (!field || seen.has(field)) continue;
    seen.add(field);
    const previous = normalizeFieldValue(from[field]);
    const next = normalizeFieldValue(to[field]);
    if (previous !== next) diff[field] = { from: previous, to: next };
  }

  return diff;
}

/** One-line, reviewer-readable summary of a diff. Empty diff → empty string. */
export function formatDiff(diff: ChangeDiff | null | undefined): string {
  if (!diff) return "";
  return Object.entries(diff)
    .map(([field, change]) => {
      const label = FIELD_LABEL[field] || field;
      return `${label}: ${change.from ?? "—"} → ${change.to ?? "—"}`;
    })
    .join("; ");
}

export interface PunchTimeValidation {
  ok: boolean;
  error: string | null;
}

const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)(?::[0-5]\d)?$/;

function minutesOf(time: string): number | null {
  if (!TIME_PATTERN.test(time)) return null;
  const [hours, minutes] = time.split(":");
  return Number(hours) * 60 + Number(minutes);
}

/**
 * Validate the corrected punch times for a regularisation request.
 * Accepts a 24-hour `HH:MM` or `HH:MM:SS` string; at least one side must be
 * present, and when both are the punch-out must be later than the punch-in.
 */
export function validatePunchTimes(
  punchIn: string | null | undefined,
  punchOut: string | null | undefined,
): PunchTimeValidation {
  const inValue = (punchIn ?? "").trim();
  const outValue = (punchOut ?? "").trim();

  if (!inValue && !outValue) {
    return { ok: false, error: "Enter a corrected punch-in or punch-out time." };
  }
  if (inValue && minutesOf(inValue) === null) {
    return { ok: false, error: "Punch-in must be a valid time (HH:MM)." };
  }
  if (outValue && minutesOf(outValue) === null) {
    return { ok: false, error: "Punch-out must be a valid time (HH:MM)." };
  }
  if (inValue && outValue) {
    if (minutesOf(outValue)! <= minutesOf(inValue)!) {
      return { ok: false, error: "Punch-out must be later than punch-in." };
    }
  }
  return { ok: true, error: null };
}
