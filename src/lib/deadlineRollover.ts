export const INITIAL_APPLICATION_DEADLINE = "2026-06-10";
export const EXTENDED_APPLICATION_DEADLINE = "2026-06-14";
export const INITIAL_CAHET_DEADLINE_ISO = "2026-06-10T23:59:59+05:30";
export const EXTENDED_CAHET_DEADLINE_ISO = "2026-06-14T23:59:59+05:30";

const INITIAL_DEADLINE_END_MS = new Date(INITIAL_CAHET_DEADLINE_ISO).getTime();

export function isAfterInitialDeadline(now = Date.now()): boolean {
  return now > INITIAL_DEADLINE_END_MS;
}

export function effectiveApplicationDeadline(deadline: string, now = Date.now()): string {
  if (deadline <= INITIAL_APPLICATION_DEADLINE && isAfterInitialDeadline(now)) {
    return EXTENDED_APPLICATION_DEADLINE;
  }
  return deadline;
}

export function effectiveCahetDeadline(deadlineIso: string, now = Date.now()): string {
  if (new Date(deadlineIso).getTime() <= INITIAL_DEADLINE_END_MS && isAfterInitialDeadline(now)) {
    return EXTENDED_CAHET_DEADLINE_ISO;
  }
  return deadlineIso;
}

export function effectiveCahetDeadlineLabel(now = Date.now()): string {
  return isAfterInitialDeadline(now) ? "14 Jun 2026, 11:59 PM" : "10 Jun 2026, 11:59 PM";
}

export function effectiveCahetWhatsAppDeadlineText(now = Date.now()): {
  descriptionDate: string;
  bodyDate: string;
  prefix: string;
} {
  return isAfterInitialDeadline(now)
    ? { descriptionDate: "14 June 2026", bodyDate: "14th June 2026", prefix: "Round 1 Final Extension - " }
    : { descriptionDate: "10 June 2026", bodyDate: "10th June 2026", prefix: "" };
}

export function cahetDeadlineDescription(now = Date.now()): string {
  const { descriptionDate, prefix } = effectiveCahetWhatsAppDeadlineText(now);
  return `${prefix}${descriptionDate} application + CAHET registration deadline`;
}

export function cahetDeadlineMessage(now = Date.now()): string {
  const { bodyDate, prefix } = effectiveCahetWhatsAppDeadlineText(now);
  return `Dear Applicant,

This is to inform you that for admission to *BPT (Bachelors of Physiotherapy) and BMRIT (Bachelors of Medical Radiological Imaging Technology)* - ${prefix}Last date for Application Submission is *${bodyDate}, 11:59 PM*

For admission Candidates *MUST*

1. Complete College Application Online at https://apply.nimt.ac.in
2. Complete the CAHET Registration on ABVMUP (This is mandatory for admission to BPT/BMRIT across Uttar Pradesh) : https://www.abvmucet26.co.in/entrance2026/login?form=4

Please note both form submissions are mandatory by ${bodyDate}, 11:59 PM to be included in the admission process for session 2026-27.

For any details please call 9555192192
9667691872
7428499849`;
}
