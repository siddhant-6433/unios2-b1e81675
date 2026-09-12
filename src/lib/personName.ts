/**
 * Sentence-case a person name for display and storage.
 * "mr. salim ahmad" → "Mr. Salim Ahmad"; "AYRA" → "Ayra".
 * Idempotent: already-formatted names stay the same.
 */
export function formatPersonName(value: string | null | undefined): string {
  if (value == null) return "";
  const trimmed = value.trim().replace(/\s+/g, " ");
  if (!trimmed) return "";
  return trimmed
    .toLowerCase()
    .replace(/\b[a-z]/g, (ch) => ch.toUpperCase());
}

export function formatPersonNameOrNull(value: string | null | undefined): string | null {
  return formatPersonName(value) || null;
}

export const PERSON_NAME_FIELDS = [
  "name",
  "first_name",
  "middle_name",
  "last_name",
  "father_name",
  "mother_name",
  "guardian_name",
] as const;

export type PersonNameField = (typeof PERSON_NAME_FIELDS)[number];

export function isPersonNameField(key: string): key is PersonNameField {
  return (PERSON_NAME_FIELDS as readonly string[]).includes(key);
}
