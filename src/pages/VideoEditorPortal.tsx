import { PageLoader } from "@/components/ui/page-loader";
import { ButtonOrb } from "@/components/ui/thinking-orb";
import { useState, useEffect, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Plus, Video, ExternalLink, CheckCircle, Instagram, Linkedin, Youtube, RotateCcw, X } from "lucide-react";
import {
  VIDEO_BRANDS, VIDEO_BRAND_LABEL, CONTENT_TYPES, CONTENT_TYPE_LABEL,
  STATUS_BADGE, type VideoBrand, type VideoContentType, type VideoStatus,
} from "@/lib/videoBrands";
import { VideoHistory } from "@/components/video/VideoHistory";
import { uploadVideoImages, checkAspectRatio } from "@/lib/videoUpload";

type VideoRow = {
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
  is_billable: boolean;
  posted_month: string | null;
  video_bill_id: string | null;
  created_at: string;
};

type EditorRow = { id: string; name: string; per_video_rate: number; active: boolean };

type BillRow = {
  id: string; brand: VideoBrand; bill_month: string;
  video_count: number; per_video_rate: number; total_amount: number;
  status: "draft" | "approved" | "paid"; paid_at: string | null;
};

// Per-video bill/payment status shown to the editor.
const VIDEO_BILL_STATUS: Record<string, { label: string; color: string }> = {
  none:     { label: "Not billed", color: "bg-muted text-muted-foreground" },
  draft:    { label: "Pending",    color: "bg-warning/10 text-warning-foreground" },
  approved: { label: "Approved",   color: "bg-info/10 text-info-foreground" },
  paid:     { label: "Paid",       color: "bg-success/10 text-success" },
};

const inputCls = "w-full rounded-xl border border-input bg-background px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20";

// Label a source link by host so the UI doesn't say "Drive" for a YouTube URL.
function sourceLabel(url: string): string {
  return /youtube\.com|youtu\.be/i.test(url) ? "YouTube" : "Drive";
}

// posted-at timestamps are timestamptz; <input type="datetime-local"> wants a
// zoneless "YYYY-MM-DDTHH:mm" in local time, so convert both ways explicitly.
function isoToLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function fmtPostedAt(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleString("en-IN", { day: "2-digit", month: "short", year: "2-digit", hour: "2-digit", minute: "2-digit" });
}

// Render the three platform markers inline — each is a clickable link to the
// live post when its URL is filled, otherwise a dimmed icon.
function SocialLinkIcons({ v }: { v: VideoRow }) {
  const items = [
    { url: v.instagram_url, posted: v.instagram_posted_on, Icon: Instagram, color: "text-pink-600", label: "Instagram" },
    { url: v.linkedin_url,  posted: v.linkedin_posted_on,  Icon: Linkedin,  color: "text-info-foreground", label: "LinkedIn" },
    { url: v.youtube_url,   posted: v.youtube_posted_on,   Icon: Youtube,   color: "text-destructive",  label: "YouTube" },
  ];
  return (
    <div className="flex items-center justify-center gap-1.5">
      {items.map(({ url, posted, Icon, color, label }) => url ? (
        <a key={label} href={url} target="_blank" rel="noreferrer"
           title={posted ? `${label} · posted ${fmtPostedAt(posted)}` : `Open ${label} post`}
           onClick={e => e.stopPropagation()} className="hover:opacity-70">
          <Icon className={`h-3.5 w-3.5 ${color}`} />
        </a>
      ) : (
        <Icon key={label} className="h-3.5 w-3.5 text-muted-foreground/30" />
      ))}
    </div>
  );
}

// One mandatory thumbnail slot. Shows the newly-picked file, else the existing
// URL (on resubmit), and a file picker. `box` sizes the preview to the ratio.
function ThumbnailPicker({ label, hint, box, existingUrl, file, onPick, required = false }: {
  label: string; hint: string; box: string;
  existingUrl: string; file: File | null; onPick: (f: File | null) => void;
  required?: boolean;
}) {
  const preview = file ? URL.createObjectURL(file) : existingUrl || "";
  return (
    <div>
      <label className="text-xs font-medium mb-1 block">{label}{required ? " *" : ""}</label>
      <div className="flex items-start gap-3">
        {preview ? (
          <div className="relative shrink-0">
            <img src={preview} alt={label} className={`${box} rounded-lg object-cover border border-border`} />
            {file && (
              <button type="button" onClick={() => onPick(null)}
                className="absolute -top-1.5 -right-1.5 h-4 w-4 rounded-full bg-destructive text-white flex items-center justify-center">
                <X className="h-2.5 w-2.5" />
              </button>
            )}
          </div>
        ) : null}
        <div className="min-w-0">
          <input type="file" accept="image/*"
            onChange={e => { onPick(e.target.files?.[0] || null); e.target.value = ""; }}
            className="text-xs file:mr-2 file:rounded-lg file:border-0 file:bg-muted file:px-2 file:py-1 file:text-xs" />
          <p className="text-[10px] text-muted-foreground mt-1">{hint}</p>
        </div>
      </div>
    </div>
  );
}

export default function VideoEditorPortal() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [editor, setEditor] = useState<EditorRow | null>(null);
  const [videos, setVideos] = useState<VideoRow[]>([]);
  const [bills, setBills] = useState<BillRow[]>([]);
  const [billingMonth, setBillingMonth] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [showSubmit, setShowSubmit] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({
    id: "",
    brand: VIDEO_BRANDS[0].value as VideoBrand,
    title: "",
    content_type: "video" as VideoContentType,
    drive_url: "",
    thumbnail_youtube_url: "",   // existing 16:9 URL (resubmit)
    thumbnail_instagram_url: "", // existing 9:16 URL (resubmit)
  });
  // Newly picked thumbnail files, uploaded on submit. Null = keep existing URL.
  const [thumbFiles, setThumbFiles] = useState<{ youtube: File | null; instagram: File | null }>({ youtube: null, instagram: null });

  const [selected, setSelected] = useState<VideoRow | null>(null);
  const [socialForm, setSocialForm] = useState({
    instagram_url: "", instagram_posted_on: "",
    linkedin_url: "",  linkedin_posted_on: "",
    youtube_url: "",   youtube_posted_on: "",
  });
  const [savingSocial, setSavingSocial] = useState(false);

  const [brandFilter, setBrandFilter] = useState<VideoBrand | "all">("all");
  const [statusFilter, setStatusFilter] = useState<VideoStatus | "all">("all");

  // Look up the editor record for this user. RLS narrows the query
  // to a single row.
  const fetchEditor = async () => {
    if (!user?.id) return;
    const { data } = await supabase
      .from("video_editors" as any)
      .select("id, name, per_video_rate, active")
      .eq("user_id", user.id)
      .maybeSingle();
    setEditor((data as any) || null);
  };

  const fetchVideos = async (editorId: string) => {
    const [vRes, bRes] = await Promise.all([
      supabase.from("videos" as any).select("*").eq("editor_id", editorId).order("created_at", { ascending: false }),
      supabase.from("video_bills" as any).select("id, brand, bill_month, video_count, per_video_rate, total_amount, status, paid_at").eq("editor_id", editorId),
    ]);
    setVideos((vRes.data as any) || []);
    setBills((bRes.data as any) || []);
    setLoading(false);
  };

  useEffect(() => {
    if (!user?.id) return;
    (async () => {
      await fetchEditor();
    })();
  }, [user?.id]);

  useEffect(() => {
    if (editor?.id) fetchVideos(editor.id);
    else setLoading(false);
  }, [editor?.id]);

  const filtered = useMemo(() => videos.filter(v =>
    (brandFilter === "all" || v.brand === brandFilter) &&
    (statusFilter === "all" || v.status === statusFilter)
  ), [videos, brandFilter, statusFilter]);

  // Monthly billable summary: per-month video count + amount across all brands.
  const monthlySummary = useMemo(() => {
    if (!editor) return [];
    const map = new Map<string, { month: string; count: number; amount: number }>();
    for (const v of videos) {
      if (!v.is_billable || !v.posted_month) continue;
      const m = v.posted_month.slice(0, 7);
      const row = map.get(m) ?? { month: m, count: 0, amount: 0 };
      row.count += 1;
      row.amount += Number(editor.per_video_rate);
      map.set(m, row);
    }
    return Array.from(map.values()).sort((a, b) => b.month.localeCompare(a.month)).slice(0, 6);
  }, [videos, editor]);

  const billById = useMemo(() => new Map(bills.map(b => [b.id, b])), [bills]);

  // Per-video bill/payment status for the breakdown modal.
  const videoStatus = (v: VideoRow) => {
    const bill = v.video_bill_id ? billById.get(v.video_bill_id) : undefined;
    const key = bill?.status ?? "none";
    return { ...(VIDEO_BILL_STATUS[key] ?? VIDEO_BILL_STATUS.none), paidAt: bill?.status === "paid" ? bill.paid_at : null };
  };

  // The selected month's billable videos, grouped by brand.
  const breakdown = useMemo(() => {
    if (!billingMonth || !editor) return null;
    const monthVideos = videos.filter(v => v.is_billable && v.posted_month?.slice(0, 7) === billingMonth);
    const byBrand = new Map<VideoBrand, VideoRow[]>();
    for (const v of monthVideos) {
      if (!byBrand.has(v.brand)) byBrand.set(v.brand, []);
      byBrand.get(v.brand)!.push(v);
    }
    const rate = Number(editor.per_video_rate);
    const groups = [...byBrand.entries()]
      .map(([brand, vids]) => ({ brand, vids, amount: vids.length * rate }))
      .sort((a, b) => VIDEO_BRAND_LABEL[a.brand].localeCompare(VIDEO_BRAND_LABEL[b.brand]));
    return { groups, total: monthVideos.length, amount: monthVideos.length * rate };
  }, [billingMonth, videos, editor]);

  // Look up which prior video a duplicate URL collides with. The dedup is
  // global, so the match usually belongs to another editor and RLS hides it —
  // this SECURITY DEFINER RPC names it. Returns a "" suffix on any miss so the
  // caller can always append it to the toast description safely.
  const describeCollision = async (url: string): Promise<string> => {
    try {
      const { data } = await supabase.rpc("find_video_by_url" as any, { p_url: url });
      const hit = (data as any)?.[0];
      if (!hit) return "";
      const when = hit.created_at ? new Date(hit.created_at).toLocaleDateString() : "";
      const who = hit.editor_name ? ` by ${hit.editor_name}` : "";
      return ` Already used on "${hit.title}"${who}${when ? ` (submitted ${when})` : ""}.`;
    } catch { return ""; }
  };

  const handleSubmitVideo = async () => {
    if (!editor) return;
    if (!form.title.trim() || !form.drive_url.trim()) {
      toast({ title: "Title and video link are required", variant: "destructive" }); return;
    }
    // At least one thumbnail is mandatory: a newly-picked file, or an existing URL
    // (resubmit). Reels are 9:16-only, so we don't force a 16:9 YouTube thumbnail too.
    const hasYoutube   = !!thumbFiles.youtube   || !!form.thumbnail_youtube_url;
    const hasInstagram = !!thumbFiles.instagram || !!form.thumbnail_instagram_url;
    if (!hasYoutube && !hasInstagram) {
      toast({ title: "Add a thumbnail", description: "Attach at least one thumbnail — 16:9 for YouTube or 9:16 for Instagram.", variant: "destructive" }); return;
    }
    // Validate the shape of any newly-picked thumbnail before we persist anything.
    if (thumbFiles.youtube && !(await checkAspectRatio(thumbFiles.youtube, 16, 9))) {
      toast({ title: "Wrong YouTube thumbnail ratio", description: "The YouTube thumbnail must be 16:9 (landscape).", variant: "destructive" }); return;
    }
    if (thumbFiles.instagram && !(await checkAspectRatio(thumbFiles.instagram, 9, 16))) {
      toast({ title: "Wrong Instagram thumbnail ratio", description: "The Instagram thumbnail must be 9:16 (portrait).", variant: "destructive" }); return;
    }
    // ponytail: client-side dedup against loaded videos; DB unique constraint is the real guard
    const normalised = form.drive_url.trim().replace(/\/+$/, "").toLowerCase();
    if (videos.some(v => v.id !== form.id && v.drive_url.replace(/\/+$/, "").toLowerCase() === normalised)) {
      toast({ title: "Duplicate link", description: "A video with this URL has already been submitted.", variant: "destructive" }); return;
    }
    setSubmitting(true);

    // Validate the link (Drive or YouTube) is publicly viewable before
    // persisting — otherwise the approver hits a sign-in/private wall and
    // bounces the submission back.
    try {
      const { data: validation, error: vErr } = await supabase.functions.invoke(
        "video-validate-drive-link",
        { body: { url: form.drive_url.trim() } },
      );
      if (vErr) throw vErr;
      if (!(validation as any)?.valid) {
        toast({
          title: "Link not accessible",
          description: (validation as any)?.reason || "Share the Drive file as 'Anyone with link → Viewer', or set the YouTube video to Unlisted/Public.",
          variant: "destructive",
        });
        setSubmitting(false);
        return;
      }
    } catch (e: any) {
      toast({ title: "Could not validate link", description: e.message, variant: "destructive" });
      setSubmitting(false); return;
    }

    // Resubmit updates the existing row back to pending and clears the prior
    // correction notes/screenshots; a fresh submission inserts a new row.
    let videoId = form.id;
    let error;
    if (form.id) {
      ({ error } = await supabase.from("videos" as any).update({
        brand: form.brand,
        title: form.title.trim(),
        content_type: form.content_type,
        drive_url: form.drive_url.trim(),
        status: "pending_approval",
        rejection_reason: null,
        rejection_screenshots: null,
        editor_notified_at: null,
      }).eq("id", form.id));
    } else {
      const { data: inserted, error: insErr } = await supabase.from("videos" as any).insert({
        editor_id: editor.id,
        brand: form.brand,
        title: form.title.trim(),
        content_type: form.content_type,
        drive_url: form.drive_url.trim(),
      }).select("id").single();
      error = insErr;
      videoId = (inserted as any)?.id || "";
    }
    if (error) {
      // 23505 = the global normalized-drive_url unique index: this video link was
      // already submitted (by anyone, in any status — pending, approved, published).
      const isDup = (error as any).code === "23505";
      const collision = isDup ? await describeCollision(form.drive_url.trim()) : "";
      toast({
        title: isDup ? "Duplicate video" : "Submission failed",
        description: isDup
          ? `This video link has already been submitted for approval or approved.${collision} Each video can only be submitted once.`
          : error.message,
        variant: "destructive",
      });
      setSubmitting(false); return;
    }
    // Upload any newly-picked thumbnails now that the row exists, then persist
    // their URLs. Blocking (not fire-and-forget) — thumbnails are mandatory.
    if (videoId && (thumbFiles.youtube || thumbFiles.instagram)) {
      try {
        const patch: any = {};
        if (thumbFiles.youtube) patch.thumbnail_youtube_url = (await uploadVideoImages("video-thumbnails", videoId, [thumbFiles.youtube]))[0];
        if (thumbFiles.instagram) patch.thumbnail_instagram_url = (await uploadVideoImages("video-thumbnails", videoId, [thumbFiles.instagram]))[0];
        const { error: tErr } = await supabase.from("videos" as any).update(patch).eq("id", videoId);
        if (tErr) throw tErr;
      } catch (e: any) {
        toast({ title: "Thumbnail upload failed", description: e.message, variant: "destructive" });
        setSubmitting(false); return;
      }
    }
    // Notify super admins on WhatsApp that a video is awaiting approval.
    // Fire-and-forget — never block the editor's submit on a notification.
    if (videoId) {
      supabase.functions.invoke("video-notify", {
        body: { event: "submitted", video_id: videoId },
      }).catch(() => { /* notification failure is non-fatal */ });
    }
    toast({ title: form.id ? "Video resubmitted for approval" : "Video submitted for approval" });
    setForm({ id: "", brand: VIDEO_BRANDS[0].value, title: "", content_type: "video", drive_url: "", thumbnail_youtube_url: "", thumbnail_instagram_url: "" });
    setThumbFiles({ youtube: null, instagram: null });
    setShowSubmit(false);
    setSubmitting(false);
    if (editor) fetchVideos(editor.id);
  };

  const openSocialDialog = (v: VideoRow) => {
    setSelected(v);
    setSocialForm({
      instagram_url: v.instagram_url || "", instagram_posted_on: isoToLocalInput(v.instagram_posted_on),
      linkedin_url:  v.linkedin_url  || "", linkedin_posted_on:  isoToLocalInput(v.linkedin_posted_on),
      youtube_url:   v.youtube_url   || "", youtube_posted_on:   isoToLocalInput(v.youtube_posted_on),
    });
  };

  const handleSaveSocial = async () => {
    if (!selected) return;
    setSavingSocial(true);
    // Only URLs are entered. IG/YouTube dates are cleared here and repopulated
    // from the platform by video-fetch-post-dates below (fraud-proof). LinkedIn
    // has no date. This also clears stale dates when a URL is changed.
    const payload: any = {
      instagram_url: socialForm.instagram_url.trim() || null,
      instagram_posted_on: null,
      linkedin_url:  socialForm.linkedin_url.trim() || null,
      linkedin_posted_on:  null,
      youtube_url:   socialForm.youtube_url.trim() || null,
      youtube_posted_on:   null,
    };
    const { error } = await supabase.from("videos" as any).update(payload).eq("id", selected.id);
    if (error) {
      // 23505 = a global normalized social-URL unique index: this Instagram/
      // LinkedIn/YouTube post is already attached to another video (any editor,
      // any status). The error message carries the offending index name.
      const isDup = (error as any).code === "23505";
      const msg = String((error as any).message || "");
      const platform = msg.includes("instagram") ? "Instagram"
        : msg.includes("linkedin") ? "LinkedIn"
        : msg.includes("youtube") ? "YouTube" : "social media";
      const dupUrl = platform === "Instagram" ? socialForm.instagram_url
        : platform === "LinkedIn" ? socialForm.linkedin_url
        : platform === "YouTube" ? socialForm.youtube_url : "";
      const collision = isDup && dupUrl ? await describeCollision(dupUrl.trim()) : "";
      toast({
        title: isDup ? "Duplicate social link" : "Save failed",
        description: isDup
          ? `This ${platform} URL is already attached to another video.${collision} Each post can only back one video.`
          : error.message,
        variant: "destructive",
      });
      setSavingSocial(false); return;
    }
    // System-authoritative posting dates: overwrite Instagram/YouTube/LinkedIn
    // posted_on with the real platform timestamps, then require each one to be
    // at or after approved_at. Instagram draft / preview permalinks are not in
    // the brand's published media list and get dropped.
    try {
      const { data: fetchResult, error: fetchErr } = await supabase.functions.invoke(
        "video-fetch-post-dates",
        { body: { video_id: selected.id, force: true } },
      );
      if (fetchErr) throw fetchErr;
      if (!fetchResult) throw new Error("empty response");
      const rejected = (fetchResult as any)?.rejected as { message: string }[] | undefined;
      if (rejected?.length) {
        toast({
          title: "Some links were rejected",
          description: rejected.map(r => r.message).join(" "),
          variant: "destructive",
        });
        setSavingSocial(false);
        setSelected(null);
        if (editor) fetchVideos(editor.id);
        return;
      }
    } catch {
      toast({
        title: "Could not verify posting dates",
        description: "Links were saved, but we could not read the live post times. Try saving again — unpublished drafts will not count.",
        variant: "destructive",
      });
      setSavingSocial(false);
      if (editor) fetchVideos(editor.id);
      return;
    }
    toast({ title: "Social links saved" });
    setSavingSocial(false);
    setSelected(null);
    if (editor) fetchVideos(editor.id);
  };

  if (loading) {
    return <PageLoader />;
  }

  if (!editor) {
    return (
      <div className="space-y-4 animate-fade-in">
        <h1 className="text-2xl font-bold">Video Portal</h1>
        <Card className="border-warning/20 bg-warning/5 dark:bg-warning/90/20">
          <CardContent className="p-6">
            <p className="text-sm">
              Your account is not yet linked to a Video Editor profile. Please contact the super admin
              to set up your rate and brand access.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Video Portal</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Welcome, {editor.name} · Rate ₹{Number(editor.per_video_rate).toLocaleString("en-IN")} per video
          </p>
        </div>
        <Button className="gap-1.5" onClick={() => {
          setForm({ id: "", brand: VIDEO_BRANDS[0].value, title: "", content_type: "video", drive_url: "", thumbnail_youtube_url: "", thumbnail_instagram_url: "" });
          setThumbFiles({ youtube: null, instagram: null });
          setShowSubmit(true);
        }}>
          <Plus className="h-4 w-4" /> Submit New Video
        </Button>
      </div>

      {/* Billable summary */}
      {monthlySummary.length > 0 && (
        <Card className="border-border/60 shadow-none">
          <CardContent className="p-4">
            <p className="text-[10px] font-semibold text-muted-foreground uppercase mb-3">Monthly Billable Summary</p>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
              {monthlySummary.map(m => (
                <button key={m.month} onClick={() => setBillingMonth(m.month)}
                  className="rounded-xl border border-border p-3 text-left hover:border-primary/50 hover:bg-muted/30 transition-colors">
                  <p className="text-[10px] text-muted-foreground">{new Date(m.month + "-01").toLocaleDateString("en-IN", { month: "long", year: "numeric" })}</p>
                  <p className="text-lg font-bold">{m.count} <span className="text-xs font-normal text-muted-foreground">videos</span></p>
                  <p className="text-xs text-success font-medium">₹{m.amount.toLocaleString("en-IN")}</p>
                  <p className="text-[9px] text-primary mt-1">View breakdown →</p>
                </button>
              ))}
            </div>
            <p className="text-[10px] text-muted-foreground mt-3">
              Only videos posted on Instagram, LinkedIn AND YouTube count toward billing.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Filters */}
      <div className="flex flex-wrap gap-2">
        <div className="flex rounded-xl border border-input bg-card p-0.5 w-fit">
          {(["all", ...VIDEO_BRANDS.map(b => b.value)] as const).map(k => (
            <button key={k} onClick={() => setBrandFilter(k as any)}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${brandFilter === k ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}>
              {k === "all" ? "All Brands" : VIDEO_BRAND_LABEL[k as VideoBrand]}
            </button>
          ))}
        </div>
        <div className="flex rounded-xl border border-input bg-card p-0.5 w-fit">
          {(["all", "pending_approval", "approved", "published", "rejected"] as const).map(k => (
            <button key={k} onClick={() => setStatusFilter(k as any)}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${statusFilter === k ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}>
              {k === "all" ? "All Status" : STATUS_BADGE[k as VideoStatus].label}
            </button>
          ))}
        </div>
      </div>

      {/* Videos table */}
      <Card className="border-border/60 shadow-none overflow-hidden">
        <CardContent className="p-0">
          {filtered.length === 0 ? (
            <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">No videos found</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/50">
                    <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase">Title</th>
                    <th className="px-3 py-3 text-left text-xs font-semibold text-muted-foreground uppercase">Brand</th>
                    <th className="px-3 py-3 text-center text-xs font-semibold text-muted-foreground uppercase">Type</th>
                    <th className="px-3 py-3 text-center text-xs font-semibold text-muted-foreground uppercase">Status</th>
                    <th className="px-3 py-3 text-center text-xs font-semibold text-muted-foreground uppercase">Platforms</th>
                    <th className="px-3 py-3 text-center text-xs font-semibold text-muted-foreground uppercase">Billable</th>
                    <th className="px-3 py-3 text-center text-xs font-semibold text-muted-foreground uppercase">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(v => {
                    const cfg = STATUS_BADGE[v.status];
                    return (
                      <tr key={v.id} className="border-b border-border/40 hover:bg-muted/20">
                        <td className="px-4 py-3">
                          <div className="font-medium text-foreground">{v.title}</div>
                          <a href={v.drive_url} target="_blank" rel="noreferrer"
                             className="text-[10px] text-muted-foreground hover:text-primary flex items-center gap-1">
                            <ExternalLink className="h-3 w-3" /> {sourceLabel(v.drive_url)}
                          </a>
                        </td>
                        <td className="px-3 py-3 text-xs text-muted-foreground">{VIDEO_BRAND_LABEL[v.brand]}</td>
                        <td className="px-3 py-3 text-center">
                          <Badge className="border-0 text-[10px] bg-muted text-foreground">{CONTENT_TYPE_LABEL[v.content_type]}</Badge>
                        </td>
                        <td className="px-3 py-3 text-center">
                          <Badge className={`border-0 text-[10px] font-semibold ${cfg.color}`}>{cfg.label}</Badge>
                          {v.status === "rejected" && v.rejection_reason && (
                            <div className="mt-1 text-[10px] text-destructive max-w-[180px] mx-auto">{v.rejection_reason}</div>
                          )}
                          {v.status === "rejected" && v.rejection_screenshots?.length ? (
                            <div className="mt-1.5 flex flex-wrap justify-center gap-1 max-w-[180px] mx-auto">
                              {v.rejection_screenshots.map((u, i) => (
                                <a key={i} href={u} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()}>
                                  <img src={u} alt={`Fix ${i + 1}`} className="h-10 w-10 rounded object-cover border border-border" />
                                </a>
                              ))}
                            </div>
                          ) : null}
                        </td>
                        <td className="px-3 py-3 text-center">
                          <SocialLinkIcons v={v} />
                        </td>
                        <td className="px-3 py-3 text-center">
                          {v.is_billable
                            ? <CheckCircle className="h-4 w-4 text-success mx-auto" />
                            : <span className="text-[10px] text-muted-foreground">—</span>}
                        </td>
                        <td className="px-3 py-3 text-center">
                          {v.status === "approved" || v.status === "published" ? (
                            <Button variant="ghost" size="sm" className="gap-1 text-xs" onClick={() => openSocialDialog(v)}>
                              <Video className="h-3 w-3" /> Add Links
                            </Button>
                          ) : v.status === "rejected" ? (
                            <Button variant="ghost" size="sm" className="gap-1 text-xs" onClick={() => {
                              setForm({ id: v.id, brand: v.brand, title: v.title, content_type: v.content_type, drive_url: v.drive_url, thumbnail_youtube_url: v.thumbnail_youtube_url || "", thumbnail_instagram_url: v.thumbnail_instagram_url || "" });
                              setThumbFiles({ youtube: null, instagram: null });
                              setShowSubmit(true);
                            }}>
                              <RotateCcw className="h-3 w-3" /> Resubmit
                            </Button>
                          ) : <span className="text-[10px] text-muted-foreground">—</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Submit dialog */}
      <Dialog open={showSubmit} onOpenChange={setShowSubmit}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle className="flex items-center gap-2">
            {form.id ? <RotateCcw className="h-5 w-5" /> : <Plus className="h-5 w-5" />} {form.id ? "Resubmit Video" : "Submit Video"}
          </DialogTitle></DialogHeader>
          <div className="space-y-3">
            {/* When resubmitting, show the reviewer's correction notes + screenshots
                so the editor knows exactly what to fix. */}
            {form.id && (() => {
              const v = videos.find(x => x.id === form.id);
              if (!v || (!v.rejection_reason && !v.rejection_screenshots?.length)) return null;
              return (
                <div className="rounded-xl border border-destructive/20 bg-destructive/5 p-3 text-xs">
                  <p className="font-semibold text-destructive mb-1">Correction requested</p>
                  {v.rejection_reason && <p>{v.rejection_reason}</p>}
                  {v.rejection_screenshots?.length ? (
                    <div className="flex flex-wrap gap-2 mt-2">
                      {v.rejection_screenshots.map((u, i) => (
                        <a key={i} href={u} target="_blank" rel="noreferrer">
                          <img src={u} alt={`Fix ${i + 1}`} className="h-16 w-16 rounded-lg object-cover border border-border" />
                        </a>
                      ))}
                    </div>
                  ) : null}
                </div>
              );
            })()}
            {form.id && <VideoHistory videoId={form.id} canComment />}
            <div>
              <label className="text-xs font-medium mb-1 block">Brand *</label>
              <select value={form.brand} onChange={e => setForm(p => ({ ...p, brand: e.target.value as VideoBrand }))} className={inputCls}>
                {VIDEO_BRANDS.map(b => <option key={b.value} value={b.value}>{b.label}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs font-medium mb-1 block">Title *</label>
              <input value={form.title} onChange={e => setForm(p => ({ ...p, title: e.target.value }))} className={inputCls}
                placeholder="e.g., Learning Nutrition Through Practice!" />
            </div>
            <div>
              <label className="text-xs font-medium mb-1 block">Content Type</label>
              <select value={form.content_type} onChange={e => setForm(p => ({ ...p, content_type: e.target.value as VideoContentType }))} className={inputCls}>
                {CONTENT_TYPES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs font-medium mb-1 block">Google Drive or YouTube Link *</label>
              <input value={form.drive_url} onChange={e => setForm(p => ({ ...p, drive_url: e.target.value }))} className={inputCls}
                placeholder="https://drive.google.com/file/d/…  or  https://youtu.be/…" />
              <p className="text-[10px] text-muted-foreground mt-1">
                Drive: share as <span className="font-semibold">Anyone with the link → Viewer</span>. YouTube: set it to <span className="font-semibold">Unlisted</span> (or Public) so the approver can open it.
              </p>
            </div>
            <p className="text-xs font-medium">
              Thumbnails <span className="text-muted-foreground font-normal">— add at least one (both if the video goes to YouTube and Instagram).</span>
            </p>
            <ThumbnailPicker
              label="YouTube thumbnail (16:9)"
              hint="Landscape image, 16:9 ratio (e.g. 1280×720)."
              box="h-16 w-28"
              existingUrl={form.thumbnail_youtube_url}
              file={thumbFiles.youtube}
              onPick={f => setThumbFiles(p => ({ ...p, youtube: f }))}
            />
            <ThumbnailPicker
              label="Instagram thumbnail (9:16)"
              hint="Portrait image, 9:16 ratio (e.g. 1080×1920)."
              box="h-28 w-[3.95rem]"
              existingUrl={form.thumbnail_instagram_url}
              file={thumbFiles.instagram}
              onPick={f => setThumbFiles(p => ({ ...p, instagram: f }))}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowSubmit(false)}>Cancel</Button>
            <Button onClick={handleSubmitVideo} disabled={submitting} className="gap-2">
              {submitting ? <ButtonOrb state="working" onFilled /> : (form.id ? <RotateCcw className="h-4 w-4" /> : <Plus className="h-4 w-4" />)} {form.id ? "Resubmit for Approval" : "Submit for Approval"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Social links dialog */}
      <Dialog open={!!selected} onOpenChange={(o) => { if (!o) setSelected(null); }}>
        <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{selected?.title}</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <p className="text-xs text-muted-foreground">
              Paste the live public URL for each platform — all three required for billing. Draft / preview Instagram links are not accepted. Each post must go live after this video was approved; we read the real posting time from the platform, not the calendar day.
            </p>
            <div className="space-y-3">
              <div className="space-y-1.5">
                <label className="text-xs font-medium flex items-center gap-1.5"><Instagram className="h-3.5 w-3.5 text-pink-600" /> Instagram
                  {socialForm.instagram_url.trim() && (
                    <a href={socialForm.instagram_url.trim()} target="_blank" rel="noreferrer"
                       className="ml-auto inline-flex items-center gap-1 text-[10px] text-primary hover:underline">
                      <ExternalLink className="h-3 w-3" /> Open
                    </a>
                  )}
                </label>
                <input className={inputCls} placeholder="Instagram URL"
                  value={socialForm.instagram_url} onChange={e => setSocialForm(p => ({ ...p, instagram_url: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium flex items-center gap-1.5"><Linkedin className="h-3.5 w-3.5 text-info-foreground" /> LinkedIn
                  {socialForm.linkedin_url.trim() && (
                    <a href={socialForm.linkedin_url.trim()} target="_blank" rel="noreferrer"
                       className="ml-auto inline-flex items-center gap-1 text-[10px] text-primary hover:underline">
                      <ExternalLink className="h-3 w-3" /> Open
                    </a>
                  )}
                </label>
                <input className={inputCls} placeholder="LinkedIn URL"
                  value={socialForm.linkedin_url} onChange={e => setSocialForm(p => ({ ...p, linkedin_url: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium flex items-center gap-1.5"><Youtube className="h-3.5 w-3.5 text-destructive" /> YouTube
                  {socialForm.youtube_url.trim() && (
                    <a href={socialForm.youtube_url.trim()} target="_blank" rel="noreferrer"
                       className="ml-auto inline-flex items-center gap-1 text-[10px] text-primary hover:underline">
                      <ExternalLink className="h-3 w-3" /> Open
                    </a>
                  )}
                </label>
                <input className={inputCls} placeholder="YouTube URL"
                  value={socialForm.youtube_url} onChange={e => setSocialForm(p => ({ ...p, youtube_url: e.target.value }))} />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSelected(null)}>Cancel</Button>
            <Button onClick={handleSaveSocial} disabled={savingSocial} className="gap-2">
              {savingSocial ? <ButtonOrb state="working" onFilled /> : <CheckCircle className="h-4 w-4" />} Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Monthly billing breakdown */}
      <Dialog open={!!billingMonth} onOpenChange={(o) => { if (!o) setBillingMonth(null); }}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {billingMonth && new Date(billingMonth + "-01").toLocaleDateString("en-IN", { month: "long", year: "numeric" })} · billing breakdown
            </DialogTitle>
          </DialogHeader>
          {breakdown && (
            <div className="space-y-4">
              <div className="flex items-center gap-4 text-sm">
                <span className="font-semibold">{breakdown.total} videos</span>
                <span className="text-success font-semibold">₹{breakdown.amount.toLocaleString("en-IN")}</span>
                <span className="text-[11px] text-muted-foreground ml-auto">Counts videos posted on Instagram, LinkedIn AND YouTube.</span>
              </div>
              {breakdown.groups.map(g => (
                <div key={g.brand} className="rounded-xl border border-border/60 overflow-hidden">
                  <div className="flex items-center justify-between bg-muted/40 px-3 py-2 text-xs font-semibold">
                    <span>{VIDEO_BRAND_LABEL[g.brand]}</span>
                    <span className="text-muted-foreground">{g.vids.length} videos · ₹{g.amount.toLocaleString("en-IN")}</span>
                  </div>
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-left text-muted-foreground border-b border-border/40">
                        <th className="px-3 py-1.5 font-medium">Title</th>
                        <th className="px-2 py-1.5 font-medium">Instagram</th>
                        <th className="px-2 py-1.5 font-medium">LinkedIn</th>
                        <th className="px-2 py-1.5 font-medium">YouTube</th>
                        <th className="px-2 py-1.5 font-medium text-center">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {g.vids.map(v => {
                        const st = videoStatus(v);
                        const cell = (url: string | null, posted: string | null) => url
                          ? <a href={url} target="_blank" rel="noreferrer" className="text-primary hover:underline">{posted ? fmtPostedAt(posted) : "Posted"}</a>
                          : <span className="text-muted-foreground">—</span>;
                        return (
                          <tr key={v.id} className="border-b border-border/30 last:border-0">
                            <td className="px-3 py-1.5 font-medium text-foreground">{v.title}</td>
                            <td className="px-2 py-1.5">{cell(v.instagram_url, v.instagram_posted_on)}</td>
                            <td className="px-2 py-1.5">{cell(v.linkedin_url, v.linkedin_posted_on)}</td>
                            <td className="px-2 py-1.5">{cell(v.youtube_url, v.youtube_posted_on)}</td>
                            <td className="px-2 py-1.5 text-center">
                              <Badge className={`border-0 text-[9px] font-semibold ${st.color}`}>{st.label}</Badge>
                              {st.paidAt && <div className="text-[9px] text-muted-foreground">{fmtPostedAt(st.paidAt)}</div>}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ))}
              {breakdown.total === 0 && (
                <p className="text-sm text-muted-foreground text-center py-6">No billable videos this month.</p>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
