import { Flame, Sun, Snowflake } from "lucide-react";

const CONFIG = {
  hot: {
    icon: Flame,
    label: "Hot",
    className: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
    iconClass: "text-red-500",
  },
  warm: {
    icon: Sun,
    label: "Warm",
    className: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
    iconClass: "text-amber-500",
  },
  cold: {
    icon: Snowflake,
    label: "Cold",
    className: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
    iconClass: "text-blue-500",
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
