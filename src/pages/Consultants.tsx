import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  Plus, Search, Loader2, Users, Building2, Phone, Mail,
  IndianRupee, MapPin, MoreHorizontal, Edit, ChevronRight
} from "lucide-react";
import { PhoneInput } from "@/components/ui/phone-input";
import { CourseCommissions } from "@/components/consultant/CourseCommissions";

const STAGES = ["new", "contacted", "onboarded", "active", "inactive"] as const;
const stageLabels: Record<string, string> = { new: "New", contacted: "Contacted", onboarded: "Onboarded", active: "Active", inactive: "Inactive" };
const stageColors: Record<string, string> = { new: "bg-pastel-blue", contacted: "bg-pastel-orange", onboarded: "bg-pastel-purple", active: "bg-pastel-green", inactive: "bg-muted" };

interface Consultant {
  id: string; name: string; organization: string | null; phone: string | null; email: string | null;
  city: string | null; stage: string; commission_type: string | null; commission_value: number | null;
  notes: string | null; created_at: string; user_id: string | null;
}

const Consultants = () => {
  const { toast } = useToast();
  const [consultants, setConsultants] = useState<Consultant[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [stageFilter, setStageFilter] = useState("all");
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    name: "", organization: "", phone: "", email: "", city: "",
    stage: "new", commission_type: "percentage", commission_value: "0", notes: "", user_id: "",
  });
  const [consultantUsers, setConsultantUsers] = useState<{ user_id: string; display_name: string | null; email: string | null }[]>([]);

  const fetchConsultants = async () => {
    setLoading(true);
    const { data } = await supabase.from("consultants").select("*").order("created_at", { ascending: false });
    if (data) setConsultants(data);
    setLoading(false);
  };

  useEffect(() => { fetchConsultants(); }, []);

  // Fetch users with consultant role (for linking)
  const fetchConsultantUsers = async () => {
    const { data: roles } = await supabase.from("user_roles").select("user_id").eq("role", "consultant");
    if (!roles || roles.length === 0) { setConsultantUsers([]); return; }
    const userIds = roles.map(r => r.user_id);
    const { data: profiles } = await supabase.from("profiles").select("user_id, display_name, email").in("user_id", userIds);
    setConsultantUsers(profiles || []);
  };

  const filtered = consultants.filter(c => {
    const matchSearch = !search || c.name.toLowerCase().includes(search.toLowerCase()) ||
      (c.organization || "").toLowerCase().includes(search.toLowerCase()) ||
      (c.city || "").toLowerCase().includes(search.toLowerCase());
    const matchStage = stageFilter === "all" || c.stage === stageFilter;
    return matchSearch && matchStage;
  });

  const handleSave = async () => {
    if (!form.name.trim()) { toast({ title: "Name is required", variant: "destructive" }); return; }
    setSaving(true);
    const payload: any = {
      name: form.name.trim(),
      organization: form.organization.trim() || null,
      phone: form.phone.trim() || null,
      email: form.email.trim() || null,
      city: form.city.trim() || null,
      stage: form.stage,
      commission_type: form.commission_type,
      commission_value: Number(form.commission_value) || 0,
      notes: form.notes.trim() || null,
      user_id: form.user_id || null,
    };

    const { error } = editingId
      ? await supabase.from("consultants").update(payload).eq("id", editingId)
      : await supabase.from("consultants").insert(payload);

    if (error) toast({ title: "Error", description: error.message, variant: "destructive" });
    else { toast({ title: editingId ? "Updated" : "Consultant added" }); resetForm(); fetchConsultants(); }
    setSaving(false);
  };

  const resetForm = () => {
    setShowForm(false); setEditingId(null);
    setForm({ name: "", organization: "", phone: "", email: "", city: "", stage: "new", commission_type: "percentage", commission_value: "0", notes: "", user_id: "" });
  };

  const editConsultant = (c: Consultant) => {
    setForm({
      name: c.name, organization: c.organization || "", phone: c.phone || "", email: c.email || "",
      city: c.city || "", stage: c.stage, commission_type: c.commission_type || "percentage",
      commission_value: String(c.commission_value || 0), notes: c.notes || "", user_id: c.user_id || "",
    });
    setEditingId(c.id);
    setShowForm(true);
    fetchConsultantUsers();
  };

  const stats = [
    { label: "Total", value: consultants.length, color: "bg-pastel-blue" },
    { label: "Active", value: consultants.filter(c => c.stage === "active").length, color: "bg-pastel-green" },
    { label: "Onboarded", value: consultants.filter(c => c.stage === "onboarded").length, color: "bg-pastel-purple" },
    { label: "New", value: consultants.filter(c => c.stage === "new").length, color: "bg-pastel-orange" },
  ];

  const inputCls = "w-full rounded-xl border border-input bg-background px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/20";

  if (loading) return <div className="flex h-64 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Consultants</h1>
          <p className="text-sm text-muted-foreground mt-1">Manage admission consultants & referral agents</p>
        </div>
        <Button onClick={() => setShowForm(true)} className="gap-2"><Plus className="h-4 w-4" />Add Consultant</Button>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {stats.map(s => (
          <Card key={s.label} className="border-border/60 shadow-none">
            <CardContent className="p-4">
              <div className={`inline-flex h-9 w-9 items-center justify-center rounded-xl ${s.color} mb-2`}>
                <Users className="h-4 w-4 text-foreground/70" />
              </div>
              <p className="text-2xl font-bold text-foreground">{s.value}</p>
              <p className="text-xs text-muted-foreground">{s.label}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input type="text" placeholder="Search consultants..." value={search} onChange={e => setSearch(e.target.value)}
            className="w-full rounded-xl border border-input bg-card py-2.5 pl-10 pr-4 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/20" />
        </div>
        <select value={stageFilter} onChange={e => setStageFilter(e.target.value)}
          className="rounded-xl border border-input bg-card px-3 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring/20">
          <option value="all">All Stages</option>
          {STAGES.map(s => <option key={s} value={s}>{stageLabels[s]}</option>)}
        </select>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {filtered.map(c => (
          <Card key={c.id} className="border-border/60 shadow-none hover:shadow-sm transition-shadow cursor-pointer group" onClick={() => editConsultant(c)}>
            <CardContent className="p-5">
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="text-sm font-semibold text-foreground">{c.name}</h3>
                  {c.organization && <p className="text-xs text-primary font-medium mt-0.5">{c.organization}</p>}
                </div>
                <div className="flex items-center gap-1">
                  {c.user_id && <Badge className="text-[9px] border-0 bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400">Linked</Badge>}
                  <Badge className={`text-[10px] border-0 ${stageColors[c.stage] || "bg-muted"}`}>{stageLabels[c.stage] || c.stage}</Badge>
                </div>
              </div>
              <div className="flex flex-col gap-1 mt-3 text-xs text-muted-foreground">
                {c.city && <span className="flex items-center gap-1.5"><MapPin className="h-3 w-3" />{c.city}</span>}
                {c.phone && <span className="flex items-center gap-1.5"><Phone className="h-3 w-3" />{c.phone}</span>}
                {c.email && <span className="flex items-center gap-1.5"><Mail className="h-3 w-3" />{c.email}</span>}
              </div>
              <div className="flex items-center justify-between mt-3 pt-2 border-t border-border/40">
                <span className="text-xs text-muted-foreground flex items-center gap-1">
                  <IndianRupee className="h-3 w-3" />
                  {c.commission_value}{c.commission_type === "percentage" ? "%" : " flat"} commission
                </span>
                <ChevronRight className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
              </div>
            </CardContent>
          </Card>
        ))}
        {filtered.length === 0 && (
          <div className="col-span-full text-center py-12 text-sm text-muted-foreground">No consultants found</div>
        )}
      </div>

      <Dialog open={showForm} onOpenChange={o => { if (!saving) resetForm(); }}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingId ? "Edit Consultant" : "Add Consultant"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-medium text-muted-foreground mb-1">Name *</label>
                <input value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} className={inputCls} />
              </div>
              <div>
                <label className="block text-[11px] font-medium text-muted-foreground mb-1">Organization</label>
                <input value={form.organization} onChange={e => setForm(p => ({ ...p, organization: e.target.value }))} className={inputCls} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-medium text-muted-foreground mb-1">Phone</label>
                <PhoneInput value={form.phone} onChange={phone => setForm(p => ({ ...p, phone }))} />
              </div>
              <div>
                <label className="block text-[11px] font-medium text-muted-foreground mb-1">Email</label>
                <input type="email" value={form.email} onChange={e => setForm(p => ({ ...p, email: e.target.value }))} className={inputCls} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-medium text-muted-foreground mb-1">City</label>
                <input value={form.city} onChange={e => setForm(p => ({ ...p, city: e.target.value }))} className={inputCls} />
              </div>
              <div>
                <label className="block text-[11px] font-medium text-muted-foreground mb-1">Stage</label>
                <select value={form.stage} onChange={e => setForm(p => ({ ...p, stage: e.target.value }))} className={inputCls}>
                  {STAGES.map(s => <option key={s} value={s}>{stageLabels[s]}</option>)}
                </select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-medium text-muted-foreground mb-1">Commission Type</label>
                <select value={form.commission_type} onChange={e => setForm(p => ({ ...p, commission_type: e.target.value }))} className={inputCls}>
                  <option value="percentage">Percentage</option>
                  <option value="flat">Flat Amount</option>
                </select>
              </div>
              <div>
                <label className="block text-[11px] font-medium text-muted-foreground mb-1">Commission Value</label>
                <input type="number" value={form.commission_value} onChange={e => setForm(p => ({ ...p, commission_value: e.target.value }))} className={inputCls} />
              </div>
            </div>
            {editingId && (
              <div className="border-t border-border pt-4">
                <CourseCommissions consultantId={editingId} />
              </div>
            )}
            {editingId && (
              <div>
                <label className="block text-[11px] font-medium text-muted-foreground mb-1">Linked User Account</label>
                <select value={form.user_id} onChange={e => setForm(p => ({ ...p, user_id: e.target.value }))} className={inputCls}>
                  <option value="">No account linked</option>
                  {consultantUsers.map(u => (
                    <option key={u.user_id} value={u.user_id}>
                      {u.display_name || "Unnamed"} {u.email ? `(${u.email})` : ""}
                    </option>
                  ))}
                </select>
                <p className="text-[10px] text-muted-foreground mt-1">
                  Link a user with "Consultant" role to enable portal access. Create the user first in User Management.
                </p>
              </div>
            )}
            <div>
              <label className="block text-[11px] font-medium text-muted-foreground mb-1">Notes</label>
              <textarea value={form.notes} onChange={e => setForm(p => ({ ...p, notes: e.target.value }))} rows={2} className={inputCls} />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={resetForm}>Cancel</Button>
              <Button onClick={handleSave} disabled={saving} className="gap-1.5">
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                {editingId ? "Update" : "Add"} Consultant
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default Consultants;
