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
import { Info } from "lucide-react";
import { computeStages, type LifecycleInput } from "@/lib/admissionLifecycle";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

const amountInfoCopy: Record<string, string> = {
  token: "Amount the candidate must pay to generate the Pre-Admission Number (PAN). Derived from the active fee structure (token threshold − already paid).",
  admitted: "Amount the candidate must pay to generate the Admission Number (AN). Derived from the active fee structure (admission threshold − total paid so far).",
};

interface Props extends LifecycleInput {
  showLabels?: boolean;
}

// Solid fill = done; hollow ring with pulsing animation = current next-action;
// dim outline = future. Makes "this stage hasn't happened yet" obvious at a
// glance, so users don't read a past-tense label and assume completion.
const dotPalette: Record<string, string> = {
  done:    "bg-success/50 ring-emerald-200",
  current: "bg-white border-2 border-info/35 ring-2 ring-blue-200 animate-pulse",
  future:  "bg-muted ring-border",
  blocked: "bg-destructive/50 ring-rose-200 ring-2",
};

const labelPalette: Record<string, string> = {
  done:    "text-success dark:text-success",
  current: "text-info-foreground dark:text-info/60 font-semibold",
  future:  "text-muted-foreground/60",
  blocked: "text-destructive dark:text-destructive/50 font-semibold",
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
            ? "bg-success/50"
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
  // When a stage carries an `amountDue` (Token/PAN and Admission stages),
  // render the rupee amount below the label so admins see exactly what
  // the candidate needs to pay next without opening the detail panel.
  return (
    <div className="flex items-start">
      {stages.map((s, i) => {
        const isLast = i === stages.length - 1;
        const lineCls = stages[i].state === "done" && (i + 1 < stages.length && stages[i + 1].state !== "future")
          ? "bg-success/50"
          : "bg-border";
        const showAmount = s.amountDue != null && s.amountDue > 0 && s.state !== "done";
        const amountTone = s.state === "current"
          ? "text-info-foreground dark:text-info/60 font-semibold"
          : "text-muted-foreground/70";
        const tooltip = `${s.label}${s.hint ? ` — ${s.hint}` : ""}${showAmount ? ` · ₹${s.amountDue!.toLocaleString("en-IN")} due` : ""}`;
        return (
          <Fragment key={s.key}>
            <div className="flex flex-col items-center" title={tooltip}>
              <span className={`block w-3 h-3 rounded-full ring-1 ${dotPalette[s.state]}`} />
              <span className={`text-[9px] mt-1 leading-tight text-center max-w-[60px] ${labelPalette[s.state]}`}>
                {s.label}
              </span>
              {showAmount && (
                <span className={`inline-flex items-center gap-0.5 text-[9px] mt-0.5 leading-tight text-center tabular-nums ${amountTone}`}>
                  ₹{s.amountDue!.toLocaleString("en-IN")}
                  {amountInfoCopy[s.key] && (
                    <Tooltip delayDuration={150}>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          aria-label={amountInfoCopy[s.key]}
                          className="inline-flex items-center cursor-help opacity-60 hover:opacity-100 focus:opacity-100 focus:outline-none"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <Info className="h-3 w-3 shrink-0" />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent side="top" className="max-w-[240px] text-xs leading-snug">
                        {amountInfoCopy[s.key]}
                      </TooltipContent>
                    </Tooltip>
                  )}
                </span>
              )}
            </div>
            {!isLast && <span className={`block h-0.5 w-4 mt-[5px] mx-0.5 ${lineCls}`} />}
          </Fragment>
        );
      })}
    </div>
  );
}
