import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Loader2, Zap, Plus, ArrowRight, MessageSquare, CalendarCheck, Clock, Trash2,
} from "lucide-react";

interface Rule {
  id: string;
  name: string;
  description: string | null;
  is_active: boolean;
  trigger_type: string;
  trigger_config: Record<string, any>;
  actions: any[];
  created_at: string;
}

interface Execution {
  id: string;
  rule_id: string;
  lead_id: string;
  actions_executed: any[];
  status: string;
  error_message: string | null;
  created_at: string;
}

const TRIGGER_LABELS: Record<string, string> = {
  stage_change: "Stage Change",
  activity_created: "Activity Created",
  followup_overdue: "Follow-up Overdue",
  time_elapsed: "Time Elapsed",
};

const TRIGGER_ICONS: Record<string, typeof ArrowRight> = {
  stage_change: ArrowRight,
  activity_created: Zap,
  followup_overdue: CalendarCheck,
  time_elapsed: Clock,
};

const ACTION_LABELS: Record<string, string> = {
  send_whatsapp: "Send WhatsApp",
  advance_stage: "Advance Stage",
  schedule_followup: "Schedule Follow-up",
};

const STAGE_LABELS: Record<string, string> = {
  new_lead: "New Lead", application_in_progress: "App In Progress",
  application_fee_paid: "Fee Paid", application_submitted: "Submitted",
  ai_called: "AI Called", counsellor_call: "Counsellor Call",
  visit_scheduled: "Visit Scheduled", interview: "Interview", offer_sent: "Offer Sent",
  token_paid: "Token Paid", pre_admitted: "Pre-Admitted", admitted: "Admitted",
};

const STAGES = Object.keys(STAGE_LABELS);

const TEMPLATES = [
  { key: "lead_welcome", label: "Lead Welcome" },
  { key: "visit_confirmation", label: "Visit Confirmation" },
  { key: "application_received", label: "Application Received" },
  { key: "fee_reminder", label: "Fee Reminder" },
  { key: "course_details", label: "Course Details" },
];

const AutomationRules = () => {
  const { toast } = useToast();
  const { user } = useAuth();
  const [rules, setRules] = useState<Rule[]>([]);
  const [executions, setExecutions] = useState<Execution[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"rules" | "log">("rules");
  const [showCreate, setShowCreate] = useState(false);

  // Create form state
  const [formName, setFormName] = useState("");
  const [formDesc, setFormDesc] = useState("");
  const [formTrigger, setFormTrigger] = useState("stage_change");
  const [formToStage, setFormToStage] = useState("application_submitted");
  const [formElapsedDays, setFormElapsedDays] = useState("3");
  const [formElapsedStage, setFormElapsedStage] = useState("offer_sent");
  const [formActionType, setFormActionType] = useState("send_whatsapp");
  const [formTemplate, setFormTemplate] = useState("application_received");
  const [formAdvanceStage, setFormAdvanceStage] = useState("counsellor_call");
  const [formFollowupType, setFormFollowupType] = useState("call");
  const [formFollowupDelay, setFormFollowupDelay] = useState("24");
  const [saving, setSaving] = useState(false);

  const fetchData = async () => {
    const [rulesR, execR] = await Promise.all([
      supabase.from("automation_rules" as any).select("*").order("priority", { ascending: false }),
      supabase.from("automation_rule_executions" as any).select("*").order("created_at", { ascending: false }).limit(50),
    ]);
    if (rulesR.data) setRules(rulesR.data as any);
    if (execR.data) setExecutions(execR.data as any);
    setLoading(false);
  };

  useEffect(() => { fetchData(); }, []);

  const toggleRule = async (id: string, active: boolean) => {
    await supabase.from("automation_rules" as any).update({ is_active: active } as any).eq("id", id);
    setRules(prev => prev.map(r => r.id === id ? { ...r, is_active: active } : r));
  };

  const deleteRule = async (id: string) => {
    await supabase.from("automation_rules" as any).delete().eq("id", id);
    setRules(prev => prev.filter(r => r.id !== id));
    toast({ title: "Rule deleted" });
  };

  const handleCreate = async () => {
    if (!formName.trim()) return;
    setSaving(true);

    let triggerConfig: Record<string, any> = {};
    if (formTrigger === "stage_change") triggerConfig = { to_stage: formToStage };
    else if (formTrigger === "time_elapsed") triggerConfig = { stage: formElapsedStage, elapsed_days: parseInt(formElapsedDays) };

    let actions: any[] = [];
    if (formActionType === "send_whatsapp") actions = [{ type: "send_whatsapp", template_key: formTemplate }];
    else if (formActionType === "advance_stage") actions = [{ type: "advance_stage", to_stage: formAdvanceStage }];
    else if (formActionType === "schedule_followup") actions = [{ type: "schedule_followup", delay_hours: parseInt(formFollowupDelay), followup_type: formFollowupType }];

    let profileId: string | null = null;
    if (user?.id) {
      const { data: p } = await supabase.from("profiles").select("id").eq("user_id", user.id).single();
      profileId = p?.id || null;
    }

    await supabase.from("automation_rules" as any).insert({
      name: formName.trim(),
      description: formDesc.trim() || null,
      trigger_type: formTrigger,
      trigger_config: triggerConfig,
      actions,
      is_active: false,
      created_by: profileId,
    } as any);

    setSaving(false);
    setShowCreate(false);
    setFormName(""); setFormDesc("");
    fetchData();
    toast({ title: "Rule created" });
  };

  const inputCls = "w-full rounded-xl border border-input bg-background px-3 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring/20";

  if (loading) return <div className="flex h-64 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Automation Rules</h1>
          <p className="text-sm text-muted-foreground mt-1">Configure triggers and actions for lead automation</p>
        </div>
        <Button onClick={() => setShowCreate(true)} className="gap-2"><Plus className="h-4 w-4" /> Create Rule</Button>
      </div>

      <div className="flex rounded-xl border border-input bg-card p-0.5 w-fit">
        <button onClick={() => setTab("rules")}
          className={`rounded-lg px-4 py-1.5 text-xs font-medium transition-colors ${tab === "rules" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}>
          Rules ({rules.length})
        </button>
        <button onClick={() => setTab("log")}
          className={`rounded-lg px-4 py-1.5 text-xs font-medium transition-colors ${tab === "log" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}>
          Execution Log
        </button>
      </div>

      {tab === "rules" ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {rules.map((rule) => {
            const TriggerIcon = TRIGGER_ICONS[rule.trigger_type] || Zap;
            return (
              <Card key={rule.id} className={`border-border/60 shadow-none ${rule.is_active ? "" : "opacity-60"}`}>
                <CardContent className="p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <div className={`flex h-8 w-8 items-center justify-center rounded-lg ${rule.is_active ? "bg-primary/10" : "bg-muted"}`}>
                        <TriggerIcon className={`h-4 w-4 ${rule.is_active ? "text-primary" : "text-muted-foreground"}`} />
                      </div>
                      <div>
                        <h3 className="text-sm font-semibold text-foreground">{rule.name}</h3>
                        {rule.description && <p className="text-xs text-muted-foreground mt-0.5">{rule.description}</p>}
                      </div>
                    </div>
                    <Switch checked={rule.is_active} onCheckedChange={(v) => toggleRule(rule.id, v)} />
                  </div>

                  <div className="mt-3 space-y-1.5">
                    <div className="flex items-center gap-1.5">
                      <Badge variant="outline" className="text-[9px]">{TRIGGER_LABELS[rule.trigger_type]}</Badge>
                      {rule.trigger_config.to_stage && (
                        <span className="text-[10px] text-muted-foreground">→ {STAGE_LABELS[rule.trigger_config.to_stage] || rule.trigger_config.to_stage}</span>
                      )}
                      {rule.trigger_config.elapsed_days && (
                        <span className="text-[10px] text-muted-foreground">{rule.trigger_config.elapsed_days}d in {STAGE_LABELS[rule.trigger_config.stage] || rule.trigger_config.stage}</span>
                      )}
                    </div>
                    {rule.actions.map((a: any, i: number) => (
                      <div key={i} className="flex items-center gap-1.5">
                        {a.type === "send_whatsapp" && <MessageSquare className="h-3 w-3 text-green-600" />}
                        {a.type === "advance_stage" && <ArrowRight className="h-3 w-3 text-violet-600" />}
                        {a.type === "schedule_followup" && <CalendarCheck className="h-3 w-3 text-orange-600" />}
                        <span className="text-[10px] text-foreground">
                          {ACTION_LABELS[a.type]}
                          {a.template_key && `: ${a.template_key}`}
                          {a.to_stage && ` → ${STAGE_LABELS[a.to_stage] || a.to_stage}`}
                          {a.delay_hours && ` in ${a.delay_hours}h (${a.followup_type})`}
                        </span>
                      </div>
                    ))}
                  </div>

                  <div className="flex items-center justify-between mt-3 pt-2 border-t border-border/40">
                    <span className="text-[10px] text-muted-foreground">{new Date(rule.created_at).toLocaleDateString("en-IN")}</span>
                    <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-red-600" onClick={() => deleteRule(rule.id)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
          {rules.length === 0 && (
            <div className="col-span-2 text-center py-12 text-muted-foreground">
              <Zap className="h-8 w-8 mx-auto mb-2 opacity-30" />
              <p className="text-sm">No automation rules yet</p>
            </div>
          )}
        </div>
      ) : (
        <Card className="border-border/60 shadow-none overflow-hidden">
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/50">
                  <th className="px-4 py-2 text-left text-xs font-semibold text-muted-foreground uppercase">Rule</th>
                  <th className="px-4 py-2 text-left text-xs font-semibold text-muted-foreground uppercase">Actions</th>
                  <th className="px-4 py-2 text-center text-xs font-semibold text-muted-foreground uppercase">Status</th>
                  <th className="px-4 py-2 text-left text-xs font-semibold text-muted-foreground uppercase">Time</th>
                </tr>
              </thead>
              <tbody>
                {executions.map((ex) => {
                  const rule = rules.find(r => r.id === ex.rule_id);
                  return (
                    <tr key={ex.id} className="border-b border-border last:border-0">
                      <td className="px-4 py-2 font-medium text-foreground text-xs">{rule?.name || ex.rule_id.slice(0, 8)}</td>
                      <td className="px-4 py-2 text-xs text-muted-foreground">
                        {(ex.actions_executed || []).map((a: any) => ACTION_LABELS[a.type] || a.type).join(", ")}
                      </td>
                      <td className="px-4 py-2 text-center">
                        <Badge className={`text-[9px] border-0 ${ex.status === "success" ? "bg-emerald-100 text-emerald-700" : ex.status === "partial" ? "bg-amber-100 text-amber-700" : "bg-red-100 text-red-700"}`}>
                          {ex.status}
                        </Badge>
                      </td>
                      <td className="px-4 py-2 text-xs text-muted-foreground">{new Date(ex.created_at).toLocaleString("en-IN")}</td>
                    </tr>
                  );
                })}
                {executions.length === 0 && (
                  <tr><td colSpan={4} className="px-4 py-8 text-center text-sm text-muted-foreground">No executions yet</td></tr>
                )}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      {/* Create Rule Dialog */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Create Automation Rule</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="block text-[11px] font-medium text-muted-foreground mb-1">Rule Name *</label>
              <input value={formName} onChange={e => setFormName(e.target.value)} placeholder="e.g. Send welcome WhatsApp" className={inputCls} />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-muted-foreground mb-1">Description</label>
              <input value={formDesc} onChange={e => setFormDesc(e.target.value)} placeholder="Optional" className={inputCls} />
            </div>

            <div>
              <label className="block text-[11px] font-medium text-muted-foreground mb-1">Trigger</label>
              <select value={formTrigger} onChange={e => setFormTrigger(e.target.value)} className={inputCls}>
                <option value="stage_change">When stage changes to...</option>
                <option value="time_elapsed">When lead is in a stage for X days...</option>
              </select>
            </div>

            {formTrigger === "stage_change" && (
              <div>
                <label className="block text-[11px] font-medium text-muted-foreground mb-1">Target Stage</label>
                <select value={formToStage} onChange={e => setFormToStage(e.target.value)} className={inputCls}>
                  {STAGES.map(s => <option key={s} value={s}>{STAGE_LABELS[s]}</option>)}
                </select>
              </div>
            )}

            {formTrigger === "time_elapsed" && (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-medium text-muted-foreground mb-1">Stage</label>
                  <select value={formElapsedStage} onChange={e => setFormElapsedStage(e.target.value)} className={inputCls}>
                    {STAGES.map(s => <option key={s} value={s}>{STAGE_LABELS[s]}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-muted-foreground mb-1">Days Elapsed</label>
                  <input type="number" min="1" value={formElapsedDays} onChange={e => setFormElapsedDays(e.target.value)} className={inputCls} />
                </div>
              </div>
            )}

            <div>
              <label className="block text-[11px] font-medium text-muted-foreground mb-1">Action</label>
              <select value={formActionType} onChange={e => setFormActionType(e.target.value)} className={inputCls}>
                <option value="send_whatsapp">Send WhatsApp Template</option>
                <option value="advance_stage">Advance Stage</option>
                <option value="schedule_followup">Schedule Follow-up</option>
              </select>
            </div>

            {formActionType === "send_whatsapp" && (
              <div>
                <label className="block text-[11px] font-medium text-muted-foreground mb-1">Template</label>
                <select value={formTemplate} onChange={e => setFormTemplate(e.target.value)} className={inputCls}>
                  {TEMPLATES.map(t => <option key={t.key} value={t.key}>{t.label}</option>)}
                </select>
              </div>
            )}

            {formActionType === "advance_stage" && (
              <div>
                <label className="block text-[11px] font-medium text-muted-foreground mb-1">Advance To</label>
                <select value={formAdvanceStage} onChange={e => setFormAdvanceStage(e.target.value)} className={inputCls}>
                  {STAGES.map(s => <option key={s} value={s}>{STAGE_LABELS[s]}</option>)}
                </select>
              </div>
            )}

            {formActionType === "schedule_followup" && (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-medium text-muted-foreground mb-1">Type</label>
                  <select value={formFollowupType} onChange={e => setFormFollowupType(e.target.value)} className={inputCls}>
                    <option value="call">Call</option>
                    <option value="whatsapp">WhatsApp</option>
                    <option value="email">Email</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-muted-foreground mb-1">Delay (hours)</label>
                  <input type="number" min="1" value={formFollowupDelay} onChange={e => setFormFollowupDelay(e.target.value)} className={inputCls} />
                </div>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreate(false)}>Cancel</Button>
            <Button onClick={handleCreate} disabled={!formName.trim() || saving} className="gap-2">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />} Create Rule
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default AutomationRules;
