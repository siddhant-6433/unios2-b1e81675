import { PageLoader } from "@/components/ui/page-loader";
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
import {
  Loader2, Plus, Video, ExternalLink, CheckCircle, Instagram, Linkedin, Youtube,
} from "lucide-react";
import {
  VIDEO_BRANDS, VIDEO_BRAND_LABEL, CONTENT_TYPES, CONTENT_TYPE_LABEL,
  STATUS_BADGE, type VideoBrand, type VideoContentType, type VideoStatus,
} from "@/lib/videoBrands";

type VideoRow = {
  id: string;
  editor_id: string;
  brand: VideoBrand;
  title: string;
  content_type: VideoContentType;
  drive_url: string;
  status: VideoStatus;
  rejection_reason: string | null;
  instagram_url: string | null;
  instagram_posted_on: string | null;
  linkedin_url: string | null;
  linkedin_posted_on: string | null;
  youtube_url: string | null;
  youtube_posted_on: string | null;
  is_billable: boolean;
  posted_month: string | null;
  created_at: string;
};

type EditorRow = { id: string; name: string; per_video_rate: number; active: boolean };

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
function localInputToISO(local: string): string | null {
  if (!local) return null;
  const d = new Date(local);
  return isNaN(d.getTime()) ? null : d.toISOString();
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

export default function VideoEditorPortal() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [editor, setEditor] = useState<EditorRow | null>(null);
  const [videos, setVideos] = useState<VideoRow[]>([]);
  const [loading, setLoading] = useState(true);

  const [showSubmit, setShowSubmit] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({
    brand: VIDEO_BRANDS[0].value as VideoBrand,
    title: "",
    content_type: "video" as VideoContentType,
    drive_url: "",
  });

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
    const { data } = await supabase
      .from("videos" as any)
      .select("*")
      .eq("editor_id", editorId)
      .order("created_at", { ascending: false });
    setVideos((data as any) || []);
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

  const handleSubmitVideo = async () => {
    if (!editor) return;
    if (!form.title.trim() || !form.drive_url.trim()) {
      toast({ title: "Title and video link are required", variant: "destructive" }); return;
    }
    // ponytail: client-side dedup against loaded videos; DB unique constraint is the real guard
    const normalised = form.drive_url.trim().replace(/\/+$/, "").toLowerCase();
    if (videos.some(v => v.drive_url.replace(/\/+$/, "").toLowerCase() === normalised)) {
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

    const { data: inserted, error } = await supabase.from("videos" as any).insert({
      editor_id: editor.id,
      brand: form.brand,
      title: form.title.trim(),
      content_type: form.content_type,
      drive_url: form.drive_url.trim(),
    }).select("id").single();
    if (error) {
      toast({ title: "Submission failed", description: error.message, variant: "destructive" });
      setSubmitting(false); return;
    }
    // Notify super admins on WhatsApp that a video is awaiting approval.
    // Fire-and-forget — never block the editor's submit on a notification.
    if ((inserted as any)?.id) {
      supabase.functions.invoke("video-notify", {
        body: { event: "submitted", video_id: (inserted as any).id },
      }).catch(() => { /* notification failure is non-fatal */ });
    }
    toast({ title: "Video submitted for approval" });
    setForm({ brand: VIDEO_BRANDS[0].value, title: "", content_type: "video", drive_url: "" });
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
    const payload: any = {
      instagram_url: socialForm.instagram_url.trim() || null,
      instagram_posted_on: localInputToISO(socialForm.instagram_posted_on),
      linkedin_url:  socialForm.linkedin_url.trim() || null,
      linkedin_posted_on:  localInputToISO(socialForm.linkedin_posted_on),
      youtube_url:   socialForm.youtube_url.trim() || null,
      youtube_posted_on:   localInputToISO(socialForm.youtube_posted_on),
    };
    const { error } = await supabase.from("videos" as any).update(payload).eq("id", selected.id);
    if (error) {
      toast({ title: "Save failed", description: error.message, variant: "destructive" });
      setSavingSocial(false); return;
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
        <Button className="gap-1.5" onClick={() => setShowSubmit(true)}>
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
                <div key={m.month} className="rounded-xl border border-border p-3">
                  <p className="text-[10px] text-muted-foreground">{new Date(m.month + "-01").toLocaleDateString("en-IN", { month: "long", year: "numeric" })}</p>
                  <p className="text-lg font-bold">{m.count} <span className="text-xs font-normal text-muted-foreground">videos</span></p>
                  <p className="text-xs text-success font-medium">₹{m.amount.toLocaleString("en-IN")}</p>
                </div>
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
          <DialogHeader><DialogTitle className="flex items-center gap-2"><Plus className="h-5 w-5" /> Submit Video</DialogTitle></DialogHeader>
          <div className="space-y-3">
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
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowSubmit(false)}>Cancel</Button>
            <Button onClick={handleSubmitVideo} disabled={submitting} className="gap-2">
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Submit for Approval
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
              Add the platform URL and posting date for each platform. All three required for billing.
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
                <input type="datetime-local" className={inputCls}
                  value={socialForm.instagram_posted_on} onChange={e => setSocialForm(p => ({ ...p, instagram_posted_on: e.target.value }))} />
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
                <input type="datetime-local" className={inputCls}
                  value={socialForm.linkedin_posted_on} onChange={e => setSocialForm(p => ({ ...p, linkedin_posted_on: e.target.value }))} />
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
                <input type="datetime-local" className={inputCls}
                  value={socialForm.youtube_posted_on} onChange={e => setSocialForm(p => ({ ...p, youtube_posted_on: e.target.value }))} />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSelected(null)}>Cancel</Button>
            <Button onClick={handleSaveSocial} disabled={savingSocial} className="gap-2">
              {savingSocial ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle className="h-4 w-4" />} Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
