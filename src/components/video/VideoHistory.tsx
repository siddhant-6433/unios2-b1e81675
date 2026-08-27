import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { ButtonOrb } from "@/components/ui/thinking-orb";
import { uploadVideoImages } from "@/lib/videoUpload";
import { Send, RotateCcw, CheckCircle, Undo2, Rocket, MessageSquareWarning, MessageSquare, X } from "lucide-react";

type VideoEvent = {
  id: string;
  event: string;
  note: string | null;
  screenshots: string[] | null;
  author_name: string | null;
  created_at: string;
};

const EVENT_META: Record<string, { label: string; Icon: typeof Send; color: string }> = {
  submitted:            { label: "Submitted",            Icon: Send,                  color: "text-muted-foreground" },
  correction_requested: { label: "Correction requested", Icon: MessageSquareWarning,  color: "text-destructive" },
  resubmitted:          { label: "Resubmitted",          Icon: RotateCcw,             color: "text-primary" },
  approved:             { label: "Approved",             Icon: CheckCircle,           color: "text-success" },
  published:            { label: "Published",            Icon: Rocket,                color: "text-success" },
  revoked:              { label: "Approval revoked",     Icon: Undo2,                 color: "text-warning-foreground" },
  comment:              { label: "Comment",              Icon: MessageSquare,         color: "text-primary" },
};

function fmt(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleString("en-IN", { day: "2-digit", month: "short", year: "2-digit", hour: "2-digit", minute: "2-digit" });
}

// Full submission/correction/comment timeline for one video, newest first.
// When canComment is set, a composer is shown and the widget always renders;
// otherwise it stays hidden until there's more than the initial submission.
export function VideoHistory({ videoId, canComment = false }: { videoId: string; canComment?: boolean }) {
  const { toast } = useToast();
  const [events, setEvents] = useState<VideoEvent[]>([]);
  const [note, setNote] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [posting, setPosting] = useState(false);

  const fetchEvents = () => {
    supabase
      .from("video_events" as any)
      .select("id, event, note, screenshots, author_name, created_at")
      .eq("video_id", videoId)
      .order("created_at", { ascending: false })
      .then(({ data }) => setEvents((data as any) || []));
  };

  useEffect(() => {
    let cancelled = false;
    supabase
      .from("video_events" as any)
      .select("id, event, note, screenshots, author_name, created_at")
      .eq("video_id", videoId)
      .order("created_at", { ascending: false })
      .then(({ data }) => { if (!cancelled) setEvents((data as any) || []); });
    return () => { cancelled = true; };
  }, [videoId]);

  const postComment = async () => {
    if (!note.trim()) { toast({ title: "Write a comment first", variant: "destructive" }); return; }
    setPosting(true);
    try {
      let urls: string[] = [];
      if (files.length) urls = await uploadVideoImages("video-comments", videoId, files);
      const { error } = await supabase.rpc("add_video_comment" as any, {
        p_video_id: videoId, p_note: note.trim(), p_screenshots: urls.length ? urls : null,
      });
      if (error) throw error;
      setNote("");
      setFiles([]);
      fetchEvents();
    } catch (e: any) {
      toast({ title: "Could not post comment", description: e.message, variant: "destructive" });
    } finally {
      setPosting(false);
    }
  };

  if (!canComment && events.length <= 1) return null;

  return (
    <div className="rounded-xl border border-border bg-card p-3">
      <p className="text-[10px] text-muted-foreground uppercase font-semibold mb-2">History</p>
      {events.length > 0 && (
        <ol className="space-y-2.5">
          {events.map(ev => {
            const meta = EVENT_META[ev.event] ?? { label: ev.event, Icon: Send, color: "text-muted-foreground" };
            const Icon = meta.Icon;
            return (
              <li key={ev.id} className="flex gap-2 text-xs">
                <Icon className={`h-3.5 w-3.5 shrink-0 mt-0.5 ${meta.color}`} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className={`font-medium ${meta.color}`}>
                      {meta.label}{ev.author_name ? ` · ${ev.author_name}` : ""}
                    </span>
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
      )}

      {canComment && (
        <div className="mt-3 pt-3 border-t border-border space-y-2">
          <textarea value={note} onChange={e => setNote(e.target.value)} rows={2}
            placeholder="Add a comment for revisions…"
            className="w-full rounded-lg border border-input bg-background px-2.5 py-2 text-xs resize-none focus:outline-none focus:ring-2 focus:ring-primary/20" />
          <input type="file" accept="image/*" multiple
            onChange={e => { setFiles(prev => [...prev, ...Array.from(e.target.files || [])]); e.target.value = ""; }}
            className="text-[11px] file:mr-2 file:rounded-lg file:border-0 file:bg-muted file:px-2 file:py-1 file:text-[11px]" />
          {files.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {files.map((f, i) => (
                <div key={i} className="relative">
                  <img src={URL.createObjectURL(f)} alt={f.name} className="h-12 w-12 rounded-lg object-cover border border-border" />
                  <button type="button" onClick={() => setFiles(s => s.filter((_, j) => j !== i))}
                    className="absolute -top-1.5 -right-1.5 h-4 w-4 rounded-full bg-destructive text-white flex items-center justify-center">
                    <X className="h-2.5 w-2.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
          <div className="flex justify-end">
            <Button size="sm" className="gap-1.5 text-xs" onClick={postComment} disabled={posting}>
              {posting ? <ButtonOrb state="working" onFilled /> : <MessageSquare className="h-3.5 w-3.5" />} Comment
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
