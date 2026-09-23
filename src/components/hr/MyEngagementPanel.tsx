// Employee — Engagement & Helpdesk (embedded in My HR).
//
// The self-service half of the pillar: read announcements (and mark them read,
// which is what fills the HR read counts), raise and follow a helpdesk ticket,
// and recognise a colleague. There is no permission gate here on purpose —
// every authenticated employee gets this.

import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { PageLoader } from "@/components/ui/page-loader";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Megaphone, Headphones, Award, Send, Check, MessageSquare, Pin } from "lucide-react";
import {
  announcementIsLive,
  announcementVisibleTo,
  sortAnnouncements,
  ticketStatusBadge,
  ticketPriorityBadge,
  TICKET_CATEGORIES,
  TICKET_PRIORITIES,
  RECOGNITION_VALUES,
  type Announcement,
  type HelpdeskTicket,
  type HelpdeskMessage,
} from "@/lib/engagement";

interface MyEngagementPanelProps {
  className?: string;
}

interface EmployeeRow {
  id: string;
  display_name: string | null;
}

type Section = "announcements" | "helpdesk" | "recognition";

function formatDateTime(s: string | null): string {
  if (!s) return "—";
  return new Date(s).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
}

export function MyEngagementPanel({ className }: MyEngagementPanelProps) {
  const { user, role } = useAuth();
  const { toast } = useToast();

  const [section, setSection] = useState<Section>("announcements");
  const [loading, setLoading] = useState(true);

  // Announcements
  const [posts, setPosts] = useState<Announcement[]>([]);
  const [readIds, setReadIds] = useState<Set<string>>(new Set());
  const [markingId, setMarkingId] = useState<string | null>(null);

  // Helpdesk — raise
  const [ticketCategory, setTicketCategory] = useState("general");
  const [ticketSubject, setTicketSubject] = useState("");
  const [ticketDescription, setTicketDescription] = useState("");
  const [ticketPriority, setTicketPriority] = useState("normal");
  const [raising, setRaising] = useState(false);

  // Helpdesk — my tickets
  const [myTickets, setMyTickets] = useState<HelpdeskTicket[]>([]);
  const [active, setActive] = useState<HelpdeskTicket | null>(null);
  const [messages, setMessages] = useState<HelpdeskMessage[]>([]);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [reply, setReply] = useState("");
  const [posting, setPosting] = useState(false);

  // Recognition
  const [employees, setEmployees] = useState<EmployeeRow[]>([]);
  const [toEmployee, setToEmployee] = useState("");
  const [recogniseMessage, setRecogniseMessage] = useState("");
  const [valueTag, setValueTag] = useState(RECOGNITION_VALUES[0].value);
  const [isPublic, setIsPublic] = useState(true);
  const [recognising, setRecognising] = useState(false);

  const now = useMemo(() => new Date(), []);

  const fetchAnnouncements = useCallback(async () => {
    if (!user?.id) return;
    const [postsRes, readsRes] = await Promise.all([
      supabase.from("announcements" as any).select("*").order("created_at", { ascending: false }),
      supabase.from("announcement_reads" as any).select("announcement_id").eq("user_id", user.id),
    ]);
    if (!postsRes.error) setPosts((postsRes.data as Announcement[]) ?? []);
    setReadIds(new Set(((readsRes.data as { announcement_id: string }[]) ?? []).map((r) => r.announcement_id)));
  }, [user?.id]);

  const fetchMyTickets = useCallback(async () => {
    if (!user?.id) return;
    const { data, error } = await supabase
      .from("helpdesk_tickets" as any)
      .select("id, ticket_no, category, subject, description, priority, status, assigned_to, created_at, resolved_at")
      .eq("submitted_by", user.id)
      .order("created_at", { ascending: false });
    if (error) {
      toast({ title: "Could not load your tickets", description: error.message, variant: "destructive" });
      setMyTickets([]);
      return;
    }
    setMyTickets((data as HelpdeskTicket[]) ?? []);
  }, [toast, user?.id]);

  const fetchEmployees = useCallback(async () => {
    const { data } = await supabase
      .from("employee_profiles" as any)
      .select("id, display_name")
      .order("display_name");
    setEmployees((data as EmployeeRow[]) ?? []);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    await Promise.all([fetchAnnouncements(), fetchMyTickets(), fetchEmployees()]);
    setLoading(false);
  }, [fetchAnnouncements, fetchMyTickets, fetchEmployees]);

  useEffect(() => { void load(); }, [load]);

  const visibleAnnouncements = useMemo(
    () => sortAnnouncements(posts, now).filter((a) => announcementIsLive(a, now) && announcementVisibleTo(a, role)),
    [posts, now, role],
  );

  const markRead = async (announcement: Announcement) => {
    if (!user?.id || readIds.has(announcement.id)) return;
    setMarkingId(announcement.id);
    const { error } = await supabase
      .from("announcement_reads" as any)
      .upsert(
        { announcement_id: announcement.id, user_id: user.id, read_at: new Date().toISOString() },
        { onConflict: "announcement_id,user_id" },
      );
    setMarkingId(null);
    if (error) {
      toast({ title: "Could not mark as read", description: error.message, variant: "destructive" });
      return;
    }
    setReadIds((prev) => new Set(prev).add(announcement.id));
  };

  const raiseTicket = async () => {
    if (!ticketSubject.trim() || !ticketDescription.trim()) {
      toast({ title: "Subject and description are required", variant: "destructive" });
      return;
    }
    setRaising(true);
    const { error } = await supabase.rpc("create_helpdesk_ticket" as any, {
      _category: ticketCategory,
      _subject: ticketSubject.trim(),
      _description: ticketDescription.trim(),
      _priority: ticketPriority,
    });
    setRaising(false);
    if (error) {
      toast({ title: "Could not raise the ticket", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Ticket raised", description: "HR will get back to you." });
    setTicketSubject("");
    setTicketDescription("");
    setTicketCategory("general");
    setTicketPriority("normal");
    await fetchMyTickets();
  };

  const openTicket = async (ticket: HelpdeskTicket) => {
    setActive(ticket);
    setReply("");
    setMessages([]);
    setMessagesLoading(true);
    const { data, error } = await supabase
      .from("helpdesk_ticket_messages" as any)
      .select("id, ticket_id, author_id, body, is_internal, created_at")
      .eq("ticket_id", ticket.id)
      .eq("is_internal", false)
      .order("created_at", { ascending: true });
    if (error) {
      toast({ title: "Could not load the thread", description: error.message, variant: "destructive" });
    } else {
      setMessages((data as HelpdeskMessage[]) ?? []);
    }
    setMessagesLoading(false);
  };

  const postReply = async () => {
    if (!active || !reply.trim() || !user?.id) return;
    setPosting(true);
    const { error } = await supabase.from("helpdesk_ticket_messages" as any).insert({
      ticket_id: active.id,
      author_id: user.id,
      body: reply.trim(),
      is_internal: false,
    });
    setPosting(false);
    if (error) {
      toast({ title: "Could not post your reply", description: error.message, variant: "destructive" });
      return;
    }
    setReply("");
    await openTicket(active);
  };

  const recognise = async () => {
    if (!user?.id || !toEmployee || !recogniseMessage.trim()) {
      toast({ title: "Pick a colleague and write a message", variant: "destructive" });
      return;
    }
    setRecognising(true);
    const { error } = await supabase.from("recognitions" as any).insert({
      from_user_id: user.id,
      to_employee_profile_id: toEmployee,
      message: recogniseMessage.trim(),
      value_tag: valueTag,
      is_public: isPublic,
    });
    setRecognising(false);
    if (error) {
      toast({ title: "Could not send recognition", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Recognition sent 🎉" });
    setToEmployee("");
    setRecogniseMessage("");
    setIsPublic(true);
  };

  const SECTIONS: { key: Section; label: string; icon: typeof Megaphone }[] = [
    { key: "announcements", label: "Announcements", icon: Megaphone },
    { key: "helpdesk", label: "Helpdesk", icon: Headphones },
    { key: "recognition", label: "Recognise", icon: Award },
  ];

  if (loading) return <PageLoader />;

  return (
    <div className={className ?? "space-y-4"}>
      <div className="flex flex-wrap gap-1 border-b border-border pb-1">
        {SECTIONS.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setSection(key)}
            className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[12.5px] font-medium transition-colors ${
              section === key ? "bg-foreground text-background" : "text-muted-foreground hover:bg-muted/50"
            }`}
          >
            <Icon className="h-3.5 w-3.5" /> {label}
            {key === "announcements" && visibleAnnouncements.length > 0 && (
              <span className="ml-1 text-[10px] opacity-80">{visibleAnnouncements.length}</span>
            )}
          </button>
        ))}
      </div>

      {section === "announcements" && (
        <div className="space-y-3">
          {visibleAnnouncements.length === 0 ? (
            <EmptyState icon={Megaphone} text="No announcements right now." />
          ) : (
            visibleAnnouncements.map((a) => {
              const isRead = readIds.has(a.id);
              return (
                <Card key={a.id} className="border-border/60 shadow-none">
                  <CardContent className="space-y-1.5 p-4">
                    <div className="flex flex-wrap items-center gap-2">
                      {a.is_pinned && <Pin className="h-3.5 w-3.5 text-primary" />}
                      <span className="font-medium text-foreground">{a.title}</span>
                      {!isRead && <Badge className="border-0 bg-primary/15 text-[10px] text-primary">New</Badge>}
                      <span className="ml-auto text-[11px] text-muted-foreground">{formatDateTime(a.published_at)}</span>
                    </div>
                    <p className="whitespace-pre-wrap text-[12.5px] text-foreground/85">{a.body}</p>
                    <div className="flex justify-end pt-1">
                      {isRead ? (
                        <span className="flex items-center gap-1 text-[11px] text-emerald-700">
                          <Check className="h-3.5 w-3.5" /> Read
                        </span>
                      ) : (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => markRead(a)}
                          disabled={markingId === a.id}
                        >
                          <Check className="h-3.5 w-3.5 mr-1" /> {markingId === a.id ? "Saving…" : "Mark read"}
                        </Button>
                      )}
                    </div>
                  </CardContent>
                </Card>
              );
            })
          )}
        </div>
      )}

      {section === "helpdesk" && (
        <div className="space-y-4">
          <Card className="border-border/60 shadow-none">
            <CardContent className="space-y-3 p-4">
              <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
                <Headphones className="h-4 w-4" /> Raise a ticket
              </h3>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <label className="text-[11px] uppercase tracking-wide text-muted-foreground">Category</label>
                  <select
                    value={ticketCategory}
                    onChange={(e) => setTicketCategory(e.target.value)}
                    className="w-full rounded-lg border border-input bg-background px-2.5 py-1.5 text-xs"
                  >
                    {TICKET_CATEGORIES.map((c) => (
                      <option key={c.value} value={c.value}>{c.label}</option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-[11px] uppercase tracking-wide text-muted-foreground">Priority</label>
                  <select
                    value={ticketPriority}
                    onChange={(e) => setTicketPriority(e.target.value)}
                    className="w-full rounded-lg border border-input bg-background px-2.5 py-1.5 text-xs"
                  >
                    {TICKET_PRIORITIES.map((p) => (
                      <option key={p} value={p}>{ticketPriorityBadge(p).label}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="space-y-1">
                <label className="text-[11px] uppercase tracking-wide text-muted-foreground">Subject</label>
                <Input
                  value={ticketSubject}
                  onChange={(e) => setTicketSubject(e.target.value)}
                  placeholder="e.g. Payslip for August missing"
                />
              </div>
              <div className="space-y-1">
                <label className="text-[11px] uppercase tracking-wide text-muted-foreground">Description</label>
                <Textarea
                  value={ticketDescription}
                  onChange={(e) => setTicketDescription(e.target.value)}
                  rows={3}
                  placeholder="Give HR enough detail to act on this."
                />
              </div>
              <div className="flex justify-end">
                <Button size="sm" onClick={raiseTicket} disabled={raising}>
                  <Send className="h-3.5 w-3.5 mr-1" /> {raising ? "Submitting…" : "Submit ticket"}
                </Button>
              </div>
            </CardContent>
          </Card>

          <div className="space-y-2">
            <h3 className="text-sm font-semibold text-foreground">My tickets</h3>
            {myTickets.length === 0 ? (
              <EmptyState icon={Headphones} text="You haven't raised any tickets." />
            ) : (
              <Card className="border-border/60 shadow-none">
                <CardContent className="p-0">
                  <ul className="divide-y divide-border">
                    {myTickets.map((t) => {
                      const status = ticketStatusBadge(t.status);
                      return (
                        <li key={t.id}>
                          <button
                            onClick={() => openTicket(t)}
                            className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-muted/30"
                          >
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-sm font-medium text-foreground">{t.subject}</p>
                              <p className="text-[11px] text-muted-foreground">
                                {t.ticket_no ? `${t.ticket_no} · ` : ""}
                                {TICKET_CATEGORIES.find((c) => c.value === t.category)?.label ?? t.category} ·{" "}
                                {formatDateTime(t.created_at)}
                              </p>
                            </div>
                            <Badge className={`${ticketPriorityBadge(t.priority).className} border-0 text-[10px]`}>
                              {ticketPriorityBadge(t.priority).label}
                            </Badge>
                            <Badge className={`${status.className} border-0 text-[10px]`}>{status.label}</Badge>
                            <MessageSquare className="h-4 w-4 shrink-0 text-muted-foreground" />
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      )}

      {section === "recognition" && (
        <Card className="border-border/60 shadow-none">
          <CardContent className="space-y-3 p-4">
            <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <Award className="h-4 w-4" /> Recognise a colleague
            </h3>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <label className="text-[11px] uppercase tracking-wide text-muted-foreground">Colleague</label>
                <select
                  value={toEmployee}
                  onChange={(e) => setToEmployee(e.target.value)}
                  className="w-full rounded-lg border border-input bg-background px-2.5 py-1.5 text-xs"
                >
                  <option value="">Pick a colleague…</option>
                  {employees.map((e) => (
                    <option key={e.id} value={e.id}>{e.display_name || "Unnamed"}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-[11px] uppercase tracking-wide text-muted-foreground">Value</label>
                <select
                  value={valueTag}
                  onChange={(e) => setValueTag(e.target.value)}
                  className="w-full rounded-lg border border-input bg-background px-2.5 py-1.5 text-xs"
                >
                  {RECOGNITION_VALUES.map((v) => (
                    <option key={v.value} value={v.value}>{v.label}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="space-y-1">
              <label className="text-[11px] uppercase tracking-wide text-muted-foreground">Message</label>
              <Textarea
                value={recogniseMessage}
                onChange={(e) => setRecogniseMessage(e.target.value)}
                rows={3}
                placeholder="What did they do that deserves a shout-out?"
              />
            </div>
            <label className="flex items-center gap-2 text-xs text-foreground">
              <Checkbox checked={isPublic} onCheckedChange={(v) => setIsPublic(v === true)} />
              Share with everyone
            </label>
            <div className="flex justify-end">
              <Button size="sm" onClick={recognise} disabled={recognising}>
                <Award className="h-3.5 w-3.5 mr-1" /> {recognising ? "Sending…" : "Send recognition"}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <Dialog open={!!active} onOpenChange={(open) => !open && setActive(null)}>
        <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
          {active && (
            <>
              <DialogHeader>
                <DialogTitle className="flex flex-wrap items-center gap-2">
                  <Headphones className="h-5 w-5" />
                  <span>{active.subject}</span>
                  <Badge className={`${ticketStatusBadge(active.status).className} border-0 text-[10px]`}>
                    {ticketStatusBadge(active.status).label}
                  </Badge>
                </DialogTitle>
              </DialogHeader>

              {active.description && (
                <p className="rounded-md bg-muted/30 px-3 py-2 text-[12.5px] text-foreground/85">
                  {active.description}
                </p>
              )}

              <div className="space-y-2">
                {messagesLoading ? (
                  <p className="py-6 text-center text-xs text-muted-foreground">Loading thread…</p>
                ) : messages.length === 0 ? (
                  <p className="py-6 text-center text-xs text-muted-foreground">No replies yet.</p>
                ) : (
                  messages.map((m) => (
                    <div
                      key={m.id}
                      className={`rounded-lg border p-2.5 text-[12.5px] ${
                        m.author_id === user?.id ? "border-primary/20 bg-primary/5" : "border-border bg-muted/20"
                      }`}
                    >
                      <div className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">
                        {m.author_id === user?.id ? "You" : "HR"} · {formatDateTime(m.created_at)}
                      </div>
                      <p className="whitespace-pre-wrap text-foreground/90">{m.body}</p>
                    </div>
                  ))
                )}
              </div>

              <div className="space-y-2 rounded-lg border border-border p-3">
                <Textarea
                  value={reply}
                  onChange={(e) => setReply(e.target.value)}
                  rows={2}
                  placeholder="Add a reply…"
                />
                <div className="flex justify-end">
                  <Button size="sm" onClick={postReply} disabled={posting || !reply.trim()}>
                    <Send className="h-3.5 w-3.5 mr-1" /> {posting ? "Posting…" : "Post"}
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

function EmptyState({ icon: Icon, text }: { icon: typeof Megaphone; text: string }) {
  return (
    <div className="rounded-xl bg-card card-shadow p-10 text-center">
      <Icon className="mx-auto mb-3 h-9 w-9 text-muted-foreground/30" />
      <p className="text-sm text-muted-foreground">{text}</p>
    </div>
  );
}

export default MyEngagementPanel;
