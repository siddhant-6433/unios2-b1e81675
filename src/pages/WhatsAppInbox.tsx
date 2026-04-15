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
  FileDown, AlertTriangle, LayoutTemplate, X, Check, ChevronDown, Zap,
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
  media_url: string | null;
  created_at: string;
}

const STAGE_LABELS: Record<string, string> = {
  new_lead: "New Lead", application_in_progress: "App In Progress",
  application_fee_paid: "Fee Paid", application_submitted: "Submitted",
  offer_sent: "Offer Sent", admitted: "Admitted", rejected: "Rejected",
};

const QUICK_REPLIES = [
  { label: "Greeting", text: "Hi! 👋 Welcome to NIMT Educational Institutions. How can I help you today?" },
  { label: "Ask course", text: "Which course are you interested in? We offer Engineering, Management, Law, Pharmacy, Nursing, Education and more." },
  { label: "Share portal", text: "You can apply online at our application portal:\nhttps://uni.nimt.ac.in/apply/nimt" },
  { label: "Fee info", text: "Our fee structure varies by course and campus. Could you tell us which course you're interested in? A counsellor will share the detailed fee breakdown." },
  { label: "Schedule visit", text: "We'd love to have you visit our campus! 🏫 Please share your preferred date and the campus you'd like to visit." },
  { label: "Counsellor connect", text: "Our counsellor will connect with you shortly. Thank you for your patience!" },
  { label: "Documents needed", text: "For admission, please keep these documents ready:\n📄 10th & 12th marksheets\n📄 Aadhaar card\n📄 Passport-size photo\n📄 Transfer certificate" },
  { label: "Thank you", text: "Thank you for reaching out! 😊 Feel free to contact us anytime if you have more questions." },
];

const INBOX_TEMPLATES = [
  {
    key: "lead_welcome",
    label: "Lead Welcome",
    description: "Welcome message with course info",
    params: ["student_name", "course_name"],
    preview: "Hi {{student_name}}, welcome to NIMT Educational Institutions! We're excited about your interest in {{course_name}}. Our counsellor will connect with you shortly to guide you through the admission process.",
  },
  {
    key: "visit_confirmation",
    label: "Visit Confirmation",
    description: "Confirm scheduled campus visit",
    params: ["student_name", "visit_date", "campus_name"],
    preview: "Hi {{student_name}}, your campus visit is confirmed for {{visit_date}} at {{campus_name}}. We look forward to welcoming you! Please carry a valid ID.",
  },
  {
    key: "visit_reminder_24hr",
    label: "Visit Reminder (24hr)",
    description: "Remind about upcoming visit",
    params: ["student_name", "visit_date"],
    preview: "Hi {{student_name}}, this is a reminder that your campus visit is scheduled for {{visit_date}}. See you soon!",
  },
  {
    key: "application_received",
    label: "Application Received",
    description: "Acknowledge application submission",
    params: ["student_name", "application_id"],
    preview: "Hi {{student_name}}, we've received your application (ID: {{application_id}}). Our admissions team will review it and get back to you shortly.",
  },
  {
    key: "fee_reminder",
    label: "Fee Reminder",
    description: "Remind about pending fee payment",
    params: ["student_name", "amount", "due_date"],
    preview: "Hi {{student_name}}, this is a reminder that your fee of ₹{{amount}} is due by {{due_date}}. Please complete the payment to secure your seat.",
  },
  {
    key: "course_details",
    label: "Course Details + Brochure",
    description: "Send course information and brochure",
    params: ["student_name", "course_name"],
    preview: "Hi {{student_name}}, here are the details for {{course_name}} at NIMT Educational Institutions. Check out the brochure and feel free to reach out with any questions!",
  },
];

const WhatsAppInbox = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { user, role, profile } = useAuth();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [selectedPhone, setSelectedPhone] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [reply, setReply] = useState("");
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);
  const [showTemplatePicker, setShowTemplatePicker] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState<string | null>(null);
  const [sendingTemplate, setSendingTemplate] = useState(false);
  const [showQuickReplies, setShowQuickReplies] = useState(false);
  const [inboxTab, setInboxTab] = useState<"leads" | "staff" | "all">("leads");
  const [staffNames, setStaffNames] = useState<Record<string, string>>({});
  const [staffConvs, setStaffConvs] = useState<Conversation[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Fetch conversations + build staff list
  useEffect(() => {
    (async () => {
      let convQuery = supabase
        .from("whatsapp_conversations" as any)
        .select("*")
        .order("last_message_at", { ascending: false })
        .limit(50);
      // Counsellors only see conversations for their assigned leads
      if (role === "counsellor" && profile?.id) {
        convQuery = convQuery.eq("counsellor_id", profile.id);
      }
      const { data } = await convQuery;
      if (data) setConversations(data as any);

      // Fetch ALL staff/counsellor profiles with phone numbers
      const { data: staffProfiles } = await supabase
        .from("profiles")
        .select("phone, display_name, user_id")
        .not("phone", "is", null);

      const { data: staffRoles } = await supabase
        .from("user_roles")
        .select("user_id, role")
        .in("role", ["super_admin", "campus_admin", "principal", "admission_head", "counsellor", "accountant", "faculty", "teacher", "data_entry", "office_assistant", "hostel_warden"]);

      const staffUserIds = new Set((staffRoles || []).map((r: any) => r.user_id));
      const nameMap: Record<string, string> = {};
      const syntheticConvs: Conversation[] = [];
      const existingPhones = new Set((data || []).map((c: any) => c.phone));

      for (const p of (staffProfiles || [])) {
        if (!p.phone || !staffUserIds.has(p.user_id)) continue;
        const digits = p.phone.replace(/\D/g, "");
        if (p.display_name) nameMap[digits] = p.display_name;

        // If no existing conversation for this staff, create a synthetic one
        if (!existingPhones.has(digits)) {
          syntheticConvs.push({
            phone: digits,
            lead_id: null,
            lead_name: null,
            lead_stage: null,
            last_message: null,
            last_direction: "outbound",
            last_message_at: new Date().toISOString(),
            unread_count: 0,
          });
        }
      }

      setStaffNames(nameMap);
      setStaffConvs(syntheticConvs);
      setLoading(false);
    })();
  }, []);

  // Fetch messages for selected conversation
  useEffect(() => {
    if (!selectedPhone) { setMessages([]); return; }
    (async () => {
      const { data } = await supabase
        .from("whatsapp_messages" as any)
        .select("id, direction, content, message_type, status, template_key, media_url, created_at")
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

  const handleSendTemplate = async () => {
    if (!selectedTemplate || !selectedPhone) return;
    setSendingTemplate(true);

    const conv = conversations.find(c => c.phone === selectedPhone);
    const leadName = conv?.lead_name || "Student";

    let params: string[] = [];
    switch (selectedTemplate) {
      case "lead_welcome": params = [leadName, "your selected course"]; break;
      case "visit_confirmation": params = [leadName, "your scheduled date", "our campus"]; break;
      case "visit_reminder_24hr": params = [leadName, "tomorrow"]; break;
      case "application_received": params = [leadName, "N/A"]; break;
      case "fee_reminder": params = [leadName, "the pending amount", "the due date"]; break;
      case "course_details": params = [leadName, "your selected course"]; break;
    }

    const { data, error } = await supabase.functions.invoke("whatsapp-send", {
      body: {
        template_key: selectedTemplate,
        phone: selectedPhone,
        params,
        lead_id: conv?.lead_id || null,
      },
    });

    if (error) {
      const errBody = (error as any).data;
      let detail = error.message;
      if (errBody) {
        detail = typeof errBody === "string" ? errBody : errBody?.error || errBody?.meta_error || errBody?.message || JSON.stringify(errBody);
      }
      console.error("whatsapp-send template error:", { error, errBody, data });
      toast({ title: "Failed to send template", description: detail, variant: "destructive" });
    } else if (data?.error) {
      toast({ title: "Failed to send template", description: data.error, variant: "destructive" });
    } else {
      toast({ title: "Template sent" });
      setSelectedTemplate(null);
      setShowTemplatePicker(false);
    }
    setSendingTemplate(false);
  };

  // Build preview text with populated variables
  const getTemplatePreview = (templateKey: string): string => {
    const tmpl = INBOX_TEMPLATES.find(t => t.key === templateKey);
    if (!tmpl) return "";
    const conv = conversations.find(c => c.phone === selectedPhone);
    const leadName = conv?.lead_name || "Student";

    const values: Record<string, string> = {
      student_name: leadName,
      course_name: "your selected course",
      visit_date: "your scheduled date",
      campus_name: "our campus",
      application_id: "N/A",
      amount: "the pending amount",
      due_date: "the due date",
    };

    return tmpl.preview.replace(/\{\{(\w+)\}\}/g, (_, key) => values[key] || `{{${key}}}`);
  };

  const selectedConv = conversations.find(c => c.phone === selectedPhone);

  // Resolve display name: lead name > staff name > phone
  const getDisplayName = (c: Conversation) => c.lead_name || staffNames[c.phone] || c.phone;
  const isStaffConv = (c: Conversation) => !c.lead_id && !!staffNames[c.phone];

  // Combine real conversations + synthetic staff entries
  const allStaffPhones = new Set(Object.keys(staffNames));
  const allConvs = inboxTab === "staff"
    ? [...conversations.filter(c => !c.lead_id && allStaffPhones.has(c.phone)), ...staffConvs]
    : conversations;

  const filtered = allConvs.filter(c => {
    // Tab filter
    if (inboxTab === "leads" && !c.lead_id) return false;
    if (inboxTab === "staff" && !allStaffPhones.has(c.phone)) return false;
    // Search
    if (search) {
      const q = search.toLowerCase();
      return getDisplayName(c).toLowerCase().includes(q) || c.phone.includes(q);
    }
    return true;
  });

  const leadConvCount = conversations.filter(c => c.lead_id).length;
  const staffConvCount = allStaffPhones.size;
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
            {/* Tab filter */}
            <div className="flex border-b border-border">
              {([
                { key: "leads" as const, label: "Leads", count: leadConvCount },
                { key: "staff" as const, label: "Staff", count: staffConvCount },
                { key: "all" as const, label: "All", count: conversations.length },
              ]).map((t) => (
                <button
                  key={t.key}
                  onClick={() => setInboxTab(t.key)}
                  className={`flex-1 py-2 text-[11px] font-medium transition-colors border-b-2 ${
                    inboxTab === t.key
                      ? "border-primary text-primary"
                      : "border-transparent text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {t.label} ({t.count})
                </button>
              ))}
            </div>
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
                          <span className="text-sm font-medium text-foreground truncate">{getDisplayName(c)}</span>
                          {isStaffConv(c) && (
                            <Badge variant="outline" className="text-[8px] px-1 py-0 h-3.5 border-violet-300 text-violet-600 dark:text-violet-400">Staff</Badge>
                          )}
                          {c.unread_count > 0 && (
                            <span className="flex h-4 min-w-[16px] items-center justify-center rounded-full bg-green-500 px-1 text-[9px] font-bold text-white">
                              {c.unread_count}
                            </span>
                          )}
                        </div>
                        <p className="text-[10px] text-muted-foreground">{c.phone}</p>
                        <p className="text-xs text-muted-foreground truncate mt-0.5">
                          {c.last_direction === "outbound" ? "You: " : ""}{(c.last_message || "[media]").replace(/\\n/g, " ")}
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
                        {/* Media rendering */}
                        {m.media_url && m.message_type === "image" ? (
                          /^\d/.test(m.media_url) ? (
                            <p className="text-sm italic opacity-70">[Media - tap to view]</p>
                          ) : (
                            <img src={m.media_url} alt="image" className="rounded-lg max-w-[240px] mb-1" loading="lazy" />
                          )
                        ) : m.media_url && m.message_type === "video" ? (
                          /^\d/.test(m.media_url) ? (
                            <p className="text-sm italic opacity-70">[Media - tap to view]</p>
                          ) : (
                            <video src={m.media_url} controls className="rounded-lg max-w-[240px] mb-1" />
                          )
                        ) : m.media_url && m.message_type === "audio" ? (
                          /^\d/.test(m.media_url) ? (
                            <p className="text-sm italic opacity-70">[Media - tap to view]</p>
                          ) : (
                            <audio src={m.media_url} controls className="mb-1 max-w-[240px]" />
                          )
                        ) : m.media_url && m.message_type === "document" ? (
                          /^\d/.test(m.media_url) ? (
                            <p className="text-sm italic opacity-70">[Media - tap to view]</p>
                          ) : (
                            <a href={m.media_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-sm underline mb-1">
                              <FileDown className="h-4 w-4" /> Download document
                            </a>
                          )
                        ) : null}
                        {/* Text content / caption */}
                        {(m.content || (!m.media_url && m.message_type !== "text")) && (
                          <p className="text-sm whitespace-pre-wrap">{(m.content || `[${m.message_type}]`).replace(/\\n/g, "\n")}</p>
                        )}
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

                {/* Template picker panel */}
                {showTemplatePicker && (
                  <div className="border-t border-border bg-muted/30">
                    <div className="flex items-center justify-between px-4 py-2 border-b border-border/40">
                      <p className="text-xs font-semibold text-foreground">Send Template Message</p>
                      <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => { setShowTemplatePicker(false); setSelectedTemplate(null); }}>
                        <X className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                    <div className="flex max-h-[280px]">
                      {/* Template list */}
                      <div className="w-48 sm:w-56 border-r border-border/40 overflow-y-auto">
                        {INBOX_TEMPLATES.map((t) => (
                          <button
                            key={t.key}
                            onClick={() => setSelectedTemplate(t.key)}
                            className={`w-full text-left px-3 py-2.5 border-b border-border/20 transition-colors ${
                              selectedTemplate === t.key ? "bg-primary/10" : "hover:bg-muted/50"
                            }`}
                          >
                            <p className={`text-xs font-medium ${selectedTemplate === t.key ? "text-primary" : "text-foreground"}`}>{t.label}</p>
                            <p className="text-[10px] text-muted-foreground mt-0.5 line-clamp-1">{t.description}</p>
                          </button>
                        ))}
                      </div>
                      {/* Preview + send */}
                      <div className="flex-1 p-3 flex flex-col">
                        {selectedTemplate ? (
                          <>
                            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-2">Preview</p>
                            <div className="flex-1 overflow-y-auto">
                              <div className="rounded-xl bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800/40 p-3">
                                <p className="text-xs text-green-900 dark:text-green-200 whitespace-pre-wrap leading-relaxed">
                                  {getTemplatePreview(selectedTemplate)}
                                </p>
                              </div>
                            </div>
                            <div className="flex items-center justify-between mt-3 pt-2 border-t border-border/40">
                              <p className="text-[10px] text-muted-foreground">
                                To: {selectedConv?.lead_name || selectedPhone}
                              </p>
                              <Button
                                size="sm"
                                className="gap-1.5 h-8 text-xs"
                                disabled={sendingTemplate}
                                onClick={handleSendTemplate}
                              >
                                {sendingTemplate ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
                                Send Template
                              </Button>
                            </div>
                          </>
                        ) : (
                          <div className="flex-1 flex items-center justify-center text-muted-foreground">
                            <p className="text-xs">Select a template to preview</p>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                )}

                {/* Quick replies panel */}
                {showQuickReplies && (
                  <div className="border-t border-border bg-muted/20 px-4 py-2">
                    <div className="flex items-center justify-between mb-2">
                      <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Quick Replies</p>
                      <Button variant="ghost" size="icon" className="h-5 w-5" onClick={() => setShowQuickReplies(false)}>
                        <X className="h-3 w-3" />
                      </Button>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {QUICK_REPLIES.map((qr) => (
                        <button
                          key={qr.label}
                          onClick={() => { setReply(qr.text); setShowQuickReplies(false); }}
                          className="rounded-full border border-primary/30 bg-primary/5 px-3 py-1 text-xs font-medium text-primary hover:bg-primary/10 transition-colors"
                        >
                          {qr.label}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Reply composer */}
                {(() => {
                  const lastInbound = [...messages].reverse().find(m => m.direction === "inbound");
                  const withinWindow = lastInbound && (Date.now() - new Date(lastInbound.created_at).getTime()) < 24 * 60 * 60 * 1000;
                  return (
                    <div className="px-4 py-3 border-t border-border">
                      {!withinWindow && !showTemplatePicker && (
                        <div className="flex items-start gap-2 rounded-lg bg-yellow-50 dark:bg-yellow-950/40 border border-yellow-200 dark:border-yellow-800 px-3 py-2 mb-2">
                          <AlertTriangle className="h-4 w-4 text-yellow-600 dark:text-yellow-400 mt-0.5 shrink-0" />
                          <p className="text-xs text-yellow-800 dark:text-yellow-300">
                            The 24-hour conversation window has expired. Use a template message to re-engage this contact.
                          </p>
                        </div>
                      )}
                      <form
                        onSubmit={(e) => { e.preventDefault(); handleSendReply(); }}
                        className="flex items-center gap-2"
                      >
                        <Button
                          type="button"
                          variant={showTemplatePicker ? "default" : "outline"}
                          size="icon"
                          className="rounded-xl h-10 w-10 shrink-0"
                          onClick={() => { setShowTemplatePicker(!showTemplatePicker); setSelectedTemplate(null); }}
                          title="Send template message"
                        >
                          <LayoutTemplate className="h-4 w-4" />
                        </Button>
                        <Button
                          type="button"
                          variant={showQuickReplies ? "default" : "outline"}
                          size="icon"
                          className="rounded-xl h-10 w-10 shrink-0"
                          onClick={() => setShowQuickReplies(!showQuickReplies)}
                          title="Quick replies"
                          disabled={!withinWindow}
                        >
                          <Zap className="h-4 w-4" />
                        </Button>
                        <input
                          type="text"
                          value={reply}
                          onChange={(e) => setReply(e.target.value)}
                          placeholder={withinWindow ? "Type a message..." : "Window expired — use template"}
                          disabled={!withinWindow}
                          className="flex-1 rounded-xl border border-input bg-background px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring/20 disabled:opacity-50 disabled:cursor-not-allowed"
                        />
                        <Button type="submit" disabled={!withinWindow || !reply.trim() || sending} size="icon" className="rounded-xl h-10 w-10">
                          {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                        </Button>
                      </form>
                      {withinWindow && !showTemplatePicker && !showQuickReplies && (
                        <p className="text-[10px] text-muted-foreground mt-1">Free-form replies only work within 24hrs of last inbound message. Use templates otherwise.</p>
                      )}
                    </div>
                  );
                })()}
              </>
            )}
          </div>
        </div>
      </Card>
    </div>
  );
};

export default WhatsAppInbox;
