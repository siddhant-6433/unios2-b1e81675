// HR — Announcements.
//
// Publish once, target it at roles (or everyone), pin it, and see how many
// people have actually read it. Read counts come from `announcement_reads`,
// which employees write when they tap "Mark read" in MyEngagementPanel.

import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { usePermissions } from "@/contexts/PermissionContext";
import { PageLoader } from "@/components/ui/page-loader";
import { OrbLoader } from "@/components/ui/thinking-orb";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Megaphone, Pin, Send, Eye, CalendarClock, Clock } from "lucide-react";
import { ALL_APP_ROLES, roleLabel } from "@/lib/accessPolicy";
import {
  announcementIsLive,
  announcementLifecycleRank,
  sortAnnouncements,
  type Announcement,
} from "@/lib/engagement";

interface AnnouncementsPanelProps {
  className?: string;
}

const LIFECYCLE_LABEL = ["Live", "Draft", "Scheduled", "Expired"] as const;
const LIFECYCLE_CLASS = [
  "bg-pastel-green text-foreground/80",
  "bg-pastel-yellow text-foreground/80",
  "bg-pastel-blue text-foreground/80",
  "bg-muted text-muted-foreground",
] as const;

function formatDate(s: string | null): string {
  if (!s) return "—";
  return new Date(s).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
}

function audienceLabel(a: Announcement): string {
  if (!a.audience_roles || a.audience_roles.length === 0) return "Everyone";
  return a.audience_roles.map((r) => roleLabel(r)).join(", ");
}

export function AnnouncementsPanel({ className }: AnnouncementsPanelProps) {
  const { toast } = useToast();
  const { user } = useAuth();
  const { can, loading: permissionsLoading } = usePermissions();
  const canManage = can("hr", "engage_manage");

  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [readCounts, setReadCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Publish form
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [allStaff, setAllStaff] = useState(true);
  const [roles, setRoles] = useState<string[]>([]);
  const [isPinned, setIsPinned] = useState(false);
  const [publishedAt, setPublishedAt] = useState("");
  const [expiresAt, setExpiresAt] = useState("");

  const now = useMemo(() => new Date(), []);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    const [posts, reads] = await Promise.all([
      supabase.from("announcements" as any).select("*").order("created_at", { ascending: false }),
      supabase.from("announcement_reads" as any).select("announcement_id"),
    ]);
    if (posts.error) {
      toast({ title: "Failed to load announcements", description: posts.error.message, variant: "destructive" });
      setAnnouncements([]);
    } else {
      setAnnouncements((posts.data as Announcement[]) ?? []);
    }

    const tally: Record<string, number> = {};
    for (const row of (reads.data as { announcement_id: string }[]) ?? []) {
      tally[row.announcement_id] = (tally[row.announcement_id] ?? 0) + 1;
    }
    setReadCounts(tally);
    setLoading(false);
  }, [toast]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const sorted = useMemo(() => sortAnnouncements(announcements, now), [announcements, now]);

  const toggleRole = (role: string) => {
    setRoles((prev) => (prev.includes(role) ? prev.filter((r) => r !== role) : [...prev, role]));
  };

  const resetForm = () => {
    setTitle("");
    setBody("");
    setAllStaff(true);
    setRoles([]);
    setIsPinned(false);
    setPublishedAt("");
    setExpiresAt("");
  };

  const publish = async () => {
    if (!title.trim() || !body.trim()) {
      toast({ title: "Title and body are required", variant: "destructive" });
      return;
    }
    if (!allStaff && roles.length === 0) {
      toast({ title: "Pick at least one role, or choose Everyone", variant: "destructive" });
      return;
    }
    setSaving(true);
    const { error } = await supabase.from("announcements" as any).insert({
      title: title.trim(),
      body: body.trim(),
      audience_roles: allStaff ? null : roles,
      is_pinned: isPinned,
      published_at: publishedAt ? new Date(publishedAt).toISOString() : null,
      expires_at: expiresAt ? new Date(expiresAt).toISOString() : null,
      created_by: user?.id ?? null,
    });
    setSaving(false);
    if (error) {
      toast({ title: "Could not publish", description: error.message, variant: "destructive" });
      return;
    }
    toast({
      title: publishedAt ? "Announcement saved" : "Draft saved",
      description: publishedAt ? undefined : "Set a publish time to make it live.",
    });
    resetForm();
    fetchAll();
  };

  if (permissionsLoading) return <PageLoader />;

  if (!canManage) {
    return (
      <div className="rounded-xl bg-card card-shadow px-4 py-12 text-center">
        <p className="text-sm text-foreground">Announcements are restricted</p>
        <p className="text-xs text-muted-foreground mt-1">You need the “Manage engagement” permission.</p>
      </div>
    );
  }

  return (
    <div className={className ?? "space-y-5 animate-fade-in"}>
      <div className="grid gap-4 lg:grid-cols-[380px_1fr]">
        {/* Publish */}
        <Card className="border-border/60 shadow-none">
          <CardContent className="space-y-3 p-4">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <Megaphone className="h-4 w-4" /> Publish an announcement
            </h2>

            <div className="space-y-1">
              <label className="text-[11px] uppercase tracking-wide text-muted-foreground">Title</label>
              <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Diwali holiday schedule" />
            </div>

            <div className="space-y-1">
              <label className="text-[11px] uppercase tracking-wide text-muted-foreground">Body</label>
              <Textarea value={body} onChange={(e) => setBody(e.target.value)} rows={4} placeholder="What do people need to know?" />
            </div>

            <div className="space-y-1">
              <label className="text-[11px] uppercase tracking-wide text-muted-foreground">Audience</label>
              <label className="flex items-center gap-2 text-xs text-foreground">
                <Checkbox checked={allStaff} onCheckedChange={(v) => setAllStaff(v === true)} />
                Everyone
              </label>
              {!allStaff && (
                <div className="max-h-40 space-y-1 overflow-y-auto rounded-lg border border-border p-2">
                  {ALL_APP_ROLES.map((role) => (
                    <label key={role} className="flex items-center gap-2 text-xs text-foreground">
                      <Checkbox checked={roles.includes(role)} onCheckedChange={() => toggleRole(role)} />
                      {roleLabel(role)}
                    </label>
                  ))}
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-[11px] uppercase tracking-wide text-muted-foreground">Publish at</label>
                <Input type="datetime-local" value={publishedAt} onChange={(e) => setPublishedAt(e.target.value)} />
                <p className="text-[10px] text-muted-foreground">Leave empty to save as a draft.</p>
              </div>
              <div className="space-y-1">
                <label className="text-[11px] uppercase tracking-wide text-muted-foreground">Expires at</label>
                <Input type="datetime-local" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} />
                <p className="text-[10px] text-muted-foreground">Optional.</p>
              </div>
            </div>

            <label className="flex items-center gap-2 text-xs text-foreground">
              <Checkbox checked={isPinned} onCheckedChange={(v) => setIsPinned(v === true)} />
              <Pin className="h-3.5 w-3.5" /> Pin to the top
            </label>

            <div className="flex justify-end gap-2 pt-1">
              <Button size="sm" variant="ghost" onClick={resetForm} disabled={saving}>Clear</Button>
              <Button size="sm" onClick={publish} disabled={saving}>
                <Send className="h-3.5 w-3.5 mr-1" /> {saving ? "Saving…" : "Publish"}
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Existing */}
        <Card className="border-border/60 shadow-none">
          <CardContent className="p-0">
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <h2 className="text-sm font-semibold text-foreground">All announcements</h2>
              <span className="text-[11px] text-muted-foreground">{announcements.length} total</span>
            </div>

            {loading ? (
              <div className="flex h-48 items-center justify-center">
                <OrbLoader state="searching" />
              </div>
            ) : sorted.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-center">
                <Megaphone className="mb-2 h-10 w-10 text-muted-foreground/40" />
                <p className="text-sm text-muted-foreground">Nothing published yet.</p>
              </div>
            ) : (
              <ul className="divide-y divide-border">
                {sorted.map((a) => {
                  const rank = announcementLifecycleRank(a, now);
                  return (
                    <li key={a.id} className="space-y-1.5 px-4 py-3">
                      <div className="flex flex-wrap items-center gap-2">
                        {a.is_pinned && <Pin className="h-3.5 w-3.5 text-primary" />}
                        <span className="font-medium text-foreground">{a.title}</span>
                        <Badge className={`${LIFECYCLE_CLASS[rank]} border-0 text-[10px]`}>
                          {LIFECYCLE_LABEL[rank]}
                        </Badge>
                        <span className="ml-auto flex items-center gap-1 text-[11px] text-muted-foreground">
                          <Eye className="h-3.5 w-3.5" /> {readCounts[a.id] ?? 0} reads
                        </span>
                      </div>
                      <p className="line-clamp-2 whitespace-pre-wrap text-[12.5px] text-foreground/80">{a.body}</p>
                      <div className="flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
                        <span className="rounded-full bg-muted px-2 py-0.5">{audienceLabel(a)}</span>
                        <span className="flex items-center gap-1">
                          <Clock className="h-3 w-3" /> {a.published_at ? formatDate(a.published_at) : "Not scheduled"}
                        </span>
                        {a.expires_at && (
                          <span className="flex items-center gap-1">
                            <CalendarClock className="h-3 w-3" /> until {formatDate(a.expires_at)}
                          </span>
                        )}
                        {!announcementIsLive(a, now) && rank === 3 && (
                          <span className="text-muted-foreground/70">no longer visible to staff</span>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

export default AnnouncementsPanel;
