import { Flame, Sun, Snowflake } from "lucide-react";

const CONFIG = {
  hot: {
    icon: Flame,
    label: "Hot",
    className: "bg-destructive/10 text-destructive dark:bg-destructive/80/30 dark:text-destructive/80",
    iconClass: "text-destructive",
  },
  warm: {
    icon: Sun,
    label: "Warm",
    className: "bg-warning/10 text-warning-foreground dark:bg-warning/80/30 dark:text-warning",
    iconClass: "text-warning",
  },
  cold: {
    icon: Snowflake,
    label: "Cold",
    className: "bg-info/10 text-info-foreground dark:bg-info/80/30 dark:text-info/80",
    iconClass: "text-info",
  },
} as const;

interface Props {
  temperature: "hot" | "warm" | "cold";
  score?: number;
  size?: "sm" | "md";
}

export function LeadTemperatureBadge({ temperature, score, size = "sm" }: Props) {
  const cfg = CONFIG[temperature] || CONFIG.cold;
  const Icon = cfg.icon;

  if (size === "sm") {
    return (
      <span
        className={`inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${cfg.className}`}
        title={score != null ? `Lead Score: ${score}` : cfg.label}
      >
        <Icon className={`h-2.5 w-2.5 ${cfg.iconClass}`} />
        {score != null && score}
      </span>
    );
  }

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold ${cfg.className}`}
      title={score != null ? `Lead Score: ${score}` : cfg.label}
    >
      <Icon className={`h-3 w-3 ${cfg.iconClass}`} />
      {cfg.label}
      {score != null && <span className="opacity-70">({score})</span>}
    </span>
  );
}
