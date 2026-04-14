import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Bot, Search, Loader2, CheckCircle, XCircle, AlertCircle, Clock, Play,
} from "lucide-react";

interface AiCallRecord {
  id: string;
  lead_id: string;
  status: string;
  duration_seconds: number | null;
  recording_url: string | null;
  summary: string | null;
  transcript: string | null;
  conversion_probability: number | null;
  disposition: string | null;
  created_at: string;
  lead_name?: string;
  lead_phone?: string;
  lead_stage?: string;
  counsellor_name?: string;
}

const STATUS_COLORS: Record<string, string> = {
  completed: "bg-emerald-100 text-emerald-700",
  initiated: "bg-blue-100 text-blue-700",
  in_progress: "bg-amber-100 text-amber-700",
  failed: "bg-red-100 text-red-700",
  no_answer: "bg-muted text-muted-foreground",
};

const AiCallLog = () => {
  const navigate = useNavigate();
  const [records, setRecords] = useState<AiCallRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("ai_call_records" as any)
        .select(`
          *,
          leads:lead_id(name, phone, stage, counsellor_id,
            profiles:counsellor_id(display_name)
          )
        `)
        .order("created_at", { ascending: false })
        .limit(200);

      if (data) {
        setRecords(
          (data as any[]).map((r: any) => ({
            ...r,
            lead_name: r.leads?.name || "Unknown",
            lead_phone: r.leads?.phone || "",
            lead_stage: r.leads?.stage || "",
            counsellor_name: r.leads?.profiles?.display_name || "Unassigned",
          }))
        );
      }
      setLoading(false);
    })();
  }, []);

  const filtered = records.filter((r) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      (r.lead_name || "").toLowerCase().includes(q) ||
      (r.lead_phone || "").includes(q) ||
      (r.summary || "").toLowerCase().includes(q) ||
      (r.disposition || "").toLowerCase().includes(q)
    );
  });

  const total = records.length;
  const withRecording = records.filter((r) => r.recording_url).length;
  const completed = records.filter((r) => r.status === "completed").length;
  const highConv = records.filter((r) => (r.conversion_probability || 0) >= 70).length;

  const fmtDuration = (s: number | null) => {
    if (!s) return "—";
    return `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, "0")}`;
  };

  if (loading) return <div className="flex h-64 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold text-foreground">AI Call Log</h1>
        <p className="text-sm text-muted-foreground mt-1">All AI-initiated calls with recordings and assessments</p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[
          { label: "Total AI Calls", value: total, icon: Bot, bg: "bg-pastel-blue" },
          { label: "Completed", value: completed, icon: CheckCircle, bg: "bg-pastel-green" },
          { label: "With Recording", value: withRecording, icon: Play, bg: "bg-pastel-purple" },
          { label: "High Conversion", value: highConv, icon: AlertCircle, bg: "bg-pastel-orange" },
        ].map((s) => (
          <Card key={s.label} className="border-border/60 shadow-none">
            <CardContent className="p-4">
              <div className={`flex h-9 w-9 items-center justify-center rounded-xl ${s.bg} mb-2`}>
                <s.icon className="h-4 w-4 text-foreground/70" />
              </div>
              <p className="text-2xl font-bold text-foreground">{s.value}</p>
              <p className="text-xs text-muted-foreground">{s.label}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input type="text" placeholder="Search by name, phone, summary..." value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full rounded-xl border border-input bg-card py-2.5 pl-10 pr-4 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/20" />
      </div>

      <Card className="border-border/60 shadow-none overflow-hidden">
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/40">
                <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Lead</th>
                <th className="px-4 py-2.5 text-center font-medium text-muted-foreground">Status</th>
                <th className="px-4 py-2.5 text-center font-medium text-muted-foreground">Duration</th>
                <th className="px-4 py-2.5 text-center font-medium text-muted-foreground">Conversion</th>
                <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Summary</th>
                <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Counsellor</th>
                <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Date</th>
                <th className="px-4 py-2.5 text-center font-medium text-muted-foreground">Recording</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => {
                const probColor = (r.conversion_probability || 0) >= 70 ? "bg-emerald-100 text-emerald-700"
                  : (r.conversion_probability || 0) >= 40 ? "bg-amber-100 text-amber-700"
                  : r.conversion_probability ? "bg-red-100 text-red-700"
                  : "bg-muted text-muted-foreground";

                return (
                  <tr key={r.id} className="border-b border-border/40 hover:bg-muted/20 cursor-pointer"
                    onClick={() => navigate(`/admissions/${r.lead_id}`)}>
                    <td className="px-4 py-2.5">
                      <p className="font-medium text-foreground">{r.lead_name}</p>
                      <p className="text-[10px] text-muted-foreground">{r.lead_phone}</p>
                    </td>
                    <td className="px-4 py-2.5 text-center">
                      <Badge className={`text-[10px] border-0 ${STATUS_COLORS[r.status] || "bg-muted"}`}>
                        {r.status}
                      </Badge>
                    </td>
                    <td className="px-4 py-2.5 text-center text-xs text-muted-foreground">
                      {fmtDuration(r.duration_seconds)}
                    </td>
                    <td className="px-4 py-2.5 text-center">
                      {r.conversion_probability ? (
                        <Badge className={`text-[10px] border-0 ${probColor}`}>{r.conversion_probability}%</Badge>
                      ) : <span className="text-[10px] text-muted-foreground">—</span>}
                    </td>
                    <td className="px-4 py-2.5 text-xs text-muted-foreground max-w-[300px]">
                      <p className="line-clamp-2">{r.summary || "—"}</p>
                    </td>
                    <td className="px-4 py-2.5 text-xs text-muted-foreground">{r.counsellor_name}</td>
                    <td className="px-4 py-2.5 text-xs text-muted-foreground">
                      {new Date(r.created_at).toLocaleDateString("en-IN", { day: "2-digit", month: "short" })}
                    </td>
                    <td className="px-4 py-2.5 text-center">
                      {r.recording_url ? (
                        <a href={r.recording_url} target="_blank" rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="inline-flex items-center gap-1 text-primary hover:underline text-xs">
                          <Play className="h-3 w-3" /> Play
                        </a>
                      ) : <span className="text-[10px] text-muted-foreground">—</span>}
                    </td>
                  </tr>
                );
              })}
              {filtered.length === 0 && (
                <tr><td colSpan={8} className="px-4 py-12 text-center text-muted-foreground">
                  <Bot className="h-8 w-8 mx-auto mb-2 opacity-30" />
                  <p className="text-sm">No AI call records found</p>
                </td></tr>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
};

export default AiCallLog;
