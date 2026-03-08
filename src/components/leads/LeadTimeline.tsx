import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Send, Loader2, ArrowRight, Phone, StickyNote, Bot, MapPin, Clock, Check, Plus, MessageSquare, Link2,
} from "lucide-react";

interface LeadTimelineProps {
  activities: any[];
  notes: any[];
  callLogs: any[];
  newNote: string;
  setNewNote: (v: string) => void;
  onAddNote: () => void;
  savingNote: boolean;
  // Keep for backwards compat — not used in rendering
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
  const inputCls = "w-full rounded-xl border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/20";

  return (
    <div className="space-y-4">
      {/* Note input — Orchid style with round send button + link icon */}
      <div className="flex items-center gap-2">
        <div className="flex-1 relative">
          <input
            type="text"
            value={newNote}
            onChange={(e) => setNewNote(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && onAddNote()}
            placeholder="Add a note..."
            className={`${inputCls} pr-10`}
          />
          <button className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors">
            <Link2 className="h-4 w-4" />
          </button>
        </div>
        <Button
          onClick={onAddNote}
          disabled={savingNote || !newNote.trim()}
          size="icon"
          className="shrink-0 rounded-full h-10 w-10 bg-primary hover:bg-primary/90"
        >
          {savingNote ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        </Button>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="timeline" className="w-full">
        <TabsList className="bg-transparent border-b border-border rounded-none p-0 h-auto gap-0 w-full justify-start">
          <TabsTrigger value="timeline" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none text-sm px-4 py-2.5 text-muted-foreground data-[state=active]:text-foreground data-[state=active]:font-semibold">
            Timeline
          </TabsTrigger>
          <TabsTrigger value="calls" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none text-sm px-4 py-2.5 text-muted-foreground data-[state=active]:text-foreground data-[state=active]:font-semibold">
            Calls
          </TabsTrigger>
          <TabsTrigger value="notes" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none text-sm px-4 py-2.5 text-muted-foreground data-[state=active]:text-foreground data-[state=active]:font-semibold">
            Notes
          </TabsTrigger>
          <TabsTrigger value="documents" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none text-sm px-4 py-2.5 text-muted-foreground data-[state=active]:text-foreground data-[state=active]:font-semibold">
            Documents
          </TabsTrigger>
        </TabsList>

        <TabsContent value="timeline" className="mt-4">
          <TimelineList activities={activities} />
        </TabsContent>

        <TabsContent value="calls" className="mt-4">
          <CallsList callLogs={callLogs} />
        </TabsContent>

        <TabsContent value="notes" className="mt-4">
          <NotesList notes={notes} />
        </TabsContent>

        <TabsContent value="documents" className="mt-4">
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

// ── Timeline ────────────────────────────────────────────────

const ACTIVITY_CONFIG: Record<string, {
  icon: React.ReactNode;
  bg: string;
  getTitle: (a: any) => string;
}> = {
  lead_created: {
    icon: <Plus className="h-4 w-4" />,
    bg: "bg-green-100 text-green-600 dark:bg-green-900/20 dark:text-green-400",
    getTitle: () => "Lead Created",
  },
  stage_change: {
    icon: <ArrowRight className="h-4 w-4" />,
    bg: "bg-primary/10 text-primary",
    getTitle: () => "Stage changed",
  },
  ai_call: {
    icon: <Bot className="h-4 w-4" />,
    bg: "bg-amber-100 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400",
    getTitle: () => "AI Outbound Call",
  },
  call: {
    icon: <Phone className="h-4 w-4" />,
    bg: "bg-primary/10 text-primary",
    getTitle: () => "Outbound call",
  },
  note: {
    icon: <StickyNote className="h-4 w-4" />,
    bg: "bg-blue-100 text-blue-600 dark:bg-blue-900/20 dark:text-blue-400",
    getTitle: () => "Note added",
  },
  whatsapp: {
    icon: <MessageSquare className="h-4 w-4" />,
    bg: "bg-green-100 text-green-600 dark:bg-green-900/20 dark:text-green-400",
    getTitle: () => "WhatsApp sent",
  },
  visit: {
    icon: <MapPin className="h-4 w-4" />,
    bg: "bg-violet-100 text-violet-600 dark:bg-violet-900/20 dark:text-violet-400",
    getTitle: () => "Campus visit",
  },
};

const DEFAULT_CONFIG = {
  icon: <Clock className="h-4 w-4" />,
  bg: "bg-muted text-muted-foreground",
  getTitle: () => "Activity",
};

function TimelineList({ activities }: { activities: any[] }) {
  if (activities.length === 0) return <EmptyState text="No activity recorded yet" />;

  return (
    <div className="relative pl-5">
      {/* Vertical connector line */}
      <div className="absolute left-[15px] top-6 bottom-6 w-px bg-border" />

      <div className="space-y-1">
        {activities.map((a) => {
          const config = ACTIVITY_CONFIG[a.type] || DEFAULT_CONFIG;
          const title = config.getTitle(a);

          // Extract subtitle from description (e.g. "New Lead → AI Called")
          const subtitle = a.type === "stage_change"
            ? a.description?.replace(/^Stage changed from /i, "")
            : null;

          return (
            <div key={a.id} className="relative flex gap-4 py-3">
              {/* Icon circle */}
              <div className={`relative z-10 flex h-8 w-8 items-center justify-center rounded-full shrink-0 -ml-5 ${config.bg}`}>
                {config.icon}
              </div>

              {/* Content */}
              <div className="flex-1 min-w-0 -mt-0.5">
                {/* Header row: title + timestamp */}
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm font-semibold text-foreground">{title}</p>
                  <span className="text-[11px] text-muted-foreground whitespace-nowrap shrink-0 pt-0.5">
                    {formatTimestamp(a.created_at)}
                  </span>
                </div>

                {/* Subtitle / metadata */}
                {subtitle && (
                  <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>
                )}

                {/* Content block — the description in a subtle card */}
                {a.description && a.type !== "stage_change" && (
                  <div className="mt-2 rounded-xl bg-muted/40 border border-border/40 px-4 py-3">
                    <p className="text-sm text-foreground/80 leading-relaxed">{a.description}</p>
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
      <div className="absolute left-[15px] top-6 bottom-6 w-px bg-border" />
      <div className="space-y-1">
        {callLogs.map((c) => {
          const isAi = c.direction === "outbound" && !c.user_id;
          return (
            <div key={c.id} className="relative flex gap-4 py-3">
              <div className={`relative z-10 flex h-8 w-8 items-center justify-center rounded-full shrink-0 -ml-5 ${isAi ? "bg-amber-100 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400" : "bg-primary/10 text-primary"}`}>
                {isAi ? <Bot className="h-4 w-4" /> : <Phone className="h-4 w-4" />}
              </div>
              <div className="flex-1 min-w-0 -mt-0.5">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-semibold text-foreground capitalize">
                      {isAi ? "AI Outbound Call" : `${c.direction} call`}
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {c.disposition && <>{c.disposition}</>}
                      {c.disposition && c.duration_seconds ? " · " : ""}
                      {c.duration_seconds ? `${Math.floor(c.duration_seconds / 60)}m ${c.duration_seconds % 60}s` : ""}
                    </p>
                  </div>
                  <span className="text-[11px] text-muted-foreground whitespace-nowrap shrink-0 pt-0.5">
                    {formatTimestamp(c.called_at)}
                  </span>
                </div>
                {c.notes && (
                  <div className="mt-2 rounded-xl bg-muted/40 border border-border/40 px-4 py-3">
                    <p className="text-sm text-foreground/80 leading-relaxed">{c.notes}</p>
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
      <div className="absolute left-[15px] top-6 bottom-6 w-px bg-border" />
      <div className="space-y-1">
        {notes.map((note) => (
          <div key={note.id} className="relative flex gap-4 py-3">
            <div className="relative z-10 flex h-8 w-8 items-center justify-center rounded-full shrink-0 -ml-5 bg-blue-100 text-blue-600 dark:bg-blue-900/20 dark:text-blue-400">
              <StickyNote className="h-4 w-4" />
            </div>
            <div className="flex-1 min-w-0 -mt-0.5">
              <div className="flex items-start justify-between gap-2">
                <p className="text-sm font-semibold text-foreground">Note added</p>
                <span className="text-[11px] text-muted-foreground whitespace-nowrap shrink-0 pt-0.5">
                  {formatTimestamp(note.created_at)}
                </span>
              </div>
              <div className="mt-2 rounded-xl bg-muted/40 border border-border/40 px-4 py-3">
                <p className="text-sm text-foreground/80 leading-relaxed">{note.content}</p>
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
  return <p className="text-sm text-muted-foreground text-center py-10">{text}</p>;
}
