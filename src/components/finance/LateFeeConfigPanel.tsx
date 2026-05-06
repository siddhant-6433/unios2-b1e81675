import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, Plus, Edit2, Check, X, ShieldAlert, Clock } from "lucide-react";

interface FeeStructure {
  id: string;
  version: string;
  is_active: boolean;
  course_name: string;
  session_name: string;
}

interface Policy {
  id: string;
  fee_structure_id: string;
  grace_period_days: number;
  penalty_type: "flat" | "daily" | "percentage";
  penalty_amount: number;
  max_penalty_cap: number | null;
  applies_to_categories: string[];
  is_active: boolean;
}

type EditState = Omit<Policy, "id" | "fee_structure_id" | "is_active">;

const ALL_CATEGORIES = ["tuition", "hostel", "transport", "lab", "library", "exam", "enrollment", "other"];

const penaltyTypeLabel: Record<string, string> = {
  flat: "Flat Amount",
  daily: "Per Day",
  percentage: "% of Balance",
};

const defaultEdit: EditState = {
  grace_period_days: 7,
  penalty_type: "flat",
  penalty_amount: 500,
  max_penalty_cap: null,
  applies_to_categories: ["tuition"],
};

export function LateFeeConfigPanel() {
  const { role } = useAuth();
  const { toast } = useToast();
  const [structures, setStructures] = useState<FeeStructure[]>([]);
  const [policies, setPolicies] = useState<Record<string, Policy>>({});
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<string | null>(null);
  const [editState, setEditState] = useState<EditState>(defaultEdit);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");
  const [overdueStats, setOverdueStats] = useState<{ total: number; amount: number }>({ total: 0, amount: 0 });

  const canEdit = ["super_admin", "campus_admin", "accountant", "principal"].includes(role || "");

  useEffect(() => { fetchAll(); }, []);

  const fetchAll = async () => {
    setLoading(true);
    const [structRes, policyRes, overdueRes] = await Promise.all([
      supabase
        .from("fee_structures")
        .select("id, version, is_active, courses:course_id(name), admission_sessions:session_id(name)")
        .order("is_active", { ascending: false }),
      supabase.from("late_fee_policies").select("*"),
      supabase
        .from("fee_ledger")
        .select("id, balance")
        .eq("status", "overdue")
        .gt("balance", 0),
    ]);

    if (structRes.data) {
      setStructures(structRes.data.map((s: any) => ({
        id: s.id,
        version: s.version,
        is_active: s.is_active,
        course_name: s.courses?.name || "Unknown Course",
        session_name: s.admission_sessions?.name || "",
      })));
    }

    if (policyRes.data) {
      const map: Record<string, Policy> = {};
      for (const p of policyRes.data as Policy[]) map[p.fee_structure_id] = p;
      setPolicies(map);
    }

    if (overdueRes.data) {
      setOverdueStats({
        total: overdueRes.data.length,
        amount: overdueRes.data.reduce((s, r) => s + Number(r.balance), 0),
      });
    }

    setLoading(false);
  };

  const startEdit = (structId: string) => {
    const existing = policies[structId];
    setEditState(existing ? {
      grace_period_days: existing.grace_period_days,
      penalty_type: existing.penalty_type,
      penalty_amount: existing.penalty_amount,
      max_penalty_cap: existing.max_penalty_cap,
      applies_to_categories: existing.applies_to_categories,
    } : { ...defaultEdit });
    setEditing(structId);
  };

  const handleSave = async (structId: string) => {
    setSaving(true);
    const existing = policies[structId];
    let error: any;

    if (existing) {
      ({ error } = await supabase
        .from("late_fee_policies")
        .update({
          grace_period_days:      editState.grace_period_days,
          penalty_type:           editState.penalty_type,
          penalty_amount:         editState.penalty_amount,
          max_penalty_cap:        editState.max_penalty_cap,
          applies_to_categories:  editState.applies_to_categories,
        })
        .eq("id", existing.id));
    } else {
      ({ error } = await supabase
        .from("late_fee_policies")
        .insert({
          fee_structure_id:       structId,
          grace_period_days:      editState.grace_period_days,
          penalty_type:           editState.penalty_type,
          penalty_amount:         editState.penalty_amount,
          max_penalty_cap:        editState.max_penalty_cap,
          applies_to_categories:  editState.applies_to_categories,
        }));
    }

    if (error) {
      toast({ title: "Save failed", description: error.message, variant: "destructive" });
    } else {
      toast({ title: existing ? "Policy updated" : "Policy created" });
      setEditing(null);
      fetchAll();
    }
    setSaving(false);
  };

  const handleToggleActive = async (policy: Policy) => {
    const { error } = await supabase
      .from("late_fee_policies")
      .update({ is_active: !policy.is_active })
      .eq("id", policy.id);
    if (error) {
      toast({ title: "Update failed", description: error.message, variant: "destructive" });
    } else {
      fetchAll();
    }
  };

  const toggleCategory = (cat: string) => {
    setEditState(prev => ({
      ...prev,
      applies_to_categories: prev.applies_to_categories.includes(cat)
        ? prev.applies_to_categories.filter(c => c !== cat)
        : [...prev.applies_to_categories, cat],
    }));
  };

  const filtered = structures.filter(s =>
    !search ||
    s.course_name.toLowerCase().includes(search.toLowerCase()) ||
    s.version.toLowerCase().includes(search.toLowerCase())
  );

  if (loading) {
    return <div className="flex h-32 items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>;
  }

  return (
    <div className="space-y-4">
      {/* Overdue stats banner */}
      {overdueStats.total > 0 && (
        <div className="flex items-center gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
          <ShieldAlert className="h-5 w-5 text-amber-600 shrink-0" />
          <div>
            <p className="text-sm font-medium text-amber-800">
              {overdueStats.total} overdue items · ₹{(overdueStats.amount / 1000).toFixed(1)}K outstanding
            </p>
            <p className="text-xs text-amber-600">
              Late fee cron runs daily at 6:00 AM IST — generates penalty rows for configured structures
            </p>
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Clock className="h-5 w-5 text-muted-foreground" />
          <h3 className="text-base font-semibold text-foreground">Late Fee Policies</h3>
          <Badge className="bg-muted text-muted-foreground border-0 text-[10px]">
            {Object.keys(policies).length} configured
          </Badge>
        </div>
        <input
          type="text" placeholder="Search course or version..."
          value={search} onChange={e => setSearch(e.target.value)}
          className="rounded-lg border border-input bg-card px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/20 w-64"
        />
      </div>

      <Card className="border-border/60 shadow-none overflow-hidden">
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/50">
                <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Course / Structure</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Grace Period</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Penalty</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Applies To</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Status</th>
                {canEdit && (
                  <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Action</th>
                )}
              </tr>
            </thead>
            <tbody>
              {filtered.map((s) => {
                const policy = policies[s.id];
                const isEditingThis = editing === s.id;

                return (
                  <tr key={s.id} className="border-b border-border last:border-0">
                    <td className="px-4 py-3">
                      <div className="font-medium text-foreground">{s.course_name}</div>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        <span className="text-[10px] font-mono text-muted-foreground">{s.version}</span>
                        {s.session_name && (
                          <span className="text-[10px] text-muted-foreground/60">· {s.session_name}</span>
                        )}
                        {!s.is_active && (
                          <Badge className="text-[9px] bg-muted text-muted-foreground border-0 h-4">inactive</Badge>
                        )}
                      </div>
                    </td>

                    {isEditingThis ? (
                      <>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1.5">
                            <input
                              type="number" min={0} max={90}
                              value={editState.grace_period_days}
                              onChange={e => setEditState(p => ({ ...p, grace_period_days: Number(e.target.value) }))}
                              className="w-16 rounded border border-input px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                            />
                            <span className="text-xs text-muted-foreground">days</span>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="space-y-1.5">
                            <select
                              value={editState.penalty_type}
                              onChange={e => setEditState(p => ({ ...p, penalty_type: e.target.value as any }))}
                              className="w-full rounded border border-input px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
                            >
                              <option value="flat">Flat Amount</option>
                              <option value="daily">Per Day</option>
                              <option value="percentage">% of Balance</option>
                            </select>
                            <div className="flex items-center gap-1.5">
                              <span className="text-xs text-muted-foreground">
                                {editState.penalty_type === "percentage" ? "%" : "₹"}
                              </span>
                              <input
                                type="number" min={1}
                                value={editState.penalty_amount}
                                onChange={e => setEditState(p => ({ ...p, penalty_amount: Number(e.target.value) }))}
                                className="w-24 rounded border border-input px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                              />
                            </div>
                            <div className="flex items-center gap-1.5">
                              <span className="text-xs text-muted-foreground">Cap ₹</span>
                              <input
                                type="number" min={0} placeholder="none"
                                value={editState.max_penalty_cap ?? ""}
                                onChange={e => setEditState(p => ({
                                  ...p,
                                  max_penalty_cap: e.target.value ? Number(e.target.value) : null,
                                }))}
                                className="w-24 rounded border border-input px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                              />
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex flex-wrap gap-1">
                            {ALL_CATEGORIES.map(cat => (
                              <button
                                key={cat}
                                onClick={() => toggleCategory(cat)}
                                className={`rounded px-2 py-0.5 text-[10px] font-medium transition-colors capitalize ${
                                  editState.applies_to_categories.includes(cat)
                                    ? "bg-primary text-primary-foreground"
                                    : "bg-muted text-muted-foreground hover:bg-muted/80"
                                }`}
                              >
                                {cat}
                              </button>
                            ))}
                          </div>
                        </td>
                        <td className="px-4 py-3" />
                        {canEdit && (
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-1">
                              <Button
                                size="sm" variant="ghost"
                                className="h-7 px-2 text-success hover:text-success hover:bg-success/10"
                                disabled={saving || editState.applies_to_categories.length === 0}
                                onClick={() => handleSave(s.id)}
                              >
                                {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                              </Button>
                              <Button
                                size="sm" variant="ghost"
                                className="h-7 px-2 text-destructive hover:text-destructive hover:bg-destructive/10"
                                onClick={() => setEditing(null)}
                              >
                                <X className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                          </td>
                        )}
                      </>
                    ) : (
                      <>
                        <td className="px-4 py-3 text-muted-foreground">
                          {policy ? `${policy.grace_period_days} days` : <span className="text-muted-foreground/40 italic text-xs">not set</span>}
                        </td>
                        <td className="px-4 py-3">
                          {policy ? (
                            <div>
                              <span className="font-medium text-foreground">
                                {policy.penalty_type === "percentage"
                                  ? `${policy.penalty_amount}%`
                                  : `₹${policy.penalty_amount.toLocaleString("en-IN")}`}
                              </span>
                              <span className="text-xs text-muted-foreground ml-1">
                                {penaltyTypeLabel[policy.penalty_type]}
                              </span>
                              {policy.max_penalty_cap && (
                                <div className="text-[10px] text-muted-foreground">
                                  cap ₹{policy.max_penalty_cap.toLocaleString("en-IN")}
                                </div>
                              )}
                            </div>
                          ) : <span className="text-muted-foreground/40 italic text-xs">not set</span>}
                        </td>
                        <td className="px-4 py-3">
                          {policy ? (
                            <div className="flex flex-wrap gap-1">
                              {policy.applies_to_categories.map(cat => (
                                <Badge key={cat} className="text-[9px] bg-pastel-blue text-foreground/70 border-0 capitalize">
                                  {cat}
                                </Badge>
                              ))}
                            </div>
                          ) : <span className="text-muted-foreground/40 italic text-xs">—</span>}
                        </td>
                        <td className="px-4 py-3">
                          {policy ? (
                            <button
                              onClick={() => canEdit && handleToggleActive(policy)}
                              className={`rounded px-2 py-0.5 text-[10px] font-medium transition-colors ${
                                policy.is_active
                                  ? "bg-success/10 text-success"
                                  : "bg-muted text-muted-foreground"
                              } ${canEdit ? "cursor-pointer hover:opacity-80" : "cursor-default"}`}
                            >
                              {policy.is_active ? "Active" : "Paused"}
                            </button>
                          ) : <span className="text-muted-foreground/40 text-xs">—</span>}
                        </td>
                        {canEdit && (
                          <td className="px-4 py-3">
                            <button
                              onClick={() => startEdit(s.id)}
                              className="flex items-center gap-1 rounded border border-input px-2.5 py-1 text-[11px] font-medium text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
                            >
                              {policy ? <><Edit2 className="h-3 w-3" /> Edit</> : <><Plus className="h-3 w-3" /> Add</>}
                            </button>
                          </td>
                        )}
                      </>
                    )}
                  </tr>
                );
              })}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={canEdit ? 6 : 5} className="px-4 py-10 text-center text-muted-foreground text-sm">
                    No fee structures found
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <div className="rounded-lg border border-border/60 bg-muted/30 px-4 py-3 text-xs text-muted-foreground space-y-1">
        <p className="font-medium text-foreground">How late fees work</p>
        <p>Each night at 6 AM IST, the engine marks unpaid ledger rows as <strong>overdue</strong> after the grace period expires, then creates a <strong>LATE-FEE</strong> row for each newly overdue item.</p>
        <p><strong>Flat</strong> — fixed amount regardless of balance · <strong>Per Day</strong> — multiplied by days overdue at time of generation · <strong>% of Balance</strong> — percentage of remaining balance</p>
        <p>Late fees are generated <em>once</em> per ledger item. Re-provisioning students will not duplicate them.</p>
      </div>
    </div>
  );
}
