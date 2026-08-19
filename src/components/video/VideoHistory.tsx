import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Send, RotateCcw, CheckCircle, Undo2, Rocket, MessageSquareWarning } from "lucide-react";

type VideoEvent = {
  id: string;
  event: string;
  note: string | null;
  screenshots: string[] | null;
  created_at: string;
};

const EVENT_META: Record<string, { label: string; Icon: typeof Send; color: string }> = {
  submitted:            { label: "Submitted",            Icon: Send,                  color: "text-muted-foreground" },
  correction_requested: { label: "Correction requested", Icon: MessageSquareWarning,  color: "text-destructive" },
  resubmitted:          { label: "Resubmitted",          Icon: RotateCcw,             color: "text-primary" },
  approved:             { label: "Approved",             Icon: CheckCircle,           color: "text-success" },
  published:            { label: "Published",            Icon: Rocket,                color: "text-success" },
  revoked:              { label: "Approval revoked",     Icon: Undo2,                 color: "text-warning-foreground" },
};

function fmt(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleString("en-IN", { day: "2-digit", month: "short", year: "2-digit", hour: "2-digit", minute: "2-digit" });
}

// Full submission/correction timeline for one video, newest first. Renders
// nothing until there's more than the single initial submission to show.
export function VideoHistory({ videoId }: { videoId: string }) {
  const [events, setEvents] = useState<VideoEvent[]>([]);

  useEffect(() => {
    let cancelled = false;
    supabase
      .from("video_events" as any)
      .select("id, event, note, screenshots, created_at")
      .eq("video_id", videoId)
      .order("created_at", { ascending: false })
      .then(({ data }) => { if (!cancelled) setEvents((data as any) || []); });
    return () => { cancelled = true; };
  }, [videoId]);

  if (events.length <= 1) return null;

  return (
    <div className="rounded-xl border border-border bg-card p-3">
      <p className="text-[10px] text-muted-foreground uppercase font-semibold mb-2">History</p>
      <ol className="space-y-2.5">
        {events.map(ev => {
          const meta = EVENT_META[ev.event] ?? { label: ev.event, Icon: Send, color: "text-muted-foreground" };
          const Icon = meta.Icon;
          return (
            <li key={ev.id} className="flex gap-2 text-xs">
              <Icon className={`h-3.5 w-3.5 shrink-0 mt-0.5 ${meta.color}`} />
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-2">
                  <span className={`font-medium ${meta.color}`}>{meta.label}</span>
                  <span className="text-[10px] text-muted-foreground shrink-0">{fmt(ev.created_at)}</span>
                </div>
                {ev.note && <p className="text-muted-foreground mt-0.5 whitespace-pre-wrap break-words">{ev.note}</p>}
                {ev.screenshots?.length ? (
                  <div className="flex flex-wrap gap-1.5 mt-1.5">
                    {ev.screenshots.map((u, i) => (
                      <a key={i} href={u} target="_blank" rel="noreferrer">
                        <img src={u} alt={`Screenshot ${i + 1}`} className="h-12 w-12 rounded-lg object-cover border border-border" />
                      </a>
                    ))}
                  </div>
                ) : null}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
