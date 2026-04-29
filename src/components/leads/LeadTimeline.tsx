import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  Send, Loader2, ArrowRight, Phone, StickyNote, Bot, MapPin, Clock, Plus, MessageSquare, Link2,
  CalendarCheck, FileText, UserCheck, GraduationCap, Mail, ClipboardList, Edit,
  Globe, MousePointer, Flame,
} from "lucide-react";
import { DocumentChecklist } from "@/components/leads/DocumentChecklist";
import { CourseInfoPanel } from "@/components/leads/CourseInfoPanel";

interface LeadTimelineProps {
  activities: any[];
  notes: any[];
  callLogs: any[];
  newNote: string;
  setNewNote: (v: string) => void;
  onAddNote: () => void;
  savingNote: boolean;
  followups?: any[];
  visits?: any[];
  onCompleteFollowup?: (id: string) => void;
  onAddFollowup?: (data: { scheduled_at: string; type: string; notes: string }) => void;
  onScheduleVisit?: (data: { visit_date: string; campus_id: string }) => void;
  onUpdateVisitStatus?: (id: string, status: string, newDate?: string) => void;
  campuses?: any[];
  leadId?: string;
  courseId?: string | null;
}

export function LeadTimeline({
  activities, notes, followups, visits, callLogs,
  newNote, setNewNote, onAddNote, savingNote,
  onCompleteFollowup, onAddFollowup, onScheduleVisit, onUpdateVisitStatus, campuses,
  leadId, courseId,
}: LeadTimelineProps) {
  return (
    <div className="space-y-3">
      {/* Tabs */}
      <Tabs defaultValue="timeline" className="w-full">
        <TabsList className="bg-transparent border-b border-border rounded-none p-0 h-auto gap-0 w-full justify-start">
          {["Timeline", "Calls", "Notes", "Course Info", "Documents"].map((t) => (
            <TabsTrigger
              key={t}
              value={t.toLowerCase()}
              className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none text-sm px-4 py-2 text-muted-foreground data-[state=active]:text-foreground data-[state=active]:font-semibold"
            >
              {t}
            </TabsTrigger>
          ))}
        </TabsList>

        {/* Note input — compact textarea with send + link */}
        <div className="relative mt-3">
          <textarea
            value={newNote}
            onChange={(e) => setNewNote(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); onAddNote(); } }}
            placeholder="Add a note..."
            rows={2}
            className="w-full rounded-xl border border-input bg-background px-3 py-2.5 pr-12 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/20 resize-none"
          />
          <div className="absolute right-2 top-2 flex flex-col gap-1.5">
            <Button
              onClick={onAddNote}
              disabled={savingNote || !newNote.trim()}
              size="icon"
              className="rounded-full h-8 w-8 bg-primary hover:bg-primary/90"
            >
              {savingNote ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
            </Button>
            <button className="h-8 w-8 flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors">
              <Link2 className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        <TabsContent value="timeline" className="mt-3">
          <TimelineList activities={activities} leadId={leadId} />
        </TabsContent>
        <TabsContent value="calls" className="mt-3">
          <CallsList callLogs={callLogs} leadId={leadId} />
        </TabsContent>
        <TabsContent value="notes" className="mt-3">
          <NotesList notes={notes} />
        </TabsContent>
        <TabsContent value="course info" className="mt-3">
          {courseId ? (
            <CourseInfoPanel courseId={courseId} />
          ) : (
            <EmptyState text="No course assigned to this lead" />
          )}
        </TabsContent>
        <TabsContent value="documents" className="mt-3">
          {leadId ? (
            <DocumentChecklist leadId={leadId} courseId={courseId || null} />
          ) : (
            <EmptyState text="No documents uploaded yet" />
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ── Helpers ──────────────────────────────────────────────────

function formatTimestamp(iso: string) {
  const d = new Date(iso);
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const isYesterday = d.toDateString() === yesterday.toDateString();
  const time = d.toLocaleString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true }).toUpperCase();
  if (isToday) return `Today, ${time}`;
  if (isYesterday) return `Yesterday, ${time}`;
  return `${d.toLocaleDateString("en-IN", { month: "short", day: "2-digit" })}, ${time}`;
}

// ── Activity config with vibrant colors ─────────────────────

const ACTIVITY_CONFIG: Record<string, {
  icon: React.ReactNode;
  bg: string;
  getTitle: (a: any) => string;
  getSub?: (a: any) => string | null;
}> = {
  lead_created: {
    icon: <Plus className="h-3.5 w-3.5" />,
    bg: "bg-emerald-500 text-white",
    getTitle: () => "Lead created",
    getSub: (a) => a.description || null,
  },
  stage_change: {
    icon: <ArrowRight className="h-3.5 w-3.5" />,
    bg: "bg-violet-500 text-white",
    getTitle: () => "Stage changed",
    getSub: (a) => a.description?.replace(/^Stage changed from /i, "") || null,
  },
  ai_call: {
    icon: <Bot className="h-3.5 w-3.5" />,
    bg: "bg-amber-500 text-white",
    getTitle: () => "AI Outbound Call",
    getSub: (a) => {
      const parts: string[] = [];
      if (a.description) {
        const match = a.description.match(/Duration:\s*([^\·\-]+)/i);
        if (match) parts.push(`Duration: ${match[1].trim()}`);
        const dMatch = a.description.match(/Disposition:\s*(\w+)/i);
        if (dMatch) parts.push(`Disposition: ${dMatch[1]}`);
      }
      return parts.length ? parts.join(" · ") : null;
    },
  },
  call: {
    icon: <Phone className="h-3.5 w-3.5" />,
    bg: "bg-blue-500 text-white",
    getTitle: () => "Outbound call",
  },
  note: {
    icon: <StickyNote className="h-3.5 w-3.5" />,
    bg: "bg-sky-500 text-white",
    getTitle: () => "Note added",
  },
  whatsapp: {
    icon: <MessageSquare className="h-3.5 w-3.5" />,
    bg: "bg-green-500 text-white",
    getTitle: () => "WhatsApp sent",
    getSub: (a) => {
      if (a.description?.toLowerCase().includes("template")) {
        const m = a.description.match(/Template:\s*(\S+)/i);
        return m ? `Template: ${m[1]}` : null;
      }
      return null;
    },
  },
  visit: {
    icon: <MapPin className="h-3.5 w-3.5" />,
    bg: "bg-purple-500 text-white",
    getTitle: () => "Campus visit",
  },
  followup: {
    icon: <CalendarCheck className="h-3.5 w-3.5" />,
    bg: "bg-orange-500 text-white",
    getTitle: () => "Follow-up",
  },
  offer: {
    icon: <FileText className="h-3.5 w-3.5" />,
    bg: "bg-teal-500 text-white",
    getTitle: () => "Offer Letter",
  },
  interview: {
    icon: <UserCheck className="h-3.5 w-3.5" />,
    bg: "bg-indigo-500 text-white",
    getTitle: () => "Interview",
  },
  conversion: {
    icon: <GraduationCap className="h-3.5 w-3.5" />,
    bg: "bg-emerald-600 text-white",
    getTitle: () => "Conversion",
  },
  application_progress: {
    icon: <ClipboardList className="h-3.5 w-3.5" />,
    bg: "bg-cyan-500 text-white",
    getTitle: () => "Application Progress",
  },
  email: {
    icon: <Mail className="h-3.5 w-3.5" />,
    bg: "bg-blue-400 text-white",
    getTitle: () => "Email sent",
  },
  info_update: {
    icon: <Edit className="h-3.5 w-3.5" />,
    bg: "bg-slate-500 text-white",
    getTitle: () => "Info Updated",
  },
  // Engagement events
  page_view: {
    icon: <Globe className="h-3.5 w-3.5" />,
    bg: "bg-orange-400 text-white",
    getTitle: () => "Visited Website",
    getSub: (a) => a.description || null,
  },
  chat_open: {
    icon: <MessageSquare className="h-3.5 w-3.5" />,
    bg: "bg-orange-500 text-white",
    getTitle: () => "Opened Chat",
  },
  chat_message: {
    icon: <MessageSquare className="h-3.5 w-3.5" />,
    bg: "bg-orange-500 text-white",
    getTitle: () => "Sent Chat Message",
  },
  navya_click: {
    icon: <Phone className="h-3.5 w-3.5" />,
    bg: "bg-orange-500 text-white",
    getTitle: () => "Clicked Talk to Navya",
  },
  whatsapp_click: {
    icon: <MessageSquare className="h-3.5 w-3.5" />,
    bg: "bg-green-500 text-white",
    getTitle: () => "Clicked WhatsApp",
  },
  email_open: {
    icon: <Mail className="h-3.5 w-3.5" />,
    bg: "bg-orange-400 text-white",
    getTitle: () => "Opened Email",
  },
  form_start: {
    icon: <ClipboardList className="h-3.5 w-3.5" />,
    bg: "bg-orange-500 text-white",
    getTitle: () => "Started Form",
  },
  apply_click: {
    icon: <MousePointer className="h-3.5 w-3.5" />,
    bg: "bg-red-500 text-white",
    getTitle: () => "Clicked Apply Now",
    getSub: (a) => a.description || null,
  },
  whatsapp_reply: {
    icon: <MessageSquare className="h-3.5 w-3.5" />,
    bg: "bg-green-500 text-white",
    getTitle: () => "Replied on WhatsApp",
  },
};

const DEFAULT_CONFIG: {
  icon: React.ReactNode;
  bg: string;
  getTitle: (a: any) => string;
  getSub?: (a: any) => string | null;
} = {
  icon: <Clock className="h-3.5 w-3.5" />,
  bg: "bg-muted text-muted-foreground",
  getTitle: () => "Activity",
};

// ── Timeline ────────────────────────────────────────────────

function TimelineList({ activities, leadId }: { activities: any[]; leadId?: string }) {
  // Fetch AI call records to match recordings to timeline entries
  const [aiRecordings, setAiRecordings] = useState<Record<string, string>>({});
  const [engagementEvents, setEngagementEvents] = useState<any[]>([]);

  useEffect(() => {
    if (!leadId) return;
    supabase.from("ai_call_records" as any).select("created_at, recording_url, duration_seconds")
      .eq("lead_id", leadId).not("recording_url", "is", null)
      .then(({ data }) => {
        if (!data) return;
        const map: Record<string, string> = {};
        for (const r of data as any[]) {
          if (r.recording_url) {
            const key = new Date(r.created_at).toISOString().slice(0, 16);
            map[key] = r.recording_url;
          }
        }
        setAiRecordings(map);
      });

    // Fetch engagement events
    supabase.from("lead_engagement_events" as any)
      .select("id, event_type, page_url, metadata, created_at")
      .eq("lead_id", leadId)
      .order("created_at", { ascending: false })
      .limit(50)
      .then(({ data }) => {
        if (data) setEngagementEvents(data as any[]);
      });
  }, [leadId]);

  // Merge activities + engagement events into a single sorted list
  const mergedActivities = [
    ...activities,
    ...engagementEvents.map((e: any) => ({
      id: e.id,
      type: e.event_type,
      description: e.page_url || null,
      created_at: e.created_at,
      _engagement: true,
    })),
  ].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  if (mergedActivities.length === 0) return <EmptyState text="No activity recorded yet" />;

  return (
    <div className="relative pl-5">
      <div className="absolute left-[13px] top-5 bottom-5 w-px bg-border" />
      <div className="space-y-0">
        {mergedActivities.map((a) => {
          const config = ACTIVITY_CONFIG[a.type] || DEFAULT_CONFIG;
          const title = config.getTitle(a);
          const subtitle = config.getSub?.(a) ?? (a.type === "stage_change" ? a.description?.replace(/^Stage changed from /i, "") : null);
          const showBody = a.description && a.type !== "stage_change" && a.type !== "lead_created";

          // Find recording for this AI call activity
          let recordingUrl: string | null = null;
          if (a.type === "ai_call") {
            // Try exact minute match
            const key = new Date(a.created_at).toISOString().slice(0, 16);
            recordingUrl = aiRecordings[key] || null;
            // Also check URL in description
            if (!recordingUrl) {
              const urlMatch = a.description?.match(/https?:\/\/\S+\.mp3/i);
              if (urlMatch) recordingUrl = urlMatch[0];
            }
            // Fallback: try ±2 minutes
            if (!recordingUrl) {
              const ts = new Date(a.created_at).getTime();
              for (const [k, url] of Object.entries(aiRecordings)) {
                if (Math.abs(new Date(k).getTime() - ts) < 120000) { recordingUrl = url; break; }
              }
            }
          }

          return (
            <div key={a.id} className="relative flex gap-3 py-2.5">
              <div className={`relative z-10 flex h-7 w-7 items-center justify-center rounded-full shrink-0 -ml-5 shadow-sm ${config.bg}`}>
                {config.icon}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-[13px] font-semibold text-foreground leading-tight">{title}</p>
                  <span className="text-[10px] text-muted-foreground whitespace-nowrap shrink-0 pt-0.5">
                    {formatTimestamp(a.created_at)}
                  </span>
                </div>
                {subtitle && (
                  <p className="text-xs text-muted-foreground mt-0.5 leading-snug">{subtitle}</p>
                )}
                {showBody && (
                  <div className="mt-1.5 rounded-lg bg-muted/50 border border-border/30 px-3 py-2">
                    <p className="text-xs text-foreground/80 leading-relaxed">{a.description}</p>
                  </div>
                )}
                {/* Recording link for AI calls */}
                {recordingUrl && (
                  <a href={recordingUrl} target="_blank" rel="noopener noreferrer"
                    className="mt-1.5 inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline">
                    <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
                    Listen to recording
                  </a>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Calls ───────────────────────────────────────────────────

function CallsList({ callLogs, leadId }: { callLogs: any[]; leadId?: string }) {
  const [aiCalls, setAiCalls] = useState<any[]>([]);

  useEffect(() => {
    if (!leadId) return;
    supabase
      .from("ai_call_records" as any)
      .select("*")
      .eq("lead_id", leadId)
      .order("created_at", { ascending: false })
      .then(({ data }) => { if (data) setAiCalls(data as any); });
  }, [leadId]);

  // Merge manual calls + AI calls into one sorted list
  const allCalls = [
    ...callLogs.map((c: any) => ({ ...c, _type: "manual", _ts: c.called_at || c.created_at })),
    ...aiCalls.map((c: any) => ({ ...c, _type: "ai", _ts: c.created_at })),
  ].sort((a, b) => new Date(b._ts).getTime() - new Date(a._ts).getTime());

  if (allCalls.length === 0) return <EmptyState text="No call logs yet" />;

  return (
    <div className="relative pl-5">
      <div className="absolute left-[13px] top-5 bottom-5 w-px bg-border" />
      <div className="space-y-0">
        {allCalls.map((c) => {
          const isAi = c._type === "ai";
          const metaParts: string[] = [];
          const dur = c.duration_seconds;
          if (dur) metaParts.push(`${Math.floor(dur / 60)}m ${dur % 60}s`);
          if (c.disposition) metaParts.push(c.disposition.replace(/_/g, " "));
          if (isAi && c.status) metaParts.push(c.status);
          if (isAi && c.conversion_probability) metaParts.push(`${c.conversion_probability}% conversion`);

          return (
            <div key={c.id} className="relative flex gap-3 py-2.5">
              <div className={`relative z-10 flex h-7 w-7 items-center justify-center rounded-full shrink-0 -ml-5 shadow-sm ${isAi ? "bg-amber-500 text-white" : "bg-blue-500 text-white"}`}>
                {isAi ? <Bot className="h-3.5 w-3.5" /> : <Phone className="h-3.5 w-3.5" />}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-[13px] font-semibold text-foreground capitalize leading-tight">
                    {isAi ? "AI Call" : `${c.direction || "outbound"} call`}
                  </p>
                  <span className="text-[10px] text-muted-foreground whitespace-nowrap shrink-0 pt-0.5">
                    {formatTimestamp(c._ts)}
                  </span>
                </div>
                {metaParts.length > 0 && (
                  <p className="text-xs text-muted-foreground mt-0.5 leading-snug">{metaParts.join(" · ")}</p>
                )}
                {(c.notes || c.summary) && (
                  <div className="mt-1.5 rounded-lg bg-muted/50 border border-border/30 px-3 py-2">
                    <p className="text-xs text-foreground/80 leading-relaxed">{c.summary || c.notes}</p>
                  </div>
                )}
                {/* Recording link */}
                {(c.recording_url || c.recording_url_manual) && (
                  <a
                    href={c.recording_url || c.recording_url_manual}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-1.5 inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline"
                  >
                    <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
                    Listen to recording
                  </a>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Notes ───────────────────────────────────────────────────

function NotesList({ notes }: { notes: any[] }) {
  if (notes.length === 0) return <EmptyState text="No notes yet" />;

  return (
    <div className="relative pl-5">
      <div className="absolute left-[13px] top-5 bottom-5 w-px bg-border" />
      <div className="space-y-0">
        {notes.map((note) => (
          <div key={note.id} className="relative flex gap-3 py-2.5">
            <div className="relative z-10 flex h-7 w-7 items-center justify-center rounded-full shrink-0 -ml-5 shadow-sm bg-sky-500 text-white">
              <StickyNote className="h-3.5 w-3.5" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-start justify-between gap-2">
                <p className="text-[13px] font-semibold text-foreground leading-tight">Note added</p>
                <span className="text-[10px] text-muted-foreground whitespace-nowrap shrink-0 pt-0.5">
                  {formatTimestamp(note.created_at)}
                </span>
              </div>
              <div className="mt-1.5 rounded-lg bg-muted/50 border border-border/30 px-3 py-2">
                <p className="text-xs text-foreground/80 leading-relaxed">{note.content}</p>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Empty state ─────────────────────────────────────────────

function EmptyState({ text }: { text: string }) {
  return <p className="text-sm text-muted-foreground text-center py-8">{text}</p>;
}
