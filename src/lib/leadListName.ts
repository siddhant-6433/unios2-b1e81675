// Shared helper for the canonical lead-list name:
//   {Course} - {23 Aug 2026} - {Source}[ - {Identifier}]
// Course is the most common course among the list's members, or "Mixed" when
// there is no clear single course. A counsellor's self-made calling list gets
// their name as a non-editable prefix so admins can tell whose list it is.

export type ListSource = "manual" | "import" | "filter" | "followup";

const SOURCE_LABEL: Record<ListSource, string> = {
  manual: "Manual",
  import: "Imported",
  filter: "Filter",
  followup: "Follow-up",
};

/** "23 Aug 2026" — the in-words due date the list name uses. */
export function formatDueDateInWords(dueDate: string | Date | null | undefined): string {
  if (!dueDate) return "";
  const d = typeof dueDate === "string" ? new Date(dueDate) : dueDate;
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

/**
 * Most common non-empty course name in the set, or "Mixed" when the set is
 * empty or no single course is a strict plurality. Ties → "Mixed" (ambiguous).
 */
export function dominantCourse(courseNames: Array<string | null | undefined>): string {
  const counts = new Map<string, number>();
  for (const raw of courseNames) {
    const name = (raw ?? "").trim();
    if (!name) continue;
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  if (counts.size === 0) return "Mixed";

  let best: string | null = null;
  let bestN = 0;
  let tied = false;
  for (const [name, n] of counts) {
    if (n > bestN) {
      best = name;
      bestN = n;
      tied = false;
    } else if (n === bestN) {
      tied = true;
    }
  }
  return best && !tied ? best : "Mixed";
}

export function buildListName(opts: {
  course: string;
  dueDate?: string | Date | null;
  source: ListSource;
  identifier?: string | null;
  /** Non-editable prefix, e.g. a counsellor's own name for a self-made list. */
  counsellorPrefix?: string | null;
}): string {
  const parts = [
    (opts.course || "Mixed").trim(),
    formatDueDateInWords(opts.dueDate),
    SOURCE_LABEL[opts.source],
    (opts.identifier ?? "").trim(),
  ].filter(Boolean);

  const base = parts.join(" - ");
  const prefix = (opts.counsellorPrefix ?? "").trim();
  return prefix ? `${prefix} - ${base}` : base;
}
