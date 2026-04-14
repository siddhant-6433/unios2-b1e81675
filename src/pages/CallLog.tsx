import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Bot, Phone, Clock, Search, Loader2, ExternalLink,
  CheckCircle, XCircle, AlertCircle, Play,
} from "lucide-react";

interface AiCallRecord {
  id: string;
  lead_id: string;
  disposition: string | null;
  duration_seconds: number | null;
  notes: string | null;
  recording_url: string | null;
  created_at: string;
  lead_name?: string;
  lead_phone?: string;
  lead_stage?: string;
  lead_source?: string;
  counsellor_name?: string;
}

const DISPOSITION_COLORS: Record<string, string> = {
  interested: "bg-emerald-100 text-emerald-700",
  not_interested: "bg-red-100 text-red-700",
  no_answer: "bg-amber-100 text-amber-700",
  voicemail: "bg-indigo-100 text-indigo-700",
  callback: "bg-blue-100 text-blue-700",
};

const CallLog = () => {
  const navigate = useNavigate();
  const [records, setRecords] = useState<AiCallRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("call_logs" as any)
        .select(`
          id, lead_id, disposition, duration_seconds, notes, recording_url, created_at,
          leads:lead_id(name, phone, stage, source, counsellor_id,
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
            lead_source: r.leads?.source || "",
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
      (r.disposition || "").toLowerCase().includes(q) ||
      (r.notes || "").toLowerCase().includes(q)
    );
  });

  // Stats
  const total = records.length;
  const interested = records.filter((r) => r.disposition === "interested").length;
  const notInterested = records.filter((r) => r.disposition === "not_interested").length;
  const noAnswer = records.filter((r) => ["no_answer", "voicemail"].includes(r.disposition || "")).length;

  const formatDuration = (s: number | null) => {
    if (!s) return "—";
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}:${sec.toString().padStart(2, "0")}`;
  };

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Manual Call Log</h1>
        <p className="text-sm text-muted-foreground mt-1">
          All calls logged manually by counsellors
        </p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[
          { label: "Total Calls", value: total, icon: Bot, bg: "bg-pastel-blue" },
          { label: "Interested", value: interested, icon: CheckCircle, bg: "bg-pastel-green" },
          { label: "Not Interested", value: notInterested, icon: XCircle, bg: "bg-pastel-red" },
          { label: "No Answer", value: noAnswer, icon: AlertCircle, bg: "bg-pastel-orange" },
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

      {/* Search */}
      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input
          type="text"
          placeholder="Search by name, phone, disposition..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full rounded-xl border border-input bg-card py-2.5 pl-10 pr-4 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/20"
        />
      </div>

      {/* Table */}
      <Card className="border-border/60 shadow-none overflow-hidden">
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/40">
                <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Lead</th>
                <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Disposition</th>
                <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Duration</th>
                <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Summary</th>
                <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Counsellor</th>
                <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Date</th>
                <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Recording</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr
                  key={r.id}
                  className="border-b border-border/40 hover:bg-muted/20 cursor-pointer"
                  onClick={() => navigate(`/admissions/${r.lead_id}`)}
                >
                  <td className="px-4 py-2.5">
                    <p className="font-medium text-foreground">{r.lead_name}</p>
                    <p className="text-[10px] text-muted-foreground">{r.lead_phone}</p>
                  </td>
                  <td className="px-4 py-2.5">
                    <Badge
                      className={`text-[10px] border-0 ${DISPOSITION_COLORS[r.disposition || ""] || "bg-muted text-muted-foreground"}`}
                    >
                      {(r.disposition || "unknown").replace(/_/g, " ")}
                    </Badge>
                  </td>
                  <td className="px-4 py-2.5 text-muted-foreground text-xs">
                    {formatDuration(r.duration_seconds)}
                  </td>
                  <td className="px-4 py-2.5 text-xs text-muted-foreground max-w-[300px] truncate">
                    {r.notes || "—"}
                  </td>
                  <td className="px-4 py-2.5 text-xs text-muted-foreground">
                    {r.counsellor_name}
                  </td>
                  <td className="px-4 py-2.5 text-xs text-muted-foreground">
                    {new Date(r.created_at).toLocaleDateString("en-IN", { day: "2-digit", month: "short" })}
                  </td>
                  <td className="px-4 py-2.5">
                    {r.recording_url ? (
                      <a
                        href={r.recording_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="text-primary hover:underline text-xs flex items-center gap-1"
                      >
                        <Play className="h-3 w-3" /> Play
                      </a>
                    ) : (
                      <span className="text-[10px] text-muted-foreground">—</span>
                    )}
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center text-muted-foreground">
                    <Bot className="h-8 w-8 mx-auto mb-2 opacity-30" />
                    <p className="text-sm">No AI call records found</p>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
};

export default CallLog;
