import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { MessageSquare, ChevronDown, User, Bot } from "lucide-react";

interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: string;
  type?: string;
}

interface WebConversation {
  id: string;
  session_id: string;
  messages: ChatMessage[];
  started_at: string;
  ended_at: string | null;
}

interface WebChatTranscriptsProps {
  leadId: string;
}

export function WebChatTranscripts({ leadId }: WebChatTranscriptsProps) {
  const [conversations, setConversations] = useState<WebConversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("web_conversations" as any)
        .select("*")
        .eq("lead_id", leadId)
        .order("started_at", { ascending: false })
        .limit(10);
      if (data) setConversations(data as any);
      setLoading(false);
    })();
  }, [leadId]);

  if (loading || conversations.length === 0) return null;

  return (
    <div className="space-y-2">
      {conversations.map((conv, idx) => {
        const isExpanded = expandedId === conv.id;
        const msgs = (conv.messages || []).filter((m) => m.role !== "system");
        const userMsgCount = msgs.filter((m) => m.role === "user").length;
        const isToday = new Date(conv.started_at).toDateString() === new Date().toDateString();
        const dateLabel = isToday ? "Today" : new Date(conv.started_at).toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
        const timeLabel = new Date(conv.started_at).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true });

        return (
          <Card key={conv.id} className={`border-2 ${idx === 0 ? "border-blue-300 dark:border-blue-600 bg-blue-50/50 dark:bg-blue-950/20" : "border-border bg-card"} overflow-hidden`}>
            <CardContent className="p-4">
              <div className="flex items-start gap-3">
                <div className={`flex h-9 w-9 items-center justify-center rounded-xl shrink-0 ${idx === 0 ? "bg-blue-100 dark:bg-blue-900/40" : "bg-muted"}`}>
                  <MessageSquare className={`h-4 w-4 ${idx === 0 ? "text-blue-600" : "text-muted-foreground"}`} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="text-sm font-bold text-foreground">
                      Website Chat {conversations.length > 1 ? `#${conversations.length - idx}` : ""}
                    </h3>
                    <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-blue-200 text-blue-800 dark:bg-blue-800/50 dark:text-blue-300">
                      {dateLabel} {timeLabel}
                    </span>
                    <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
                      {userMsgCount} message{userMsgCount !== 1 ? "s" : ""}
                    </span>
                  </div>

                  {/* Preview: first user message */}
                  {msgs.length > 0 && (() => {
                    const firstUser = msgs.find((m) => m.role === "user");
                    return firstUser ? (
                      <p className="text-sm text-foreground/80 mt-2 leading-relaxed line-clamp-2">
                        {firstUser.content}
                      </p>
                    ) : null;
                  })()}

                  <div className="flex items-center gap-3 mt-2">
                    <button
                      onClick={() => setExpandedId(isExpanded ? null : conv.id)}
                      className="text-xs font-medium text-primary hover:underline flex items-center gap-1"
                    >
                      <MessageSquare className="h-3.5 w-3.5" /> {isExpanded ? "Hide" : "View"} transcript
                      <ChevronDown className={`h-3 w-3 transition-transform ${isExpanded ? "rotate-180" : ""}`} />
                    </button>
                  </div>

                  {isExpanded && (
                    <div className="mt-2 rounded-lg bg-muted/50 p-3 text-xs space-y-2 max-h-[400px] overflow-y-auto border border-border">
                      {msgs.map((msg, i) => (
                        <div key={i} className={`flex gap-2 ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                          {msg.role === "assistant" && (
                            <Bot className="h-4 w-4 text-blue-500 shrink-0 mt-0.5" />
                          )}
                          <div className={`rounded-lg px-3 py-2 max-w-[80%] ${
                            msg.role === "user"
                              ? "bg-primary text-primary-foreground"
                              : "bg-background border border-border text-foreground/80"
                          }`}>
                            <p className="whitespace-pre-wrap">{msg.content}</p>
                            <p className={`text-[9px] mt-1 ${msg.role === "user" ? "text-primary-foreground/60" : "text-muted-foreground"}`}>
                              {new Date(msg.timestamp).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true })}
                            </p>
                          </div>
                          {msg.role === "user" && (
                            <User className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
