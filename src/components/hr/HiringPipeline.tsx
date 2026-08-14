// The hiring funnel: Sourced → Screening → Interview → Preboarding, with Hired and
// Archived set apart as outcomes.
//
// Click-to-filter, not drag-and-drop. Keka's own default is the list view with this
// strip above it, the repo has no dnd dependency, and LeadPipeline/VisitPipeline
// already establish the click-to-filter shape — adding a drag library to reproduce a
// view Keka doesn't lead with would be a lot of weight for nothing.
//
// Stages come from src/lib/hiringStages; do not redefine them here.

import { FUNNEL_STAGES, OUTCOME_STAGES, STAGE_LABEL, type HiringStage } from "@/lib/hiringStages";
import { CheckCircle2, Archive } from "lucide-react";

interface Props {
  counts: Record<HiringStage, number>;
  active: HiringStage | null;
  onSelect: (stage: HiringStage | null) => void;
}

export function HiringPipeline({ counts, active, onSelect }: Props) {
  const toggle = (stage: HiringStage) => onSelect(active === stage ? null : stage);

  return (
    <div className="flex flex-wrap items-stretch gap-2">
      <div className="flex min-w-0 flex-1 overflow-hidden rounded-xl border border-border">
        {FUNNEL_STAGES.map((stage, i) => {
          const on = active === stage;
          return (
            <button
              key={stage}
              onClick={() => toggle(stage)}
              className={`relative flex-1 border-r border-border px-4 py-3 text-left transition-colors last:border-r-0 ${
                on ? "bg-primary/10" : "hover:bg-muted/40"
              }`}
              // The chevron notch is what makes it read as a funnel rather than tabs.
              style={i > 0 ? { clipPath: "polygon(0 0, 100% 0, 100% 100%, 0 100%, 12px 50%)" } : undefined}
            >
              <p className={`text-xs ${on ? "font-semibold text-primary" : "text-muted-foreground"}`}>
                {STAGE_LABEL[stage]}
              </p>
              <p className={`text-xl font-bold ${on ? "text-primary" : "text-foreground"}`}>
                {counts[stage] ?? 0}
              </p>
            </button>
          );
        })}
      </div>

      <div className="flex overflow-hidden rounded-xl border border-border">
        {OUTCOME_STAGES.map((stage) => {
          const on = active === stage;
          const Icon = stage === "hired" ? CheckCircle2 : Archive;
          return (
            <button
              key={stage}
              onClick={() => toggle(stage)}
              className={`w-28 border-r border-border px-4 py-3 text-left transition-colors last:border-r-0 ${
                on ? "bg-primary/10" : "hover:bg-muted/40"
              }`}
            >
              <p className={`flex items-center gap-1 text-xs ${on ? "font-semibold text-primary" : "text-muted-foreground"}`}>
                <Icon className={`h-3 w-3 ${stage === "hired" ? "text-success" : ""}`} />
                {STAGE_LABEL[stage]}
              </p>
              <p className={`text-xl font-bold ${on ? "text-primary" : "text-foreground"}`}>
                {counts[stage] ?? 0}
              </p>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default HiringPipeline;
