import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AlertTriangle,
  CheckCircle2,
  ListPlus,
  Loader2,
  Mail,
  Megaphone,
  MessageSquare,
  PauseCircle,
  PlayCircle,
  RefreshCw,
  Send,
  StopCircle,
  XCircle,
} from "lucide-react";

type Channel = "whatsapp" | "email";

interface CampaignRow {
  id: string;
  channel: Channel;
  name: string;
  template: string | null;
  listName: string | null;
  total: number;
  sent: number;
  failed: number;
  pending: number;
  status: string;
  createdAt: string;
  completedAt: string | null;
  workerError: string | null;
}

interface FailureRow {
  id: string;
  destination: string;
  leadName: string | null;
  status: string;
  error: string | null;
}

const statusTone = (status: string) => {
  if (status === "completed") return "bg-emerald-100 text-emerald-700";
  if (status === "failed") return "bg-red-100 text-red-700";
  if (status === "sending") return "bg-blue-100 text-blue-700";
  if (status === "paused") return "bg-slate-100 text-slate-700";
  if (status === "terminated") return "bg-zinc-200 text-zinc-700";
  return "bg-amber-100 text-amber-700";
};

const pct = (num: number, den: number) => {
  if (!den) return "0.0%";
  return `${((num / den) * 100).toFixed(1)}%`;
};

const fmtDate = (value: string | null) => {
  if (!value) return "-";
  return new Date(value).toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
};

export default function Marketing() {
  const [campaigns, setCampaigns] = useState<CampaignRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [detailCampaign, setDetailCampaign] = useState<CampaignRow | null>(null);
  const [failures, setFailures] = useState<FailureRow[]>([]);
  const [failuresLoading, setFailuresLoading] = useState(false);
  const [queueingId, setQueueingId] = useState<string | null>(null);
  const [queueError, setQueueError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    const [waRes, emailRes] = await Promise.all([
      supabase
        .from("whatsapp_campaigns" as any)
        .select("id,name,template_key,total_recipients,sent_count,failed_count,status,created_at,completed_at,worker_error,lead_lists(name)")
        .order("created_at", { ascending: false })
        .limit(100),
      supabase
        .from("email_campaigns" as any)
        .select("id,name,template_slug,total_recipients,sent_count,failed_count,status,created_at,completed_at,worker_error,lead_lists(name)")
        .order("created_at", { ascending: false })
        .limit(100),
    ]);

    const waRows: CampaignRow[] = ((waRes.data as any[]) || []).map((row) => {
      const total = Number(row.total_recipients || 0);
      const sent = Number(row.sent_count || 0);
      const failed = Number(row.failed_count || 0);
      return {
        id: row.id,
        channel: "whatsapp",
        name: row.name,
        template: row.template_key,
        listName: row.lead_lists?.name || null,
        total,
        sent,
        failed,
        pending: row.status === "completed" || row.status === "failed" || row.status === "terminated" ? 0 : Math.max(0, total - sent - failed),
        status: row.status || "pending",
        createdAt: row.created_at,
        completedAt: row.completed_at,
        workerError: row.worker_error || null,
      };
    });

    const emailRows: CampaignRow[] = ((emailRes.data as any[]) || []).map((row) => {
      const total = Number(row.total_recipients || 0);
      const sent = Number(row.sent_count || 0);
      const failed = Number(row.failed_count || 0);
      return {
        id: row.id,
        channel: "email",
        name: row.name,
        template: row.template_slug || "custom",
        listName: row.lead_lists?.name || null,
        total,
        sent,
        failed,
        pending: row.status === "completed" || row.status === "failed" || row.status === "terminated" ? 0 : Math.max(0, total - sent - failed),
        status: row.status || "pending",
        createdAt: row.created_at,
        completedAt: row.completed_at,
        workerError: row.worker_error || null,
      };
    });

    setCampaigns([...waRows, ...emailRows].sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const totals = useMemo(() => {
    return campaigns.reduce(
      (acc, item) => {
        acc.total += item.total;
        acc.sent += item.sent;
        acc.failed += item.failed;
        acc.pending += item.pending;
        if (item.channel === "whatsapp") acc.whatsapp += item.sent;
        if (item.channel === "email") acc.email += item.sent;
        return acc;
      },
      { total: 0, sent: 0, failed: 0, pending: 0, whatsapp: 0, email: 0 },
    );
  }, [campaigns]);

  const openFailures = async (campaign: CampaignRow) => {
    setDetailCampaign(campaign);
    setFailuresLoading(true);
    const table = campaign.channel === "whatsapp" ? "whatsapp_campaign_recipients" : "email_campaign_recipients";
    const destinationColumn = campaign.channel === "whatsapp" ? "phone" : "to_email";
    const { data } = await supabase
      .from(table as any)
      .select(`id,status,error_message,${destinationColumn},leads(name)`)
      .eq("campaign_id", campaign.id)
      .in("status", ["failed", "skipped"])
      .order("created_at", { ascending: false })
      .limit(100);

    setFailures(((data as any[]) || []).map((row) => ({
      id: row.id,
      destination: row[destinationColumn] || "-",
      leadName: row.leads?.name || null,
      status: row.status,
      error: row.error_message || null,
    })));
    setFailuresLoading(false);
  };

  const resumeCampaign = async (campaign: CampaignRow) => {
    setQueueingId(campaign.id);
    setQueueError(null);
    const table = campaign.channel === "whatsapp" ? "whatsapp_campaigns" : "email_campaigns";
    const { error } = await supabase
      .from(table as any)
      .update({
        status: "pending",
        next_attempt_at: new Date().toISOString(),
        worker_locked_at: null,
        worker_error: null,
      })
      .eq("id", campaign.id);
    if (error) {
      setQueueError(error.message);
      setQueueingId(null);
      await load();
      return;
    }
    supabase.functions.invoke("campaign-dispatcher", { body: { limit: 1, batch_size: 10 } }).catch(() => {});
    setQueueingId(null);
    await load();
  };

  const pauseCampaign = async (campaign: CampaignRow) => {
    setQueueingId(campaign.id);
    setQueueError(null);
    const table = campaign.channel === "whatsapp" ? "whatsapp_campaigns" : "email_campaigns";
    const { error } = await supabase
      .from(table as any)
      .update({
        status: "paused",
        next_attempt_at: null,
        worker_locked_at: null,
        worker_error: null,
      })
      .eq("id", campaign.id);
    if (error) setQueueError(error.message);
    setQueueingId(null);
    await load();
  };

  const terminateCampaign = async (campaign: CampaignRow) => {
    const ok = window.confirm(`Terminate "${campaign.name}"? Pending recipients will not be sent.`);
    if (!ok) return;

    setQueueingId(campaign.id);
    setQueueError(null);
    const table = campaign.channel === "whatsapp" ? "whatsapp_campaigns" : "email_campaigns";
    const { error } = await supabase
      .from(table as any)
      .update({
        status: "terminated",
        completed_at: new Date().toISOString(),
        next_attempt_at: null,
        worker_locked_at: null,
        worker_error: null,
      })
      .eq("id", campaign.id);
    if (error) setQueueError(error.message);
    setQueueingId(null);
    await load();
  };

  return (
    <div className="space-y-5 p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Marketing</h1>
          <p className="text-sm text-muted-foreground">
            Campaign performance for WhatsApp and email outbound.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline" size="sm">
            <Link to="/lists"><ListPlus className="mr-2 h-4 w-4" /> Lists</Link>
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link to="/template-manager"><Megaphone className="mr-2 h-4 w-4" /> Templates</Link>
          </Button>
          <Button onClick={load} variant="outline" size="sm" disabled={loading}>
            <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Refresh
          </Button>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-4">
        <Metric title="Total recipients" value={totals.total.toLocaleString("en-IN")} icon={Megaphone} />
        <Metric title="Sent" value={totals.sent.toLocaleString("en-IN")} icon={CheckCircle2} tone="emerald" />
        <Metric title="Failed" value={totals.failed.toLocaleString("en-IN")} icon={XCircle} tone="red" />
        <Metric title="Success rate" value={pct(totals.sent, totals.sent + totals.failed)} icon={Send} tone="blue" />
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <Card>
          <CardContent className="flex items-center justify-between p-4">
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">WhatsApp sent</p>
              <p className="mt-1 text-2xl font-bold">{totals.whatsapp.toLocaleString("en-IN")}</p>
            </div>
            <MessageSquare className="h-8 w-8 text-emerald-600" />
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center justify-between p-4">
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Email sent</p>
              <p className="mt-1 text-2xl font-bold">{totals.email.toLocaleString("en-IN")}</p>
            </div>
            <Mail className="h-8 w-8 text-blue-600" />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="border-b border-border px-4 py-3">
            <p className="font-semibold">Campaigns</p>
            {queueError && <p className="mt-1 text-xs text-red-600">{queueError}</p>}
          </div>
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : campaigns.length === 0 ? (
            <div className="py-12 text-center text-sm text-muted-foreground">No campaigns yet.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-border bg-muted/30 text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3 text-left">Campaign</th>
                    <th className="px-4 py-3 text-left">Channel</th>
                    <th className="px-4 py-3 text-left">Status</th>
                    <th className="px-4 py-3 text-right">Recipients</th>
                    <th className="px-4 py-3 text-right">Sent</th>
                    <th className="px-4 py-3 text-right">Failed</th>
                    <th className="px-4 py-3 text-right">Success</th>
                    <th className="px-4 py-3 text-left">Created</th>
                    <th className="px-4 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {campaigns.map((campaign) => (
                    <tr key={`${campaign.channel}-${campaign.id}`} className="border-b border-border last:border-b-0">
                      <td className="px-4 py-3">
                        <p className="font-medium text-foreground">{campaign.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {campaign.template || "No template"}{campaign.listName ? ` - ${campaign.listName}` : ""}
                        </p>
                        {campaign.workerError && (
                          <p className="mt-1 text-xs text-red-600">{campaign.workerError}</p>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <Badge variant="outline" className="capitalize">{campaign.channel}</Badge>
                      </td>
                      <td className="px-4 py-3">
                        <Badge className={`border-0 ${statusTone(campaign.status)}`}>{campaign.status}</Badge>
                      </td>
                      <td className="px-4 py-3 text-right font-medium">{campaign.total.toLocaleString("en-IN")}</td>
                      <td className="px-4 py-3 text-right text-emerald-700">{campaign.sent.toLocaleString("en-IN")}</td>
                      <td className="px-4 py-3 text-right text-red-700">{campaign.failed.toLocaleString("en-IN")}</td>
                      <td className="px-4 py-3 text-right">{pct(campaign.sent, campaign.sent + campaign.failed)}</td>
                      <td className="px-4 py-3 text-muted-foreground">{fmtDate(campaign.createdAt)}</td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex flex-wrap justify-end gap-2">
                        {campaign.pending > 0 && campaign.status !== "paused" && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => resumeCampaign(campaign)}
                            disabled={queueingId === campaign.id}
                          >
                            {queueingId === campaign.id ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : null}
                            Queue
                          </Button>
                        )}
                        {campaign.status === "paused" && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => resumeCampaign(campaign)}
                            disabled={queueingId === campaign.id}
                          >
                            {queueingId === campaign.id ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <PlayCircle className="mr-1 h-3.5 w-3.5" />}
                            Resume
                          </Button>
                        )}
                        {campaign.pending > 0 && ["pending", "sending"].includes(campaign.status) && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => pauseCampaign(campaign)}
                            disabled={queueingId === campaign.id}
                          >
                            <PauseCircle className="mr-1 h-3.5 w-3.5" />
                            Pause
                          </Button>
                        )}
                        {campaign.pending > 0 && ["pending", "sending", "paused"].includes(campaign.status) && (
                          <Button
                            variant="outline"
                            size="sm"
                            className="text-red-700 hover:text-red-700"
                            onClick={() => terminateCampaign(campaign)}
                            disabled={queueingId === campaign.id}
                          >
                            <StopCircle className="mr-1 h-3.5 w-3.5" />
                            Terminate
                          </Button>
                        )}
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => openFailures(campaign)}
                          disabled={campaign.failed === 0}
                        >
                          Failures
                        </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!detailCampaign} onOpenChange={(open) => { if (!open) setDetailCampaign(null); }}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-red-600" />
              Failed recipients
            </DialogTitle>
          </DialogHeader>
          {failuresLoading ? (
            <div className="flex items-center justify-center py-10">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : failures.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">No failed recipients found.</div>
          ) : (
            <div className="max-h-[60vh] overflow-auto rounded-lg border border-border">
              <table className="w-full text-sm">
                <thead className="sticky top-0 border-b border-border bg-muted text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 text-left">Lead</th>
                    <th className="px-3 py-2 text-left">Destination</th>
                    <th className="px-3 py-2 text-left">Status</th>
                    <th className="px-3 py-2 text-left">Error</th>
                  </tr>
                </thead>
                <tbody>
                  {failures.map((row) => (
                    <tr key={row.id} className="border-b border-border last:border-b-0">
                      <td className="px-3 py-2 font-medium">{row.leadName || "-"}</td>
                      <td className="px-3 py-2">{row.destination}</td>
                      <td className="px-3 py-2">{row.status}</td>
                      <td className="px-3 py-2 text-muted-foreground">{row.error || "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Metric({
  title,
  value,
  icon: Icon,
  tone = "slate",
}: {
  title: string;
  value: string;
  icon: any;
  tone?: "slate" | "emerald" | "red" | "blue";
}) {
  const toneClass = {
    slate: "text-slate-600 bg-slate-100",
    emerald: "text-emerald-600 bg-emerald-100",
    red: "text-red-600 bg-red-100",
    blue: "text-blue-600 bg-blue-100",
  }[tone];

  return (
    <Card>
      <CardContent className="flex items-center justify-between p-4">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{title}</p>
          <p className="mt-1 text-2xl font-bold">{value}</p>
        </div>
        <div className={`rounded-lg p-2 ${toneClass}`}>
          <Icon className="h-5 w-5" />
        </div>
      </CardContent>
    </Card>
  );
}
