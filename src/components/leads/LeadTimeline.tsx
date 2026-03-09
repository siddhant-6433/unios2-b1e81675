import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  Send, Loader2, ArrowRight, Phone, StickyNote, Bot, MapPin, Clock, Plus, MessageSquare, Link2,
  CalendarCheck, FileText, UserCheck, GraduationCap, Mail, ClipboardList, Edit,
} from "lucide-react";

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
  onUpdateVisitStatus?: (id: string, status: string) => void;
  campuses?: any[];
}

export function LeadTimeline({
  activities, notes, followups, visits, callLogs,
  newNote, setNewNote, onAddNote, savingNote,
  onCompleteFollowup, onAddFollowup, onScheduleVisit, onUpdateVisitStatus, campuses,
}: LeadTimelineProps) {
  return (
    <div className="space-y-3">
      {/* Tabs */}
      <Tabs defaultValue="timeline" className="w-full">
        <TabsList className="bg-transparent border-b border-border rounded-none p-0 h-auto gap-0 w-full justify-start">
          {["Timeline", "Calls", "Notes", "Documents"].map((t) => (
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
          <TimelineList activities={activities} />
        </TabsContent>
        <TabsContent value="calls" className="mt-3">
          <CallsList callLogs={callLogs} />
        </TabsContent>
        <TabsContent value="notes" className="mt-3">
          <NotesList notes={notes} />
        </TabsContent>
        <TabsContent value="documents" className="mt-3">
          <EmptyState text="No documents uploaded yet" />
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

function TimelineList({ activities }: { activities: any[] }) {
  if (activities.length === 0) return <EmptyState text="No activity recorded yet" />;

  return (
    <div className="relative pl-5">
      <div className="absolute left-[13px] top-5 bottom-5 w-px bg-border" />
      <div className="space-y-0">
        {activities.map((a) => {
          const config = ACTIVITY_CONFIG[a.type] || DEFAULT_CONFIG;
          const title = config.getTitle(a);
          const subtitle = config.getSub?.(a) ?? (a.type === "stage_change" ? a.description?.replace(/^Stage changed from /i, "") : null);
          const showBody = a.description && a.type !== "stage_change" && a.type !== "lead_created";

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
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Calls ───────────────────────────────────────────────────

function CallsList({ callLogs }: { callLogs: any[] }) {
  if (callLogs.length === 0) return <EmptyState text="No call logs yet" />;

  return (
    <div className="relative pl-5">
      <div className="absolute left-[13px] top-5 bottom-5 w-px bg-border" />
      <div className="space-y-0">
        {callLogs.map((c) => {
          const isAi = c.direction === "outbound" && !c.user_id;
          const metaParts: string[] = [];
          if (c.duration_seconds) metaParts.push(`Duration: ${Math.floor(c.duration_seconds / 60)}m ${c.duration_seconds % 60}s`);
          if (c.disposition) metaParts.push(`Disposition: ${c.disposition}`);

          return (
            <div key={c.id} className="relative flex gap-3 py-2.5">
              <div className={`relative z-10 flex h-7 w-7 items-center justify-center rounded-full shrink-0 -ml-5 shadow-sm ${isAi ? "bg-amber-500 text-white" : "bg-blue-500 text-white"}`}>
                {isAi ? <Bot className="h-3.5 w-3.5" /> : <Phone className="h-3.5 w-3.5" />}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-[13px] font-semibold text-foreground capitalize leading-tight">
                    {isAi ? "AI Outbound Call" : `${c.direction} call`}
                  </p>
                  <span className="text-[10px] text-muted-foreground whitespace-nowrap shrink-0 pt-0.5">
                    {formatTimestamp(c.called_at)}
                  </span>
                </div>
                {metaParts.length > 0 && (
                  <p className="text-xs text-muted-foreground mt-0.5 leading-snug">{metaParts.join(" · ")}</p>
                )}
                {c.notes && (
                  <div className="mt-1.5 rounded-lg bg-muted/50 border border-border/30 px-3 py-2">
                    <p className="text-xs text-foreground/80 leading-relaxed">{c.notes}</p>
                  </div>
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
