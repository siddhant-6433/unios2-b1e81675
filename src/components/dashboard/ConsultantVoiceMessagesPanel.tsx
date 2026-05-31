import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Mic, ChevronRight } from "lucide-react";

interface VoiceMessage {
  id: string;
  consultant_id: string | null;
  sender_user_id: string | null;
  audio_url: string;
  duration_seconds: number | null;
  subject: string | null;
  status: string;
  created_at: string;
  consultants?: { name: string } | null;
  profiles?: { display_name: string } | null;
}

export function ConsultantVoiceMessagesPanel() {
  const { role } = useAuth();
  const navigate = useNavigate();
  const [messages, setMessages] = useState<VoiceMessage[]>([]);
  const [loading, setLoading] = useState(true);

  const canSee = ["super_admin", "principal", "admission_head", "campus_admin"].includes(role || "");

  const fetchMessages = async () => {
    if (!canSee) { setLoading(false); return; }
    setLoading(true);
    const { data } = await supabase
      .from("consultant_voice_messages" as any)
      .select(`
        *,
        consultants:consultant_id(name)
      `)
      .order("created_at", { ascending: false })
      .limit(20);

    const rows = (data || []) as any[];
    const senderIds = Array.from(new Set(rows.map(r => r.sender_user_id).filter(Boolean)));
    let nameMap: Record<string, string> = {};
    if (senderIds.length) {
      const { data: profs } = await supabase
        .from("profiles")
        .select("user_id, display_name")
        .in("user_id", senderIds);
      nameMap = Object.fromEntries((profs || []).map(p => [p.user_id, p.display_name || ""]));
    }
    setMessages(rows.map(r => ({ ...r, profiles: r.sender_user_id ? { display_name: nameMap[r.sender_user_id] || "" } : null })));
    setLoading(false);
  };

  useEffect(() => {
    fetchMessages();
    const channel = supabase
      .channel("voice-messages-panel")
      .on("postgres_changes" as any, { event: "*", schema: "public", table: "consultant_voice_messages" }, fetchMessages)
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [role]);

  if (!canSee) return null;
  if (loading) return null;

  const unreadCount = messages.filter(m => m.status === "unread").length;
  if (messages.length === 0) return null;

  return (
    <button
      onClick={() => navigate("/inbox")}
      className="w-full flex items-center gap-3 px-4 py-2.5 rounded-lg bg-purple-50/60 dark:bg-purple-950/10 border border-purple-200/60 hover:bg-purple-100/50 dark:hover:bg-purple-950/20 transition-colors text-left"
    >
      <Mic className="h-4 w-4 text-purple-600 shrink-0" />
      <span className="flex-1 text-sm">
        <span className="font-semibold text-foreground">{messages.length} voice message{messages.length !== 1 ? "s" : ""}</span>
        {unreadCount > 0 && <span className="text-muted-foreground"> · {unreadCount} new</span>}
        <span className="text-muted-foreground"> — view in Inbox</span>
      </span>
      <ChevronRight className="h-4 w-4 text-purple-600/60 shrink-0" />
    </button>
  );
}
