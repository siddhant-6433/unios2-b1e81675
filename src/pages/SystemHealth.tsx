import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Activity, Clock, Mail, Globe, Megaphone, Phone } from "lucide-react";

// ponytail: same 6-indicator model as DevHealthWidget, just laid out full-page with drill-down

interface CronFailure {
  job: string;
  error: string;
  at: string;
}

interface DevHealth {
  cron: { succeeded: number; failed: number };
  cron_failures: CronFailure[];
  meta_leads_24h: number;
  whatsapp: { sent_1h: number; failed_1h: number };
  edge_errors: { err_401: number; err_500: number };
  campaigns_stuck: number;
  ai_queue: { pending: number; failed: number };
  checked_at: string;
}

interface CronJob {
  jobid: number;
  jobname: string;
  schedule: string;
  active: boolean;
  last_status: string | null;
  last_run: string | null;
  last_error: string | null;
  runs_1h: number;
  fails_1h: number;
}

type Status = "green" | "yellow" | "red";

const DOT: Record<Status, string> = {
  green: "bg-emerald-500",
  yellow: "bg-amber-400",
  red: "bg-red-500",
};

function timeAgo(iso: string): string {
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

function statusOf(key: string, h: DevHealth): { status: Status; label: string } {
  switch (key) {
    case "cron": {
      const f = h.cron.failed;
      return { status: f === 0 ? "green" : f <= 2 ? "yellow" : "red", label: `${h.cron.succeeded} ok / ${f} fail (1h)` };
    }
    case "meta": {
      const n = h.meta_leads_24h;
      return { status: n > 0 ? "green" : "red", label: `${n} in 24h` };
    }
    case "wa": {
      const total = h.whatsapp.sent_1h + h.whatsapp.failed_1h;
      if (total === 0) return { status: "green", label: "0 msgs (quiet)" };
      const rate = h.whatsapp.failed_1h / total;
      return { status: rate < 0.05 ? "green" : rate < 0.2 ? "yellow" : "red", label: `${h.whatsapp.sent_1h} ok / ${h.whatsapp.failed_1h} fail (1h)` };
    }
    case "edge": {
      const sum = h.edge_errors.err_401 + h.edge_errors.err_500;
      return { status: sum === 0 ? "green" : sum <= 5 ? "yellow" : "red", label: `${h.edge_errors.err_401}×401  ${h.edge_errors.err_500}×500 (2h)` };
    }
    case "campaigns": {
      const n = h.campaigns_stuck;
      return { status: n === 0 ? "green" : "red", label: n === 0 ? "none stuck" : `${n} stuck` };
    }
    case "ai": {
      const f = h.ai_queue.failed;
      return { status: f === 0 ? "green" : f <= 5 ? "yellow" : "red", label: `${h.ai_queue.pending} pending / ${f} fail (24h)` };
    }
    default:
      return { status: "green", label: "" };
  }
}

const ROWS = [
  { key: "cron", icon: Clock, title: "Cron Jobs" },
  { key: "meta", icon: Globe, title: "Meta Leads" },
  { key: "wa", icon: Mail, title: "WhatsApp" },
  { key: "edge", icon: Activity, title: "Edge Errors" },
  { key: "campaigns", icon: Megaphone, title: "Campaigns" },
  { key: "ai", icon: Phone, title: "AI Calls" },
] as const;

function OverviewTab() {
  const { data, isLoading, error } = useQuery<DevHealth>({
    queryKey: ["dev-health-summary"],
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("fn_dev_health_summary");
      if (error) throw error;
      return data as DevHealth;
    },
    refetchInterval: 30_000,
  });

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (error || !data) return <p className="text-sm text-red-500">Failed to load health summary.</p>;

  return (
    <div>
      <p className="text-xs text-muted-foreground mb-4">Last checked {timeAgo(data.checked_at)}</p>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {ROWS.map(({ key, icon: Icon, title }) => {
          const { status, label } = statusOf(key, data);
          return (
            <Card key={key} className="border-border/60 shadow-none">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <span className={`h-2.5 w-2.5 rounded-full shrink-0 ${DOT[status]}`} />
                  <Icon className="h-4 w-4 text-muted-foreground" />
                  {title}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">{label}</p>
                {key === "cron" && data.cron_failures?.length > 0 && (
                  <ul className="mt-2 space-y-1 text-xs text-red-600">
                    {data.cron_failures.map((f, i) => (
                      <li key={i} className="truncate">
                        <span className="font-medium">{f.job}</span>: {f.error} ({timeAgo(f.at)})
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

function CronJobsTab() {
  const { data, isLoading, error } = useQuery<CronJob[]>({
    queryKey: ["dev-cron-detail"],
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("fn_dev_cron_detail");
      if (error) throw error;
      return (data ?? []) as CronJob[];
    },
    refetchInterval: 30_000,
  });

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (error || !data) return <p className="text-sm text-red-500">Failed to load cron jobs.</p>;

  const jobs = [...data].sort((a, b) => a.jobname.localeCompare(b.jobname));

  return (
    <Card className="border-border/60 shadow-none">
      <CardContent className="pt-4 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-muted-foreground">
              <th className="py-2 pr-4 font-medium">Job Name</th>
              <th className="py-2 pr-4 font-medium">Schedule</th>
              <th className="py-2 pr-4 font-medium">Last Run</th>
              <th className="py-2 pr-4 font-medium">Status</th>
              <th className="py-2 pr-4 font-medium">Fails (1h)</th>
              <th className="py-2 pr-4 font-medium">Last Error</th>
            </tr>
          </thead>
          <tbody>
            {jobs.map((j) => {
              const ok = j.last_status === "succeeded";
              return (
                <tr key={j.jobid} className="border-b last:border-0">
                  <td className="py-2 pr-4 font-medium">{j.jobname}</td>
                  <td className="py-2 pr-4 font-mono text-xs text-muted-foreground">{j.schedule}</td>
                  <td className="py-2 pr-4 text-muted-foreground">{j.last_run ? timeAgo(j.last_run) : "never"}</td>
                  <td className="py-2 pr-4">
                    <Badge variant="outline" className="gap-1.5">
                      <span className={`h-1.5 w-1.5 rounded-full ${ok ? "bg-emerald-500" : "bg-red-500"}`} />
                      {j.last_status ?? "unknown"}
                    </Badge>
                  </td>
                  <td className="py-2 pr-4">{j.fails_1h}</td>
                  <td className="py-2 pr-4 text-xs text-red-600 max-w-xs truncate">{j.last_error ?? "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}

function EdgeErrorsTab() {
  const { data, isLoading, error } = useQuery<DevHealth>({
    queryKey: ["dev-health-summary"],
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("fn_dev_health_summary");
      if (error) throw error;
      return data as DevHealth;
    },
    refetchInterval: 30_000,
  });

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (error || !data) return <p className="text-sm text-red-500">Failed to load edge error counts.</p>;

  return (
    <Card className="border-border/60 shadow-none">
      <CardHeader>
        <CardTitle className="text-sm font-medium">Edge Function Errors</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <div className="flex gap-6 text-sm">
          <span>401 Unauthorized: <span className="font-semibold">{data.edge_errors.err_401}</span></span>
          <span>500 Server Error: <span className="font-semibold">{data.edge_errors.err_500}</span></span>
        </div>
        <p className="text-xs text-muted-foreground">
          These counts cover the last 2 hours (pg_net response table is pruned every 2h).
        </p>
        <p className="text-xs text-muted-foreground">
          For detailed error logs, use the Supabase dashboard → Logs.
        </p>
      </CardContent>
    </Card>
  );
}

export default function SystemHealth() {
  return (
    <div className="p-6">
      <div className="space-y-1 mb-6">
        <h1 className="text-2xl font-bold">System Health</h1>
        <p className="text-sm text-muted-foreground">Infrastructure monitoring for super admins</p>
      </div>

      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="cron">Cron Jobs</TabsTrigger>
          <TabsTrigger value="edge">Edge Errors</TabsTrigger>
        </TabsList>
        <TabsContent value="overview" className="mt-4">
          <OverviewTab />
        </TabsContent>
        <TabsContent value="cron" className="mt-4">
          <CronJobsTab />
        </TabsContent>
        <TabsContent value="edge" className="mt-4">
          <EdgeErrorsTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
