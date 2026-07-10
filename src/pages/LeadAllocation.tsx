import { PageLoader } from "@/components/ui/page-loader";
import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent } from "@/components/ui/card";
import { LEAD_SOURCES } from "@/config/leadSources";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Plus, X, Loader2, Settings, Check, Trash2, PhoneIncoming } from "lucide-react";

interface AllocationRule {
  id: string;
  name: string;
  priority: number;
  is_active: boolean;
  is_intake_pool: boolean;
  conditions: {
    course?: string;
    campus?: string;
    source?: string;
    city?: string;
  };
  assignment_type: string;
  assigned_to: string | null;
  round_robin_pool: string[];
}

interface Counsellor {
  id: string; // profiles.user_id — what round_robin_pool stores
  name: string;
}

const emptyForm = {
  name: "",
  priority: 0,
  conditions: { course: "", campus: "", source: "" },
  assignment_type: "specific" as string,
  assigned_to: "",
  is_intake_pool: false,
  round_robin_pool: [] as string[],
};

const LeadAllocation = () => {
  const { toast } = useToast();
  const [rules, setRules] = useState<AllocationRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [counsellors, setCounsellors] = useState<Counsellor[]>([]);
  const [courses, setCourses] = useState<{ id: string; name: string }[]>([]);
  const [campuses, setCampuses] = useState<{ id: string; name: string }[]>([]);
  const [form, setForm] = useState(emptyForm);

  useEffect(() => { fetchAll(); }, []);

  const fetchAll = async () => {
    setLoading(true);
    const [rulesRes, profilesRes, coursesRes, campusesRes] = await Promise.all([
      supabase.from("lead_allocation_rules").select("*").order("priority", { ascending: true }),
      supabase.from("profiles").select("user_id, display_name"),
      supabase.from("courses").select("id, name"),
      supabase.from("campuses").select("id, name"),
    ]);
    if (rulesRes.data) setRules(rulesRes.data as any);
    if (profilesRes.data) setCounsellors(profilesRes.data.map(p => ({ id: p.user_id, name: p.display_name || "Unnamed" })));
    if (coursesRes.data) setCourses(coursesRes.data);
    if (campusesRes.data) setCampuses(campusesRes.data);
    setLoading(false);
  };

  const togglePoolMember = (userId: string) => {
    setForm(p => ({
      ...p,
      round_robin_pool: p.round_robin_pool.includes(userId)
        ? p.round_robin_pool.filter(id => id !== userId)
        : [...p.round_robin_pool, userId],
    }));
  };

  const saveRule = async () => {
    const conditions: Record<string, string> = {};
    if (form.conditions.course) conditions.course = form.conditions.course;
    if (form.conditions.campus) conditions.campus = form.conditions.campus;
    if (form.conditions.source) conditions.source = form.conditions.source;

    const isRoundRobin = form.assignment_type === "round_robin";
    const { error } = await supabase.from("lead_allocation_rules").insert({
      name: form.name,
      priority: form.priority,
      conditions,
      assignment_type: form.assignment_type,
      assigned_to: isRoundRobin ? null : (form.assigned_to || null),
      round_robin_pool: isRoundRobin ? form.round_robin_pool : [],
      // Intake pool only makes sense for round-robin assignment.
      is_intake_pool: isRoundRobin && form.is_intake_pool,
    } as any);
    if (error) {
      const friendly = error.message.includes("uq_lead_allocation_rules_active_intake_pool")
        ? "Another active intake pool already exists. Disable it first — only one intake pool can be active at a time."
        : error.message;
      toast({ title: "Error", description: friendly, variant: "destructive" });
      return;
    }
    toast({ title: "Rule created" });
    setShowForm(false);
    setForm(emptyForm);
    await fetchAll();
  };

  const toggleRule = async (id: string, isActive: boolean) => {
    const { error } = await supabase.from("lead_allocation_rules").update({ is_active: !isActive }).eq("id", id);
    if (error) {
      const friendly = error.message.includes("uq_lead_allocation_rules_active_intake_pool")
        ? "Another active intake pool already exists. Disable it before enabling this one."
        : error.message;
      toast({ title: "Error", description: friendly, variant: "destructive" });
      return;
    }
    await fetchAll();
  };

  const deleteRule = async (id: string) => {
    await supabase.from("lead_allocation_rules").delete().eq("id", id);
    await fetchAll();
  };

  const counsellorName = (userId: string | null) =>
    counsellors.find(c => c.id === userId)?.name || "Unassigned";

  const inputCls = "w-full rounded-xl border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/20";

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Lead Allocation Rules</h1>
          <p className="text-sm text-muted-foreground mt-1">Configure automatic lead assignment based on conditions</p>
        </div>
        <Button onClick={() => setShowForm(true)} className="gap-2"><Plus className="h-4 w-4" />Add Rule</Button>
      </div>

      {/* Intake-pool explainer */}
      <Card className="border-primary/30 bg-primary/[0.03]">
        <CardContent className="p-4 flex items-start gap-3">
          <PhoneIncoming className="h-5 w-5 text-primary shrink-0 mt-0.5" />
          <div className="text-sm text-muted-foreground">
            <span className="font-semibold text-foreground">Intake round-robin pool.</span> Mark one
            round-robin rule as the <em>intake pool</em> to set the counsellors that brand-new leads from
            inbound voice calls and WhatsApp messages are distributed across (online counsellors are
            preferred). Only one intake pool can be active at a time.
          </div>
        </CardContent>
      </Card>

      {showForm && (
        <Card className="border-border/60"><CardContent className="p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-foreground">New Allocation Rule</h3>
            <button onClick={() => { setShowForm(false); setForm(emptyForm); }} className="text-muted-foreground hover:text-foreground"><X className="h-5 w-5" /></button>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div><label className="block text-[11px] font-medium text-muted-foreground mb-1">Rule Name *</label>
              <input type="text" value={form.name} onChange={(e) => setForm(p => ({ ...p, name: e.target.value }))} placeholder="Inbound intake pool" className={inputCls} /></div>
            <div><label className="block text-[11px] font-medium text-muted-foreground mb-1">Priority (lower = higher)</label>
              <input type="number" value={form.priority} onChange={(e) => setForm(p => ({ ...p, priority: parseInt(e.target.value) || 0 }))} className={inputCls} /></div>
          </div>

          <div className="space-y-2">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Conditions (IF)</p>
            <div className="grid grid-cols-3 gap-4">
              <div><label className="block text-[11px] font-medium text-muted-foreground mb-1">Course</label>
                <select value={form.conditions.course} onChange={(e) => setForm(p => ({ ...p, conditions: { ...p.conditions, course: e.target.value } }))} className={inputCls}>
                  <option value="">Any</option>
                  {courses.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
                </select></div>
              <div><label className="block text-[11px] font-medium text-muted-foreground mb-1">Campus</label>
                <select value={form.conditions.campus} onChange={(e) => setForm(p => ({ ...p, conditions: { ...p.conditions, campus: e.target.value } }))} className={inputCls}>
                  <option value="">Any</option>
                  {campuses.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
                </select></div>
              <div><label className="block text-[11px] font-medium text-muted-foreground mb-1">Source</label>
                <select value={form.conditions.source} onChange={(e) => setForm(p => ({ ...p, conditions: { ...p.conditions, source: e.target.value } }))} className={inputCls}>
                  <option value="">Any</option>
                  {LEAD_SOURCES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                </select></div>
            </div>
          </div>

          <div className="space-y-2">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Assignment (THEN)</p>
            <div className="grid grid-cols-2 gap-4">
              <div><label className="block text-[11px] font-medium text-muted-foreground mb-1">Type</label>
                <select value={form.assignment_type} onChange={(e) => setForm(p => ({ ...p, assignment_type: e.target.value }))} className={inputCls}>
                  <option value="specific">Specific Counsellor</option>
                  <option value="round_robin">Round Robin</option>
                </select></div>
              {form.assignment_type === "specific" && (
                <div><label className="block text-[11px] font-medium text-muted-foreground mb-1">Assign To</label>
                  <select value={form.assigned_to} onChange={(e) => setForm(p => ({ ...p, assigned_to: e.target.value }))} className={inputCls}>
                    <option value="">Select...</option>
                    {counsellors.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select></div>
              )}
            </div>
          </div>

          {form.assignment_type === "round_robin" && (
            <div className="space-y-3 rounded-xl border border-border/60 p-4">
              <label className="flex items-center gap-2 text-sm font-medium text-foreground cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.is_intake_pool}
                  onChange={(e) => setForm(p => ({ ...p, is_intake_pool: e.target.checked }))}
                  className="h-4 w-4 rounded border-input"
                />
                <PhoneIncoming className="h-4 w-4 text-primary" />
                Use as intake pool for inbound voice calls &amp; WhatsApp
              </label>

              <div>
                <p className="text-[11px] font-medium text-muted-foreground mb-2">
                  Round-robin pool ({form.round_robin_pool.length} selected)
                </p>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 max-h-56 overflow-y-auto pr-1">
                  {counsellors.map(c => {
                    const selected = form.round_robin_pool.includes(c.id);
                    return (
                      <button
                        type="button"
                        key={c.id}
                        onClick={() => togglePoolMember(c.id)}
                        className={`flex items-center gap-2 rounded-lg border px-2.5 py-2 text-xs text-left transition-colors ${
                          selected
                            ? "border-primary bg-primary/10 text-foreground"
                            : "border-border/60 text-muted-foreground hover:border-primary/40"
                        }`}
                      >
                        <span className={`flex h-4 w-4 items-center justify-center rounded border shrink-0 ${selected ? "bg-primary border-primary text-primary-foreground" : "border-input"}`}>
                          {selected && <Check className="h-3 w-3" />}
                        </span>
                        <span className="truncate">{c.name}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          <div className="flex gap-2 pt-2">
            <Button
              onClick={saveRule}
              disabled={!form.name || (form.assignment_type === "round_robin" && form.round_robin_pool.length === 0)}
              className="gap-1.5"
            >
              <Check className="h-4 w-4" />Save Rule
            </Button>
            <Button onClick={() => { setShowForm(false); setForm(emptyForm); }} variant="outline">Cancel</Button>
          </div>
        </CardContent></Card>
      )}

      {loading ? (
        <PageLoader />
      ) : rules.length === 0 ? (
        <Card className="border-border/60"><CardContent className="py-16 text-center">
          <Settings className="h-10 w-10 text-muted-foreground/30 mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">No allocation rules configured yet</p>
        </CardContent></Card>
      ) : (
        <div className="space-y-3">
          {rules.map((rule, idx) => (
            <Card key={rule.id} className={`border-border/60 ${!rule.is_active ? "opacity-50" : ""} ${rule.is_intake_pool ? "ring-1 ring-primary/30" : ""}`}>
              <CardContent className="p-5 flex items-center gap-4">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-sm font-bold text-primary shrink-0">
                  {idx + 1}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-sm font-semibold text-foreground">{rule.name}</p>
                    <Badge variant={rule.is_active ? "default" : "outline"} className="text-[10px]">
                      {rule.is_active ? "Active" : "Inactive"}
                    </Badge>
                    {rule.is_intake_pool && (
                      <Badge className="text-[10px] gap-1 bg-primary/15 text-primary hover:bg-primary/15">
                        <PhoneIncoming className="h-3 w-3" />Intake pool
                      </Badge>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-2 mt-1.5">
                    {Object.entries(rule.conditions || {}).map(([key, val]) => (
                      val ? <Badge key={key} variant="outline" className="text-[10px]">{key}: {String(val)}</Badge> : null
                    ))}
                    <Badge variant="outline" className="text-[10px] text-primary border-primary/30">
                      → {rule.assignment_type === "round_robin"
                        ? `Round Robin (${(rule.round_robin_pool || []).length})`
                        : counsellorName(rule.assigned_to)}
                    </Badge>
                  </div>
                  {rule.assignment_type === "round_robin" && (rule.round_robin_pool || []).length > 0 && (
                    <p className="text-[11px] text-muted-foreground mt-1.5 truncate">
                      {(rule.round_robin_pool || []).map(counsellorName).join(", ")}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <Button onClick={() => toggleRule(rule.id, rule.is_active)} size="sm" variant="outline" className="text-xs">
                    {rule.is_active ? "Disable" : "Enable"}
                  </Button>
                  <Button onClick={() => deleteRule(rule.id)} size="sm" variant="ghost" className="text-destructive hover:text-destructive">
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
};

export default LeadAllocation;
