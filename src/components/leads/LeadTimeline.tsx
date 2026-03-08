import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Send, Loader2, ArrowRight, Phone, StickyNote, Bot, MapPin, Clock, Check, FileText, Plus, Calendar, X,
} from "lucide-react";

interface LeadTimelineProps {
  activities: any[];
  notes: any[];
  followups: any[];
  visits: any[];
  callLogs: any[];
  newNote: string;
  setNewNote: (v: string) => void;
  onAddNote: () => void;
  savingNote: boolean;
  onCompleteFollowup: (id: string) => void;
  onAddFollowup: (data: { scheduled_at: string; type: string; notes: string }) => void;
  onScheduleVisit: (data: { visit_date: string; campus_id: string }) => void;
  onUpdateVisitStatus: (id: string, status: string) => void;
  campuses: any[];
}

export function LeadTimeline({
  activities, notes, followups, visits, callLogs,
  newNote, setNewNote, onAddNote, savingNote,
  onCompleteFollowup, onAddFollowup, onScheduleVisit, onUpdateVisitStatus, campuses,
}: LeadTimelineProps) {
  const inputCls = "w-full rounded-xl border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/20";

  return (
    <div className="space-y-4">
      {/* Note input */}
      <Card className="border-border/60">
        <CardContent className="p-4">
          <div className="flex gap-2">
            <input
              type="text"
              value={newNote}
              onChange={(e) => setNewNote(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && onAddNote()}
              placeholder="Add a note..."
              className={inputCls}
            />
            <Button onClick={onAddNote} disabled={savingNote || !newNote.trim()} size="icon" className="shrink-0 rounded-xl h-10 w-10">
              {savingNote ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Tabs */}
      <Tabs defaultValue="timeline" className="w-full">
        <TabsList className="bg-card border border-border rounded-xl p-1 h-auto flex-wrap">
          <TabsTrigger value="timeline" className="rounded-lg text-xs sm:text-sm data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">Timeline</TabsTrigger>
          <TabsTrigger value="calls" className="rounded-lg text-xs sm:text-sm data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">Calls</TabsTrigger>
          <TabsTrigger value="notes" className="rounded-lg text-xs sm:text-sm data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">Notes</TabsTrigger>
          <TabsTrigger value="followups" className="rounded-lg text-xs sm:text-sm data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">Follow-ups</TabsTrigger>
        </TabsList>

        <TabsContent value="timeline" className="mt-3">
          <TimelineList activities={activities} />
        </TabsContent>

        <TabsContent value="calls" className="mt-3">
          <CallsList callLogs={callLogs} />
        </TabsContent>

        <TabsContent value="notes" className="mt-3">
          <NotesList notes={notes} />
        </TabsContent>

        <TabsContent value="followups" className="mt-3">
          <FollowupsList
            followups={followups}
            onComplete={onCompleteFollowup}
            onAdd={onAddFollowup}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function TimelineList({ activities }: { activities: any[] }) {
  if (activities.length === 0) return <EmptyState text="No activity recorded yet" />;

  const getIcon = (type: string) => {
    if (type === "stage_change") return <ArrowRight className="h-3.5 w-3.5" />;
    if (type === "note") return <StickyNote className="h-3.5 w-3.5" />;
    if (type === "call" || type === "ai_call") return <Bot className="h-3.5 w-3.5" />;
    if (type === "visit") return <MapPin className="h-3.5 w-3.5" />;
    return <Clock className="h-3.5 w-3.5" />;
  };

  const getIconBg = (type: string) => {
    if (type === "stage_change") return "bg-primary/10 text-primary";
    if (type === "ai_call") return "bg-amber-100 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400";
    if (type === "note") return "bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400";
    return "bg-muted text-muted-foreground";
  };

  return (
    <div className="relative">
      {/* Vertical line */}
      <div className="absolute left-[18px] top-4 bottom-4 w-px bg-border" />
      <div className="space-y-0">
        {activities.map((a) => (
          <div key={a.id} className="relative flex gap-4 py-3 pl-0">
            <div className={`relative z-10 flex h-9 w-9 items-center justify-center rounded-xl shrink-0 ${getIconBg(a.type)}`}>
              {getIcon(a.type)}
            </div>
            <div className="flex-1 min-w-0 pt-0.5">
              <div className="flex items-start justify-between gap-2">
                <p className="text-sm text-foreground leading-snug">{a.description}</p>
                <span className="text-[10px] text-muted-foreground whitespace-nowrap shrink-0">
                  {new Date(a.created_at).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                </span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function CallsList({ callLogs }: { callLogs: any[] }) {
  if (callLogs.length === 0) return <EmptyState text="No call logs yet" />;
  return (
    <div className="space-y-2">
      {callLogs.map((c) => (
        <Card key={c.id} className="border-border/60">
          <CardContent className="p-4 flex items-start gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary shrink-0">
              <Phone className="h-4 w-4" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium text-foreground capitalize">{c.direction} call</p>
                <span className="text-[10px] text-muted-foreground">
                  {new Date(c.called_at).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                </span>
              </div>
              {c.disposition && <p className="text-xs text-muted-foreground mt-0.5">Disposition: {c.disposition}</p>}
              {c.duration_seconds && <p className="text-xs text-muted-foreground">Duration: {Math.floor(c.duration_seconds / 60)}m {c.duration_seconds % 60}s</p>}
              {c.notes && <p className="text-sm text-foreground/80 mt-2 bg-muted/50 rounded-lg p-2.5">{c.notes}</p>}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function NotesList({ notes }: { notes: any[] }) {
  if (notes.length === 0) return <EmptyState text="No notes yet" />;
  return (
    <div className="space-y-2">
      {notes.map((note) => (
        <Card key={note.id} className="border-border/60">
          <CardContent className="p-4">
            <div className="flex items-start gap-3">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-50 text-blue-500 dark:bg-blue-900/20 dark:text-blue-400 shrink-0">
                <StickyNote className="h-3.5 w-3.5" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm text-foreground">{note.content}</p>
                <p className="text-[10px] text-muted-foreground mt-1.5">
                  {new Date(note.created_at).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function FollowupsList({
  followups, onComplete, onAdd,
}: {
  followups: any[];
  onComplete: (id: string) => void;
  onAdd: (data: { scheduled_at: string; type: string; notes: string }) => void;
}) {
  const [showForm, setShowForm] = useState(false);
  const [data, setData] = useState({ scheduled_at: "", type: "call", notes: "" });
  const inputCls = "w-full rounded-xl border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/20";

  return (
    <div className="space-y-3">
      {!showForm ? (
        <Button onClick={() => setShowForm(true)} size="sm" variant="outline" className="gap-1.5 rounded-xl">
          <Plus className="h-4 w-4" /> Schedule Follow-up
        </Button>
      ) : (
        <Card className="border-border/60">
          <CardContent className="p-4 space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-medium text-muted-foreground mb-1">Date & Time *</label>
                <input type="datetime-local" value={data.scheduled_at} onChange={(e) => setData((p) => ({ ...p, scheduled_at: e.target.value }))} className={inputCls} />
              </div>
              <div>
                <label className="block text-[11px] font-medium text-muted-foreground mb-1">Type</label>
                <select value={data.type} onChange={(e) => setData((p) => ({ ...p, type: e.target.value }))} className={inputCls}>
                  <option value="call">Call</option>
                  <option value="whatsapp">WhatsApp</option>
                  <option value="email">Email</option>
                  <option value="visit">Visit</option>
                </select>
              </div>
            </div>
            <input type="text" value={data.notes} onChange={(e) => setData((p) => ({ ...p, notes: e.target.value }))} placeholder="Notes (optional)" className={inputCls} />
            <div className="flex gap-2">
              <Button onClick={() => { onAdd(data); setShowForm(false); setData({ scheduled_at: "", type: "call", notes: "" }); }} size="sm" className="gap-1.5" disabled={!data.scheduled_at}>
                <Plus className="h-4 w-4" /> Save
              </Button>
              <Button onClick={() => setShowForm(false)} size="sm" variant="outline">Cancel</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {followups.map((f) => (
        <Card key={f.id} className="border-border/60">
          <CardContent className="p-4 flex items-center gap-3">
            <div className={`h-9 w-9 rounded-xl flex items-center justify-center shrink-0 ${f.status === "completed" ? "bg-green-50 text-green-500 dark:bg-green-900/20 dark:text-green-400" : "bg-amber-50 text-amber-500 dark:bg-amber-900/20 dark:text-amber-400"}`}>
              {f.status === "completed" ? <Check className="h-4 w-4" /> : <Clock className="h-4 w-4" />}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-foreground capitalize">{f.type} follow-up</p>
              <p className="text-xs text-muted-foreground">
                {new Date(f.scheduled_at).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
              </p>
              {f.notes && <p className="text-xs text-muted-foreground mt-0.5">{f.notes}</p>}
            </div>
            {f.status === "pending" && (
              <Button onClick={() => onComplete(f.id)} size="sm" variant="outline" className="gap-1 shrink-0 rounded-xl">
                <Check className="h-3.5 w-3.5" /> Done
              </Button>
            )}
          </CardContent>
        </Card>
      ))}
      {followups.length === 0 && !showForm && <EmptyState text="No follow-ups scheduled" />}
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return <p className="text-sm text-muted-foreground text-center py-10">{text}</p>;
}
