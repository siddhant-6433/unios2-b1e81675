function toIsoDate(year: number, month: number, day: number): string {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return "";
  if (year < 1900 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31) return "";

  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return "";
  }

  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function normalizeStudentImportDate(raw: string | null | undefined): string {
  const value = String(raw || "").trim();
  if (!value) return "";

  const iso = value.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:T.*)?$/);
  if (iso) {
    return toIsoDate(Number(iso[1]), Number(iso[2]), Number(iso[3]));
  }

  const dayFirst = value.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
  if (dayFirst) {
    return toIsoDate(Number(dayFirst[3]), Number(dayFirst[2]), Number(dayFirst[1]));
  }

  return "";
}

export function resolveStudentImportAdmissionDate(
  rowAdmissionDate: string | null | undefined,
  defaultAdmissionDate: string | null | undefined,
): string | null {
  return normalizeStudentImportDate(rowAdmissionDate) || normalizeStudentImportDate(defaultAdmissionDate) || null;
}
