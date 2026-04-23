import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Loader2, Zap, Plus, ArrowRight, MessageSquare, CalendarCheck, Clock, Trash2,
  Mail, Bell, UserPlus, Edit, Thermometer, X,
} from "lucide-react";

interface Rule {
  id: string;
  name: string;
  description: string | null;
  is_active: boolean;
  trigger_type: string;
  trigger_config: Record<string, any>;
  actions: any[];
  campus_id: string | null;
  priority: number;
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
  lead_created: "Lead Created",
  stage_change: "Stage Changed",
  lead_assigned: "Lead Assigned",
  activity_created: "Activity Logged",
  followup_overdue: "Follow-up Overdue",
  time_elapsed: "Time Elapsed in Stage",
  visit_scheduled: "Visit Scheduled",
  visit_completed: "Visit Completed",
};

const TRIGGER_ICONS: Record<string, typeof Zap> = {
  lead_created: Plus,
  stage_change: ArrowRight,
  lead_assigned: UserPlus,
  activity_created: Zap,
  followup_overdue: CalendarCheck,
  time_elapsed: Clock,
  visit_scheduled: CalendarCheck,
  visit_completed: CalendarCheck,
};

const TRIGGER_DESCRIPTIONS: Record<string, string> = {
  lead_created: "Fires when a new lead is added from any source",
  stage_change: "Fires when a lead's stage changes",
  lead_assigned: "Fires when a lead is assigned to a counsellor",
  activity_created: "Fires when an activity is logged (call, note, WhatsApp, etc.)",
  followup_overdue: "Fires when a scheduled follow-up becomes overdue",
  time_elapsed: "Fires when a lead stays in a stage for X days",
};

const ACTION_LABELS: Record<string, string> = {
  send_whatsapp: "Send WhatsApp",
  send_email: "Send Email",
  advance_stage: "Change Stage",
  schedule_followup: "Schedule Follow-up",
  create_notification: "Send Notification",
  update_field: "Update Field",
  assign_counsellor: "Assign Counsellor",
};

const ACTION_ICONS: Record<string, typeof Zap> = {
  send_whatsapp: MessageSquare,
  send_email: Mail,
  advance_stage: ArrowRight,
  schedule_followup: CalendarCheck,
  create_notification: Bell,
  update_field: Edit,
  assign_counsellor: UserPlus,
};

const STAGES: Record<string, string> = {
  new_lead: "New Lead", application_in_progress: "App In Progress",
  application_fee_paid: "Fee Paid", application_submitted: "Submitted",
  ai_called: "AI Called", counsellor_call: "In Follow Up",
  visit_scheduled: "Visit Scheduled", interview: "Interview", offer_sent: "Offer Sent",
  token_paid: "Token Paid", pre_admitted: "Pre-Admitted", admitted: "Admitted",
  waitlisted: "Waitlisted", rejected: "Rejected",
};

const ACTIVITY_TYPES = [
  { value: "call", label: "Call" }, { value: "whatsapp", label: "WhatsApp" },
  { value: "email", label: "Email" }, { value: "note", label: "Note" },
  { value: "visit", label: "Visit" }, { value: "lead_created", label: "Lead Created" },
];

const WA_TEMPLATES = [
  { key: "lead_welcome", label: "Lead Welcome" },
  { key: "visit_confirmed", label: "Visit Confirmation" },
  { key: "visit_reminder", label: "Visit Reminder" },
  { key: "application_received", label: "Application Received" },
  { key: "fee_reminder", label: "Fee Reminder" },
  { key: "course_info_video", label: "Course Info" },
];

const SOURCES = [
  "website", "meta_ads", "google_ads", "justdial", "shiksha",
  "collegedunia", "collegehai", "walk_in", "referral", "consultant", "education_fair",
];

// ── Action builder helper ──
interface ActionConfig {
  type: string;
  template_key?: string;
  template_slug?: string;
  to_stage?: string;
  delay_hours?: number;
  followup_type?: string;
  notify_counsellor?: boolean;
  title?: string;
  body?: string;
  field?: string;
  value?: string;
}

const emptyAction = (): ActionConfig => ({ type: "send_whatsapp", template_key: "lead_welcome" });

const AutomationRules = () => {
  const { toast } = useToast();
  const { user } = useAuth();
  const [rules, setRules] = useState<Rule[]>([]);
  const [executions, setExecutions] = useState<Execution[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"rules" | "log">("rules");
  const [showCreate, setShowCreate] = useState(false);
  const [saving, setSaving] = useState(false);

  // Email templates for send_email action
  const [emailTemplates, setEmailTemplates] = useState<{ slug: string; name: string }[]>([]);

  // ── Create form ──
  const [formName, setFormName] = useState("");
  const [formDesc, setFormDesc] = useState("");
  const [formTrigger, setFormTrigger] = useState("lead_created");
  const [formPriority, setFormPriority] = useState("0");

  // Trigger config
  const [formToStage, setFormToStage] = useState("application_submitted");
  const [formFromStage, setFormFromStage] = useState("");
  const [formActivityType, setFormActivityType] = useState("call");
  const [formElapsedDays, setFormElapsedDays] = useState("3");
  const [formElapsedStage, setFormElapsedStage] = useState("new_lead");

  // Conditions
  const [formCondSource, setFormCondSource] = useState("");
  const [formCondTemp, setFormCondTemp] = useState("");
  const [formCondHasEmail, setFormCondHasEmail] = useState("");

  // Actions (multi)
  const [formActions, setFormActions] = useState<ActionConfig[]>([emptyAction()]);

  const fetchData = async () => {
    const [rulesR, execR, emailR] = await Promise.all([
      supabase.from("automation_rules" as any).select("*").order("priority", { ascending: false }),
      supabase.from("automation_rule_executions" as any).select("*").order("created_at", { ascending: false }).limit(50),
      supabase.from("email_templates" as any).select("slug, name").eq("is_active", true).order("name"),
    ]);
    if (rulesR.data) setRules(rulesR.data as any);
    if (execR.data) setExecutions(execR.data as any);
    if (emailR.data) setEmailTemplates(emailR.data as any);
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

  const updateAction = (index: number, updates: Partial<ActionConfig>) => {
    setFormActions(prev => prev.map((a, i) => i === index ? { ...a, ...updates } : a));
  };

  const removeAction = (index: number) => {
    setFormActions(prev => prev.filter((_, i) => i !== index));
  };

  const resetForm = () => {
    setFormName(""); setFormDesc(""); setFormTrigger("lead_created"); setFormPriority("0");
    setFormToStage("application_submitted"); setFormFromStage(""); setFormActivityType("call");
    setFormElapsedDays("3"); setFormElapsedStage("new_lead");
    setFormCondSource(""); setFormCondTemp(""); setFormCondHasEmail("");
    setFormActions([emptyAction()]);
  };

  const handleCreate = async () => {
    if (!formName.trim() || formActions.length === 0) return;
    setSaving(true);

    const triggerConfig: Record<string, any> = {};
    const conditions: Record<string, any> = {};

    // Trigger config
    if (formTrigger === "stage_change") {
      triggerConfig.to_stage = formToStage;
      if (formFromStage) triggerConfig.from_stage = formFromStage;
    } else if (formTrigger === "activity_created") {
      triggerConfig.activity_type = formActivityType;
    } else if (formTrigger === "time_elapsed") {
      triggerConfig.stage = formElapsedStage;
      triggerConfig.elapsed_days = parseInt(formElapsedDays);
    }

    // Conditions
    if (formCondSource) conditions.source = formCondSource;
    if (formCondTemp) conditions.temperature = formCondTemp;
    if (formCondHasEmail === "yes") conditions.has_email = true;
    if (formCondHasEmail === "no") conditions.has_email = false;
    if (Object.keys(conditions).length > 0) triggerConfig.conditions = conditions;

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
      actions: formActions,
      is_active: false,
      priority: parseInt(formPriority) || 0,
      created_by: profileId,
    } as any);

    setSaving(false);
    setShowCreate(false);
    resetForm();
    fetchData();
    toast({ title: "Rule created", description: "Activate it with the toggle." });
  };

  const inputCls = "w-full rounded-xl border border-input bg-background px-3 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring/20";

  if (loading) return <div className="flex h-64 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Automation Engine</h1>
          <p className="text-sm text-muted-foreground mt-1">Configure triggers, conditions, and actions for lead automation</p>
        </div>
        <Button onClick={() => { resetForm(); setShowCreate(true); }} className="gap-2"><Plus className="h-4 w-4" /> Create Rule</Button>
      </div>

      <div className="flex rounded-xl border border-input bg-card p-0.5 w-fit">
        <button onClick={() => setTab("rules")}
          className={`rounded-lg px-4 py-1.5 text-xs font-medium transition-colors ${tab === "rules" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}>
          Rules ({rules.length})
        </button>
        <button onClick={() => setTab("log")}
          className={`rounded-lg px-4 py-1.5 text-xs font-medium transition-colors ${tab === "log" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}>
          Execution Log ({executions.length})
        </button>
      </div>

      {tab === "rules" ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {rules.map((rule) => {
            const TriggerIcon = TRIGGER_ICONS[rule.trigger_type] || Zap;
            const config = rule.trigger_config || {};
            const conditions = config.conditions || {};
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

                  {/* Trigger */}
                  <div className="mt-3 space-y-1.5">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <Badge variant="outline" className="text-[9px] bg-blue-50 dark:bg-blue-950/20 border-blue-200 dark:border-blue-800">
                        WHEN: {TRIGGER_LABELS[rule.trigger_type]}
                      </Badge>
                      {config.to_stage && <span className="text-[10px] text-muted-foreground">→ {STAGES[config.to_stage] || config.to_stage}</span>}
                      {config.from_stage && <span className="text-[10px] text-muted-foreground">from {STAGES[config.from_stage]}</span>}
                      {config.activity_type && <span className="text-[10px] text-muted-foreground">type: {config.activity_type}</span>}
                      {config.elapsed_days && <span className="text-[10px] text-muted-foreground">{config.elapsed_days}d in {STAGES[config.stage]}</span>}
                    </div>

                    {/* Conditions */}
                    {Object.keys(conditions).length > 0 && (
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <Badge variant="outline" className="text-[9px] bg-amber-50 dark:bg-amber-950/20 border-amber-200 dark:border-amber-800">IF</Badge>
                        {conditions.source && <span className="text-[10px] text-muted-foreground">source={conditions.source}</span>}
                        {conditions.temperature && <span className="text-[10px] text-muted-foreground">temp={conditions.temperature}</span>}
                        {conditions.has_email !== undefined && <span className="text-[10px] text-muted-foreground">{conditions.has_email ? "has email" : "no email"}</span>}
                      </div>
                    )}

                    {/* Actions */}
                    {rule.actions.map((a: any, i: number) => {
                      const AIcon = ACTION_ICONS[a.type] || Zap;
                      return (
                        <div key={i} className="flex items-center gap-1.5">
                          <Badge variant="outline" className="text-[9px] bg-emerald-50 dark:bg-emerald-950/20 border-emerald-200 dark:border-emerald-800">
                            THEN
                          </Badge>
                          <AIcon className="h-3 w-3 text-muted-foreground" />
                          <span className="text-[10px] text-foreground">
                            {ACTION_LABELS[a.type] || a.type}
                            {a.template_key && `: ${a.template_key}`}
                            {a.template_slug && `: ${a.template_slug}`}
                            {a.to_stage && ` → ${STAGES[a.to_stage] || a.to_stage}`}
                            {a.delay_hours && ` in ${a.delay_hours}h`}
                            {a.title && `: "${a.title}"`}
                          </span>
                        </div>
                      );
                    })}
                  </div>

                  <div className="flex items-center justify-between mt-3 pt-2 border-t border-border/40">
                    <div className="flex gap-1.5">
                      <Badge variant="outline" className="text-[9px]">Priority: {rule.priority}</Badge>
                      <span className="text-[10px] text-muted-foreground">{new Date(rule.created_at).toLocaleDateString("en-IN")}</span>
                    </div>
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
              <p className="text-xs mt-1">Create your first rule to automate lead workflows</p>
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

      {/* ── Create Rule Dialog ── */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Create Automation Rule</DialogTitle></DialogHeader>
          <div className="space-y-4">
            {/* Basic info */}
            <div className="grid grid-cols-3 gap-3">
              <div className="col-span-2">
                <label className="block text-[11px] font-medium text-muted-foreground mb-1">Rule Name *</label>
                <input value={formName} onChange={e => setFormName(e.target.value)} placeholder="e.g. Welcome new leads" className={inputCls} />
              </div>
              <div>
                <label className="block text-[11px] font-medium text-muted-foreground mb-1">Priority</label>
                <input type="number" value={formPriority} onChange={e => setFormPriority(e.target.value)} className={inputCls} />
              </div>
            </div>
            <div>
              <label className="block text-[11px] font-medium text-muted-foreground mb-1">Description</label>
              <input value={formDesc} onChange={e => setFormDesc(e.target.value)} placeholder="Optional" className={inputCls} />
            </div>

            {/* ── TRIGGER ── */}
            <div className="rounded-lg border border-blue-200 dark:border-blue-800/40 bg-blue-50/50 dark:bg-blue-950/10 p-3 space-y-3">
              <p className="text-[11px] font-semibold text-blue-700 dark:text-blue-400 uppercase tracking-wider">When (Trigger)</p>
              <select value={formTrigger} onChange={e => setFormTrigger(e.target.value)} className={inputCls}>
                {Object.entries(TRIGGER_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </select>
              {TRIGGER_DESCRIPTIONS[formTrigger] && (
                <p className="text-[10px] text-muted-foreground">{TRIGGER_DESCRIPTIONS[formTrigger]}</p>
              )}

              {formTrigger === "stage_change" && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[10px] text-muted-foreground mb-1">From Stage (optional)</label>
                    <select value={formFromStage} onChange={e => setFormFromStage(e.target.value)} className={inputCls}>
                      <option value="">Any stage</option>
                      {Object.entries(STAGES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-[10px] text-muted-foreground mb-1">To Stage *</label>
                    <select value={formToStage} onChange={e => setFormToStage(e.target.value)} className={inputCls}>
                      {Object.entries(STAGES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                    </select>
                  </div>
                </div>
              )}

              {formTrigger === "activity_created" && (
                <div>
                  <label className="block text-[10px] text-muted-foreground mb-1">Activity Type</label>
                  <select value={formActivityType} onChange={e => setFormActivityType(e.target.value)} className={inputCls}>
                    {ACTIVITY_TYPES.map(a => <option key={a.value} value={a.value}>{a.label}</option>)}
                  </select>
                </div>
              )}

              {formTrigger === "time_elapsed" && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[10px] text-muted-foreground mb-1">In Stage</label>
                    <select value={formElapsedStage} onChange={e => setFormElapsedStage(e.target.value)} className={inputCls}>
                      {Object.entries(STAGES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-[10px] text-muted-foreground mb-1">For Days</label>
                    <input type="number" min="1" value={formElapsedDays} onChange={e => setFormElapsedDays(e.target.value)} className={inputCls} />
                  </div>
                </div>
              )}
            </div>

            {/* ── CONDITIONS ── */}
            <div className="rounded-lg border border-amber-200 dark:border-amber-800/40 bg-amber-50/50 dark:bg-amber-950/10 p-3 space-y-3">
              <p className="text-[11px] font-semibold text-amber-700 dark:text-amber-400 uppercase tracking-wider">If (Conditions) — optional</p>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-[10px] text-muted-foreground mb-1">Source</label>
                  <select value={formCondSource} onChange={e => setFormCondSource(e.target.value)} className={inputCls}>
                    <option value="">Any</option>
                    {SOURCES.map(s => <option key={s} value={s}>{s.replace(/_/g, " ")}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] text-muted-foreground mb-1">Temperature</label>
                  <select value={formCondTemp} onChange={e => setFormCondTemp(e.target.value)} className={inputCls}>
                    <option value="">Any</option>
                    <option value="hot">Hot</option>
                    <option value="warm">Warm</option>
                    <option value="cold">Cold</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] text-muted-foreground mb-1">Has Email</label>
                  <select value={formCondHasEmail} onChange={e => setFormCondHasEmail(e.target.value)} className={inputCls}>
                    <option value="">Any</option>
                    <option value="yes">Yes</option>
                    <option value="no">No</option>
                  </select>
                </div>
              </div>
            </div>

            {/* ── ACTIONS ── */}
            <div className="rounded-lg border border-emerald-200 dark:border-emerald-800/40 bg-emerald-50/50 dark:bg-emerald-950/10 p-3 space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-[11px] font-semibold text-emerald-700 dark:text-emerald-400 uppercase tracking-wider">Then (Actions)</p>
                <Button variant="ghost" size="sm" className="h-6 px-2 text-[10px]" onClick={() => setFormActions(prev => [...prev, emptyAction()])}>
                  <Plus className="h-3 w-3 mr-1" /> Add Action
                </Button>
              </div>

              {formActions.map((action, idx) => (
                <div key={idx} className="rounded-lg border border-border bg-card p-3 space-y-2 relative">
                  {formActions.length > 1 && (
                    <button className="absolute top-2 right-2 text-muted-foreground hover:text-red-500" onClick={() => removeAction(idx)}>
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                  <div>
                    <label className="block text-[10px] text-muted-foreground mb-1">Action #{idx + 1}</label>
                    <select value={action.type} onChange={e => updateAction(idx, { type: e.target.value })} className={inputCls}>
                      {Object.entries(ACTION_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                    </select>
                  </div>

                  {action.type === "send_whatsapp" && (
                    <div>
                      <label className="block text-[10px] text-muted-foreground mb-1">Template</label>
                      <select value={action.template_key || ""} onChange={e => updateAction(idx, { template_key: e.target.value })} className={inputCls}>
                        {WA_TEMPLATES.map(t => <option key={t.key} value={t.key}>{t.label}</option>)}
                      </select>
                    </div>
                  )}

                  {action.type === "send_email" && (
                    <div>
                      <label className="block text-[10px] text-muted-foreground mb-1">Email Template</label>
                      <select value={action.template_slug || ""} onChange={e => updateAction(idx, { template_slug: e.target.value })} className={inputCls}>
                        <option value="">Select...</option>
                        {emailTemplates.map(t => <option key={t.slug} value={t.slug}>{t.name}</option>)}
                      </select>
                    </div>
                  )}

                  {action.type === "advance_stage" && (
                    <div>
                      <label className="block text-[10px] text-muted-foreground mb-1">To Stage</label>
                      <select value={action.to_stage || ""} onChange={e => updateAction(idx, { to_stage: e.target.value })} className={inputCls}>
                        {Object.entries(STAGES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                      </select>
                    </div>
                  )}

                  {action.type === "schedule_followup" && (
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="block text-[10px] text-muted-foreground mb-1">Type</label>
                        <select value={action.followup_type || "call"} onChange={e => updateAction(idx, { followup_type: e.target.value })} className={inputCls}>
                          <option value="call">Call</option>
                          <option value="whatsapp">WhatsApp</option>
                          <option value="email">Email</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-[10px] text-muted-foreground mb-1">Delay (hours)</label>
                        <input type="number" min="1" value={action.delay_hours || 24} onChange={e => updateAction(idx, { delay_hours: parseInt(e.target.value) })} className={inputCls} />
                      </div>
                    </div>
                  )}

                  {action.type === "create_notification" && (
                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        <input type="checkbox" checked={action.notify_counsellor || false} onChange={e => updateAction(idx, { notify_counsellor: e.target.checked })} />
                        <label className="text-[10px] text-muted-foreground">Notify assigned counsellor</label>
                      </div>
                      <input value={action.title || ""} onChange={e => updateAction(idx, { title: e.target.value })} placeholder="Notification title (use {{name}})" className={inputCls} />
                      <input value={action.body || ""} onChange={e => updateAction(idx, { body: e.target.value })} placeholder="Body (use {{name}}, {{course}})" className={inputCls} />
                    </div>
                  )}

                  {action.type === "update_field" && (
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="block text-[10px] text-muted-foreground mb-1">Field</label>
                        <select value={action.field || ""} onChange={e => updateAction(idx, { field: e.target.value })} className={inputCls}>
                          <option value="lead_temperature">Temperature</option>
                          <option value="notes">Notes</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-[10px] text-muted-foreground mb-1">Value</label>
                        {action.field === "lead_temperature" ? (
                          <select value={action.value || ""} onChange={e => updateAction(idx, { value: e.target.value })} className={inputCls}>
                            <option value="hot">Hot</option>
                            <option value="warm">Warm</option>
                            <option value="cold">Cold</option>
                          </select>
                        ) : (
                          <input value={action.value || ""} onChange={e => updateAction(idx, { value: e.target.value })} className={inputCls} />
                        )}
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreate(false)}>Cancel</Button>
            <Button onClick={handleCreate} disabled={!formName.trim() || formActions.length === 0 || saving} className="gap-2">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />} Create Rule
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default AutomationRules;
