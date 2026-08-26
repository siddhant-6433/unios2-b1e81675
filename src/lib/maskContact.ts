// Partial masking of phone numbers and emails for exports (and, later, list
// views). Only super_admins download real values; everyone else sees masked
// data. Single source of truth — mirror of the edge-side maskPhoneForLog
// (supabase/functions/_shared/phone.ts) and the LeadBuckets frontend pattern.

export function maskPhone(value: string | null | undefined): string {
  const digits = String(value ?? "").replace(/\D/g, "");
  const last10 = digits.length > 10 ? digits.slice(-10) : digits; // drop +91 country code
  if (last10.length <= 4) return last10 ? "****" : "";
  return last10.slice(0, 2) + "*".repeat(last10.length - 4) + last10.slice(-2);
}

export function maskEmail(value: string | null | undefined): string {
  const s = String(value ?? "").trim();
  const at = s.indexOf("@");
  if (at < 1) return s ? "****" : ""; // no / degenerate local part
  const local = s.slice(0, at);
  const domain = s.slice(at); // includes the "@"
  return (local.length <= 2 ? local : local.slice(0, 2)) + "****" + domain;
}

// Decide masking by column header; an "@" in the value wins (handles Marketing's
// "Destination" column, which is a phone for WhatsApp campaigns and an email for
// email campaigns).
export function maskContactField(header: string, value: unknown): string {
  const v = value == null ? "" : String(value);
  if (/e-?mail/i.test(header)) return maskEmail(v);
  if (/(phone|mobile|whatsapp|destination|contact\s*no)/i.test(header)) {
    return v.includes("@") ? maskEmail(v) : maskPhone(v);
  }
  return v;
}

// Object-keyed rows (the shared xlsxExport form).
export function maskExportRows<T extends Record<string, unknown>>(
  rows: T[],
  unmask: boolean,
): T[] {
  if (unmask) return rows;
  return rows.map(
    (r) =>
      Object.fromEntries(
        Object.entries(r).map(([k, val]) => [k, maskContactField(k, val)]),
      ) as T,
  );
}

// Header + matrix form (the hand-rolled CSV exporters).
export function maskMatrix<T>(
  headers: string[],
  rows: T[][],
  unmask: boolean,
): (T | string)[][] {
  if (unmask) return rows;
  return rows.map((row) =>
    row.map((cell, i) => maskContactField(headers[i] ?? "", cell)),
  );
}
