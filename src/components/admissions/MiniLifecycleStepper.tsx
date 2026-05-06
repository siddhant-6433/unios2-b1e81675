/**
 * Compact dots renderer of the admission lifecycle, for the Applications
 * list dashboard. Same stage logic as the full AdmissionLifecycleStepper.
 *
 * Two variants:
 *   - default (`showLabels=false`): a row of 7 connected circles, fits in a
 *     narrow table cell, full info on hover via `title`.
 *   - labeled (`showLabels=true`): wider, with a 2-line label under each
 *     dot. Used on the Applications list so the lifecycle is readable at
 *     a glance without hovering.
 */

import { Fragment } from "react";
import { computeStages, type LifecycleInput } from "@/lib/admissionLifecycle";

interface Props extends LifecycleInput {
  showLabels?: boolean;
}

const dotPalette: Record<string, string> = {
  done:    "bg-emerald-500 ring-emerald-200",
  current: "bg-blue-500 ring-blue-200 ring-2",
  future:  "bg-muted ring-border",
  blocked: "bg-rose-500 ring-rose-200 ring-2",
};

const labelPalette: Record<string, string> = {
  done:    "text-emerald-700 dark:text-emerald-400",
  current: "text-blue-700 dark:text-blue-300 font-semibold",
  future:  "text-muted-foreground/60",
  blocked: "text-rose-700 dark:text-rose-300 font-semibold",
};

export function MiniLifecycleStepper(props: Props) {
  const stages = computeStages(props);
  if (!stages.length) return null;
  const showLabels = props.showLabels ?? false;

  if (!showLabels) {
    return (
      <div className="flex items-center gap-0">
        {stages.map((s, i) => {
          const isLast = i === stages.length - 1;
          const lineCls = stages[i].state === "done" && (i + 1 < stages.length && stages[i + 1].state !== "future")
            ? "bg-emerald-400"
            : "bg-border";
          return (
            <div key={s.key} className="flex items-center" title={`${s.label}${s.hint ? ` — ${s.hint}` : ""}`}>
              <span className={`block w-2.5 h-2.5 rounded-full ring-1 ${dotPalette[s.state]}`} />
              {!isLast && <span className={`block h-0.5 w-3 ${lineCls}`} />}
            </div>
          );
        })}
      </div>
    );
  }

  // Labeled rendering — dots on top, stage labels below.
  // The connector is centered vertically with the dot using mt-[5px] so it
  // visually crosses to the neighbour without offsetting the labels.
  return (
    <div className="flex items-start">
      {stages.map((s, i) => {
        const isLast = i === stages.length - 1;
        const lineCls = stages[i].state === "done" && (i + 1 < stages.length && stages[i + 1].state !== "future")
          ? "bg-emerald-400"
          : "bg-border";
        return (
          <Fragment key={s.key}>
            <div className="flex flex-col items-center" title={`${s.label}${s.hint ? ` — ${s.hint}` : ""}`}>
              <span className={`block w-3 h-3 rounded-full ring-1 ${dotPalette[s.state]}`} />
              <span className={`text-[9px] mt-1 leading-tight text-center max-w-[60px] ${labelPalette[s.state]}`}>
                {s.label}
              </span>
            </div>
            {!isLast && <span className={`block h-0.5 w-4 mt-[5px] mx-0.5 ${lineCls}`} />}
          </Fragment>
        );
      })}
    </div>
  );
}
