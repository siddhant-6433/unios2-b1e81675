import { cn } from "@/lib/utils";
import { OrbLoader, type OrbState } from "@/components/ui/thinking-orb";

function SkeletonBar({ className, delay = 0 }: { className?: string; delay?: number }) {
  return (
    <div
      className={cn("rounded-lg blade-skeleton", className)}
      style={delay ? { animationDelay: `${delay}ms` } : undefined}
    />
  );
}

/**
 * The app's one page-load surface: an orb for aliveness over a skeleton for
 * shape. Used by ~60 pages, by AppLayout's Suspense fallback, and by the
 * RequirePermission gate — so all three read as one continuous state instead of
 * three differently-shaped handoffs.
 *
 * The orb leads and is deliberately not delayed: `.blade-skeleton` fades in over
 * its first 960ms before it starts pulsing, so skeleton-alone leaves a dead
 * second. `min-h-[60vh]` holds the block at a stable height so content landing
 * doesn't yank the scroll position.
 *
 * ponytail: the table/cards/detail variants that used to live here had zero call
 * sites across 63 usages. Deleted. A page that wants a table-shaped skeleton can
 * write four divs inline, which is what Dashboard and Admissions already do.
 */
export function PageLoader({ className, state = "working", label = "Loading…" }: {
  className?: string;
  state?: OrbState;
  label?: string;
}) {
  return (
    <div className={cn("min-h-[60vh] space-y-6 load-delayed", className)}>
      <OrbLoader state={state} label={label} className="py-6" />
      <div className="space-y-2">
        <SkeletonBar className="h-6 w-48" />
        <SkeletonBar className="h-4 w-72" delay={60} />
      </div>
      <div className="space-y-3">
        {[0, 1, 2].map(i => (
          <SkeletonBar key={i} className="h-16 w-full rounded-xl" delay={120 + i * 80} />
        ))}
      </div>
    </div>
  );
}
