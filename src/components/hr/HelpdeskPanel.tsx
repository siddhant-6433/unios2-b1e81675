// HR — Helpdesk triage.
//
// One queue over `helpdesk_ticket_inbox`: filter by status and priority, open a
// ticket, read the thread, reply (optionally as an internal note the employee
// never sees), then move it along with update_helpdesk_ticket. Status, assignee
// and the note travel together in one RPC so a triage action is atomic.

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
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Headphones, MessageSquare, Send, Lock, User2 } from "lucide-react";
import {
  priorityRank,
  ticketStatusBadge,
  ticketPriorityBadge,
  TICKET_PRIORITIES,
  TICKET_STATUSES,
  type HelpdeskTicket,
  type HelpdeskMessage,
} from "@/lib/engagement";

interface HelpdeskPanelProps {
  className?: string;
}

interface StaffRow {
  user_id: string;
  display_name: string | null;
}

const CATEGORY_LABEL: Record<string, string> = {
  general: "General",
  payroll: "Payroll",
  attendance: "Attendance",
  leave: "Leave",
  documents: "Documents",
  it: "IT",
  facilities: "Facilities",
  grievance: "Grievance",
};

function formatDateTime(s: string | null): string {
  if (!s) return "—";
  return new Date(s).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
}

export function HelpdeskPanel({ className }: HelpdeskPanelProps) {
  const { toast } = useToast();
  const { user } = useAuth();
  const { can, loading: permissionsLoading } = usePermissions();
  const canManage = can("hr", "helpdesk_manage");

  const [tickets, setTickets] = useState<HelpdeskTicket[]>([]);
  const [staff, setStaff] = useState<StaffRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [priorityFilter, setPriorityFilter] = useState<string>("all");

  // Thread dialog
  const [active, setActive] = useState<HelpdeskTicket | null>(null);
  const [messages, setMessages] = useState<HelpdeskMessage[]>([]);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [reply, setReply] = useState("");
  const [internal, setInternal] = useState(false);
  const [posting, setPosting] = useState(false);

  // Triage controls
  const [draftStatus, setDraftStatus] = useState("");
  const [draftAssignee, setDraftAssignee] = useState("");
  const [draftNote, setDraftNote] = useState("");
  const [triaging, setTriaging] = useState(false);

  const fetchTickets = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("helpdesk_ticket_inbox" as any)
      .select("id, ticket_no, employee_name, category, subject, priority, status, assigned_to, assigned_to_name, message_count, created_at")
      .order("created_at", { ascending: false });
    if (error) {
      toast({ title: "Failed to load tickets", description: error.message, variant: "destructive" });
      setTickets([]);
    } else {
      setTickets((data as HelpdeskTicket[]) ?? []);
    }
    setLoading(false);
  }, [toast]);

  useEffect(() => {
    void fetchTickets();
    void supabase
      .from("profiles" as any)
      .select("user_id, display_name")
      .order("display_name")
      .then(({ data }) => setStaff((data as StaffRow[]) ?? []));
  }, [fetchTickets]);

  const staffName = useCallback(
    (userId: string | null) => {
      if (!userId) return null;
      return staff.find((s) => s.user_id === userId)?.display_name ?? null;
    },
    [staff],
  );

  const filtered = useMemo(() => {
    const rows = tickets.filter(
      (t) =>
        (statusFilter === "all" || t.status === statusFilter) &&
        (priorityFilter === "all" || t.priority === priorityFilter),
    );
    // Urgent first within the current filter, then newest.
    return rows.sort((a, b) => {
      const rank = priorityRank(b.priority) - priorityRank(a.priority);
      if (rank !== 0) return rank;
      return Date.parse(b.created_at) - Date.parse(a.created_at);
    });
  }, [tickets, statusFilter, priorityFilter]);

  const fetchMessages = useCallback(
    async (ticketId: string) => {
      setMessagesLoading(true);
      const { data, error } = await supabase
        .from("helpdesk_ticket_messages" as any)
        .select("id, ticket_id, author_id, body, is_internal, created_at")
        .eq("ticket_id", ticketId)
        .order("created_at", { ascending: true });
      if (error) {
        toast({ title: "Could not load the thread", description: error.message, variant: "destructive" });
        setMessages([]);
      } else {
        setMessages((data as HelpdeskMessage[]) ?? []);
      }
      setMessagesLoading(false);
    },
    [toast],
  );

  const openTicket = (ticket: HelpdeskTicket) => {
    setActive(ticket);
    setDraftStatus(ticket.status);
    setDraftAssignee(ticket.assigned_to ?? "");
    setDraftNote("");
    setReply("");
    setInternal(false);
    setMessages([]);
    void fetchMessages(ticket.id);
  };

  const postReply = async () => {
    if (!active || !reply.trim()) return;
    setPosting(true);
    const { error } = await supabase.from("helpdesk_ticket_messages" as any).insert({
      ticket_id: active.id,
      author_id: user?.id ?? null,
      body: reply.trim(),
      is_internal: internal,
    });
    setPosting(false);
    if (error) {
      toast({ title: "Could not post the reply", description: error.message, variant: "destructive" });
      return;
    }
    setReply("");
    setInternal(false);
    await fetchMessages(active.id);
  };

  const saveTriage = async () => {
    if (!active) return;
    setTriaging(true);
    const { error } = await supabase.rpc("update_helpdesk_ticket" as any, {
      _ticket_id: active.id,
      _status: draftStatus || null,
      _assigned_to: draftAssignee || null,
      _note: draftNote.trim() || null,
    });
    setTriaging(false);
    if (error) {
      toast({ title: "Could not update the ticket", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Ticket updated" });
    setDraftNote("");
    setActive({
      ...active,
      status: draftStatus || active.status,
      assigned_to: draftAssignee || null,
      assigned_to_name: staffName(draftAssignee) ?? undefined,
    });
    await Promise.all([fetchTickets(), fetchMessages(active.id)]);
  };

  if (permissionsLoading) return <PageLoader />;

  if (!canManage) {
    return (
      <div className="rounded-xl bg-card card-shadow px-4 py-12 text-center">
        <p className="text-sm text-foreground">Helpdesk is restricted</p>
        <p className="text-xs text-muted-foreground mt-1">You need the “Manage helpdesk” permission.</p>
      </div>
    );
  }

  return (
    <div className={className ?? "space-y-5 animate-fade-in"}>
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          aria-label="Filter by status"
          className="rounded-lg border border-input bg-background px-2.5 py-1.5 text-xs"
        >
          <option value="all">All statuses</option>
          {TICKET_STATUSES.map((s) => (
            <option key={s} value={s}>{ticketStatusBadge(s).label}</option>
          ))}
        </select>
        <select
          value={priorityFilter}
          onChange={(e) => setPriorityFilter(e.target.value)}
          aria-label="Filter by priority"
          className="rounded-lg border border-input bg-background px-2.5 py-1.5 text-xs"
        >
          <option value="all">All priorities</option>
          {TICKET_PRIORITIES.map((p) => (
            <option key={p} value={p}>{ticketPriorityBadge(p).label}</option>
          ))}
        </select>
        <span className="text-[11px] text-muted-foreground">{filtered.length} tickets</span>
      </div>

      <Card className="border-border/60 shadow-none overflow-hidden">
        <CardContent className="p-0">
          {loading ? (
            <div className="flex h-48 items-center justify-center">
              <OrbLoader state="searching" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <Headphones className="mb-2 h-10 w-10 text-muted-foreground/40" />
              <p className="text-sm text-muted-foreground">No tickets in this view.</p>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/20">
                  {["Ticket", "Employee", "Category", "Subject", "Priority", "Status", "Assigned", ""].map((h) => (
                    <th key={h} className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((t) => {
                  const status = ticketStatusBadge(t.status);
                  const priority = ticketPriorityBadge(t.priority);
                  return (
                    <tr
                      key={t.id}
                      className="cursor-pointer border-b border-border last:border-0 hover:bg-muted/30"
                      onClick={() => openTicket(t)}
                    >
                      <td className="px-4 py-3 font-mono text-[11px] text-muted-foreground">{t.ticket_no ?? "—"}</td>
                      <td className="px-4 py-3 text-foreground">{t.employee_name || "—"}</td>
                      <td className="px-4 py-3 text-foreground/80">{CATEGORY_LABEL[t.category] ?? t.category}</td>
                      <td className="max-w-[280px] px-4 py-3">
                        <p className="truncate text-foreground" title={t.subject}>{t.subject}</p>
                        {!!t.message_count && (
                          <span className="text-[10px] text-muted-foreground">{t.message_count} messages</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <Badge className={`${priority.className} border-0 text-[10px]`}>{priority.label}</Badge>
                      </td>
                      <td className="px-4 py-3">
                        <Badge className={`${status.className} border-0 text-[10px]`}>{status.label}</Badge>
                      </td>
                      <td className="px-4 py-3 text-[12px] text-muted-foreground">
                        {t.assigned_to_name || staffName(t.assigned_to) || "Unassigned"}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <MessageSquare className="inline h-4 w-4 text-muted-foreground" />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!active} onOpenChange={(open) => !open && setActive(null)}>
        <DialogContent className="max-h-[85vh] max-w-3xl overflow-y-auto">
          {active && (
            <>
              <DialogHeader>
                <DialogTitle className="flex flex-wrap items-center gap-2">
                  <Headphones className="h-5 w-5" />
                  <span className="font-mono text-xs text-muted-foreground">{active.ticket_no ?? "Ticket"}</span>
                  <span>{active.subject}</span>
                  <Badge className={`${ticketPriorityBadge(active.priority).className} border-0 text-[10px]`}>
                    {ticketPriorityBadge(active.priority).label}
                  </Badge>
                  <Badge className={`${ticketStatusBadge(active.status).className} border-0 text-[10px]`}>
                    {ticketStatusBadge(active.status).label}
                  </Badge>
                </DialogTitle>
              </DialogHeader>

              <div className="grid gap-1 text-[12px] text-muted-foreground sm:grid-cols-2">
                <span><User2 className="mr-1 inline h-3.5 w-3.5" />{active.employee_name || "—"}</span>
                <span>{CATEGORY_LABEL[active.category] ?? active.category} · raised {formatDateTime(active.created_at)}</span>
              </div>

              {/* Thread */}
              <div className="space-y-2">
                {messagesLoading ? (
                  <p className="py-6 text-center text-xs text-muted-foreground">Loading thread…</p>
                ) : messages.length === 0 ? (
                  <p className="py-6 text-center text-xs text-muted-foreground">No messages yet.</p>
                ) : (
                  messages.map((m) => (
                    <div
                      key={m.id}
                      className={`rounded-lg border p-2.5 text-[12.5px] ${
                        m.is_internal ? "border-amber-500/30 bg-amber-500/5" : "border-border bg-muted/20"
                      }`}
                    >
                      <div className="mb-1 flex items-center gap-2 text-[10px] uppercase tracking-wide text-muted-foreground">
                        <span>{m.author_id === user?.id ? "You" : staffName(m.author_id) || "Employee"}</span>
                        <span>· {formatDateTime(m.created_at)}</span>
                        {m.is_internal && (
                          <span className="flex items-center gap-1 text-amber-700">
                            <Lock className="h-3 w-3" /> Internal note
                          </span>
                        )}
                      </div>
                      <p className="whitespace-pre-wrap text-foreground/90">{m.body}</p>
                    </div>
                  ))
                )}
              </div>

              {/* Reply */}
              <div className="space-y-2 rounded-lg border border-border p-3">
                <Textarea
                  value={reply}
                  onChange={(e) => setReply(e.target.value)}
                  rows={2}
                  placeholder="Reply to the employee…"
                />
                <div className="flex items-center gap-2">
                  <label className="flex items-center gap-2 text-xs text-foreground">
                    <Checkbox checked={internal} onCheckedChange={(v) => setInternal(v === true)} />
                    <Lock className="h-3.5 w-3.5" /> Internal note
                  </label>
                  <div className="flex-1" />
                  <Button size="sm" onClick={postReply} disabled={posting || !reply.trim()}>
                    <Send className="h-3.5 w-3.5 mr-1" /> {posting ? "Posting…" : "Post"}
                  </Button>
                </div>
              </div>

              {/* Triage */}
              <div className="space-y-2 rounded-lg border border-border p-3">
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Triage</p>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1">
                    <label className="text-[11px] text-muted-foreground">Status</label>
                    <select
                      value={draftStatus}
                      onChange={(e) => setDraftStatus(e.target.value)}
                      className="w-full rounded-lg border border-input bg-background px-2.5 py-1.5 text-xs"
                    >
                      {TICKET_STATUSES.map((s) => (
                        <option key={s} value={s}>{ticketStatusBadge(s).label}</option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-1">
                    <label className="text-[11px] text-muted-foreground">Assign to</label>
                    <select
                      value={draftAssignee}
                      onChange={(e) => setDraftAssignee(e.target.value)}
                      className="w-full rounded-lg border border-input bg-background px-2.5 py-1.5 text-xs"
                    >
                      <option value="">Unassigned</option>
                      {staff.map((s) => (
                        <option key={s.user_id} value={s.user_id}>{s.display_name || s.user_id}</option>
                      ))}
                    </select>
                  </div>
                </div>
                <Textarea
                  value={draftNote}
                  onChange={(e) => setDraftNote(e.target.value)}
                  rows={2}
                  placeholder="Optional note recorded with this update…"
                />
                <div className="flex justify-end">
                  <Button size="sm" onClick={saveTriage} disabled={triaging}>
                    {triaging ? "Saving…" : "Save update"}
                  </Button>
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default HelpdeskPanel;
