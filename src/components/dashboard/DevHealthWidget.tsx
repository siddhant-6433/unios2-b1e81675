import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Activity, Clock, Mail, Globe, Megaphone, Phone, ChevronRight } from "lucide-react";

// ponytail: minimal smoke-detector widget, not a full monitoring page

interface DevHealth {
  cron: { succeeded: number; failed: number };
  cron_failures?: { job: string; error: string | null; at: string }[];
  meta_leads_24h: number;
  whatsapp: { sent_1h: number; failed_1h: number };
  edge_errors: { err_401: number; err_500: number };
  campaigns_stuck: number;
  ai_queue: { pending: number; failed: number };
  checked_at: string;
}

type Status = "green" | "yellow" | "red";

const DOT: Record<Status, string> = {
  green:  "bg-emerald-500",
  yellow: "bg-amber-400",
  red:    "bg-red-500",
};

function statusOf(key: string, h: DevHealth): { status: Status; label: string } {
  switch (key) {
    case "cron": {
      const f = h.cron.failed;
      return { status: f === 0 ? "green" : f <= 2 ? "yellow" : "red", label: `${h.cron.succeeded} ok / ${f} fail` };
    }
    case "meta": {
      const n = h.meta_leads_24h;
      return { status: n > 0 ? "green" : "red", label: `${n} in 24h` };
    }
    case "wa": {
      const total = h.whatsapp.sent_1h + h.whatsapp.failed_1h;
      if (total === 0) return { status: "green", label: "0 msgs (quiet)" };
      const rate = h.whatsapp.failed_1h / total;
      return { status: rate < 0.05 ? "green" : rate < 0.2 ? "yellow" : "red", label: `${h.whatsapp.sent_1h} ok / ${h.whatsapp.failed_1h} fail` };
    }
    case "edge": {
      const sum = h.edge_errors.err_401 + h.edge_errors.err_500;
      return { status: sum === 0 ? "green" : sum <= 5 ? "yellow" : "red", label: `${h.edge_errors.err_401}×401  ${h.edge_errors.err_500}×500` };
    }
    case "campaigns": {
      const n = h.campaigns_stuck;
      return { status: n === 0 ? "green" : "red", label: n === 0 ? "none stuck" : `${n} stuck` };
    }
    case "ai": {
      const f = h.ai_queue.failed;
      return { status: f === 0 ? "green" : f <= 5 ? "yellow" : "red", label: `${h.ai_queue.pending} pending / ${f} fail` };
    }
    default: return { status: "green", label: "" };
  }
}

function renderDetail(key: string, h: DevHealth): React.ReactNode {
  switch (key) {
    case "cron":
      if (!h.cron_failures?.length) return <p>No failures in the last hour.</p>;
      return h.cron_failures.map((f, i) => (
        <p key={i}><span className="font-medium">{f.job}</span>: {f.error || "no message"}</p>
      ));
    case "meta":
      return <p>{h.meta_leads_24h === 0 ? "No Meta leads received in 24h — check token & webhook." : `${h.meta_leads_24h} leads ingested via Meta in the last 24 hours.`}</p>;
    case "wa":
      return <p>Outbound in last hour: {h.whatsapp.sent_1h} delivered, {h.whatsapp.failed_1h} failed.</p>;
    case "edge":
      return <p>Last 2h: {h.edge_errors.err_401} unauthorized (401), {h.edge_errors.err_500} server errors (500+). Pruned every 2h.</p>;
    case "campaigns":
      return <p>{h.campaigns_stuck === 0 ? "All campaigns progressing normally." : `${h.campaigns_stuck} campaign(s) stuck in 'sending' for 30+ min.`}</p>;
    case "ai":
      return <p>{h.ai_queue.pending} calls queued, {h.ai_queue.failed} failed in 24h.</p>;
    default:
      return null;
  }
}

const ROWS = [
  { key: "cron",      icon: Clock,     title: "Cron Jobs" },
  { key: "meta",      icon: Globe,     title: "Meta Leads" },
  { key: "wa",        icon: Mail,      title: "WhatsApp" },
  { key: "edge",      icon: Activity,  title: "Edge Errors" },
  { key: "campaigns", icon: Megaphone, title: "Campaigns" },
  { key: "ai",        icon: Phone,     title: "AI Calls" },
] as const;

export default function DevHealthWidget() {
  const [expanded, setExpanded] = useState<string | null>(null);
  const { data, isLoading, error } = useQuery<DevHealth>({
    queryKey: ["dev-health"],
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("fn_dev_health_summary");
      if (error) throw error;
      return data as DevHealth;
    },
    refetchInterval: 60_000,
    staleTime: 30_000,
    retry: false,
  });

  if (isLoading || error || !data) return null;

  const ago = Math.round((Date.now() - new Date(data.checked_at).getTime()) / 1000);
  const agoLabel = ago < 60 ? `${ago}s ago` : `${Math.round(ago / 60)}m ago`;

  return (
    <Card className="border-border/60 shadow-none mb-4">
      <CardHeader className="pb-2 pt-4 px-5">
        <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-1.5">
          <Activity className="h-3.5 w-3.5" />
          System Health
          <span className="ml-auto text-xs font-normal opacity-60">{agoLabel}</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="px-5 pb-4">
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-2.5">
          {ROWS.map(({ key, icon: Icon, title }) => {
            const { status, label } = statusOf(key, data);
            return (
              <div
                key={key}
                className="cursor-pointer hover:bg-muted/30 rounded px-1 -mx-1 transition-colors"
                onClick={() => setExpanded(expanded === key ? null : key)}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span className={`h-2 w-2 rounded-full shrink-0 ${DOT[status]}`} />
                  <Icon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                  <div className="min-w-0">
                    <span className="text-xs font-medium text-foreground">{title}</span>
                    <span className="text-xs text-muted-foreground ml-1.5">{label}</span>
                  </div>
                </div>
                {expanded === key && (
                  <div className="mt-1.5 pl-6 text-xs text-muted-foreground space-y-0.5">
                    {renderDetail(key, data)}
                  </div>
                )}
              </div>
            );
          })}
        </div>
        <div className="mt-3 pt-2 border-t border-border/40">
          <Link to="/admin/system-health" className="text-xs text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1">
            View details <ChevronRight className="h-3 w-3" />
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}
