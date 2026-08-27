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
import { Video, ExternalLink, CheckCircle, Users, Plus, Pencil, Instagram, Linkedin, Youtube, Trash2, Undo2, RotateCcw, X, BellRing } from "lucide-react";
import {
  VIDEO_BRANDS, VIDEO_BRAND_LABEL, CONTENT_TYPE_LABEL, STATUS_BADGE,
  type VideoBrand, type VideoContentType, type VideoStatus,
} from "@/lib/videoBrands";
import { BankDetailsFields } from "@/components/bank/BankDetailsFields";
import { VideoHistory } from "@/components/video/VideoHistory";
import { ZohoVendorLinkField } from "@/components/video/ZohoVendorLinkField";
import { isValidIfsc } from "@/lib/bankDetails";
import { uploadVideoImages } from "@/lib/videoUpload";

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
  approved_at: string | null;
  created_at: string;
};

type EditorRow = {
  id: string; user_id: string | null; name: string; email: string | null;
  phone: string | null; per_video_rate: number; active: boolean;
  bank_account_name?: string | null; bank_account_number?: string | null;
  bank_ifsc?: string | null; bank_name?: string | null; bank_upi?: string | null;
  bank_verified_name?: string | null; bank_verified_at?: string | null;
  bank_verification_ref?: string | null; bank_verification_status?: string | null;
  zoho_vendor_id?: string | null;
};

const inputCls = "w-full rounded-xl border border-input bg-background px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20";

// Label a source link by host so the UI doesn't say "Drive" for a YouTube URL.
function sourceLabel(url: string): string {
  return /youtube\.com|youtu\.be/i.test(url) ? "YouTube" : "Drive";
}

function fmtPostedAt(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleString("en-IN", { day: "2-digit", month: "short", year: "2-digit", hour: "2-digit", minute: "2-digit" });
}

// Published social links rendered inline as clickable URLs (not plain text),
// each with its posting date+time. Returns null when nothing's been posted.
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

export default function VideoApprovals() {
  const { user, role } = useAuth();
  const { toast } = useToast();
  const isSuperAdmin = role === "super_admin";

  const [videos, setVideos] = useState<VideoRow[]>([]);
  const [editors, setEditors] = useState<EditorRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"queue" | "all" | "editors">("queue");
  const [statusFilter, setStatusFilter] = useState<VideoStatus | "all">("all");

  const [selected, setSelected] = useState<VideoRow | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [screenshots, setScreenshots] = useState<File[]>([]);
  const [acting, setActing] = useState(false);

  // Editor management
  const [editorForm, setEditorForm] = useState<EditorRow | null>(null);
  const [availableUsers, setAvailableUsers] = useState<{ user_id: string; display_name: string | null; email: string | null }[]>([]);
  const [savingEditor, setSavingEditor] = useState(false);

  const fetchAll = async () => {
    const [vRes, eRes] = await Promise.all([
      supabase.from("videos" as any).select("*").order("created_at", { ascending: false }),
      supabase.from("video_editors" as any).select("*").order("created_at", { ascending: false }),
    ]);
    setVideos((vRes.data as any) || []);
    setEditors((eRes.data as any) || []);
    setLoading(false);
  };

  useEffect(() => { fetchAll(); }, []);

  const editorById = useMemo(() => Object.fromEntries(editors.map(e => [e.id, e])), [editors]);
  const queue = useMemo(() => videos.filter(v => v.status === "pending_approval"), [videos]);
  const statusCounts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const v of videos) c[v.status] = (c[v.status] || 0) + 1;
    return c;
  }, [videos]);

  const handleApprove = async () => {
    if (!selected) return;
    setActing(true);
    const { error } = await supabase.from("videos" as any).update({
      status: "approved",
      approved_by: user?.id,
      approved_at: new Date().toISOString(),
      rejection_reason: null,
      rejection_screenshots: null,
    }).eq("id", selected.id);
    if (error) {
      toast({ title: "Approve failed", description: error.message, variant: "destructive" });
      setActing(false); return;
    }
    // Notify the editor on WhatsApp to post & submit the published links.
    // Fire-and-forget — never block the approval on a notification.
    supabase.functions.invoke("video-notify", {
      body: { event: "approved", video_id: selected.id },
    }).catch(() => { /* notification failure is non-fatal */ });
    toast({ title: "Video approved" });
    setActing(false);
    setSelected(null);
    fetchAll();
  };

  // Revoke a prior approval — sends the video back to the pending queue and
  // clears the approval stamp. The before-change trigger recomputes
  // is_billable (→ false) automatically. Super-admin only (RLS-enforced).
  const handleRevoke = async () => {
    if (!selected) return;
    if (!window.confirm(`Revoke approval for "${selected.title}"? It returns to the pending queue.`)) return;
    setActing(true);
    const { error } = await supabase.from("videos" as any).update({
      status: "pending_approval",
      approved_by: null,
      approved_at: null,
      rejection_reason: null,
      rejection_screenshots: null,
    }).eq("id", selected.id);
    if (error) {
      toast({ title: "Revoke failed", description: error.message, variant: "destructive" });
      setActing(false); return;
    }
    toast({ title: "Approval revoked — back in queue" });
    setActing(false);
    setSelected(null);
    fetchAll();
  };

  const handleDelete = async () => {
    if (!selected) return;
    if (!window.confirm(`Delete "${selected.title}" permanently? This cannot be undone.`)) return;
    setActing(true);
    const { error } = await supabase.from("videos" as any).delete().eq("id", selected.id);
    if (error) {
      toast({ title: "Delete failed", description: error.message, variant: "destructive" });
      setActing(false); return;
    }
    toast({ title: "Video deleted" });
    setActing(false);
    setSelected(null);
    fetchAll();
  };

  // Send a video back to the editor for correction — reuses the "rejected"
  // status (relabelled "Needs Correction") plus notes and optional screenshots
  // pointing at exactly what to fix. The editor can then resubmit.
  const handleSendForCorrection = async () => {
    if (!selected) return;
    if (!rejectReason.trim()) {
      toast({ title: "Please add correction notes", variant: "destructive" }); return;
    }
    setActing(true);
    let urls: string[] = [];
    try {
      urls = await uploadVideoImages("video-rejections", selected.id, screenshots);
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
    }).eq("id", selected.id);
    if (error) {
      toast({ title: "Failed to send for correction", description: error.message, variant: "destructive" });
      setActing(false); return;
    }
    // Notify the editor on WhatsApp with the correction notes. Fire-and-forget.
    supabase.functions.invoke("video-notify", {
      body: { event: "correction", video_id: selected.id },
    }).catch(() => { /* notification failure is non-fatal */ });
    toast({ title: "Sent back for correction" });
    setActing(false);
    setRejectReason("");
    setScreenshots([]);
    setSelected(null);
    fetchAll();
  };

  const openEditorDialog = async (editor: EditorRow | null) => {
    setEditorForm(editor ?? {
      id: "", user_id: null, name: "", email: "", phone: "", per_video_rate: 0, active: true,
    });
    // Pull users with role=video_editor who aren't yet linked to an editor row.
    // (For editing an existing editor we still want the current user in the list.)
    const { data: roleRows } = await supabase
      .from("user_roles")
      .select("user_id")
      .eq("role", "video_editor" as any);
    const userIds = (roleRows || []).map(r => r.user_id);
    if (userIds.length === 0) { setAvailableUsers([]); return; }
    const { data: profiles } = await supabase
      .from("profiles")
      .select("user_id, display_name")
      .in("user_id", userIds);
    const usedIds = new Set(editors.filter(e => e.user_id && (!editor || e.id !== editor.id)).map(e => e.user_id));
    setAvailableUsers(((profiles as any) || []).filter((p: any) => !usedIds.has(p.user_id)).map((p: any) => ({
      user_id: p.user_id, display_name: p.display_name, email: null,
    })));
  };

  const handleSaveEditor = async () => {
    if (!editorForm) return;
    if (!editorForm.name.trim()) {
      toast({ title: "Name is required", variant: "destructive" }); return;
    }
    if (editorForm.bank_account_number?.trim() && !isValidIfsc(editorForm.bank_ifsc)) {
      toast({ title: "Check the IFSC", description: "An account number needs a valid IFSC (e.g. HDFC0001234).", variant: "destructive" }); return;
    }
    setSavingEditor(true);
    const payload: any = {
      user_id: editorForm.user_id || null,
      name: editorForm.name.trim(),
      email: editorForm.email?.trim() || null,
      phone: editorForm.phone?.trim() || null,
      per_video_rate: Number(editorForm.per_video_rate) || 0,
      active: editorForm.active,
      bank_account_name: editorForm.bank_account_name?.trim() || null,
      bank_account_number: editorForm.bank_account_number?.trim() || null,
      bank_ifsc: editorForm.bank_ifsc?.trim().toUpperCase() || null,
      bank_name: editorForm.bank_name?.trim() || null,
      bank_upi: editorForm.bank_upi?.trim() || null,
      bank_verified_name: editorForm.bank_verified_name ?? null,
      bank_verified_at: editorForm.bank_verified_at ?? null,
      bank_verification_ref: editorForm.bank_verification_ref ?? null,
      bank_verification_status: editorForm.bank_verification_status ?? "unverified",
      zoho_vendor_id: editorForm.zoho_vendor_id ?? null,
    };
    let error;
    if (editorForm.id) {
      ({ error } = await supabase.from("video_editors" as any).update(payload).eq("id", editorForm.id));
    } else {
      ({ error } = await supabase.from("video_editors" as any).insert(payload));
    }
    if (error) {
      toast({ title: "Save failed", description: error.message, variant: "destructive" });
      setSavingEditor(false); return;
    }
    toast({ title: editorForm.id ? "Editor updated" : "Editor added" });
    setSavingEditor(false);
    setEditorForm(null);
    fetchAll();
  };

  if (loading) {
    return <PageLoader />;
  }

  const tableRows = tab === "queue"
    ? queue
    : statusFilter === "all" ? videos : videos.filter(v => v.status === statusFilter);

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Video Approvals</h1>
          <p className="text-sm text-muted-foreground mt-1">Review video submissions and manage editors</p>
        </div>
        {queue.length > 0 && (
          <Badge className="bg-warning/10 text-warning-foreground border-0 text-sm font-bold gap-1">
            {queue.length} Pending
          </Badge>
        )}
      </div>

      <div className="flex rounded-xl border border-input bg-card p-0.5 w-fit">
        {[
          { k: "queue", label: `Queue (${queue.length})` },
          { k: "all", label: `All Videos (${videos.length})` },
          { k: "editors", label: `Editors (${editors.length})` },
        ].map(t => (
          <button key={t.k} onClick={() => setTab(t.k as any)}
            className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${tab === t.k ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === "all" && (
        <div className="flex flex-wrap gap-2">
          {([
            { k: "all", label: "All", count: videos.length },
            ...(Object.keys(STATUS_BADGE) as VideoStatus[]).map(s => ({
              k: s, label: STATUS_BADGE[s].label, count: statusCounts[s] || 0,
            })),
          ]).map(f => (
            <button key={f.k} onClick={() => setStatusFilter(f.k as any)}
              className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${statusFilter === f.k ? "border-primary bg-primary text-primary-foreground" : "border-input text-muted-foreground hover:text-foreground"}`}>
              {f.label} ({f.count})
            </button>
          ))}
        </div>
      )}

      {tab === "editors" ? (
        <Card className="border-border/60 shadow-none overflow-hidden">
          <CardContent className="p-0">
            <div className="flex items-center justify-between px-4 py-3 border-b border-border">
              <p className="text-xs text-muted-foreground">Editors are external consultants — link each to a user account with the <span className="font-semibold">video_editor</span> role.</p>
              <Button size="sm" className="gap-1.5" onClick={() => openEditorDialog(null)} disabled={!isSuperAdmin}>
                <Plus className="h-4 w-4" /> Add Editor
              </Button>
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/50">
                  <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase">Name</th>
                  <th className="px-3 py-3 text-left text-xs font-semibold text-muted-foreground uppercase">Email / Phone</th>
                  <th className="px-3 py-3 text-center text-xs font-semibold text-muted-foreground uppercase">Linked User</th>
                  <th className="px-3 py-3 text-right text-xs font-semibold text-muted-foreground uppercase">Per-Video Rate</th>
                  <th className="px-3 py-3 text-center text-xs font-semibold text-muted-foreground uppercase">Active</th>
                  <th className="px-3 py-3 text-center text-xs font-semibold text-muted-foreground uppercase">Edit</th>
                </tr>
              </thead>
              <tbody>
                {editors.length === 0 ? (
                  <tr><td colSpan={6} className="px-4 py-8 text-center text-sm text-muted-foreground">No editors yet</td></tr>
                ) : editors.map(e => (
                  <tr key={e.id} className="border-b border-border/40 hover:bg-muted/20">
                    <td className="px-4 py-3 font-medium">{e.name}</td>
                    <td className="px-3 py-3 text-xs text-muted-foreground">
                      <div>{e.email || "—"}</div>
                      <div>{e.phone || ""}</div>
                    </td>
                    <td className="px-3 py-3 text-center text-xs">
                      {e.user_id
                        ? <CheckCircle className="h-4 w-4 text-success mx-auto" />
                        : <span className="text-muted-foreground">—</span>}
                    </td>
                    <td className="px-3 py-3 text-right font-medium">₹{Number(e.per_video_rate).toLocaleString("en-IN")}</td>
                    <td className="px-3 py-3 text-center">
                      <Badge className={`border-0 text-[10px] ${e.active ? "bg-success/10 text-success" : "bg-gray-100 text-gray-700"}`}>
                        {e.active ? "Active" : "Inactive"}
                      </Badge>
                    </td>
                    <td className="px-3 py-3 text-center">
                      <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => openEditorDialog(e)} disabled={!isSuperAdmin}>
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      ) : (
        <Card className="border-border/60 shadow-none overflow-hidden">
          <CardContent className="p-0">
            {tableRows.length === 0 ? (
              <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">
                {tab === "queue" ? "Nothing pending — you're all caught up." : "No videos yet"}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border bg-muted/50">
                      <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase">Title</th>
                      <th className="px-3 py-3 text-left text-xs font-semibold text-muted-foreground uppercase">Editor</th>
                      <th className="px-3 py-3 text-left text-xs font-semibold text-muted-foreground uppercase">Brand</th>
                      <th className="px-3 py-3 text-center text-xs font-semibold text-muted-foreground uppercase">Type</th>
                      <th className="px-3 py-3 text-center text-xs font-semibold text-muted-foreground uppercase">Status</th>
                      <th className="px-3 py-3 text-center text-xs font-semibold text-muted-foreground uppercase">Submitted</th>
                      <th className="px-3 py-3 text-center text-xs font-semibold text-muted-foreground uppercase">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tableRows.map(v => {
                      const cfg = STATUS_BADGE[v.status];
                      return (
                        <tr key={v.id} className="border-b border-border/40 hover:bg-muted/20 cursor-pointer"
                            onClick={() => setSelected(v)}>
                          <td className="px-4 py-3">
                            <div className="font-medium">{v.title}</div>
                            <a href={v.drive_url} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()}
                               className="text-[10px] text-muted-foreground hover:text-primary flex items-center gap-1 w-fit">
                              <ExternalLink className="h-3 w-3" /> {sourceLabel(v.drive_url)} link
                            </a>
                          </td>
                          <td className="px-3 py-3 text-xs">{editorById[v.editor_id]?.name || "—"}</td>
                          <td className="px-3 py-3 text-xs text-muted-foreground">{VIDEO_BRAND_LABEL[v.brand]}</td>
                          <td className="px-3 py-3 text-center">
                            <Badge className="border-0 text-[10px] bg-muted text-foreground">{CONTENT_TYPE_LABEL[v.content_type]}</Badge>
                          </td>
                          <td className="px-3 py-3 text-center">
                            <Badge className={`border-0 text-[10px] font-semibold ${cfg.color}`}>{cfg.label}</Badge>
                            {(v.status === "rejected" || v.status === "approved") && v.editor_notified_at && (
                              <div className="mt-1 flex items-center justify-center gap-0.5 text-[9px] text-success">
                                <BellRing className="h-2.5 w-2.5" /> Editor notified
                              </div>
                            )}
                          </td>
                          <td className="px-3 py-3 text-center text-xs text-muted-foreground">
                            {new Date(v.created_at).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}
                          </td>
                          <td className="px-3 py-3 text-center">
                            <Button variant="ghost" size="sm" className="gap-1 text-xs">Review</Button>
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
      )}

      {/* Review dialog */}
      <Dialog open={!!selected} onOpenChange={(o) => { if (!o) { setSelected(null); setRejectReason(""); setScreenshots([]); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Video className="h-5 w-5 text-primary" /> Review Video</DialogTitle>
          </DialogHeader>
          {selected && (
            <div className="space-y-3">
              <div>
                <p className="text-[10px] text-muted-foreground uppercase font-semibold">Title</p>
                <p className="text-sm font-medium">{selected.title}</p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <p className="text-[10px] text-muted-foreground uppercase font-semibold">Editor</p>
                  <p className="text-sm">{editorById[selected.editor_id]?.name || "—"}</p>
                </div>
                <div>
                  <p className="text-[10px] text-muted-foreground uppercase font-semibold">Brand</p>
                  <p className="text-sm">{VIDEO_BRAND_LABEL[selected.brand]}</p>
                </div>
                <div>
                  <p className="text-[10px] text-muted-foreground uppercase font-semibold">Type</p>
                  <p className="text-sm">{CONTENT_TYPE_LABEL[selected.content_type]}</p>
                </div>
                <div>
                  <p className="text-[10px] text-muted-foreground uppercase font-semibold">Status</p>
                  <Badge className={`border-0 text-[10px] font-semibold ${STATUS_BADGE[selected.status].color}`}>
                    {STATUS_BADGE[selected.status].label}
                  </Badge>
                  {selected.editor_notified_at && (selected.status === "rejected" || selected.status === "approved") && (
                    <p className="mt-1 flex items-center gap-1 text-[10px] text-success">
                      <BellRing className="h-3 w-3" /> Editor notified {fmtPostedAt(selected.editor_notified_at)}
                    </p>
                  )}
                </div>
              </div>
              <a href={selected.drive_url} target="_blank" rel="noreferrer"
                 className="inline-flex items-center gap-1.5 rounded-xl border border-primary/40 bg-primary/5 px-3 py-2 text-sm font-medium text-primary hover:bg-primary/10">
                <ExternalLink className="h-4 w-4" /> Open {sourceLabel(selected.drive_url)} Link
              </a>

              {(selected.thumbnail_youtube_url || selected.thumbnail_instagram_url) && (
                <div>
                  <p className="text-[10px] text-muted-foreground uppercase font-semibold mb-1.5">Thumbnails</p>
                  <div className="flex gap-3">
                    {[
                      { url: selected.thumbnail_youtube_url, label: "YouTube 16:9", box: "h-20 w-36" },
                      { url: selected.thumbnail_instagram_url, label: "Instagram 9:16", box: "h-32 w-[4.5rem]" },
                    ].map(t => t.url ? (
                      <a key={t.label} href={t.url} target="_blank" rel="noreferrer" className="text-center">
                        <img src={t.url} alt={t.label} className={`${t.box} rounded-lg object-cover border border-border`} />
                        <span className="mt-1 block text-[9px] text-muted-foreground">{t.label}</span>
                      </a>
                    ) : null)}
                  </div>
                </div>
              )}

              <PostedLinks v={selected} />

              <VideoHistory videoId={selected.id} canComment />

              {selected.status === "rejected" && (selected.rejection_reason || selected.rejection_screenshots?.length) && (
                <div className="rounded-xl border border-destructive/20 bg-destructive/5 p-3 text-xs">
                  <p className="font-semibold text-destructive mb-1">Correction requested</p>
                  {selected.rejection_reason && <p>{selected.rejection_reason}</p>}
                  {selected.rejection_screenshots?.length ? (
                    <div className="flex flex-wrap gap-2 mt-2">
                      {selected.rejection_screenshots.map((u, i) => (
                        <a key={i} href={u} target="_blank" rel="noreferrer">
                          <img src={u} alt={`Screenshot ${i + 1}`} className="h-16 w-16 rounded-lg object-cover border border-border" />
                        </a>
                      ))}
                    </div>
                  ) : null}
                </div>
              )}

              {selected.status === "pending_approval" && isSuperAdmin && (
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
                            onClick={handleSendForCorrection} disabled={acting}>
                      {acting ? <ButtonOrb state="working" /> : <RotateCcw className="h-4 w-4" />} Send for correction
                    </Button>
                    <Button className="flex-1 gap-1.5 bg-success hover:bg-success/90"
                            onClick={handleApprove} disabled={acting}>
                      {acting ? <ButtonOrb state="working" onFilled /> : <CheckCircle className="h-4 w-4" />} Approve
                    </Button>
                  </div>
                </>
              )}

              {/* Admin overrides — revoke a prior approval, or delete the video. */}
              {isSuperAdmin && (
                <div className="flex gap-2 pt-2 border-t border-border">
                  {(selected.status === "approved" || selected.status === "published") && (
                    <Button variant="outline" className="flex-1 gap-1.5 text-warning-foreground hover:bg-warning/5"
                            onClick={handleRevoke} disabled={acting}>
                      {acting ? <ButtonOrb state="working" /> : <Undo2 className="h-4 w-4" />} Revoke approval
                    </Button>
                  )}
                  <Button variant="outline" className="flex-1 gap-1.5 text-destructive hover:bg-destructive/5"
                          onClick={handleDelete} disabled={acting}>
                    {acting ? <ButtonOrb state="working" /> : <Trash2 className="h-4 w-4" />} Delete video
                  </Button>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Editor add/edit dialog */}
      <Dialog open={!!editorForm} onOpenChange={(o) => { if (!o) setEditorForm(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Users className="h-5 w-5" /> {editorForm?.id ? "Edit" : "Add"} Editor</DialogTitle>
          </DialogHeader>
          {editorForm && (
            <div className="space-y-3">
              <div>
                <label className="text-xs font-medium mb-1 block">Link to user (must have <span className="font-semibold">video_editor</span> role)</label>
                <select value={editorForm.user_id || ""} onChange={e => setEditorForm(p => p ? { ...p, user_id: e.target.value || null } : p)} className={inputCls}>
                  <option value="">— Not linked —</option>
                  {availableUsers.map(u => <option key={u.user_id} value={u.user_id}>{u.display_name || u.user_id}</option>)}
                  {editorForm.user_id && !availableUsers.find(u => u.user_id === editorForm.user_id) && (
                    <option value={editorForm.user_id}>Currently linked user</option>
                  )}
                </select>
                <p className="text-[10px] text-muted-foreground mt-1">Invite the editor first from Admin Panel → Users (role: Video Editor), then link here.</p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="text-xs font-medium mb-1 block">Name *</label>
                  <input value={editorForm.name} onChange={e => setEditorForm(p => p ? { ...p, name: e.target.value } : p)} className={inputCls} /></div>
                <div><label className="text-xs font-medium mb-1 block">Per-Video Rate (₹)</label>
                  <input type="number" value={editorForm.per_video_rate}
                    onChange={e => setEditorForm(p => p ? { ...p, per_video_rate: Number(e.target.value) } : p)} className={inputCls} /></div>
                <div><label className="text-xs font-medium mb-1 block">Email</label>
                  <input value={editorForm.email || ""} onChange={e => setEditorForm(p => p ? { ...p, email: e.target.value } : p)} className={inputCls} /></div>
                <div><label className="text-xs font-medium mb-1 block">Phone</label>
                  <input value={editorForm.phone || ""} onChange={e => setEditorForm(p => p ? { ...p, phone: e.target.value } : p)} className={inputCls} /></div>
              </div>
              <div className="border-t border-border pt-3 space-y-2">
                <label className="block text-[11px] font-semibold uppercase text-muted-foreground">Bank / Payout Account</label>
                <BankDetailsFields
                  value={{
                    holderName: editorForm.bank_account_name || "", accountNumber: editorForm.bank_account_number || "",
                    ifsc: editorForm.bank_ifsc || "", bankName: editorForm.bank_name || "", upi: editorForm.bank_upi || "",
                  }}
                  onChange={v => setEditorForm(p => p ? {
                    ...p, bank_account_name: v.holderName, bank_account_number: v.accountNumber,
                    bank_ifsc: v.ifsc, bank_name: v.bankName, bank_upi: v.upi || "",
                  } : p)}
                  verification={{ status: editorForm.bank_verification_status || "unverified", name: editorForm.bank_verified_name || null }}
                  onVerification={v => setEditorForm(p => p ? {
                    ...p, bank_verification_status: v.status, bank_verified_name: v.name,
                    bank_verification_ref: v.ref, bank_verified_at: v.at,
                  } : p)}
                />
              </div>
              <ZohoVendorLinkField
                phone={editorForm.phone}
                value={editorForm.zoho_vendor_id}
                onChange={(id) => setEditorForm(p => p ? { ...p, zoho_vendor_id: id } : p)}
              />
              <label className="flex items-center gap-2 text-xs font-medium">
                <input type="checkbox" checked={editorForm.active}
                  onChange={e => setEditorForm(p => p ? { ...p, active: e.target.checked } : p)} />
                Active
              </label>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditorForm(null)}>Cancel</Button>
            <Button onClick={handleSaveEditor} disabled={savingEditor} className="gap-2">
              {savingEditor ? <ButtonOrb state="working" onFilled /> : <CheckCircle className="h-4 w-4" />} Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
