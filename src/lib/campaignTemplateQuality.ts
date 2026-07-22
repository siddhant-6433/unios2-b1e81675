/**
 * Meta template quality for bulk campaigns.
 * GREEN preferred; YELLOW warned; RED blocked for bulk sends.
 */

export type TemplateQualityScore = "GREEN" | "YELLOW" | "RED" | "UNKNOWN";

export type TemplateQualityDecision = {
  score: TemplateQualityScore;
  /** Allow starting a bulk campaign with this template. */
  allowBulk: boolean;
  /** Soft warning for YELLOW / unknown. */
  warn: boolean;
  label: string;
  badgeClass: string;
  detail: string;
};

export function normalizeTemplateQuality(raw: unknown): TemplateQualityScore {
  if (raw == null || raw === "") return "UNKNOWN";
  if (typeof raw === "object" && raw !== null && "score" in (raw as object)) {
    return normalizeTemplateQuality((raw as { score?: unknown }).score);
  }
  const value = String(raw).trim().toUpperCase();
  if (value === "GREEN" || value === "HIGH") return "GREEN";
  if (value === "YELLOW" || value === "MEDIUM") return "YELLOW";
  if (value === "RED" || value === "LOW") return "RED";
  if (value === "UNKNOWN" || value === "PENDING") return "UNKNOWN";
  return "UNKNOWN";
}

export function evaluateTemplateQualityForBulk(raw: unknown): TemplateQualityDecision {
  const score = normalizeTemplateQuality(raw);
  switch (score) {
    case "GREEN":
      return {
        score,
        allowBulk: true,
        warn: false,
        label: "High quality",
        badgeClass: "bg-emerald-100 text-emerald-800 border-emerald-200",
        detail: "Meta rates this template high — good for bulk campaigns.",
      };
    case "YELLOW":
      return {
        score,
        allowBulk: true,
        warn: true,
        label: "Medium quality",
        badgeClass: "bg-amber-100 text-amber-900 border-amber-200",
        detail:
          "Meta reports medium quality (feedback or low reads). Prefer a GREEN template or warm up with a small list.",
      };
    case "RED":
      return {
        score,
        allowBulk: false,
        warn: true,
        label: "Low quality",
        badgeClass: "bg-red-100 text-red-800 border-red-200",
        detail:
          "Meta rates this template low — bulk send blocked to protect portfolio quality. Fix copy or use another template.",
      };
    default:
      return {
        score: "UNKNOWN",
        allowBulk: true,
        warn: true,
        label: "Quality pending",
        badgeClass: "bg-muted text-muted-foreground border-border",
        detail:
          "No Meta quality score yet (new or unused). Start small, then scale after GREEN.",
      };
  }
}
