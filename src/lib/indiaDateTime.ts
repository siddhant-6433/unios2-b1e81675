const INDIA_TIME_ZONE = "Asia/Kolkata";

function indiaDateTimeParts(value: Date) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: INDIA_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(value);

  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value || "";

  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    time: `${get("hour")}:${get("minute")}`,
  };
}

export function getCurrentIndiaDateTimeInput() {
  return indiaDateTimeParts(new Date());
}

export function splitToIndiaDateTimeInput(value?: string | null) {
  if (!value) return getCurrentIndiaDateTimeInput();
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return getCurrentIndiaDateTimeInput();
  return indiaDateTimeParts(date);
}

export function combineIndiaDateTimeInput(date: string, time: string) {
  if (!date) return null;
  return `${date}T${time || "00:00"}:00+05:30`;
}

export function indiaTodayDate() {
  return getCurrentIndiaDateTimeInput().date;
}

/** Add calendar days to a YYYY-MM-DD value without using the browser timezone. */
export function addCalendarDays(date: string, days: number) {
  const [year, month, day] = date.split("-").map(Number);
  const utc = new Date(Date.UTC(year, (month || 1) - 1, (day || 1) + days));
  return [
    utc.getUTCFullYear(),
    String(utc.getUTCMonth() + 1).padStart(2, "0"),
    String(utc.getUTCDate()).padStart(2, "0"),
  ].join("-");
}

/** Inclusive IST midnight for a calendar date. */
export function indiaDayStartIso(date: string) {
  return combineIndiaDateTimeInput(date, "00:00");
}

/** Exclusive IST midnight of the next calendar date. */
export function indiaDayEndExclusiveIso(date: string) {
  return combineIndiaDateTimeInput(addCalendarDays(date, 1), "00:00");
}
