import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Bot, Play, Pause, Phone, Clock, ArrowUpRight,
  ChevronDown, ChevronUp, Loader2, PhoneCall, PhoneIncoming,
} from "lucide-react";

interface AiCallLog {
  id: string;
  lead_id: string | null;
  call_uuid: string | null;
  direction: string;
  from_number: string | null;
  to_number: string | null;
  status: string | null;
  duration_seconds: number;
  recording_url: string | null;
  bill_cost: number | null;
  hangup_cause: string | null;
  caller_transcript: string | null;
  ai_transcript: string | null;
  tool_calls_made: any[];
  created_at: string;
  leads?: { name: string; phone: string } | null;
}

const statusColors: Record<string, string> = {
  completed: "bg-success/10 text-success",
  busy: "bg-warning/10 text-warning-foreground",
  "no-answer": "bg-warning/10 text-warning-foreground",
  failed: "bg-destructive/10 text-destructive",
  initiated: "bg-info/10 text-info-foreground",
};

export function AiCallLogsPanel() {
  const { role } = useAuth();
  const navigate = useNavigate();
  const [logs, setLogs] = useState<AiCallLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const canSee = ["super_admin", "principal", "admission_head", "campus_admin"].includes(role || "");

  useEffect(() => {
    if (!canSee) { setLoading(false); return; }
    (async () => {
      setLoading(true);
      const { data } = await supabase
        .from("ai_call_logs" as any)
        .select("*, leads:lead_id(name, phone)")
        .order("created_at", { ascending: false })
        .limit(50);
      setLogs((data || []) as any);
      setLoading(false);
    })();
  }, [role]);

  const togglePlay = async (log: AiCallLog) => {
    if (!log.recording_url) return;
    if (playingId === log.id) {
      audioRef.current?.pause();
      setPlayingId(null);
      return;
    }
    if (audioRef.current) audioRef.current.pause();
    audioRef.current = new Audio(log.recording_url);
    audioRef.current.onended = () => setPlayingId(null);
    audioRef.current.onerror = () => setPlayingId(null);
    await audioRef.current.play();
    setPlayingId(log.id);
  };

  if (!canSee) return null;

  const totalCalls = logs.length;
  const completedCalls = logs.filter(l => l.status === "completed").length;
  const totalDuration = logs.reduce((s, l) => s + (l.duration_seconds || 0), 0);
  const totalCost = logs.reduce((s, l) => s + (Number(l.bill_cost) || 0), 0);

  return (
    <div className="space-y-4">
      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard label="Total AI Calls" value={String(totalCalls)} icon={<Bot className="h-[18px] w-[18px] text-info-foreground" />} bg="bg-pastel-blue" delay={0} />
        <StatCard label="Connected" value={String(completedCalls)} icon={<PhoneCall className="h-[18px] w-[18px] text-success" />} bg="bg-pastel-green" delay={60} />
        <StatCard label="Total Duration" value={`${Math.floor(totalDuration / 60)}m ${totalDuration % 60}s`} icon={<Clock className="h-[18px] w-[18px] text-warning-foreground" />} bg="bg-pastel-orange" delay={120} />
        <StatCard label="Total Cost" value={`$${totalCost.toFixed(3)}`} icon={<Phone className="h-[18px] w-[18px] text-primary" />} bg="bg-pastel-purple" delay={180} />
      </div>

      {/* Call logs table */}
      <Card className="border-border/60 shadow-none overflow-hidden">
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <Bot className="h-4 w-4 text-primary" />
            AI Call Logs
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex h-32 items-center justify-center">
              <Loader2 className="h-5 w-5 animate-spin text-primary" />
            </div>
          ) : logs.length === 0 ? (
            <div className="flex h-32 items-center justify-center text-sm text-muted-foreground">
              No AI calls yet
            </div>
          ) : (
            <div className="divide-y divide-border/40">
              {logs.map(log => {
                const isExpanded = expandedId === log.id;
                const isPlaying = playingId === log.id;
                return (
                  <div key={log.id}>
                    <button
                      className="w-full flex items-center gap-3 px-4 py-3 hover:bg-muted/30 transition-colors text-left"
                      onClick={() => setExpandedId(isExpanded ? null : log.id)}
                    >
                      <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${log.direction === "inbound" ? "bg-info/10 text-info-foreground" : "bg-primary/10 text-primary"}`}>
                        {log.direction === "inbound" ? <PhoneIncoming className="h-4 w-4" /> : <PhoneCall className="h-4 w-4" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-semibold text-foreground truncate">
                            {log.leads?.name || log.to_number || "Unknown"}
                          </p>
                          <Badge className={`text-[9px] border-0 ${statusColors[log.status || ""] || "bg-muted"}`}>
                            {log.status || "unknown"}
                          </Badge>
                        </div>
                        <p className="text-[10px] text-muted-foreground mt-0.5">
                          {log.duration_seconds}s · {new Date(log.created_at).toLocaleString("en-IN", {
                            day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
                          })}
                          {log.bill_cost ? ` · $${Number(log.bill_cost).toFixed(3)}` : ""}
                        </p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {log.recording_url && (
                          <button
                            onClick={(e) => { e.stopPropagation(); togglePlay(log); }}
                            className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-primary-foreground hover:bg-primary/90"
                          >
                            {isPlaying ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5 ml-0.5" />}
                          </button>
                        )}
                        {log.lead_id && (
                          <button
                            onClick={(e) => { e.stopPropagation(); navigate(`/admissions/${log.lead_id}`); }}
                            className="text-muted-foreground hover:text-primary transition-colors"
                          >
                            <ArrowUpRight className="h-4 w-4" />
                          </button>
                        )}
                        {isExpanded ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
                      </div>
                    </button>

                    {isExpanded && (
                      <div className="px-4 pb-4 space-y-3 bg-muted/10">
                        {log.ai_transcript && (
                          <div>
                            <p className="text-[10px] font-semibold text-muted-foreground uppercase mb-1">AI Transcript</p>
                            <p className="text-xs text-foreground/80 leading-relaxed bg-card rounded-lg p-3 border border-border/40">
                              {log.ai_transcript}
                            </p>
                          </div>
                        )}
                        {log.caller_transcript && (
                          <div>
                            <p className="text-[10px] font-semibold text-muted-foreground uppercase mb-1">Caller Transcript</p>
                            <p className="text-xs text-foreground/80 leading-relaxed bg-card rounded-lg p-3 border border-border/40">
                              {log.caller_transcript}
                            </p>
                          </div>
                        )}
                        {log.tool_calls_made && log.tool_calls_made.length > 0 && (
                          <div>
                            <p className="text-[10px] font-semibold text-muted-foreground uppercase mb-1">Actions Taken</p>
                            <div className="flex flex-wrap gap-1.5">
                              {log.tool_calls_made.map((tc: any, i: number) => (
                                <Badge key={i} variant="outline" className="text-[9px]">
                                  {tc.name}{tc.result?.success ? " ✓" : ""}
                                </Badge>
                              ))}
                            </div>
                          </div>
                        )}
                        <div className="flex items-center gap-4 text-[10px] text-muted-foreground">
                          {log.hangup_cause && <span>Hangup: {log.hangup_cause}</span>}
                          {log.call_uuid && <span className="font-mono">{log.call_uuid.slice(0, 8)}...</span>}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// Reference-inspired stat-card shape (matches the Applications page row):
// rounded-2xl shell, generous padding, larger tinted icon chip, hero-sized
// value with tight tracking and the label tucked below.
function StatCard({ label, value, icon, bg, delay = 0 }: { label: string; value: string; icon: React.ReactNode; bg: string; delay?: number }) {
  return (
    <Card
      className="rounded-2xl border-border/40 shadow-none transition-all duration-280 ease-standard hover:elevation-mid hover:-translate-y-1 animate-rs-slide-up"
      style={{ animationDelay: `${delay}ms`, animationFillMode: "both" }}
    >
      <CardContent className="p-4 flex items-center gap-3.5">
        <div className={`flex h-10 w-10 items-center justify-center rounded-xl shrink-0 ${bg}`}>
          {icon}
        </div>
        <div className="min-w-0">
          <p className="text-[11px] text-muted-foreground">{label}</p>
          <p className="text-2xl font-bold text-foreground leading-none tracking-tight mt-1.5">{value}</p>
        </div>
      </CardContent>
    </Card>
  );
}
