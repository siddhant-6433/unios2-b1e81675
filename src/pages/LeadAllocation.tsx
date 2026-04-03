import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LEAD_SOURCES } from "@/config/leadSources";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Plus, X, Loader2, Settings, ArrowUpDown, Check, Trash2 } from "lucide-react";

interface AllocationRule {
  id: string;
  name: string;
  priority: number;
  is_active: boolean;
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

const LeadAllocation = () => {
  const { toast } = useToast();
  const [rules, setRules] = useState<AllocationRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [counsellors, setCounsellors] = useState<{ id: string; name: string }[]>([]);
  const [courses, setCourses] = useState<{ id: string; name: string }[]>([]);
  const [campuses, setCampuses] = useState<{ id: string; name: string }[]>([]);
  const [form, setForm] = useState({
    name: "", priority: 0, conditions: { course: "", campus: "", source: "" },
    assignment_type: "specific" as string, assigned_to: "",
  });

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

  const saveRule = async () => {
    const conditions: any = {};
    if (form.conditions.course) conditions.course = form.conditions.course;
    if (form.conditions.campus) conditions.campus = form.conditions.campus;
    if (form.conditions.source) conditions.source = form.conditions.source;

    const { error } = await supabase.from("lead_allocation_rules").insert({
      name: form.name,
      priority: form.priority,
      conditions,
      assignment_type: form.assignment_type,
      assigned_to: form.assigned_to || null,
    });
    if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); return; }
    toast({ title: "Rule created" });
    setShowForm(false);
    setForm({ name: "", priority: 0, conditions: { course: "", campus: "", source: "" }, assignment_type: "specific", assigned_to: "" });
    await fetchAll();
  };

  const toggleRule = async (id: string, isActive: boolean) => {
    await supabase.from("lead_allocation_rules").update({ is_active: !isActive }).eq("id", id);
    await fetchAll();
  };

  const deleteRule = async (id: string) => {
    await supabase.from("lead_allocation_rules").delete().eq("id", id);
    await fetchAll();
  };

  const inputCls = "w-full rounded-xl border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/20";

  // Lead sources from shared config

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Lead Allocation Rules</h1>
          <p className="text-sm text-muted-foreground mt-1">Configure automatic lead assignment based on conditions</p>
        </div>
        <Button onClick={() => setShowForm(true)} className="gap-2"><Plus className="h-4 w-4" />Add Rule</Button>
      </div>

      {showForm && (
        <Card className="border-border/60"><CardContent className="p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-foreground">New Allocation Rule</h3>
            <button onClick={() => setShowForm(false)} className="text-muted-foreground hover:text-foreground"><X className="h-5 w-5" /></button>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div><label className="block text-[11px] font-medium text-muted-foreground mb-1">Rule Name *</label>
              <input type="text" value={form.name} onChange={(e) => setForm(p => ({ ...p, name: e.target.value }))} placeholder="MBA Greater Noida" className={inputCls} /></div>
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

          <div className="flex gap-2 pt-2">
            <Button onClick={saveRule} disabled={!form.name} className="gap-1.5"><Check className="h-4 w-4" />Save Rule</Button>
            <Button onClick={() => setShowForm(false)} variant="outline">Cancel</Button>
          </div>
        </CardContent></Card>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
      ) : rules.length === 0 ? (
        <Card className="border-border/60"><CardContent className="py-16 text-center">
          <Settings className="h-10 w-10 text-muted-foreground/30 mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">No allocation rules configured yet</p>
        </CardContent></Card>
      ) : (
        <div className="space-y-3">
          {rules.map((rule, idx) => (
            <Card key={rule.id} className={`border-border/60 ${!rule.is_active ? "opacity-50" : ""}`}>
              <CardContent className="p-5 flex items-center gap-4">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-sm font-bold text-primary shrink-0">
                  {idx + 1}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-semibold text-foreground">{rule.name}</p>
                    <Badge variant={rule.is_active ? "default" : "outline"} className="text-[10px]">
                      {rule.is_active ? "Active" : "Inactive"}
                    </Badge>
                  </div>
                  <div className="flex flex-wrap gap-2 mt-1.5">
                    {Object.entries(rule.conditions || {}).map(([key, val]) => (
                      val ? <Badge key={key} variant="outline" className="text-[10px]">{key}: {String(val)}</Badge> : null
                    ))}
                    <Badge variant="outline" className="text-[10px] text-primary border-primary/30">
                      → {rule.assignment_type === "round_robin" ? "Round Robin" : counsellors.find(c => c.id === rule.assigned_to)?.name || "Unassigned"}
                    </Badge>
                  </div>
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
