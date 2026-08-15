// What to show next to an employee's name, decided once.
//
// The exit record is the source of truth, not employee_profiles.employment_status:
// that column is NULL for 91 of the 99 employees (only imported rows ever got one),
// so anything keyed on it alone would show nothing for almost everybody. It stays as
// a fallback for exactly those rows.
//
// Note the two meanings of "out". Keka puts OUT next to the name for "not currently
// punched in", which is what In/Out means here. Having left the organisation is
// "Exited" — this profile used to render a red OUT pill for that, which read as an
// attendance state and meant the same word said two different things.

export type ExitStatus = "under_review" | "in_progress" | "completed" | "reverted" | "rejected";

export interface ExitRecord {
  status: string;
  last_working_day: string | null;
  exit_type?: string | null;
}

export interface BadgeInput {
  exit?: ExitRecord | null;
  /** employee_profiles.employment_status — only populated on imported rows. */
  employmentStatus?: string | null;
  dateOfExit?: string | null;
  /** Today's punches. A pair with an in and no out means they are on site. */
  punchesToday?: { punch_in: string | null; punch_out: string | null }[];
  /** Omit to hide the attendance pill entirely (e.g. in a dense list). */
  showAttendance?: boolean;
}

export type BadgeKind = "in" | "out" | "exit_requested" | "under_notice" | "exited";

export interface Badge {
  kind: BadgeKind;
  label: string;
  /** Secondary line, e.g. "until 30 Sep · 46 days left". */
  detail?: string;
  tone: "success" | "muted" | "warning" | "danger";
}

const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** Whole days from today to an ISO date; negative once past. */
export function daysUntil(date: string | null | undefined, today = new Date()): number | null {
  if (!date) return null;
  const [y, m, d] = date.split("-").map(Number);
  if (!y || !m || !d) return null;
  const target = new Date(y, m - 1, d).getTime();
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  return Math.round((target - start) / 86_400_000);
}

function formatDate(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  if (!y || !m || !d) return date;
  return new Date(y, m - 1, d).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

/** On site right now: some punch today has an in and no out. */
export function isPunchedIn(punches: BadgeInput["punchesToday"]): boolean {
  return (punches ?? []).some((p) => p.punch_in && !p.punch_out);
}

/**
 * At most one employment badge plus at most one attendance badge.
 * Employment precedence: exited > under notice > exit requested — the furthest
 * along wins, so a completed exit never also reads as "requested".
 */
export function employmentBadges(input: BadgeInput, today = new Date()): Badge[] {
  const badges: Badge[] = [];
  const { exit, employmentStatus, dateOfExit } = input;

  // A reverted or rejected exit is not a state the person is in.
  const live = exit && exit.status !== "reverted" && exit.status !== "rejected" ? exit : null;
  const todayIso = iso(today);

  const hasLeft =
    live?.status === "completed" ||
    (!!dateOfExit && dateOfExit <= todayIso) ||
    (!live && (employmentStatus === "Resigned" || employmentStatus === "Terminated"));

  const serving =
    live?.status === "in_progress" ||
    (!live && employmentStatus === "On Notice");

  if (hasLeft) {
    const on = live?.last_working_day ?? dateOfExit;
    badges.push({
      kind: "exited",
      label: "Exited",
      detail: on ? `left ${formatDate(on)}` : undefined,
      tone: "danger",
    });
  } else if (serving) {
    const lwd = live?.last_working_day ?? null;
    const left = daysUntil(lwd, today);
    badges.push({
      kind: "under_notice",
      label: "Under notice",
      detail: lwd
        ? `until ${formatDate(lwd)}${left !== null && left >= 0 ? ` · ${left} day${left === 1 ? "" : "s"} left` : ""}`
        : undefined,
      tone: "warning",
    });
  } else if (live?.status === "under_review") {
    badges.push({
      kind: "exit_requested",
      label: "Exit requested",
      detail: "awaiting approval",
      tone: "warning",
    });
  }

  // Attendance is orthogonal — somebody serving notice still turns up.
  // Suppressed once they have left, where it would be noise.
  if (input.showAttendance && !hasLeft) {
    badges.push(
      isPunchedIn(input.punchesToday)
        ? { kind: "in", label: "In", tone: "success" }
        : { kind: "out", label: "Out", tone: "muted" },
    );
  }

  return badges;
}

/** True when the exit still needs someone to act on it. */
export function needsAction(exit: ExitRecord | null | undefined, today = new Date()): boolean {
  if (!exit) return false;
  if (exit.status === "under_review") return true;
  if (exit.status === "in_progress") {
    const left = daysUntil(exit.last_working_day, today);
    return left !== null && left <= 0;
  }
  return false;
}

export const TONE_CLASS: Record<Badge["tone"], string> = {
  success: "bg-success/15 text-success",
  muted: "bg-muted text-muted-foreground",
  warning: "bg-warning/15 text-warning",
  danger: "bg-destructive/15 text-destructive",
};
