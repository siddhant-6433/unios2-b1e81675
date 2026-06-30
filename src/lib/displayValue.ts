const PREFERRED_OBJECT_KEYS = [
  "label",
  "name",
  "value",
  "title",
  "text",
  "course_name",
  "campus_name",
  "prev_school_name",
  "school_name",
  "school",
  "first_name",
];

function humanizeKey(key: string) {
  return key.replace(/_/g, " ").replace(/\b\w/g, ch => ch.toUpperCase());
}

export function displayValue(value: unknown): string | null {
  if (value == null || value === "") return null;
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    const parts = value.map(displayValue).filter(Boolean);
    return parts.length > 0 ? parts.join(", ") : null;
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    for (const key of PREFERRED_OBJECT_KEYS) {
      const nested = displayValue(record[key]);
      if (nested) return nested;
    }

    const parts = Object.entries(record)
      .map(([key, nestedValue]) => {
        const nested = displayValue(nestedValue);
        return nested ? `${humanizeKey(key)}: ${nested}` : null;
      })
      .filter(Boolean);

    if (parts.length > 0) return parts.join(", ");

    try {
      return JSON.stringify(value);
    } catch {
      return null;
    }
  }
  return String(value);
}
