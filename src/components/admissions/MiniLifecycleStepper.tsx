/**
 * Compact dots renderer of the admission lifecycle, for the Applications
 * list dashboard. Same stage logic as the full AdmissionLifecycleStepper —
 * just a row of 7 connected circles that fits inside a table cell.
 *
 * Hover/tap shows the stage label + hint as a native title tooltip.
 */

import { computeStages, type LifecycleInput } from "@/lib/admissionLifecycle";

export function MiniLifecycleStepper(props: LifecycleInput) {
  const stages = computeStages(props);
  if (!stages.length) return null;

  return (
    <div className="flex items-center gap-0">
      {stages.map((s, i) => {
        const isLast = i === stages.length - 1;
        const dotCls = {
          done:    "bg-emerald-500 ring-emerald-200",
          current: "bg-blue-500 ring-blue-200 ring-2",
          future:  "bg-muted ring-border",
          blocked: "bg-rose-500 ring-rose-200 ring-2",
        }[s.state];
        const lineCls = stages[i].state === "done" && (i + 1 < stages.length && stages[i + 1].state !== "future")
          ? "bg-emerald-400"
          : "bg-border";
        return (
          <div key={s.key} className="flex items-center" title={`${s.label}${s.hint ? ` — ${s.hint}` : ""}`}>
            <span className={`block w-2.5 h-2.5 rounded-full ring-1 ${dotCls}`} />
            {!isLast && <span className={`block h-0.5 w-3 ${lineCls}`} />}
          </div>
        );
      })}
    </div>
  );
}
