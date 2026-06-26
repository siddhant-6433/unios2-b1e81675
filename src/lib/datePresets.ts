export type DatePreset =
  | "all"
  | "today"
  | "yesterday"
  | "this_week"
  | "this_month"
  | "last_7"
  | "last_30"
  | "last_90"
  | "custom";

export const DATE_PRESETS: { key: DatePreset; label: string }[] = [
  { key: "all", label: "All time" },
  { key: "today", label: "Today" },
  { key: "yesterday", label: "Yesterday" },
  { key: "this_week", label: "This week" },
  { key: "this_month", label: "This month" },
  { key: "last_7", label: "Last 7 days" },
  { key: "last_30", label: "Last 30 days" },
  { key: "last_90", label: "Last 90 days" },
  { key: "custom", label: "Custom range" },
];

export function toDateInputValue(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function getDatePresetRange(preset: DatePreset): { from: string; to: string } {
  const today = new Date();
  const todayValue = toDateInputValue(today);

  switch (preset) {
    case "today":
      return { from: todayValue, to: todayValue };
    case "yesterday": {
      const yesterday = new Date(today);
      yesterday.setDate(yesterday.getDate() - 1);
      const value = toDateInputValue(yesterday);
      return { from: value, to: value };
    }
    case "this_week": {
      const start = new Date(today);
      const day = start.getDay();
      start.setDate(start.getDate() - (day === 0 ? 6 : day - 1));
      return { from: toDateInputValue(start), to: todayValue };
    }
    case "this_month": {
      const start = new Date(today.getFullYear(), today.getMonth(), 1);
      return { from: toDateInputValue(start), to: todayValue };
    }
    case "last_7":
    case "last_30":
    case "last_90": {
      const days = preset === "last_7" ? 7 : preset === "last_30" ? 30 : 90;
      const start = new Date(today);
      start.setDate(start.getDate() - days + 1);
      return { from: toDateInputValue(start), to: todayValue };
    }
    case "all":
    case "custom":
    default:
      return { from: "", to: "" };
  }
}

export function getEndExclusiveIso(dateValue: string) {
  const date = new Date(`${dateValue}T00:00:00`);
  date.setDate(date.getDate() + 1);
  return date.toISOString();
}
