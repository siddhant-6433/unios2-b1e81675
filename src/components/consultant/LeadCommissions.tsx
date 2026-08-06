import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { ButtonOrb } from "@/components/ui/thinking-orb";
import { Button } from "@/components/ui/button";
import { Loader2, Edit, Save, X, Plus, Trash2, Search } from "lucide-react";

interface LeadOverride {
  id: string;
  lead_id: string;
  commission_type: string;
  commission_value: number;
  notes: string | null;
  lead_name?: string;
  lead_phone?: string;
  course_name?: string;
}

interface Props {
  consultantId: string;
}

export function LeadCommissions({ consultantId }: Props) {
  const { role } = useAuth();
  const { toast } = useToast();
  const [overrides, setOverrides] = useState<LeadOverride[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [editType, setEditType] = useState("fixed");
  const [editNotes, setEditNotes] = useState("");
  const [saving, setSaving] = useState(false);

  const [adding, setAdding] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [searching, setSearching] = useState(false);
  const [newLeadId, setNewLeadId] = useState<string | null>(null);
  const [newLeadLabel, setNewLeadLabel] = useState("");
  const [newValue, setNewValue] = useState("");
  const [newType, setNewType] = useState("fixed");
  const [newNotes, setNewNotes] = useState("");

  const canEdit = ["super_admin", "campus_admin", "principal", "admission_head"].includes(role || "");

  const fetchOverrides = async () => {
    const { data } = await supabase
      .from("consultant_lead_commissions" as any)
      .select("*")
      .eq("consultant_id", consultantId)
      .order("created_at", { ascending: false });

    if (!data || data.length === 0) {
      setOverrides([]);
      setLoading(false);
      return;
    }

    const leadIds = (data as any[]).map(d => d.lead_id);
    const { data: leads } = await supabase
      .from("leads")
      .select("id, name, phone, courses:course_id(name)")
      .in("id", leadIds);

    const leadMap = new Map((leads || []).map((l: any) => [l.id, l]));
    setOverrides((data as any[]).map(d => {
      const lead = leadMap.get(d.lead_id);
      return {
        ...d,
        lead_name: lead?.name || "Unknown",
        lead_phone: lead?.phone || "",
        course_name: (lead?.courses as any)?.name || "",
      };
    }));
    setLoading(false);
  };

  useEffect(() => { fetchOverrides(); }, [consultantId]);

  const searchLeads = async (q: string) => {
    if (q.length < 2) { setSearchResults([]); return; }
    setSearching(true);
    const { data } = await supabase
      .from("leads")
      .select("id, name, phone, courses:course_id(name)")
      .eq("consultant_id", consultantId)
      .or(`name.ilike.%${q}%,phone.ilike.%${q}%`)
      .limit(10);
    setSearchResults(data || []);
    setSearching(false);
  };

  useEffect(() => {
    const t = setTimeout(() => searchLeads(searchQuery), 300);
    return () => clearTimeout(t);
  }, [searchQuery]);

  const handleAdd = async () => {
    if (!newLeadId || !newValue) return;
    const val = parseFloat(newValue);
    if (isNaN(val) || val < 0) return;
    setSaving(true);

    const { data: profile } = await supabase.from("profiles").select("id").eq("user_id", (await supabase.auth.getUser()).data.user?.id).single();
    const { error } = await supabase.from("consultant_lead_commissions" as any).upsert({
      consultant_id: consultantId,
      lead_id: newLeadId,
      commission_type: newType,
      commission_value: val,
      notes: newNotes.trim() || null,
      set_by: profile?.id,
      updated_at: new Date().toISOString(),
    } as any, { onConflict: "consultant_id,lead_id" });

    if (error) {
      toast({ title: "Failed to set override", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Lead commission override set" });
      setAdding(false);
      setNewLeadId(null);
      setNewLeadLabel("");
      setNewValue("");
      setNewNotes("");
      setSearchQuery("");
      fetchOverrides();
    }
    setSaving(false);
  };

  const handleSave = async (o: LeadOverride) => {
    const val = parseFloat(editValue);
    if (isNaN(val) || val < 0) return;
    setSaving(true);

    const { error } = await supabase
      .from("consultant_lead_commissions" as any)
      .update({
        commission_type: editType,
        commission_value: val,
        notes: editNotes.trim() || null,
        updated_at: new Date().toISOString(),
      } as any)
      .eq("id", o.id);

    if (error) {
      toast({ title: "Update failed", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Override updated" });
      fetchOverrides();
    }
    setSaving(false);
    setEditingId(null);
  };

  const handleDelete = async (o: LeadOverride) => {
    const { error } = await supabase
      .from("consultant_lead_commissions" as any)
      .delete()
      .eq("id", o.id);

    if (error) {
      toast({ title: "Delete failed", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Override removed — course/default rate applies" });
      fetchOverrides();
    }
  };

  if (loading) return <div className="text-xs text-muted-foreground py-2">Loading overrides...</div>;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">Per-Lead Commission Overrides</h4>
        {canEdit && !adding && (
          <Button size="sm" variant="outline" className="h-6 text-[10px] gap-1" onClick={() => setAdding(true)}>
            <Plus className="h-3 w-3" /> Add Override
          </Button>
        )}
      </div>

      {adding && (
        <div className="rounded-lg border border-border p-3 space-y-2 bg-muted/20">
          <div className="relative">
            <div className="flex items-center gap-1 border border-input rounded bg-background px-2 py-1">
              <Search className="h-3 w-3 text-muted-foreground" />
              <input
                type="text"
                placeholder="Search lead by name or phone..."
                value={newLeadId ? newLeadLabel : searchQuery}
                onChange={e => { setSearchQuery(e.target.value); setNewLeadId(null); setNewLeadLabel(""); }}
                className="flex-1 bg-transparent text-xs outline-none"
                autoFocus
              />
              {searching && <Loader2 className="h-3 w-3 animate-spin" />}
            </div>
            {searchResults.length > 0 && !newLeadId && (
              <div className="absolute z-10 mt-1 w-full rounded-md border border-border bg-background shadow-lg max-h-36 overflow-y-auto">
                {searchResults.map((l: any) => (
                  <button
                    key={l.id}
                    className="w-full text-left px-3 py-1.5 text-xs hover:bg-muted/50 border-b border-border/30 last:border-0"
                    onClick={() => {
                      setNewLeadId(l.id);
                      setNewLeadLabel(`${l.name}${l.phone ? ` (${l.phone})` : ""}`);
                      setSearchResults([]);
                    }}
                  >
                    <span className="font-medium">{l.name}</span>
                    {l.phone && <span className="text-muted-foreground ml-1">{l.phone}</span>}
                    {(l.courses as any)?.name && <span className="text-muted-foreground ml-1">· {(l.courses as any).name}</span>}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="flex items-center gap-2">
            <select
              value={newType}
              onChange={e => setNewType(e.target.value)}
              className="rounded border border-input bg-background px-2 py-1 text-xs"
            >
              <option value="fixed">Fixed ₹</option>
              <option value="percentage">% of Annual Fee</option>
            </select>
            <input
              type="number"
              placeholder={newType === "percentage" ? "e.g. 10" : "e.g. 5000"}
              value={newValue}
              onChange={e => setNewValue(e.target.value)}
              className="w-24 rounded border border-input bg-background px-2 py-1 text-xs text-right"
            />
            <input
              placeholder="Notes (optional)"
              value={newNotes}
              onChange={e => setNewNotes(e.target.value)}
              className="flex-1 rounded border border-input bg-background px-2 py-1 text-xs"
            />
          </div>
          <div className="flex items-center gap-2 justify-end">
            <Button size="sm" variant="ghost" className="h-6 text-[10px]" onClick={() => { setAdding(false); setNewLeadId(null); setSearchQuery(""); }}>
              Cancel
            </Button>
            <Button size="sm" className="h-6 text-[10px]" onClick={handleAdd} disabled={!newLeadId || !newValue || saving}>
              {saving ? <ButtonOrb state="working" onFilled /> : "Set Override"}
            </Button>
          </div>
        </div>
      )}

      {overrides.length === 0 && !adding ? (
        <p className="text-[10px] text-muted-foreground">No per-lead overrides. Course/default rates apply to all leads.</p>
      ) : overrides.length > 0 && (
        <div className="rounded-lg border border-border overflow-hidden">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-muted/40 border-b border-border">
                <th className="px-3 py-2 text-left font-medium text-muted-foreground">Lead</th>
                <th className="px-3 py-2 text-left font-medium text-muted-foreground">Course</th>
                <th className="px-3 py-2 text-right font-medium text-muted-foreground">Type</th>
                <th className="px-3 py-2 text-right font-medium text-muted-foreground">Commission</th>
                <th className="px-3 py-2 text-right font-medium text-muted-foreground w-20">Action</th>
              </tr>
            </thead>
            <tbody>
              {overrides.map(o => {
                const isEditing = editingId === o.id;
                return (
                  <tr key={o.id} className="border-b border-border/40 last:border-0">
                    <td className="px-3 py-2">
                      <div className="font-medium text-foreground">{o.lead_name}</div>
                      {o.lead_phone && <div className="text-[10px] text-muted-foreground">{o.lead_phone}</div>}
                      {o.notes && <div className="text-[10px] text-muted-foreground italic mt-0.5">{o.notes}</div>}
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">{o.course_name || "—"}</td>
                    <td className="px-3 py-2 text-right">
                      {isEditing ? (
                        <select
                          value={editType}
                          onChange={e => setEditType(e.target.value)}
                          className="rounded border border-input bg-background px-1 py-0.5 text-xs"
                        >
                          <option value="fixed">Fixed</option>
                          <option value="percentage">%</option>
                        </select>
                      ) : (
                        <Badge variant="outline" className="text-[9px]">
                          {o.commission_type === "percentage" ? "%" : "Fixed"}
                        </Badge>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {isEditing ? (
                        <div className="space-y-1">
                          <input
                            type="number"
                            value={editValue}
                            onChange={e => setEditValue(e.target.value)}
                            className="w-20 rounded border border-input bg-background px-2 py-1 text-xs text-right"
                            autoFocus
                          />
                          <input
                            value={editNotes}
                            onChange={e => setEditNotes(e.target.value)}
                            placeholder="Notes"
                            className="w-28 rounded border border-input bg-background px-2 py-1 text-[10px]"
                          />
                        </div>
                      ) : (
                        <span className="font-semibold">
                          {o.commission_type === "percentage" ? `${o.commission_value}%` : `₹${Number(o.commission_value).toLocaleString("en-IN")}`}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {isEditing ? (
                        <div className="flex items-center gap-1 justify-end">
                          <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={() => handleSave(o)} disabled={saving}>
                            {saving ? <ButtonOrb state="working" /> : <Save className="h-3 w-3 text-success" />}
                          </Button>
                          <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={() => setEditingId(null)}>
                            <X className="h-3 w-3 text-muted-foreground" />
                          </Button>
                        </div>
                      ) : canEdit && (
                        <div className="flex items-center gap-1 justify-end">
                          <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={() => {
                            setEditingId(o.id);
                            setEditValue(String(o.commission_value));
                            setEditType(o.commission_type);
                            setEditNotes(o.notes || "");
                          }}>
                            <Edit className="h-3 w-3 text-muted-foreground" />
                          </Button>
                          <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={() => handleDelete(o)}>
                            <Trash2 className="h-3 w-3 text-muted-foreground" />
                          </Button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
