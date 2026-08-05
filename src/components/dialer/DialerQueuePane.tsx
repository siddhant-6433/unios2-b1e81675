import { useMemo } from "react";
import { Phone, Search, X } from "lucide-react";
import { DialerQueueRow } from "@/components/dialer/DialerQueueRow";
import { filterQueue, type QueueLead } from "@/lib/dialerQueue";

interface Props {
  queue: QueueLead[];
  currentIdx: number;
  onSelect: (idx: number) => void;
  buckets: { key: string; label: string; color: string; count: number }[];
  bucketFilter: string | null;
  setBucketFilter: (fn: (prev: string | null) => string | null) => void;
  search: string;
  setSearch: (v: string) => void;
  /** Mid-call: rows and filters are frozen so the queue can't shift underfoot. */
  disabled: boolean;
  minutesToReclaim: (lead: QueueLead) => number | null;
}

/**
 * Left column — the navigator. Fixed-height header (chips scroll sideways
 * rather than wrapping) over a scrolling list of compact rows.
 */
export function DialerQueuePane({
  queue, currentIdx, onSelect, buckets, bucketFilter, setBucketFilter,
  search, setSearch, disabled, minutesToReclaim,
}: Props) {
  // ponytail: plain filter, no virtualisation — the queue RPCs cap the list at
  // a few hundred rows. Revisit if a call list ever ships uncapped.
  const visible = useMemo(() => filterQueue(queue, search), [queue, search]);

  return (
    <div className="flex w-[264px] shrink-0 flex-col border-r border-border bg-muted/20">
      <div className="shrink-0 border-b border-border px-3 py-2.5">
        <div className="flex items-baseline justify-between">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Call Queue</p>
          <p className="text-[10px] tabular-nums text-muted-foreground">
            {search ? `${visible.length} of ${queue.length}` : `${Math.min(currentIdx + 1, queue.length)} of ${queue.length}`}
          </p>
        </div>

        {/* Bucket chips double as the work-mode filter. Clicking one narrows
            the queue in place — this is what replaces /pending-followups,
            /fresh-leads, /missed-calls and the visit tabs for counsellors. */}
        {buckets.length > 1 && (
          <div className="mt-2 flex gap-1 overflow-x-auto pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {bucketFilter && (
              <button onClick={() => setBucketFilter(() => null)} disabled={disabled}
                className="inline-flex shrink-0 items-center gap-0.5 rounded-full border border-input px-1.5 py-0.5 text-[9px] font-medium hover:bg-muted disabled:opacity-50">
                <X className="h-2.5 w-2.5" />All
              </button>
            )}
            {buckets.map(b => (
              <button key={b.key} onClick={() => setBucketFilter(prev => prev === b.key ? null : b.key)}
                disabled={disabled}
                className={`inline-flex shrink-0 items-center gap-1 rounded-full px-1.5 py-0.5 text-[9px] font-medium whitespace-nowrap transition-colors disabled:opacity-50 ${
                  bucketFilter === b.key
                    ? "bg-primary/15 text-primary ring-1 ring-primary/30"
                    : "text-muted-foreground hover:bg-muted"
                }`}>
                <span className={`h-1.5 w-1.5 rounded-full ${b.color}`} />{b.label}: {b.count}
              </button>
            ))}
          </div>
        )}

        <div className="relative mt-2">
          <Search className="absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground" />
          <input type="text" value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search name, phone, course…"
            className="w-full rounded-md border border-input bg-background py-1.5 pl-7 pr-6 text-xs outline-none placeholder:text-muted-foreground/60 focus:ring-1 focus:ring-primary" />
          {search && (
            <button onClick={() => setSearch("")} className="absolute right-1.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
              <X className="h-3 w-3" />
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {visible.map((lead) => {
          const idx = queue.indexOf(lead);
          return (
            <DialerQueueRow
              key={lead.id}
              lead={lead}
              state={idx === currentIdx ? "current" : idx < currentIdx ? "done" : "pending"}
              reclaimMins={minutesToReclaim(lead)}
              onClick={() => !disabled && onSelect(idx)}
              disabled={disabled}
            />
          );
        })}
        {visible.length === 0 && (
          <div className="px-4 py-12 text-center text-muted-foreground">
            <Phone className="mx-auto mb-2 h-8 w-8 opacity-30" />
            <p className="text-sm">{queue.length === 0 ? "No leads in queue" : "No matches"}</p>
            <p className="mt-1 text-[10px]">{queue.length === 0 ? "Try a different queue source" : "Clear the search to see all leads"}</p>
          </div>
        )}
      </div>
    </div>
  );
}
