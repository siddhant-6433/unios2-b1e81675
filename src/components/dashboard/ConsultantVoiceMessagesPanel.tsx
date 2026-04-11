import { useState, useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Mic, Play, Pause, Loader2, CheckCircle } from "lucide-react";

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
  const { role, user } = useAuth();
  const { toast } = useToast();
  const [messages, setMessages] = useState<VoiceMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const canSee = ["super_admin", "principal", "admission_head", "campus_admin"].includes(role || "");

  const fetchMessages = async () => {
    if (!canSee) { setLoading(false); return; }
    setLoading(true);
    const { data } = await supabase
      .from("consultant_voice_messages" as any)
      .select(`
        *,
        consultants:consultant_id(name),
        profiles:sender_user_id(display_name)
      `)
      .order("created_at", { ascending: false })
      .limit(20);
    setMessages((data || []) as any);
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

  const togglePlay = async (msg: VoiceMessage) => {
    if (playingId === msg.id) {
      audioRef.current?.pause();
      setPlayingId(null);
      return;
    }
    if (audioRef.current) {
      audioRef.current.pause();
    }
    audioRef.current = new Audio(msg.audio_url);
    audioRef.current.onended = () => setPlayingId(null);
    audioRef.current.onerror = () => {
      toast({ title: "Audio failed to load", variant: "destructive" });
      setPlayingId(null);
    };
    await audioRef.current.play();
    setPlayingId(msg.id);

    // Auto-mark as read on first play
    if (msg.status === "unread") {
      await supabase
        .from("consultant_voice_messages" as any)
        .update({ status: "read", read_by: user?.id, read_at: new Date().toISOString() })
        .eq("id", msg.id);
    }
  };

  const markResolved = async (id: string) => {
    const { error } = await supabase
      .from("consultant_voice_messages" as any)
      .update({ status: "resolved", read_by: user?.id, read_at: new Date().toISOString() })
      .eq("id", id);
    if (!error) toast({ title: "Marked resolved" });
  };

  if (!canSee) return null;
  if (loading) return null;

  const unreadCount = messages.filter(m => m.status === "unread").length;
  if (messages.length === 0) return null;

  const fmtTime = (s: number | null) => {
    if (!s) return "0:00";
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}:${sec.toString().padStart(2, "0")}`;
  };

  return (
    <Card className="border-border/60 shadow-none">
      <CardHeader className="pb-3 flex flex-row items-center justify-between">
        <CardTitle className="text-base font-semibold flex items-center gap-2">
          <Mic className="h-4 w-4 text-purple-600" />
          Consultant Voice Messages
          {unreadCount > 0 && (
            <Badge className="bg-purple-100 text-purple-700 border-purple-200 text-[10px]">{unreadCount} new</Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <div className="divide-y divide-border/40 max-h-[400px] overflow-y-auto">
          {messages.map(msg => {
            const isPlaying = playingId === msg.id;
            const senderName = msg.consultants?.name || msg.profiles?.display_name || "Unknown consultant";
            return (
              <div
                key={msg.id}
                className={`flex items-start gap-3 px-4 py-3 ${msg.status === "unread" ? "bg-purple-50/30 dark:bg-purple-950/10" : ""}`}
              >
                <button
                  onClick={() => togglePlay(msg)}
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
                >
                  {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4 ml-0.5" />}
                </button>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-semibold text-foreground truncate">{senderName}</p>
                    {msg.status === "unread" && (
                      <span className="h-2 w-2 rounded-full bg-purple-500" />
                    )}
                    {msg.status === "resolved" && (
                      <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200 text-[9px]">resolved</Badge>
                    )}
                  </div>
                  {msg.subject && (
                    <p className="text-xs text-foreground/80 mt-0.5">{msg.subject}</p>
                  )}
                  <p className="text-[10px] text-muted-foreground mt-0.5">
                    {fmtTime(msg.duration_seconds)} · {new Date(msg.created_at).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                  </p>
                </div>
                {msg.status !== "resolved" && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 text-xs text-muted-foreground hover:text-success"
                    onClick={() => markResolved(msg.id)}
                  >
                    <CheckCircle className="h-3.5 w-3.5 mr-1" /> Resolve
                  </Button>
                )}
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
