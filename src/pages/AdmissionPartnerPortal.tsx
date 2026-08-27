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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TextField, SelectField, TextAreaField } from "@/components/ui/state-fields";
import { PhoneInput } from "@/components/ui/phone-input";
import { ApplyMagicLinkButton } from "@/components/leads/ApplyMagicLinkButton";
import { ConvertToStudentDialog } from "@/components/admissions/ConvertToStudentDialog";
import { Plus, GraduationCap, FileText, Users, UserPlus } from "lucide-react";

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
  const { courseOptions, allCampuses, coursesByDepartment, getCampusesForCourse } = useCourseCampusLink();

  const [loading, setLoading] = useState(true);
  const [leads, setLeads] = useState<PartnerLead[]>([]);
  const [applications, setApplications] = useState<PartnerApplication[]>([]);
  const [students, setStudents] = useState<PartnerStudent[]>([]);

  const [addOpen, setAddOpen] = useState(false);
  const [convertLead, setConvertLead] = useState<PartnerLead | null>(null);

  const tabParam = searchParams.get("tab");
  const activeTab: TabKey = (TABS as readonly string[]).includes(tabParam || "") ? (tabParam as TabKey) : "leads";
  const setTab = (t: string) => setSearchParams(prev => { prev.set("tab", t); return prev; }, { replace: true });

  const courseName = useMemo(() => {
    const m = new Map(courseOptions.map(c => [c.id, c.name]));
    return (id: string | null) => (id ? m.get(id) ?? "—" : "—");
  }, [courseOptions]);
  const campusName = useMemo(() => {
    const m = new Map(allCampuses.map(c => [c.id, c.name]));
    return (id: string | null) => (id ? m.get(id) ?? "—" : "—");
  }, [allCampuses]);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    const [l, a, s] = await Promise.all([
      supabase.from("leads")
        .select("id, name, phone, email, guardian_name, guardian_phone, course_id, campus_id, stage, pre_admission_no, admission_no, application_id, created_at")
        .order("created_at", { ascending: false }),
      supabase.from("applications")
        .select("id, application_id, lead_id, full_name, status, payment_status, created_at")
        .order("created_at", { ascending: false }),
      supabase.from("students")
        .select("id, name, phone, status, pre_admission_no, admission_no, created_at")
        .order("created_at", { ascending: false }),
    ]);
    if (l.error) toast({ title: "Failed to load leads", description: l.error.message, variant: "destructive" });
    setLeads((l.data as PartnerLead[]) ?? []);
    setApplications((a.data as PartnerApplication[]) ?? []);
    setStudents((s.data as PartnerStudent[]) ?? []);
    setLoading(false);
  }, [toast]);

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
                            {converted ? (
                              <Badge variant="outline">Converted</Badge>
                            ) : (
                              <Button size="sm" variant="outline" onClick={() => setConvertLead(lead)}>
                                Convert
                              </Button>
                            )}
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
            <EmptyState icon={Users} title="No students yet" description="Convert a lead to see it here." />
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
        onSuccess={() => { setAddOpen(false); fetchAll(); }}
        coursesByDepartment={coursesByDepartment}
        getCampusesForCourse={getCampusesForCourse}
        userId={user?.id ?? null}
      />

      {convertLead && (
        <ConvertToStudentDialog
          open={!!convertLead}
          onOpenChange={open => { if (!open) setConvertLead(null); }}
          lead={{
            id: convertLead.id,
            name: convertLead.name,
            phone: convertLead.phone,
            email: convertLead.email,
            guardian_name: convertLead.guardian_name,
            guardian_phone: convertLead.guardian_phone,
            course_id: convertLead.course_id,
            campus_id: convertLead.campus_id,
            stage: convertLead.stage,
            pre_admission_no: convertLead.pre_admission_no,
            admission_no: convertLead.admission_no,
          }}
          courseName={courseName(convertLead.course_id)}
          campusName={campusName(convertLead.campus_id)}
          onSuccess={() => { setConvertLead(null); fetchAll(); }}
        />
      )}
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

// Lean partner add-lead form. Routes through admission_partner_insert_lead, which
// stamps attribution + source='admission_partner' + skip_ai_call server-side, so
// there is no counsellor/source picker (unlike the counsellor AddLeadDialog).
function AddLeadForm({
  open, onOpenChange, onSuccess, coursesByDepartment, getCampusesForCourse, userId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
  coursesByDepartment: { department: string; courses: { id: string; name: string }[] }[];
  getCampusesForCourse: (courseId: string | null) => { id: string; name: string }[];
  userId: string | null;
}) {
  const { toast } = useToast();
  const [form, setForm] = useState(EMPTY_LEAD);
  const [saving, setSaving] = useState(false);

  useEffect(() => { if (open) setForm(EMPTY_LEAD); }, [open]);

  const campuses = getCampusesForCourse(form.course_id || null);

  const handleCourseChange = (courseId: string) => {
    const cs = getCampusesForCourse(courseId || null);
    setForm(p => ({ ...p, course_id: courseId, campus_id: cs.length === 1 ? cs[0].id : "" }));
  };

  const handleSubmit = async () => {
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
    toast({ title: "Lead added" });
    onSuccess();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Add New Lead</DialogTitle></DialogHeader>
        <div className="space-y-4 mt-2">
          <div className="grid grid-cols-2 gap-3">
            <TextField value={form.name} onValueChange={v => setForm(p => ({ ...p, name: v }))} label="Name" required placeholder="Student name" />
            <div className="min-w-0">
              <label className="block text-[11px] font-medium text-muted-foreground mb-1">Phone *</label>
              <PhoneInput value={form.phone} onChange={phone => setForm(p => ({ ...p, phone }))} required />
            </div>
          </div>
          <TextField value={form.email} onValueChange={v => setForm(p => ({ ...p, email: v }))} label="Email" type="email" placeholder="email@example.com" />
          <div className="grid grid-cols-2 gap-3">
            <TextField value={form.guardian_name} onValueChange={v => setForm(p => ({ ...p, guardian_name: v }))} label="Guardian Name" />
            <div className="min-w-0">
              <label className="block text-[11px] font-medium text-muted-foreground mb-1">Guardian Phone</label>
              <PhoneInput value={form.guardian_phone} onChange={phone => setForm(p => ({ ...p, guardian_phone: phone }))} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <SelectField
              value={form.course_id}
              onValueChange={handleCourseChange}
              groups={coursesByDepartment.map(g => ({
                label: g.department,
                options: (g.courses ?? []).map(c => ({ value: c.id, label: c.name })),
              }))}
              label="Course"
              placeholder="Select course"
            />
            <SelectField
              value={form.campus_id}
              onValueChange={v => setForm(p => ({ ...p, campus_id: v }))}
              options={
                !form.course_id
                  ? [{ value: "", label: "Select course first" }]
                  : campuses.length === 1
                    ? [{ value: campuses[0].id, label: campuses[0].name }]
                    : [{ value: "", label: "Select campus" }, ...campuses.map(c => ({ value: c.id, label: c.name }))]
              }
              label="Campus"
              disabled={campuses.length <= 1}
              allowEmpty={false}
            />
          </div>
          <TextAreaField value={form.notes} onValueChange={v => setForm(p => ({ ...p, notes: v }))} label="Notes" rows={2} />
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button onClick={handleSubmit} disabled={saving} className="gap-1.5">
              {saving ? <ButtonOrb state="working" onFilled /> : <Plus className="h-4 w-4" />} Add Lead
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
