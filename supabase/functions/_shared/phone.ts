/**
 * Normalize phone numbers for Plivo Voice API calls.
 *
 * Plivo Voice accepts E.164 numbers. In this codebase the voice paths have
 * historically sent E.164 as digits-only (`919599682428`), so this helper keeps
 * that wire format while rejecting values that cannot be routed.
 */
export function normalizePlivoVoiceNumber(value: string | null | undefined, defaultCountryCode = "91"): string | null {
  let digits = String(value || "").replace(/\D/g, "");
  const countryCode = defaultCountryCode.replace(/\D/g, "") || "91";

  if (!digits) return null;
  if (digits.startsWith("00")) digits = digits.slice(2);

  // Indian staff/student numbers are commonly stored as 10 digits, +91...,
  // 91..., or with a leading trunk 0. Canonicalize those before validation.
  if (countryCode === "91") {
    if (digits.length === 11 && digits.startsWith("0")) digits = digits.slice(1);
    if (digits.length === 10) digits = `${countryCode}${digits}`;
    if (digits.length === 13 && digits.startsWith("910")) {
      digits = `91${digits.slice(3)}`;
    }
  } else if (digits.length === 10) {
    digits = `${countryCode}${digits}`;
  }

  // E.164 allows up to 15 digits and cannot start with 0. Require at least 11
  // digits so a bare local number never slips through to Plivo.
  if (!/^[1-9]\d{10,14}$/.test(digits)) return null;
  return digits;
}

export function maskPhoneForLog(value: string | null | undefined): string {
  const digits = String(value || "").replace(/\D/g, "");
  if (digits.length <= 4) return digits ? "****" : "";
  return `${"*".repeat(Math.max(0, digits.length - 4))}${digits.slice(-4)}`;
}
