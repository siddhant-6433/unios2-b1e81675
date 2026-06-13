export const INITIAL_APPLICATION_DEADLINE = "2026-06-14";
export const INITIAL_CAHET_DEADLINE_ISO = "2026-06-14T23:59:59+05:30";

const IST_DAY_MS = 86_400_000;
const GENERAL_ADMISSION_ROUND_START = 2;
const GENERAL_ADMISSION_EXTENSION_DAYS = 5;
const GENERAL_ADMISSION_WINDOWS_PER_ROUND = 3;
const INITIAL_APPLICATION_DEADLINE_END_MS = new Date(`${INITIAL_APPLICATION_DEADLINE}T23:59:59+05:30`).getTime();
const INITIAL_CAHET_DEADLINE_END_MS = new Date(INITIAL_CAHET_DEADLINE_ISO).getTime();

export function isAfterInitialDeadline(now = Date.now()): boolean {
  return now > INITIAL_APPLICATION_DEADLINE_END_MS;
}

function formatIsoDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function applicationWindowIndex(now = Date.now()): number {
  if (!isAfterInitialDeadline(now)) return 0;
  return Math.floor((now - INITIAL_APPLICATION_DEADLINE_END_MS - 1) / (GENERAL_ADMISSION_EXTENSION_DAYS * IST_DAY_MS)) + 1;
}

export function effectiveApplicationDeadline(_deadline: string, now = Date.now()): string {
  const windowIndex = applicationWindowIndex(now);
  const rollingDeadline = formatIsoDate(INITIAL_APPLICATION_DEADLINE_END_MS + windowIndex * GENERAL_ADMISSION_EXTENSION_DAYS * IST_DAY_MS);
  return _deadline > rollingDeadline ? _deadline : rollingDeadline;
}

export function effectiveApplicationRound(now = Date.now()): number {
  return GENERAL_ADMISSION_ROUND_START + Math.floor(applicationWindowIndex(now) / GENERAL_ADMISSION_WINDOWS_PER_ROUND);
}

export function applicationDeadlineHeadline(portalId: "nimt" | "beacon" | "mirai", now = Date.now()): string {
  const round = effectiveApplicationRound(now);
  if (portalId === "nimt") return `Round ${round} Application Deadline`;
  return `Round ${round} Application Deadline for Admission`;
}

export function effectiveCahetDeadline(deadlineIso: string, _now = Date.now()): string {
  if (new Date(deadlineIso).getTime() <= INITIAL_CAHET_DEADLINE_END_MS) {
    return INITIAL_CAHET_DEADLINE_ISO;
  }
  return deadlineIso;
}

export function effectiveCahetDeadlineLabel(_now = Date.now()): string {
  return "14 Jun 2026, 11:59 PM";
}

export function effectiveCahetWhatsAppDeadlineText(_now = Date.now()): {
  descriptionDate: string;
  bodyDate: string;
  prefix: string;
} {
  return { descriptionDate: "14 June 2026", bodyDate: "14th June 2026", prefix: "" };
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
