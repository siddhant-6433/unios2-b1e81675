// Custom employee fields — pure types and helpers.
//
// HR can define extra fields on an employee that the core schema does not know
// about (a uniform size, a licence expiry, a preferred shift). A definition
// lives in `employee_field_defs`; each employee's answer lives in
// `employee_field_values` as text, whatever the field type. Nothing in this file
// touches Supabase — the panels own the I/O. The rules that decide whether a
// value is acceptable and how it should read back live here so they can be
// unit-tested without a database.
//
// Values are stored as text on purpose: one column, one UNIQUE
// (employee_profile_id, field_id) row per answer, and the definition's
// `field_type` decides how to parse and render it. `options` arrives from jsonb
// as a string array (or occasionally a JSON string), so every reader normalises
// it through `normalizeOptions` rather than trusting the shape.

export type FieldType = "text" | "number" | "date" | "boolean" | "select";

/** Every type the DB CHECK constraint allows, in a sensible authoring order. */
export const FIELD_TYPES: readonly FieldType[] = [
  "text",
  "number",
  "date",
  "boolean",
  "select",
] as const;

export interface FieldDef {
  id: string;
  key: string;
  label: string;
  field_type: FieldType;
  /** jsonb array of strings; only meaningful for `select`. */
  options: string[] | null;
  is_required: boolean;
  display_order: number;
  is_active: boolean;
}

/** A stored answer. `value` is always text; empty clears the row via RPC. */
export interface FieldValue {
  id?: string;
  employee_profile_id?: string;
  field_id: string;
  value: string | null;
  updated_at?: string;
}

/** The minimum a value needs to render or validate — inbox/RPC rows carry no options. */
export type FieldDefLike = Pick<FieldDef, "field_type"> &
  Partial<Pick<FieldDef, "options" | "label" | "is_required">>;

export interface FieldValidation {
  ok: boolean;
  error: string | null;
}

const FIELD_TYPE_LABELS: Record<FieldType, string> = {
  text: "Text",
  number: "Number",
  date: "Date",
  boolean: "Yes / No",
  select: "Select",
};

/** Human label for a field type, tolerant of an unexpected string from the DB. */
export function fieldTypeLabel(type: FieldType | string): string {
  return FIELD_TYPE_LABELS[type as FieldType] ?? String(type);
}

/**
 * Coerce the jsonb `options` into a clean string array. Handles null, an
 * already-parsed array, a JSON-encoded string, and drops blank entries so a
 * trailing comma in the authoring UI never becomes a selectable empty option.
 */
export function normalizeOptions(options: unknown): string[] {
  let raw: unknown = options;
  if (typeof raw === "string") {
    try {
      raw = JSON.parse(raw);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(raw)) return [];
  return raw
    .map((o) => (o === null || o === undefined ? "" : String(o)).trim())
    .filter((o) => o.length > 0);
}

function isBlank(value: unknown): boolean {
  return value === null || value === undefined || String(value).trim() === "";
}

/**
 * Parse a stored text value into a boolean, or null when it is not one. The
 * panel writes "true"/"false", but we accept the common spellings so a value
 * seeded by hand still reads correctly.
 */
export function parseBoolean(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  if (isBlank(value)) return null;
  switch (String(value).trim().toLowerCase()) {
    case "true":
    case "1":
    case "yes":
    case "y":
    case "on":
      return true;
    case "false":
    case "0":
    case "no":
    case "n":
    case "off":
      return false;
    default:
      return null;
  }
}

function parseIsoDate(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const [, year, month, day] = match;
  const date = new Date(Number(year), Number(month) - 1, Number(day));
  if (
    date.getFullYear() !== Number(year) ||
    date.getMonth() !== Number(month) - 1 ||
    date.getDate() !== Number(day)
  ) {
    return null;
  }
  return date;
}

const NUMBER_FORMAT = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 });

/**
 * A stored value as HR should read it. `def` supplies the `field_type` (and the
 * `options`/`label` for callers that have them); a blank value is an em dash so
 * the table never shows an empty cell. Unparseable values fall back to the raw
 * text rather than being silently blanked — a bad value should stay visible.
 */
export function formatFieldValue(def: FieldDefLike, value: unknown): string {
  if (isBlank(value)) return "—";
  const raw = String(value).trim();

  switch (def.field_type) {
    case "boolean": {
      const parsed = parseBoolean(raw);
      if (parsed === null) return raw;
      return parsed ? "Yes" : "No";
    }
    case "number": {
      const n = Number(raw);
      return Number.isFinite(n) ? NUMBER_FORMAT.format(n) : raw;
    }
    case "date": {
      const date = parseIsoDate(raw);
      return date
        ? date.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })
        : raw;
    }
    case "select":
    case "text":
    default:
      return raw;
  }
}

/**
 * Validate a value against its definition. Always shaped `{ ok, error }` so a
 * caller can render `error` inline; `error` is null when the value is accepted.
 * A blank value is fine unless the field is required, in which case every type
 * fails the same way. Non-blank values are checked for their type.
 */
export function validateFieldValue(def: FieldDefLike, value: unknown): FieldValidation {
  const label = def.label?.trim() || "This field";
  const blank = isBlank(value);

  if (blank) {
    if (def.is_required) {
      return { ok: false, error: `${label} is required` };
    }
    return { ok: true, error: null };
  }

  const raw = String(value).trim();

  switch (def.field_type) {
    case "number": {
      const n = Number(raw);
      if (!Number.isFinite(n)) {
        return { ok: false, error: `${label} must be a number` };
      }
      return { ok: true, error: null };
    }
    case "date": {
      if (!parseIsoDate(raw)) {
        return { ok: false, error: `${label} must be a valid date` };
      }
      return { ok: true, error: null };
    }
    case "select": {
      const options = normalizeOptions(def.options);
      // An unfinished definition with no options cannot reject anything.
      if (options.length > 0 && !options.includes(raw)) {
        return { ok: false, error: `${label} must be one of: ${options.join(", ")}` };
      }
      return { ok: true, error: null };
    }
    case "boolean": {
      if (parseBoolean(raw) === null) {
        return { ok: false, error: `${label} must be yes or no` };
      }
      return { ok: true, error: null };
    }
    case "text":
    default:
      return { ok: true, error: null };
  }
}

/**
 * A copy of the definitions ordered for display: `display_order` ascending, then
 * label, then key so two defs sharing an order still get a stable sequence.
 */
export function sortDefs<T extends Pick<FieldDef, "display_order"> & Partial<Pick<FieldDef, "label" | "key">>>(
  defs: readonly T[],
): T[] {
  return [...defs].sort((a, b) => {
    const order = (Number(a.display_order) || 0) - (Number(b.display_order) || 0);
    if (order !== 0) return order;
    const byLabel = (a.label ?? "").localeCompare(b.label ?? "");
    if (byLabel !== 0) return byLabel;
    return (a.key ?? "").localeCompare(b.key ?? "");
  });
}
