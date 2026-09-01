import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { useCourseCampusLink } from "@/hooks/useCourseCampusLink";
import { PageLoader } from "@/components/ui/page-loader";
import { ButtonOrb } from "@/components/ui/thinking-orb";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TextField, SelectField, TextAreaField } from "@/components/ui/state-fields";
import { PhoneInput } from "@/components/ui/phone-input";
import { ApplyMagicLinkButton } from "@/components/leads/ApplyMagicLinkButton";
import { useIsMobile } from "@/hooks/use-mobile";
import { Plus, GraduationCap, FileText, Users, UserPlus, ChevronDown } from "lucide-react";

// A partner-entered lead. RLS scopes every select on `leads` to the caller's
// attributed rows, so a plain select returns only this partner's leads.
interface PartnerLead {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  guardian_name: string | null;
  guardian_phone: string | null;
  course_id: string | null;
  campus_id: string | null;
  stage: string;
  pre_admission_no: string | null;
  admission_no: string | null;
  application_id: string | null;
  created_at: string;
}

interface PartnerApplication {
  id: string;
  application_id: string;
  lead_id: string | null;
  full_name: string | null;
  status: string | null;
  payment_status: string | null;
  created_at: string;
}

interface PartnerStudent {
  id: string;
  name: string;
  phone: string | null;
  status: string | null;
  pre_admission_no: string | null;
  admission_no: string | null;
  created_at: string;
}

const TABS = ["leads", "applications", "students"] as const;
type TabKey = (typeof TABS)[number];

const EMPTY_LEAD = {
  name: "", phone: "", email: "", guardian_name: "", guardian_phone: "",
  course_id: "", campus_id: "", notes: "",
};

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

export default function AdmissionPartnerPortal() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const { courseOptions, coursesByDepartment, getCampusesForCourse } = useCourseCampusLink();

  const [loading, setLoading] = useState(true);
  const [leads, setLeads] = useState<PartnerLead[]>([]);
  const [applications, setApplications] = useState<PartnerApplication[]>([]);
  const [students, setStudents] = useState<PartnerStudent[]>([]);

  const [addOpen, setAddOpen] = useState(false);

  const tabParam = searchParams.get("tab");
  const activeTab: TabKey = (TABS as readonly string[]).includes(tabParam || "") ? (tabParam as TabKey) : "leads";
  const setTab = (t: string) => setSearchParams(prev => { prev.set("tab", t); return prev; }, { replace: true });

  const courseName = useMemo(() => {
    const m = new Map(courseOptions.map(c => [c.id, c.name]));
    return (id: string | null) => (id ? m.get(id) ?? "—" : "—");
  }, [courseOptions]);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    // Scope leads on the indexed admission_partner_id column. A bare select
    // relies solely on the can_view_lead RLS chain, which the planner evaluates
    // per row across all 30k+ leads -> statement timeout. Resolving our partner
    // row first lets the query use idx_leads_admission_partner_id (~10ms).
    const { data: partner } = await supabase
      .from("admission_partners")
      .select("id")
      .eq("user_id", user?.id ?? "")
      .maybeSingle();
    const partnerId = partner?.id;
    if (!partnerId) {
      setLeads([]); setApplications([]); setStudents([]); setLoading(false);
      return;
    }

    const l = await supabase.from("leads")
      .select("id, name, phone, email, guardian_name, guardian_phone, course_id, campus_id, stage, pre_admission_no, admission_no, application_id, created_at")
      .eq("admission_partner_id", partnerId)
      .order("created_at", { ascending: false });
    if (l.error) toast({ title: "Failed to load leads", description: l.error.message, variant: "destructive" });
    const leadRows = (l.data as PartnerLead[]) ?? [];
    setLeads(leadRows);

    // Applications and students carry no partner column; scope them to the
    // partner's own leads (indexed lead_id) instead of a full-table RLS scan.
    const leadIds = leadRows.map(r => r.id);
    if (leadIds.length === 0) {
      setApplications([]); setStudents([]); setLoading(false);
      return;
    }
    const [a, s] = await Promise.all([
      supabase.from("applications")
        .select("id, application_id, lead_id, full_name, status, payment_status, created_at")
        .in("lead_id", leadIds)
        .order("created_at", { ascending: false }),
      supabase.from("students")
        .select("id, name, phone, status, pre_admission_no, admission_no, created_at")
        .in("lead_id", leadIds)
        .order("created_at", { ascending: false }),
    ]);
    setApplications((a.data as PartnerApplication[]) ?? []);
    setStudents((s.data as PartnerStudent[]) ?? []);
    setLoading(false);
  }, [toast, user?.id]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  if (loading) return <PageLoader />;

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6 space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Admission Partner Portal</h1>
          <p className="text-sm text-muted-foreground">Your leads, applications and admissions.</p>
        </div>
        <Button onClick={() => setAddOpen(true)} className="gap-1.5">
          <Plus className="h-4 w-4" /> Add Lead
        </Button>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <StatCard icon={<GraduationCap className="h-4 w-4" />} label="Leads" value={leads.length} />
        <StatCard icon={<FileText className="h-4 w-4" />} label="Applications" value={applications.length} />
        <StatCard icon={<Users className="h-4 w-4" />} label="Students" value={students.length} />
      </div>

      <Tabs value={activeTab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="leads">Leads</TabsTrigger>
          <TabsTrigger value="applications">Applications</TabsTrigger>
          <TabsTrigger value="students">Students</TabsTrigger>
        </TabsList>

        <TabsContent value="leads" className="mt-4">
          {leads.length === 0 ? (
            <EmptyState icon={UserPlus} title="No leads yet" description="Add your first lead to get started." />
          ) : (
            <Card><CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Phone</TableHead>
                    <TableHead>Course</TableHead>
                    <TableHead>Stage</TableHead>
                    <TableHead>Added</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {leads.map(lead => {
                    // Conversion to a student happens automatically when the lead
                    // pays their token fee (handle_lead_payment_change trigger),
                    // so the portal only shows the outcome — no manual convert.
                    const converted = !!lead.pre_admission_no || !!lead.admission_no;
                    return (
                      <TableRow key={lead.id}>
                        <TableCell className="font-medium">{lead.name}</TableCell>
                        <TableCell>{lead.phone}</TableCell>
                        <TableCell>{courseName(lead.course_id)}</TableCell>
                        <TableCell><Badge variant="secondary">{lead.stage.replace(/_/g, " ")}</Badge></TableCell>
                        <TableCell className="text-muted-foreground">{fmtDate(lead.created_at)}</TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-2">
                            <ApplyMagicLinkButton
                              leadId={lead.id}
                              leadName={lead.name}
                              leadPhone={lead.phone}
                              compact
                              label="Application"
                            />
                            {converted && <Badge variant="outline">Converted</Badge>}
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent></Card>
          )}
        </TabsContent>

        <TabsContent value="applications" className="mt-4">
          {applications.length === 0 ? (
            <EmptyState icon={FileText} title="No applications yet" description="Applications for your leads show up here." />
          ) : (
            <Card><CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Application ID</TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Payment</TableHead>
                    <TableHead>Started</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {applications.map(app => (
                    <TableRow key={app.id}>
                      <TableCell className="font-mono text-xs">{app.application_id}</TableCell>
                      <TableCell className="font-medium">{app.full_name ?? "—"}</TableCell>
                      <TableCell><Badge variant="secondary">{app.status ?? "draft"}</Badge></TableCell>
                      <TableCell>
                        <Badge variant={app.payment_status === "paid" ? "default" : "outline"}>
                          {app.payment_status ?? "pending"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-muted-foreground">{fmtDate(app.created_at)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent></Card>
          )}
        </TabsContent>

        <TabsContent value="students" className="mt-4">
          {students.length === 0 ? (
            <EmptyState icon={Users} title="No students yet" description="A lead becomes a student automatically once they pay their token fee." />
          ) : (
            <Card><CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Phone</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>PAN</TableHead>
                    <TableHead>Admission No.</TableHead>
                    <TableHead>Admitted</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {students.map(st => (
                    <TableRow key={st.id}>
                      <TableCell className="font-medium">{st.name}</TableCell>
                      <TableCell>{st.phone ?? "—"}</TableCell>
                      <TableCell><Badge variant="secondary">{(st.status ?? "").replace(/_/g, " ")}</Badge></TableCell>
                      <TableCell className="font-mono text-xs">{st.pre_admission_no ?? "—"}</TableCell>
                      <TableCell className="font-mono text-xs">{st.admission_no ?? "—"}</TableCell>
                      <TableCell className="text-muted-foreground">{fmtDate(st.created_at)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent></Card>
          )}
        </TabsContent>
      </Tabs>

      <AddLeadForm
        open={addOpen}
        onOpenChange={setAddOpen}
        onSaved={fetchAll}
        coursesByDepartment={coursesByDepartment}
        getCampusesForCourse={getCampusesForCourse}
        userId={user?.id ?? null}
      />
    </div>
  );
}

function StatCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: number }) {
  return (
    <Card><CardContent className="flex items-center gap-3 p-4">
      <div className="rounded-lg bg-muted p-2 text-muted-foreground">{icon}</div>
      <div>
        <div className="text-2xl font-semibold">{value}</div>
        <div className="text-xs text-muted-foreground">{label}</div>
      </div>
    </CardContent></Card>
  );
}

// Field-PRO add-lead form. Mobile-first: bottom sheet on phones, dialog on
// desktop; only Name + Phone + Course up front (the rest collapses), big touch
// targets, and "Save & add another" for rapid on-field entry. Routes through
// admission_partner_insert_lead, which stamps attribution + source +
// skip_ai_call server-side, so there is no counsellor/source picker.
function AddLeadForm({
  open, onOpenChange, onSaved, coursesByDepartment, getCampusesForCourse, userId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
  coursesByDepartment: { department: string; courses: { id: string; name: string }[] }[];
  getCampusesForCourse: (courseId: string | null) => { id: string; name: string }[];
  userId: string | null;
}) {
  const { toast } = useToast();
  const isMobile = useIsMobile();
  const [form, setForm] = useState(EMPTY_LEAD);
  const [saving, setSaving] = useState(false);
  const [showMore, setShowMore] = useState(false);
  // Bumping this remounts the Name field so its autoFocus re-fires — lets
  // "Save & add another" drop the cursor straight back on Name without ref
  // plumbing through TextField.
  const [formKey, setFormKey] = useState(0);

  const reset = () => { setForm(EMPTY_LEAD); setShowMore(false); setFormKey(k => k + 1); };
  useEffect(() => { if (open) reset(); }, [open]);

  const campuses = getCampusesForCourse(form.course_id || null);
  // Only surface the campus picker when the chosen course spans >1 campus; a
  // single-campus course auto-selects (below) and no course means nothing to pick.
  const showCampus = !!form.course_id && campuses.length > 1;

  const handleCourseChange = (courseId: string) => {
    const cs = getCampusesForCourse(courseId || null);
    setForm(p => ({ ...p, course_id: courseId, campus_id: cs.length === 1 ? cs[0].id : "" }));
  };

  const handleSubmit = async (keepOpen: boolean) => {
    if (!form.name.trim() || !form.phone.trim()) {
      toast({ title: "Required", description: "Name and phone are required", variant: "destructive" });
      return;
    }
    setSaving(true);
    const { data: leadId, error } = await supabase.rpc("admission_partner_insert_lead" as any, {
      _name: form.name.trim(),
      _phone: form.phone.trim(),
      _email: form.email.trim() || null,
      _guardian_name: form.guardian_name.trim() || null,
      _guardian_phone: form.guardian_phone.trim() || null,
      _course_id: form.course_id || null,
      _campus_id: form.campus_id || null,
      _notes: form.notes.trim() || null,
    });
    if (!error && leadId) {
      await supabase.from("lead_activities").insert({
        lead_id: leadId as string,
        type: "lead_created",
        description: "Lead created by admission partner",
        user_id: userId,
      });
    }
    setSaving(false);
    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
      return;
    }
    onSaved();
    if (keepOpen) {
      reset();
      toast({ title: "Lead added — add another" });
    } else {
      toast({ title: "Lead added" });
      onOpenChange(false);
    }
  };

  const phoneField = (label: string, value: string, onChange: (v: string) => void, required = false) => (
    <div className="min-w-0">
      <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
        {label}{required && <span className="text-destructive"> *</span>}
      </label>
      <PhoneInput value={value} onChange={onChange} required={required} />
    </div>
  );

  // Plain variable (NOT a nested component) so React reconciles in place and
  // inputs keep focus across re-renders.
  const body = (
    <div className="space-y-4">
      {/* Essentials — always visible */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <TextField
          key={`name-${formKey}`}
          value={form.name}
          onValueChange={v => setForm(p => ({ ...p, name: v }))}
          label="Name"
          required
          placeholder="Student name"
          autoFocus
          autoComplete="off"
          autoCapitalize="words"
        />
        {phoneField("Phone", form.phone, phone => setForm(p => ({ ...p, phone })), true)}
      </div>
      <SelectField
        value={form.course_id}
        onValueChange={handleCourseChange}
        groups={coursesByDepartment.map(g => ({
          label: g.department,
          options: (g.courses ?? []).map(c => ({ value: c.id, label: c.name })),
        }))}
        label="Course"
        placeholder="Select course (optional)"
      />
      {showCampus && (
        <SelectField
          value={form.campus_id}
          onValueChange={v => setForm(p => ({ ...p, campus_id: v }))}
          options={[{ value: "", label: "Select campus" }, ...campuses.map(c => ({ value: c.id, label: c.name }))]}
          label="Campus"
          allowEmpty={false}
        />
      )}

      {/* Optional details — collapsed by default */}
      <button
        type="button"
        onClick={() => setShowMore(v => !v)}
        className="flex w-full items-center justify-between rounded-lg border border-dashed border-border px-3 py-2.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted"
      >
        Add more details (optional)
        <ChevronDown className={`h-4 w-4 transition-transform ${showMore ? "rotate-180" : ""}`} />
      </button>
      {showMore && (
        <div className="space-y-4">
          <TextField value={form.email} onValueChange={v => setForm(p => ({ ...p, email: v }))} label="Email" type="email" placeholder="email@example.com" autoComplete="off" />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <TextField value={form.guardian_name} onValueChange={v => setForm(p => ({ ...p, guardian_name: v }))} label="Guardian Name" autoCapitalize="words" />
            {phoneField("Guardian Phone", form.guardian_phone, phone => setForm(p => ({ ...p, guardian_phone: phone })))}
          </div>
          <TextAreaField value={form.notes} onValueChange={v => setForm(p => ({ ...p, notes: v }))} label="Notes" rows={2} />
        </div>
      )}

      {/* Sticky footer so the CTAs stay thumb-reachable above the keyboard */}
      <div className="sticky bottom-0 -mx-1 flex flex-col-reverse gap-2 bg-background pt-3 sm:flex-row sm:justify-end">
        <Button variant="outline" onClick={() => onOpenChange(false)} className="sm:w-auto">Cancel</Button>
        <Button variant="outline" size="lg" onClick={() => handleSubmit(true)} disabled={saving} className="gap-1.5">
          <Plus className="h-4 w-4" /> Save &amp; add another
        </Button>
        <Button size="lg" onClick={() => handleSubmit(false)} disabled={saving} className="gap-1.5">
          {saving ? <ButtonOrb state="working" onFilled /> : <Plus className="h-4 w-4" />} Save Lead
        </Button>
      </div>
    </div>
  );

  if (isMobile) {
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="bottom" className="max-h-[92dvh] overflow-y-auto rounded-t-2xl">
          <SheetHeader className="text-left"><SheetTitle>Add New Lead</SheetTitle></SheetHeader>
          <div className="mt-2">{body}</div>
        </SheetContent>
      </Sheet>
    );
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Add New Lead</DialogTitle></DialogHeader>
        <div className="mt-2">{body}</div>
      </DialogContent>
    </Dialog>
  );
}
