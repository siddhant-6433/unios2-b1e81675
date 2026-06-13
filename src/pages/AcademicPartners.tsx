import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { PhoneInput } from "@/components/ui/phone-input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  BookOpen,
  GraduationCap,
  IndianRupee,
  Link2,
  Loader2,
  Pencil,
  Plus,
  Search,
  Users,
} from "lucide-react";
import { LeadAssociationRequestsPanel } from "@/components/admissions/LeadAssociationRequestsPanel";

type Partner = {
  id: string;
  user_id: string | null;
  name: string;
  organization: string | null;
  phone: string | null;
  email: string | null;
  status: string;
  default_payout_percentage: number;
  notes: string | null;
};

type Dashboard = {
  partner_id: string;
  partner_name: string;
  organization: string | null;
  status: string;
  assigned_courses: number;
  assigned_batches: number;
  total_leads: number;
  total_candidates: number;
  total_fee_collected: number;
  total_payout: number;
  pending_payout: number;
};

type Assignment = {
  id: string;
  partner_id: string;
  course_id: string;
  course_name: string;
  batch_id: string | null;
  batch_name: string | null;
  effective_payout_percentage: number;
  candidates: number;
  fee_collected: number;
};

type PartnerRole = { user_id: string };

const inputCls = "w-full rounded-xl border border-input bg-background px-3 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring/20";
const fmt = (n: number | string | null | undefined) => `₹${Number(n || 0).toLocaleString("en-IN")}`;

export default function AcademicPartners() {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [partners, setPartners] = useState<Partner[]>([]);
  const [dashboard, setDashboard] = useState<Dashboard[]>([]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [courses, setCourses] = useState<{ id: string; name: string }[]>([]);
  const [batches, setBatches] = useState<{ id: string; name: string; course_id: string }[]>([]);
  const [partnerUsers, setPartnerUsers] = useState<{ user_id: string; display_name: string | null; email: string | null }[]>([]);
  const [search, setSearch] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [showAssignment, setShowAssignment] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [assignmentPartnerId, setAssignmentPartnerId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    name: "",
    organization: "",
    phone: "",
    email: "",
    status: "active",
    default_payout_percentage: "0",
    user_id: "",
    notes: "",
  });
  const [assignmentForm, setAssignmentForm] = useState({ course_id: "", batch_id: "", payout_percentage: "" });

  const fetchAll = async () => {
    setLoading(true);
    const [partnersRes, dashboardRes, assignmentsRes, coursesRes, batchesRes, rolesRes] = await Promise.all([
      supabase.from("academic_partners").select("*").order("created_at", { ascending: false }),
      supabase.from("academic_partner_dashboard").select("*").order("partner_name"),
      supabase.from("academic_partner_assignment_summary").select("*").order("course_name"),
      supabase.from("courses").select("id, name").order("name"),
      supabase.from("batches").select("id, name, course_id").order("name"),
      supabase.from("user_roles").select("user_id").eq("role", "academic_partner"),
    ]);

    const roleUserIds = ((rolesRes.data || []) as PartnerRole[]).map((r) => r.user_id);
    let profiles: { user_id: string; display_name: string | null; email: string | null }[] = [];
    if (roleUserIds.length > 0) {
      const { data } = await supabase.from("profiles").select("user_id, display_name, email").in("user_id", roleUserIds);
      profiles = data || [];
    }

    setPartners((partnersRes.data || []) as Partner[]);
    setDashboard((dashboardRes.data || []) as Dashboard[]);
    setAssignments((assignmentsRes.data || []) as Assignment[]);
    setCourses(coursesRes.data || []);
    setBatches((batchesRes.data || []) as { id: string; name: string; course_id: string }[]);
    setPartnerUsers(profiles);
    setLoading(false);
  };

  useEffect(() => { fetchAll(); }, []);

  const dashboardByPartner = useMemo(() => {
    const map = new Map<string, Dashboard>();
    dashboard.forEach((d) => map.set(d.partner_id, d));
    return map;
  }, [dashboard]);

  const filtered = partners.filter((partner) => {
    const q = search.toLowerCase();
    return !q || partner.name.toLowerCase().includes(q) || (partner.organization || "").toLowerCase().includes(q) || (partner.email || "").toLowerCase().includes(q);
  });

  const resetForm = () => {
    setShowForm(false);
    setEditingId(null);
    setForm({ name: "", organization: "", phone: "", email: "", status: "active", default_payout_percentage: "0", user_id: "", notes: "" });
  };

  const openEdit = (partner: Partner) => {
    setEditingId(partner.id);
    setForm({
      name: partner.name,
      organization: partner.organization || "",
      phone: partner.phone || "",
      email: partner.email || "",
      status: partner.status,
      default_payout_percentage: String(partner.default_payout_percentage || 0),
      user_id: partner.user_id || "",
      notes: partner.notes || "",
    });
    setShowForm(true);
  };

  const handleSave = async () => {
    if (!form.name.trim()) {
      toast({ title: "Name is required", variant: "destructive" });
      return;
    }
    setSaving(true);
    const payload = {
      name: form.name.trim(),
      organization: form.organization.trim() || null,
      phone: form.phone.trim() || null,
      email: form.email.trim() || null,
      status: form.status,
      default_payout_percentage: Number(form.default_payout_percentage) || 0,
      user_id: form.user_id || null,
      notes: form.notes.trim() || null,
    };
    const { error } = editingId
      ? await supabase.from("academic_partners").update(payload).eq("id", editingId)
      : await supabase.from("academic_partners").insert(payload);
    if (error) {
      toast({ title: "Save failed", description: error.message, variant: "destructive" });
    } else {
      toast({ title: editingId ? "Academic partner updated" : "Academic partner added" });
      resetForm();
      await fetchAll();
    }
    setSaving(false);
  };

  const openAssignment = (partnerId: string) => {
    setAssignmentPartnerId(partnerId);
    setAssignmentForm({ course_id: "", batch_id: "", payout_percentage: "" });
    setShowAssignment(true);
  };

  const handleAddAssignment = async () => {
    if (!assignmentPartnerId || !assignmentForm.course_id) return;
    setSaving(true);
    const { error } = await supabase.from("academic_partner_assignments").insert({
      partner_id: assignmentPartnerId,
      course_id: assignmentForm.course_id,
      batch_id: assignmentForm.batch_id || null,
      payout_percentage: assignmentForm.payout_percentage ? Number(assignmentForm.payout_percentage) : null,
      is_active: true,
    });
    if (error) {
      toast({ title: "Assignment failed", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Assignment added" });
      setShowAssignment(false);
      await fetchAll();
    }
    setSaving(false);
  };

  const filteredBatches = batches.filter((batch) => batch.course_id === assignmentForm.course_id);
  const totals = {
    partners: partners.length,
    candidates: dashboard.reduce((sum, row) => sum + Number(row.total_candidates || 0), 0),
    fee: dashboard.reduce((sum, row) => sum + Number(row.total_fee_collected || 0), 0),
    payout: dashboard.reduce((sum, row) => sum + Number(row.pending_payout || 0), 0),
  };

  if (loading) return <div className="flex h-64 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Academic Partners</h1>
          <p className="mt-1 text-sm text-muted-foreground">Manage batch ownership, admissions access, and partner payouts</p>
        </div>
        <Button onClick={() => setShowForm(true)} className="gap-2"><Plus className="h-4 w-4" /> Add Partner</Button>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: "Partners", value: totals.partners, icon: Users, bg: "bg-pastel-blue" },
          { label: "Candidates", value: totals.candidates, icon: GraduationCap, bg: "bg-pastel-green" },
          { label: "Fee Collected", value: fmt(totals.fee), icon: IndianRupee, bg: "bg-pastel-mint" },
          { label: "Pending Payout", value: fmt(totals.payout), icon: IndianRupee, bg: "bg-pastel-yellow" },
        ].map((item) => (
          <Card key={item.label} className="border-border/60 shadow-none">
            <CardContent className="p-4">
              <div className={`mb-2 inline-flex h-9 w-9 items-center justify-center rounded-lg ${item.bg}`}>
                <item.icon className="h-4 w-4 text-foreground/70" />
              </div>
              <p className="text-xl font-bold text-foreground">{item.value}</p>
              <p className="text-xs text-muted-foreground">{item.label}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search partners..." className="w-full rounded-xl border border-input bg-card py-2.5 pl-10 pr-4 text-sm focus:outline-none focus:ring-2 focus:ring-ring/20" />
      </div>

      <Card className="border-border/60 shadow-none">
        <CardContent className="p-5">
          <LeadAssociationRequestsPanel requesterType="academic_partner" />
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        {filtered.map((partner) => {
          const row = dashboardByPartner.get(partner.id);
          const partnerAssignments = assignments.filter((a) => a.partner_id === partner.id);
          return (
            <Card key={partner.id} className="border-border/60 shadow-none">
              <CardContent className="p-5">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="text-base font-semibold text-foreground">{partner.name}</h3>
                      {partner.user_id && <Badge className="border-0 bg-emerald-100 text-emerald-700 text-[10px]">Linked</Badge>}
                      <Badge className={`border-0 text-[10px] ${partner.status === "active" ? "bg-emerald-100 text-emerald-700" : "bg-muted text-muted-foreground"}`}>{partner.status}</Badge>
                    </div>
                    {partner.organization && <p className="mt-0.5 text-sm text-primary">{partner.organization}</p>}
                    <p className="mt-1 text-xs text-muted-foreground">{partner.email || partner.phone || "No contact details"}</p>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openAssignment(partner.id)}><Link2 className="h-4 w-4" /></Button>
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEdit(partner)}><Pencil className="h-4 w-4" /></Button>
                  </div>
                </div>

                <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-3">
                  <div><p className="text-lg font-bold">{row?.assigned_batches || 0}</p><p className="text-xs text-muted-foreground">Batches</p></div>
                  <div><p className="text-lg font-bold">{row?.total_candidates || 0}</p><p className="text-xs text-muted-foreground">Candidates</p></div>
                  <div><p className="text-lg font-bold">{fmt(row?.total_fee_collected)}</p><p className="text-xs text-muted-foreground">Fee</p></div>
                  <div><p className="text-lg font-bold">{fmt(row?.pending_payout)}</p><p className="text-xs text-muted-foreground">Payout</p></div>
                </div>

                <div className="mt-4 border-t border-border/50 pt-3">
                  <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase text-muted-foreground">
                    <BookOpen className="h-3.5 w-3.5" /> Assignments
                  </div>
                  {partnerAssignments.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No course or batch assignments yet.</p>
                  ) : (
                    <div className="space-y-2">
                      {partnerAssignments.map((assignment) => (
                        <div key={assignment.id} className="rounded-lg border border-border/60 px-3 py-2 text-sm">
                          <div className="flex items-center justify-between gap-3">
                            <div>
                              <p className="font-medium">{assignment.batch_name || "All batches"}</p>
                              <p className="text-xs text-muted-foreground">{assignment.course_name}</p>
                            </div>
                            <Badge variant="secondary" className="text-[10px]">{Number(assignment.effective_payout_percentage || 0)}%</Badge>
                          </div>
                          <div className="mt-2 flex items-center gap-4 text-xs text-muted-foreground">
                            <span>{assignment.candidates} candidates</span>
                            <span>{fmt(assignment.fee_collected)} collected</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          );
        })}
        {filtered.length === 0 && <div className="col-span-full py-12 text-center text-sm text-muted-foreground">No academic partners found</div>}
      </div>

      <Dialog open={showForm} onOpenChange={(open) => { if (!open && !saving) resetForm(); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>{editingId ? "Edit Academic Partner" : "Add Academic Partner"}</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-medium text-muted-foreground mb-1">Name *</label>
                <input value={form.name} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} className={inputCls} />
              </div>
              <div>
                <label className="block text-[11px] font-medium text-muted-foreground mb-1">Organization</label>
                <input value={form.organization} onChange={(e) => setForm((p) => ({ ...p, organization: e.target.value }))} className={inputCls} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-medium text-muted-foreground mb-1">Phone</label>
                <PhoneInput value={form.phone} onChange={(phone) => setForm((p) => ({ ...p, phone }))} />
              </div>
              <div>
                <label className="block text-[11px] font-medium text-muted-foreground mb-1">Email</label>
                <input type="email" value={form.email} onChange={(e) => setForm((p) => ({ ...p, email: e.target.value }))} className={inputCls} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-medium text-muted-foreground mb-1">Default Payout %</label>
                <input type="number" min="0" value={form.default_payout_percentage} onChange={(e) => setForm((p) => ({ ...p, default_payout_percentage: e.target.value }))} className={inputCls} />
              </div>
              <div>
                <label className="block text-[11px] font-medium text-muted-foreground mb-1">Status</label>
                <select value={form.status} onChange={(e) => setForm((p) => ({ ...p, status: e.target.value }))} className={inputCls}>
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                </select>
              </div>
            </div>
            <div>
              <label className="block text-[11px] font-medium text-muted-foreground mb-1">Linked User Account</label>
              <select value={form.user_id} onChange={(e) => setForm((p) => ({ ...p, user_id: e.target.value }))} className={inputCls}>
                <option value="">No account linked</option>
                {partnerUsers.map((u) => <option key={u.user_id} value={u.user_id}>{u.display_name || "Unnamed"} {u.email ? `(${u.email})` : ""}</option>)}
              </select>
              <p className="mt-1 text-[10px] text-muted-foreground">Create or assign a user with the Academic Partner role first.</p>
            </div>
            <div>
              <label className="block text-[11px] font-medium text-muted-foreground mb-1">Notes</label>
              <textarea rows={2} value={form.notes} onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value }))} className={inputCls} />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={resetForm}>Cancel</Button>
              <Button onClick={handleSave} disabled={saving || !form.name.trim()} className="gap-2">{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Save</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={showAssignment} onOpenChange={setShowAssignment}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Add Course or Batch Assignment</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="block text-[11px] font-medium text-muted-foreground mb-1">Course *</label>
              <select value={assignmentForm.course_id} onChange={(e) => setAssignmentForm({ course_id: e.target.value, batch_id: "", payout_percentage: assignmentForm.payout_percentage })} className={inputCls}>
                <option value="">Select course</option>
                {courses.map((course) => <option key={course.id} value={course.id}>{course.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-[11px] font-medium text-muted-foreground mb-1">Batch</label>
              <select value={assignmentForm.batch_id} onChange={(e) => setAssignmentForm((p) => ({ ...p, batch_id: e.target.value }))} className={inputCls} disabled={!assignmentForm.course_id}>
                <option value="">All batches for course</option>
                {filteredBatches.map((batch) => <option key={batch.id} value={batch.id}>{batch.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-[11px] font-medium text-muted-foreground mb-1">Payout Override %</label>
              <input type="number" min="0" value={assignmentForm.payout_percentage} onChange={(e) => setAssignmentForm((p) => ({ ...p, payout_percentage: e.target.value }))} placeholder="Use partner default" className={inputCls} />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setShowAssignment(false)}>Cancel</Button>
              <Button onClick={handleAddAssignment} disabled={saving || !assignmentForm.course_id} className="gap-2">{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />} Add Assignment</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
