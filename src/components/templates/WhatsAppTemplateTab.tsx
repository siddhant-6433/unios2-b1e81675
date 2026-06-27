import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { invokeEdge } from "@/integrations/supabase/edge";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Loader2, Plus, Trash2, MessageSquare, RefreshCw, Send,
  CheckCircle, Clock, XCircle, AlertTriangle,
} from "lucide-react";
import {
  cahetDeadlineDescription,
  cahetDeadlineMessage,
} from "@/lib/deadlineRollover";
import { WhatsAppTemplateForm } from "./WhatsAppTemplateForm";

interface WaTemplateRow {
  id: string;
  meta_template_id: string | null;
  name: string;
  language: string;
  category: string | null;
  status: string;
  header_format: string | null;
  has_media: boolean;
  placeholder_count: number;
  components: TemplateComponent[] | null;
  reject_reason: string | null;
  quality_score: string | null;
  submitted_at: string | null;
}

interface TemplateButtonComponent {
  type?: string;
  text?: string;
}

interface TemplateComponent {
  type?: string;
  text?: string;
  buttons?: TemplateButtonComponent[];
}

// Pre-built templates ready to submit (match approved Meta templates).
const SUGGESTED_TEMPLATES = [
  {
    name: "nimt_new_staff",
    category: "UTILITY",
    body: "Welcome to NIMT Educational Institutions, {{1}}!\n\nYou have been added as {{2}} at {{3}}.\n\nPlease check your email for login details.\n\nFor any assistance, contact the admin office.",
    description: "Sent when a new staff/admin/teacher account is created (3 params: name, role, campus)",
  },
  {
    name: "nimt_student_admitted",
    category: "UTILITY",
    body: "Congratulations {{1}}!\n\nWelcome to NIMT Educational Institutions.\n\nAdmission No: {{2}}\nCourse: {{3}}\nCampus: {{4}}\n\nYou can access the student portal at https://uni.nimt.ac.in\n\nWe wish you a great academic journey ahead!",
    description: "Sent when a lead is converted to student (4 params: name, admission_no, course, campus)",
  },
  {
    name: "nimt_application_started",
    category: "UTILITY",
    body: "Hi {{1}}, thank you for starting your application at NIMT Educational Institutions!\n\nYour Application ID: {{2}}\nCourse: {{3}}\n\nComplete your application at https://uni.nimt.ac.in/apply/nimt/\n\nOur admissions team is here to help. Feel free to reach out anytime!",
    description: "Sent when a new applicant starts the application process (3 params: name, app_id, course)",
  },
  {
    name: "bpt_bmrit_cahet_deadline",
    category: "UTILITY",
    body: cahetDeadlineMessage(),
    description: `Sent to BPT/BMRIT applicants for the ${cahetDeadlineDescription()}`,
  },
];

function statusVisual(status: string) {
  const Icon = status === "APPROVED" ? CheckCircle
    : status === "PENDING" ? Clock
    : status === "REJECTED" ? XCircle
    : AlertTriangle;
  const color = status === "APPROVED" ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400"
    : status === "PENDING" ? "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400"
    : status === "REJECTED" ? "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
    : "bg-muted text-muted-foreground";
  return { Icon, color };
}

export function WhatsAppTemplateTab() {
  const { toast } = useToast();
  const [rows, setRows] = useState<WaTemplateRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [initialForm, setInitialForm] = useState<{ name?: string; category?: string; body?: string } | undefined>();

  const fetchRows = useCallback(async () => {
    const { data, error } = await supabase
      .from("whatsapp_templates" as never)
      .select("*")
      .order("submitted_at", { ascending: false });
    if (error) console.error("Failed to fetch whatsapp_templates:", error);
    if (data) setRows(data as unknown as WaTemplateRow[]);
    setLoading(false);
  }, []);

  // Initial load + realtime: status flips arrive live from the webhook.
  useEffect(() => {
    fetchRows();
    const channel = supabase
      .channel("whatsapp-templates")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "whatsapp_templates" },
        () => { fetchRows(); },
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [fetchRows]);

  const syncFromMeta = async () => {
    setSyncing(true);
    const { data, error } = await invokeEdge<{ synced?: number; error?: string }>("whatsapp-templates", { body: { action: "sync" } });
    if (error || data?.error) {
      toast({ title: "Sync failed", description: data?.error || error?.message, variant: "destructive" });
    } else {
      toast({ title: "Synced from Meta", description: `${data?.synced ?? 0} template(s) reconciled.` });
      await fetchRows();
    }
    setSyncing(false);
  };

  const deleteTemplate = async (name: string) => {
    setDeleting(name);
    const { data, error } = await invokeEdge<{ error?: string }>("whatsapp-templates", { body: { action: "delete", name } });
    if (error || data?.error) {
      toast({ title: "Delete failed", description: data?.error || error?.message, variant: "destructive" });
    } else {
      toast({ title: "Template deleted" });
      await fetchRows();
    }
    setDeleting(null);
  };

  const openSuggested = (s: typeof SUGGESTED_TEMPLATES[number]) => {
    setInitialForm({ name: s.name, category: s.category, body: s.body });
    setShowCreate(true);
  };

  const openBlank = () => {
    setInitialForm(undefined);
    setShowCreate(true);
  };

  const existingNames = new Set(rows.map((r) => r.name));
  const pendingSuggested = SUGGESTED_TEMPLATES.filter((s) => !existingNames.has(s.name));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <Button variant="outline" size="sm" className="gap-2" onClick={syncFromMeta} disabled={syncing}>
          <RefreshCw className={`h-3.5 w-3.5 ${syncing ? "animate-spin" : ""}`} /> Sync from Meta
        </Button>
        <Button size="sm" className="gap-2" onClick={openBlank}>
          <Plus className="h-4 w-4" /> New Template
        </Button>
      </div>

      {/* Suggested templates to submit */}
      {pendingSuggested.length > 0 && !loading && (
        <div className="rounded-xl border border-primary/20 bg-primary/[0.02] p-4 space-y-3">
          <div>
            <p className="text-sm font-semibold text-foreground">Ready to Submit</p>
            <p className="text-xs text-muted-foreground mt-0.5">{pendingSuggested.length} template(s) not yet submitted to Meta</p>
          </div>
          <div className="space-y-2">
            {pendingSuggested.map((s) => (
              <div key={s.name} className="flex items-start gap-3 rounded-lg border border-border bg-card p-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium text-foreground font-mono">{s.name}</p>
                    <Badge variant="outline" className="text-[9px]">{s.category}</Badge>
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-0.5">{s.description}</p>
                  <p className="text-xs text-foreground/70 mt-1.5 whitespace-pre-wrap bg-muted/30 rounded-lg px-2 py-1.5 line-clamp-3">{s.body}</p>
                </div>
                <Button size="sm" className="gap-1.5 shrink-0" onClick={() => openSuggested(s)}>
                  <Send className="h-3 w-3" /> Review &amp; Submit
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}

      {loading ? (
        <div className="flex h-32 items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
      ) : rows.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <MessageSquare className="h-8 w-8 mx-auto mb-2 opacity-30" />
          <p className="text-sm">No WhatsApp templates yet — submit one to Meta to get started.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {rows.map((t) => {
            const bodyComp = t.components?.find((c) => c.type === "BODY");
            const buttonComp = t.components?.find((c) => c.type === "BUTTONS");
            const { Icon, color } = statusVisual(t.status);
            return (
              <Card key={t.id} className="border-border/60 shadow-none">
                <CardContent className="p-5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <MessageSquare className="h-4 w-4 text-green-600" />
                      <h3 className="text-sm font-semibold text-foreground">{t.name}</h3>
                    </div>
                    <Badge className={`text-[9px] border-0 gap-1 ${color}`}>
                      <Icon className="h-3 w-3" />
                      {t.status}
                    </Badge>
                  </div>

                  {t.header_format && t.header_format !== "NONE" && (
                    <div className="mt-2">
                      <Badge variant="outline" className="text-[9px]">Header: {t.header_format}</Badge>
                    </div>
                  )}

                  {bodyComp?.text && (
                    <div className="mt-2 rounded-lg bg-muted/30 px-3 py-2">
                      <p className="text-[10px] font-semibold text-muted-foreground uppercase mb-0.5">Body</p>
                      <p className="text-xs text-foreground whitespace-pre-wrap">{bodyComp.text}</p>
                    </div>
                  )}

                  {t.status === "REJECTED" && t.reject_reason && (
                    <div className="mt-2 rounded-lg bg-red-50 dark:bg-red-950/20 px-3 py-2">
                      <p className="text-[10px] font-semibold text-red-700 dark:text-red-400 uppercase mb-0.5">Rejection reason</p>
                      <p className="text-xs text-red-700/90 dark:text-red-300">{t.reject_reason}</p>
                    </div>
                  )}

                  {buttonComp?.buttons && (
                    <div className="flex flex-wrap gap-1 mt-2">
                      {buttonComp.buttons.map((b, i) => (
                        <Badge key={i} variant="outline" className="text-[9px]">
                          {b.type === "URL" ? `🔗 ${b.text}` : b.text}
                        </Badge>
                      ))}
                    </div>
                  )}

                  <div className="flex items-center gap-2 mt-3 pt-2 border-t border-border/40">
                    <Badge variant="outline" className="text-[9px]">{t.category}</Badge>
                    <Badge variant="outline" className="text-[9px]">{t.language}</Badge>
                    {t.quality_score && (
                      <Badge variant="outline" className="text-[9px]">Quality: {t.quality_score}</Badge>
                    )}
                    <div className="ml-auto">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-muted-foreground hover:text-red-600"
                        disabled={deleting === t.name}
                        onClick={() => deleteTemplate(t.name)}
                      >
                        {deleting === t.name ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <WhatsAppTemplateForm
        key={showCreate ? (initialForm?.name ?? "blank") : "closed"}
        open={showCreate}
        onOpenChange={setShowCreate}
        onSubmitted={fetchRows}
        initial={initialForm}
      />
    </div>
  );
}
