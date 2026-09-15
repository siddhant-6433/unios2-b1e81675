// Partial masking of phone numbers and emails for CRM display and exports.
// Every staff CRM view paints 981****892. Super_admin exports can still
// unmask. Single source of truth — mirror of the edge-side maskPhoneForLog
// (supabase/functions/_shared/phone.ts) and the LeadBuckets frontend pattern.

export function maskPhone(value: string | null | undefined): string {
  const digits = String(value ?? "").replace(/\D/g, "");
  const last10 = digits.length > 10 ? digits.slice(-10) : digits; // drop +91 country code
  if (last10.length < 6) return last10 ? "****" : "";
  // 10-digit mobiles: 981****892 (first 3 + last 3, four middle digits hidden).
  return `${last10.slice(0, 3)}****${last10.slice(-3)}`;
}

export function maskEmail(value: string | null | undefined): string {
  const s = String(value ?? "").trim();
  const at = s.indexOf("@");
  if (at < 1) return s ? "****" : ""; // no / degenerate local part
  const local = s.slice(0, at);
  const domain = s.slice(at); // includes the "@"
  return (local.length <= 2 ? local : local.slice(0, 2)) + "****" + domain;
}

export function canUnmaskContact(role: string | null | undefined): boolean {
  return role === "super_admin";
}

export function displayPhone(
  value: string | null | undefined,
  unmask = false,
): string {
  if (unmask) return value == null ? "" : String(value);
  return maskPhone(value);
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
