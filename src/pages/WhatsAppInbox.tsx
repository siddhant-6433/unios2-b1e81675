import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  MessageSquare, Search, Send, Loader2, User, Clock, ExternalLink, ArrowLeft,
} from "lucide-react";

interface Conversation {
  phone: string;
  lead_id: string | null;
  lead_name: string | null;
  lead_stage: string | null;
  last_message: string | null;
  last_direction: string;
  last_message_at: string;
  unread_count: number;
}

interface Message {
  id: string;
  direction: string;
  content: string | null;
  message_type: string;
  status: string;
  template_key: string | null;
  created_at: string;
}

const STAGE_LABELS: Record<string, string> = {
  new_lead: "New Lead", application_in_progress: "App In Progress",
  application_fee_paid: "Fee Paid", application_submitted: "Submitted",
  offer_sent: "Offer Sent", admitted: "Admitted", rejected: "Rejected",
};

const WhatsAppInbox = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { user } = useAuth();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [selectedPhone, setSelectedPhone] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [reply, setReply] = useState("");
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Fetch conversations
  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("whatsapp_conversations" as any)
        .select("*")
        .order("last_message_at", { ascending: false });
      if (data) setConversations(data as any);
      setLoading(false);
    })();
  }, []);

  // Fetch messages for selected conversation
  useEffect(() => {
    if (!selectedPhone) { setMessages([]); return; }
    (async () => {
      const { data } = await supabase
        .from("whatsapp_messages" as any)
        .select("id, direction, content, message_type, status, template_key, created_at")
        .eq("phone", selectedPhone)
        .order("created_at", { ascending: true })
        .limit(200);
      if (data) setMessages(data as any);

      // Mark as read
      await supabase
        .from("whatsapp_messages" as any)
        .update({ is_read: true, read_at: new Date().toISOString() } as any)
        .eq("phone", selectedPhone)
        .eq("direction", "inbound")
        .eq("is_read", false);

      // Update local unread count
      setConversations(prev =>
        prev.map(c => c.phone === selectedPhone ? { ...c, unread_count: 0 } : c)
      );
    })();
  }, [selectedPhone]);

  // Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Realtime subscription
  useEffect(() => {
    const channel = supabase
      .channel("whatsapp-inbox")
      .on("postgres_changes", {
        event: "INSERT",
        schema: "public",
        table: "whatsapp_messages",
      }, (payload: any) => {
        const msg = payload.new as Message & { phone: string; direction: string };
        // Add to current thread if matching
        if (msg.phone === selectedPhone) {
          setMessages(prev => [...prev, msg]);
        }
        // Update conversation list
        setConversations(prev => {
          const existing = prev.find(c => c.phone === msg.phone);
          if (existing) {
            return prev.map(c =>
              c.phone === msg.phone
                ? {
                    ...c,
                    last_message: msg.content,
                    last_direction: msg.direction,
                    last_message_at: msg.created_at,
                    unread_count: msg.direction === "inbound" && msg.phone !== selectedPhone
                      ? c.unread_count + 1 : c.unread_count,
                  }
                : c
            ).sort((a, b) => new Date(b.last_message_at).getTime() - new Date(a.last_message_at).getTime());
          }
          return prev;
        });
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [selectedPhone]);

  const handleSendReply = async () => {
    if (!reply.trim() || !selectedPhone) return;
    setSending(true);

    const conv = conversations.find(c => c.phone === selectedPhone);

    const { error } = await supabase.functions.invoke("whatsapp-reply", {
      body: {
        phone: selectedPhone,
        message: reply.trim(),
        lead_id: conv?.lead_id || null,
      },
    });

    if (error) {
      toast({ title: "Failed to send", description: error.message, variant: "destructive" });
    } else {
      setReply("");
    }
    setSending(false);
  };

  const selectedConv = conversations.find(c => c.phone === selectedPhone);
  const filtered = conversations.filter(c =>
    !search || (c.lead_name || "").toLowerCase().includes(search.toLowerCase()) || c.phone.includes(search)
  );

  const totalUnread = conversations.reduce((s, c) => s + c.unread_count, 0);

  const formatTime = (iso: string) => {
    const d = new Date(iso);
    const now = new Date();
    const isToday = d.toDateString() === now.toDateString();
    if (isToday) return d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true });
    return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
  };

  if (loading) return <div className="flex h-64 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;

  return (
    <div className="animate-fade-in">
      <div className="mb-4">
        <h1 className="text-2xl font-bold text-foreground">WhatsApp Inbox</h1>
        <p className="text-sm text-muted-foreground mt-1">
          {totalUnread > 0 ? `${totalUnread} unread message${totalUnread !== 1 ? "s" : ""}` : "All messages read"}
        </p>
      </div>

      <Card className="border-border/60 shadow-none overflow-hidden">
        <div className="flex h-[calc(100vh-180px)]">
          {/* Conversation list */}
          <div className={`w-full sm:w-80 lg:w-96 border-r border-border flex flex-col ${selectedPhone ? "hidden sm:flex" : "flex"}`}>
            <div className="p-3 border-b border-border">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <input
                  type="text"
                  placeholder="Search conversations..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="w-full rounded-lg border border-input bg-background py-2 pl-9 pr-3 text-xs focus:outline-none focus:ring-1 focus:ring-ring/20"
                />
              </div>
            </div>
            <div className="flex-1 overflow-y-auto">
              {filtered.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-8">No conversations yet</p>
              ) : (
                filtered.map((c) => (
                  <button
                    key={c.phone}
                    onClick={() => setSelectedPhone(c.phone)}
                    className={`w-full text-left px-4 py-3 border-b border-border/40 hover:bg-muted/30 transition-colors ${selectedPhone === c.phone ? "bg-muted/50" : ""}`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <span className="text-sm font-medium text-foreground truncate">{c.lead_name || c.phone}</span>
                          {c.unread_count > 0 && (
                            <span className="flex h-4 min-w-[16px] items-center justify-center rounded-full bg-green-500 px-1 text-[9px] font-bold text-white">
                              {c.unread_count}
                            </span>
                          )}
                        </div>
                        {c.lead_name && <p className="text-[10px] text-muted-foreground">{c.phone}</p>}
                        <p className="text-xs text-muted-foreground truncate mt-0.5">
                          {c.last_direction === "outbound" ? "You: " : ""}{c.last_message || "[media]"}
                        </p>
                      </div>
                      <span className="text-[10px] text-muted-foreground whitespace-nowrap">{formatTime(c.last_message_at)}</span>
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>

          {/* Message thread */}
          <div className={`flex-1 flex flex-col ${!selectedPhone ? "hidden sm:flex" : "flex"}`}>
            {!selectedPhone ? (
              <div className="flex-1 flex items-center justify-center text-muted-foreground">
                <div className="text-center">
                  <MessageSquare className="h-12 w-12 mx-auto mb-3 opacity-30" />
                  <p className="text-sm">Select a conversation</p>
                </div>
              </div>
            ) : (
              <>
                {/* Thread header */}
                <div className="flex items-center gap-3 px-4 py-3 border-b border-border">
                  <Button variant="ghost" size="icon" className="sm:hidden h-8 w-8" onClick={() => setSelectedPhone(null)}>
                    <ArrowLeft className="h-4 w-4" />
                  </Button>
                  <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/10">
                    <User className="h-4 w-4 text-primary" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-foreground truncate">{selectedConv?.lead_name || selectedPhone}</p>
                    <p className="text-[10px] text-muted-foreground">{selectedPhone}</p>
                  </div>
                  {selectedConv?.lead_id && (
                    <Button variant="ghost" size="sm" className="gap-1 text-xs" onClick={() => navigate(`/admissions/${selectedConv.lead_id}`)}>
                      View Lead <ExternalLink className="h-3 w-3" />
                    </Button>
                  )}
                </div>

                {/* Messages */}
                <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
                  {messages.map((m) => (
                    <div key={m.id} className={`flex ${m.direction === "outbound" ? "justify-end" : "justify-start"}`}>
                      <div className={`max-w-[75%] rounded-2xl px-3 py-2 ${
                        m.direction === "outbound"
                          ? "bg-primary text-primary-foreground rounded-br-md"
                          : "bg-muted text-foreground rounded-bl-md"
                      }`}>
                        {m.template_key && (
                          <p className="text-[9px] opacity-70 mb-0.5">Template: {m.template_key}</p>
                        )}
                        <p className="text-sm whitespace-pre-wrap">{m.content || `[${m.message_type}]`}</p>
                        <div className="flex items-center justify-end gap-1 mt-0.5">
                          <span className="text-[9px] opacity-60">
                            {new Date(m.created_at).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true })}
                          </span>
                          {m.direction === "outbound" && (
                            <span className="text-[9px] opacity-50">{m.status === "read" ? "✓✓" : m.status === "delivered" ? "✓✓" : "✓"}</span>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                  <div ref={messagesEndRef} />
                </div>

                {/* Reply composer */}
                <div className="px-4 py-3 border-t border-border">
                  <form
                    onSubmit={(e) => { e.preventDefault(); handleSendReply(); }}
                    className="flex items-center gap-2"
                  >
                    <input
                      type="text"
                      value={reply}
                      onChange={(e) => setReply(e.target.value)}
                      placeholder="Type a message..."
                      className="flex-1 rounded-xl border border-input bg-background px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring/20"
                    />
                    <Button type="submit" disabled={!reply.trim() || sending} size="icon" className="rounded-xl h-10 w-10">
                      {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                    </Button>
                  </form>
                  <p className="text-[10px] text-muted-foreground mt-1">Free-form replies only work within 24hrs of last inbound message. Use templates otherwise.</p>
                </div>
              </>
            )}
          </div>
        </div>
      </Card>
    </div>
  );
};

export default WhatsAppInbox;
