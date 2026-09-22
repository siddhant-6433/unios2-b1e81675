import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ButtonOrb } from "@/components/ui/thinking-orb";
import {
  ExternalLink, CheckCircle, Instagram, Linkedin, Youtube,
  Trash2, Undo2, RotateCcw, X, BellRing,
} from "lucide-react";
import {
  VIDEO_BRAND_LABEL, CONTENT_TYPE_LABEL, STATUS_BADGE,
  type VideoBrand, type VideoContentType, type VideoStatus,
} from "@/lib/videoBrands";
import { VideoHistory } from "@/components/video/VideoHistory";
import { VideoEmbed } from "@/components/video/VideoEmbed";
import { videoSourceLabel } from "@/lib/videoEmbed";
import { uploadVideoImages } from "@/lib/videoUpload";

export type VideoRow = {
  id: string;
  editor_id: string;
  brand: VideoBrand;
  title: string;
  content_type: VideoContentType;
  drive_url: string;
  status: VideoStatus;
  rejection_reason: string | null;
  rejection_screenshots: string[] | null;
  editor_notified_at: string | null;
  instagram_url: string | null;
  instagram_posted_on: string | null;
  linkedin_url: string | null;
  linkedin_posted_on: string | null;
  youtube_url: string | null;
  youtube_posted_on: string | null;
  thumbnail_youtube_url: string | null;
  thumbnail_instagram_url: string | null;
  approved_at: string | null;
  created_at: string;
};

const inputCls = "w-full rounded-xl border border-input bg-background px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20";

function fmtPostedAt(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleString("en-IN", { day: "2-digit", month: "short", year: "2-digit", hour: "2-digit", minute: "2-digit" });
}

// Published social links rendered inline as clickable URLs, each with its
// posting date+time. Returns null when nothing's been posted.
function PostedLinks({ v }: { v: VideoRow }) {
  const items = [
    { url: v.instagram_url, posted: v.instagram_posted_on, Icon: Instagram, color: "text-pink-600", label: "Instagram" },
    { url: v.linkedin_url,  posted: v.linkedin_posted_on,  Icon: Linkedin,  color: "text-info-foreground", label: "LinkedIn" },
    { url: v.youtube_url,   posted: v.youtube_posted_on,   Icon: Youtube,   color: "text-destructive",  label: "YouTube" },
  ].filter(i => i.url);
  if (items.length === 0) return null;
  return (
    <div className="rounded-xl border border-border bg-card p-3 space-y-2">
      <p className="text-[10px] text-muted-foreground uppercase font-semibold">Published Links</p>
      {items.map(({ url, posted, Icon, color, label }) => (
        <div key={label} className="flex items-center gap-2 min-w-0">
          <Icon className={`h-3.5 w-3.5 shrink-0 ${color}`} />
          <a href={url!} target="_blank" rel="noreferrer"
             className="text-xs text-primary hover:underline truncate flex-1">{url}</a>
          {posted && <span className="text-[10px] text-muted-foreground shrink-0">{fmtPostedAt(posted)}</span>}
        </div>
      ))}
    </div>
  );
}

/**
 * The full video review experience — inline embed, metadata, published links,
 * correction history, the correction-notes + screenshots form, approve, and the
 * admin revoke/delete overrides. Shared by the Video Approvals page and the
 * Inbox so behaviour can't drift between the two surfaces.
 */
export function VideoReviewPanel({
  video,
  editorName,
  onDone,
}: {
  video: VideoRow;
  editorName?: string | null;
  onDone: () => void;
}) {
  const { user, role } = useAuth();
  const { toast } = useToast();
  const isSuperAdmin = role === "super_admin";

  const [rejectReason, setRejectReason] = useState("");
  const [screenshots, setScreenshots] = useState<File[]>([]);
  const [acting, setActing] = useState(false);

  const notifyEditor = (event: "approved" | "correction") =>
    supabase.functions
      .invoke("video-notify", { body: { event, video_id: video.id } })
      .catch(() => { /* notification failure is non-fatal */ });

  const approve = async () => {
    setActing(true);
    const { error } = await supabase.from("videos" as any).update({
      status: "approved",
      approved_by: user?.id,
      approved_at: new Date().toISOString(),
      rejection_reason: null,
      rejection_screenshots: null,
    }).eq("id", video.id);
    if (error) {
      toast({ title: "Approve failed", description: error.message, variant: "destructive" });
      setActing(false); return;
    }
    notifyEditor("approved");
    toast({ title: "Video approved" });
    setActing(false);
    onDone();
  };

  // Send a video back to the editor for correction — uses the "rejected"
  // status (relabelled "Needs Correction") plus notes and optional screenshots
  // pointing at exactly what to fix. The editor can then resubmit.
  const sendForCorrection = async () => {
    if (!rejectReason.trim()) {
      toast({ title: "Please add correction notes", variant: "destructive" }); return;
    }
    setActing(true);
    let urls: string[] = [];
    try {
      urls = await uploadVideoImages("video-rejections", video.id, screenshots);
    } catch (e: any) {
      toast({ title: "Screenshot upload failed", description: e.message, variant: "destructive" });
      setActing(false); return;
    }
    const { error } = await supabase.from("videos" as any).update({
      status: "rejected",
      approved_by: user?.id,
      approved_at: new Date().toISOString(),
      rejection_reason: rejectReason.trim(),
      rejection_screenshots: urls.length ? urls : null,
    }).eq("id", video.id);
    if (error) {
      toast({ title: "Failed to send for correction", description: error.message, variant: "destructive" });
      setActing(false); return;
    }
    notifyEditor("correction");
    toast({ title: "Sent back for correction" });
    setActing(false);
    setRejectReason("");
    setScreenshots([]);
    onDone();
  };

  // Revoke a prior approval — back to the pending queue. The before-change
  // trigger recomputes is_billable (→ false) automatically.
  const revoke = async () => {
    if (!window.confirm(`Revoke approval for "${video.title}"? It returns to the pending queue.`)) return;
    setActing(true);
    const { error } = await supabase.from("videos" as any).update({
      status: "pending_approval",
      approved_by: null,
      approved_at: null,
      rejection_reason: null,
      rejection_screenshots: null,
    }).eq("id", video.id);
    if (error) {
      toast({ title: "Revoke failed", description: error.message, variant: "destructive" });
      setActing(false); return;
    }
    toast({ title: "Approval revoked — back in queue" });
    setActing(false);
    onDone();
  };

  const remove = async () => {
    if (!window.confirm(`Delete "${video.title}" permanently? This cannot be undone.`)) return;
    setActing(true);
    const { error } = await supabase.from("videos" as any).delete().eq("id", video.id);
    if (error) {
      toast({ title: "Delete failed", description: error.message, variant: "destructive" });
      setActing(false); return;
    }
    toast({ title: "Video deleted" });
    setActing(false);
    onDone();
  };

  return (
    <div className="space-y-3">
      <VideoEmbed url={video.drive_url} title={video.title} />

      <div>
        <p className="text-[10px] text-muted-foreground uppercase font-semibold">Title</p>
        <p className="text-sm font-medium">{video.title}</p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <p className="text-[10px] text-muted-foreground uppercase font-semibold">Editor</p>
          <p className="text-sm">{editorName || "—"}</p>
        </div>
        <div>
          <p className="text-[10px] text-muted-foreground uppercase font-semibold">Brand</p>
          <p className="text-sm">{VIDEO_BRAND_LABEL[video.brand as VideoBrand]}</p>
        </div>
        <div>
          <p className="text-[10px] text-muted-foreground uppercase font-semibold">Type</p>
          <p className="text-sm">{CONTENT_TYPE_LABEL[video.content_type as VideoContentType]}</p>
        </div>
        <div>
          <p className="text-[10px] text-muted-foreground uppercase font-semibold">Status</p>
          <Badge className={`border-0 text-[10px] font-semibold ${STATUS_BADGE[video.status as VideoStatus]?.color || "bg-muted"}`}>
            {STATUS_BADGE[video.status as VideoStatus]?.label || video.status}
          </Badge>
          {video.editor_notified_at && (video.status === "rejected" || video.status === "approved") && (
            <p className="mt-1 flex items-center gap-1 text-[10px] text-success">
              <BellRing className="h-3 w-3" /> Editor notified {fmtPostedAt(video.editor_notified_at)}
            </p>
          )}
        </div>
      </div>

      <a href={video.drive_url} target="_blank" rel="noreferrer"
         className="inline-flex items-center gap-1.5 rounded-xl border border-primary/40 bg-primary/5 px-3 py-2 text-sm font-medium text-primary hover:bg-primary/10">
        <ExternalLink className="h-4 w-4" /> Open {videoSourceLabel(video.drive_url)} Link
      </a>

      {(video.thumbnail_youtube_url || video.thumbnail_instagram_url) && (
        <div>
          <p className="text-[10px] text-muted-foreground uppercase font-semibold mb-1.5">Thumbnails</p>
          <div className="flex gap-3">
            {[
              { url: video.thumbnail_youtube_url, label: "YouTube 16:9", box: "h-20 w-36" },
              { url: video.thumbnail_instagram_url, label: "Instagram 9:16", box: "h-32 w-[4.5rem]" },
            ].map(t => t.url ? (
              <a key={t.label} href={t.url} target="_blank" rel="noreferrer" className="text-center">
                <img src={t.url} alt={t.label} className={`${t.box} rounded-lg object-cover border border-border`} />
                <span className="mt-1 block text-[9px] text-muted-foreground">{t.label}</span>
              </a>
            ) : null)}
          </div>
        </div>
      )}

      <PostedLinks v={video} />

      <VideoHistory videoId={video.id} canComment />

      {video.status === "rejected" && (video.rejection_reason || video.rejection_screenshots?.length) && (
        <div className="rounded-xl border border-destructive/20 bg-destructive/5 p-3 text-xs">
          <p className="font-semibold text-destructive mb-1">Correction requested</p>
          {video.rejection_reason && <p>{video.rejection_reason}</p>}
          {video.rejection_screenshots?.length ? (
            <div className="flex flex-wrap gap-2 mt-2">
              {video.rejection_screenshots.map((u, i) => (
                <a key={i} href={u} target="_blank" rel="noreferrer">
                  <img src={u} alt={`Screenshot ${i + 1}`} className="h-16 w-16 rounded-lg object-cover border border-border" />
                </a>
              ))}
            </div>
          ) : null}
        </div>
      )}

      {video.status === "pending_approval" && isSuperAdmin && (
        <>
          <div>
            <label className="text-xs font-medium mb-1 block">Correction notes (required if sending back)</label>
            <textarea value={rejectReason} onChange={e => setRejectReason(e.target.value)} rows={2}
              className={inputCls + " resize-none"} placeholder="e.g. Drive link not accessible, off-brand, fix the intro, etc." />
          </div>
          <div>
            <label className="text-xs font-medium mb-1 block">Screenshots (optional — show what to fix)</label>
            <input type="file" accept="image/*" multiple
              onChange={e => { setScreenshots(prev => [...prev, ...Array.from(e.target.files || [])]); e.target.value = ""; }}
              className="text-xs file:mr-2 file:rounded-lg file:border-0 file:bg-muted file:px-2 file:py-1 file:text-xs" />
            {screenshots.length > 0 && (
              <div className="flex flex-wrap gap-2 mt-2">
                {screenshots.map((f, i) => (
                  <div key={i} className="relative">
                    <img src={URL.createObjectURL(f)} alt={f.name} className="h-14 w-14 rounded-lg object-cover border border-border" />
                    <button type="button" onClick={() => setScreenshots(s => s.filter((_, j) => j !== i))}
                      className="absolute -top-1.5 -right-1.5 h-4 w-4 rounded-full bg-destructive text-white flex items-center justify-center">
                      <X className="h-2.5 w-2.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="flex gap-2 pt-2 border-t border-border">
            <Button variant="outline" className="flex-1 gap-1.5 text-destructive hover:bg-destructive/5"
                    onClick={sendForCorrection} disabled={acting}>
              {acting ? <ButtonOrb state="working" /> : <RotateCcw className="h-4 w-4" />} Send for correction
            </Button>
            <Button className="flex-1 gap-1.5 bg-success hover:bg-success/90"
                    onClick={approve} disabled={acting}>
              {acting ? <ButtonOrb state="working" onFilled /> : <CheckCircle className="h-4 w-4" />} Approve
            </Button>
          </div>
        </>
      )}

      {/* Admin overrides — revoke a prior approval, or delete the video. */}
      {isSuperAdmin && (
        <div className="flex gap-2 pt-2 border-t border-border">
          {(video.status === "approved" || video.status === "published") && (
            <Button variant="outline" className="flex-1 gap-1.5 text-warning-foreground hover:bg-warning/5"
                    onClick={revoke} disabled={acting}>
              {acting ? <ButtonOrb state="working" /> : <Undo2 className="h-4 w-4" />} Revoke approval
            </Button>
          )}
          <Button variant="outline" className="flex-1 gap-1.5 text-destructive hover:bg-destructive/5"
                  onClick={remove} disabled={acting}>
            {acting ? <ButtonOrb state="working" /> : <Trash2 className="h-4 w-4" />} Delete video
          </Button>
        </div>
      )}
    </div>
  );
}
