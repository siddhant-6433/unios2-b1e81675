import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { PhoneInput } from "@/components/ui/phone-input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  BookOpen,
  CalendarCheck,
  GraduationCap,
  IndianRupee,
  Loader2,
  Plus,
  TrendingUp,
  Users,
} from "lucide-react";
import { LeadAssociationRequestsPanel } from "@/components/admissions/LeadAssociationRequestsPanel";

type Partner = {
  id: string;
  name: string;
  default_payout_percentage: number;
};

type DashboardStats = {
  partner_name: string;
  assigned_courses: number;
  assigned_batches: number;
  total_leads: number;
  conversions: number;
  pipeline: number;
  total_candidates: number;
  total_fee_collected: number;
  total_payout: number;
  pending_payout: number;
  paid_payout: number;
};

type Assignment = {
  id: string;
  course_id: string;
  course_name: string;
  batch_id: string | null;
  batch_name: string | null;
  effective_payout_percentage: number;
  candidates: number;
  fee_collected: number;
};

type Lead = {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  stage: string;
  course_id: string | null;
  course_name: string;
  campus_name: string;
  created_at: string;
};

type Student = {
  id: string;
  name: string;
  admission_no: string | null;
  phone: string | null;
  course_name: string;
  batch_name: string;
  status: string;
};

type AttendanceRow = {
  id: string;
  date: string;
  status: string;
  subject: string | null;
  student_name: string;
  batch_name: string;
};

type FeeRow = {
  id: string;
  student_name: string;
  term: string;
  total_amount: number;
  paid_amount: number;
  balance: number;
  status: string;
};

type Payout = {
  id: string;
  payout_amount: number;
  payout_percentage: number;
  fee_paid: number;
  status: string;
  created_at: string;
  lead_name?: string;
  student_name?: string;
  course_name?: string;
};

type LeadRow = Omit<Lead, "course_name" | "campus_name"> & {
  courses?: { name: string | null } | null;
  campuses?: { name: string | null } | null;
};

type StudentRow = Omit<Student, "course_name" | "batch_name"> & {
  courses?: { name: string | null } | null;
  batches?: { name: string | null } | null;
};

type AttendanceDataRow = Omit<AttendanceRow, "student_name" | "batch_name"> & {
  students?: { name: string | null } | null;
  batches?: { name: string | null } | null;
};

type FeeDataRow = Omit<FeeRow, "student_name"> & {
  students?: { name: string | null } | null;
};

type PayoutRow = Payout & {
  leads?: { name: string | null } | null;
  students?: { name: string | null } | null;
  courses?: { name: string | null } | null;
};

const STAGE_LABELS: Record<string, string> = {
  new_lead: "New Lead",
  application_in_progress: "Application",
  application_fee_paid: "Fee Paid",
  application_submitted: "Submitted",
  counsellor_call: "Follow Up",
  visit_scheduled: "Visit",
  interview: "Interview",
  offer_sent: "Offer",
  token_paid: "Token Paid",
  pre_admitted: "Pre-Admitted",
  admitted: "Admitted",
  rejected: "Rejected",
  waitlisted: "Waitlisted",
};

const statusBadge = (status: string) => {
  if (["paid", "present", "admitted", "active", "approved"].includes(status)) return "bg-emerald-100 text-emerald-700";
  if (["pending", "due", "waitlisted"].includes(status)) return "bg-amber-100 text-amber-700";
  if (["cancelled", "overdue", "absent", "rejected"].includes(status)) return "bg-red-100 text-red-700";
  return "bg-muted text-muted-foreground";
};

const inputCls = "w-full rounded-xl border border-input bg-background px-3 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring/20";
const fmt = (n: number | string | null | undefined) => `₹${Number(n || 0).toLocaleString("en-IN")}`;

export default function AcademicPartnerPortal() {
  const { user } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [partner, setPartner] = useState<Partner | null>(null);
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [attendance, setAttendance] = useState<AttendanceRow[]>([]);
  const [fees, setFees] = useState<FeeRow[]>([]);
  const [payouts, setPayouts] = useState<Payout[]>([]);
  const [showAddLead, setShowAddLead] = useState(false);
  const [saving, setSaving] = useState(false);
  const [leadForm, setLeadForm] = useState({ name: "", phone: "", email: "", course_id: "", notes: "" });

  const courses = useMemo(() => {
    const map = new Map<string, string>();
    assignments.forEach((a) => map.set(a.course_id, a.course_name));
    return Array.from(map.entries()).map(([id, name]) => ({ id, name }));
  }, [assignments]);

  const fetchPortal = async (partnerId: string) => {
    const [statsRes, assignmentsRes, leadsRes, studentsRes, attendanceRes, feesRes, payoutsRes] = await Promise.all([
      supabase.from("academic_partner_dashboard").select("*").eq("partner_id", partnerId).single(),
      supabase.from("academic_partner_assignment_summary").select("*").eq("partner_id", partnerId).eq("is_active", true).order("course_name"),
      supabase.from("leads").select("id, name, phone, email, stage, course_id, created_at, courses:course_id(name), campuses:campus_id(name)").eq("academic_partner_id", partnerId).order("created_at", { ascending: false }).limit(200),
      supabase.from("students").select("id, name, admission_no, phone, status, courses:course_id(name), batches:batch_id(name)").order("created_at", { ascending: false }).limit(200),
      supabase.from("daily_attendance").select("id, date, status, subject, students:student_id(name), batches:batch_id(name)").order("date", { ascending: false }).limit(100),
      supabase.from("fee_ledger").select("id, term, total_amount, paid_amount, balance, status, students:student_id(name)").order("due_date", { ascending: false }).limit(200),
      supabase.from("academic_partner_payouts").select("*, leads:lead_id(name), students:student_id(name), courses:course_id(name)").eq("partner_id", partnerId).order("created_at", { ascending: false }).limit(100),
    ]);

    if (statsRes.data) setStats(statsRes.data as DashboardStats);
    setAssignments(((assignmentsRes.data || []) as unknown as Assignment[]).map((a) => ({
      ...a,
      effective_payout_percentage: Number(a.effective_payout_percentage || 0),
      candidates: Number(a.candidates || 0),
      fee_collected: Number(a.fee_collected || 0),
    })));
    setLeads(((leadsRes.data || []) as unknown as LeadRow[]).map((l) => ({
      ...l,
      course_name: l.courses?.name || "-",
      campus_name: l.campuses?.name || "-",
    })));
    setStudents(((studentsRes.data || []) as unknown as StudentRow[]).map((s) => ({
      ...s,
      course_name: s.courses?.name || "-",
      batch_name: s.batches?.name || "-",
    })));
    setAttendance(((attendanceRes.data || []) as unknown as AttendanceDataRow[]).map((a) => ({
      ...a,
      student_name: a.students?.name || "-",
      batch_name: a.batches?.name || "-",
    })));
    setFees(((feesRes.data || []) as unknown as FeeDataRow[]).map((f) => ({
      ...f,
      student_name: f.students?.name || "-",
    })));
    setPayouts(((payoutsRes.data || []) as unknown as PayoutRow[]).map((p) => ({
      ...p,
      lead_name: p.leads?.name,
      student_name: p.students?.name,
      course_name: p.courses?.name,
    })));
  };

  useEffect(() => {
    (async () => {
      if (!user?.id) return;
      setLoading(true);
      const { data } = await supabase.from("academic_partners").select("id, name, default_payout_percentage").eq("user_id", user.id).single();
      if (!data) {
        setLoading(false);
        return;
      }
      setPartner(data as Partner);
      await fetchPortal((data as Partner).id);
      setLoading(false);
    })();
  }, [user?.id]);

  const handleAddLead = async () => {
    if (!partner || !leadForm.name.trim() || !leadForm.phone.trim() || !leadForm.course_id) return;
    setSaving(true);
    const { data, error } = await supabase.rpc("submit_lead_association_request", {
      _requester_type: "academic_partner",
      _name: leadForm.name.trim(),
      _phone: leadForm.phone.trim(),
      _email: leadForm.email.trim() || null,
      _course_id: leadForm.course_id,
      _campus_id: null,
      _notes: leadForm.notes.trim() || null,
      _consultant_id: null,
      _academic_partner_id: partner.id,
    });

    if (error) {
      toast({ title: "Lead not added", description: error.message, variant: "destructive" });
    } else {
      const result = data as { status?: string } | null;
      toast({
        title: result?.status === "pending" ? "Duplicate sent for approval" : "Lead added",
        description: result?.status === "pending"
          ? "This phone already exists in CRM. It will show as associated only after superadmin approval."
          : undefined,
      });
      setLeadForm({ name: "", phone: "", email: "", course_id: "", notes: "" });
      setShowAddLead(false);
      await fetchPortal(partner.id);
    }
    setSaving(false);
  };

  if (loading) return <div className="flex h-64 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  if (!partner) return <div className="flex h-64 items-center justify-center text-sm text-muted-foreground">No academic partner profile is linked to this account.</div>;

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Academic Partner Dashboard</h1>
          <p className="mt-1 text-sm text-muted-foreground">Welcome, {stats?.partner_name || partner.name}</p>
        </div>
        <Button onClick={() => setShowAddLead(true)} className="gap-2">
          <Plus className="h-4 w-4" /> Add Lead
        </Button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-6 gap-3">
        {[
          { label: "Courses", value: stats?.assigned_courses || 0, icon: BookOpen, bg: "bg-pastel-blue" },
          { label: "Batches", value: stats?.assigned_batches || 0, icon: GraduationCap, bg: "bg-pastel-purple" },
          { label: "Leads", value: stats?.total_leads || 0, icon: Users, bg: "bg-pastel-orange" },
          { label: "Candidates", value: stats?.total_candidates || 0, icon: TrendingUp, bg: "bg-pastel-green" },
          { label: "Fee Collected", value: fmt(stats?.total_fee_collected), icon: IndianRupee, bg: "bg-pastel-mint" },
          { label: "Pending Payout", value: fmt(stats?.pending_payout), icon: IndianRupee, bg: "bg-pastel-yellow" },
        ].map((item) => (
          <Card key={item.label} className="border-border/60 shadow-none">
            <CardContent className="p-4">
              <div className={`mb-2 inline-flex h-9 w-9 items-center justify-center rounded-lg ${item.bg}`}>
                <item.icon className="h-4 w-4 text-foreground/70" />
              </div>
              <p className="text-xl font-bold text-foreground">{item.value}</p>
              <p className="text-[11px] text-muted-foreground">{item.label}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Tabs defaultValue="leads" className="w-full">
        <TabsList className="bg-transparent border-b border-border rounded-none p-0 h-auto gap-0 w-full justify-start overflow-x-auto">
          {["Leads", "Students", "Fees", "Attendance", "Payouts", "Batches", "Requests"].map((tab) => (
            <TabsTrigger key={tab} value={tab.toLowerCase()} className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none px-4 py-2 text-sm">
              {tab}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="leads" className="mt-4">
          <Card className="border-border/60 shadow-none overflow-hidden"><CardContent className="p-0">
            <table className="w-full text-sm">
              <thead><tr className="border-b bg-muted/50">
                <th className="px-4 py-3 text-left text-xs uppercase text-muted-foreground">Lead</th>
                <th className="px-4 py-3 text-left text-xs uppercase text-muted-foreground">Course</th>
                <th className="px-4 py-3 text-center text-xs uppercase text-muted-foreground">Stage</th>
                <th className="px-4 py-3 text-left text-xs uppercase text-muted-foreground">Date</th>
                <th className="px-4 py-3 text-right text-xs uppercase text-muted-foreground">Action</th>
              </tr></thead>
              <tbody>
                {leads.map((lead) => (
                  <tr key={lead.id} className="border-b last:border-0 hover:bg-muted/30">
                    <td className="px-4 py-3"><div className="font-medium">{lead.name}</div><div className="text-xs text-muted-foreground">{lead.phone}</div></td>
                    <td className="px-4 py-3"><div>{lead.course_name}</div><div className="text-xs text-muted-foreground">{lead.campus_name}</div></td>
                    <td className="px-4 py-3 text-center"><Badge className={`border-0 text-[10px] ${statusBadge(lead.stage)}`}>{STAGE_LABELS[lead.stage] || lead.stage}</Badge></td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">{new Date(lead.created_at).toLocaleDateString("en-IN")}</td>
                    <td className="px-4 py-3 text-right"><Button variant="ghost" size="sm" onClick={() => navigate(`/admissions/${lead.id}`)}>Open</Button></td>
                  </tr>
                ))}
                {leads.length === 0 && <tr><td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">No leads added yet</td></tr>}
              </tbody>
            </table>
          </CardContent></Card>
        </TabsContent>

        <TabsContent value="students" className="mt-4">
          <Card className="border-border/60 shadow-none overflow-hidden"><CardContent className="p-0">
            <table className="w-full text-sm">
              <thead><tr className="border-b bg-muted/50">
                <th className="px-4 py-3 text-left text-xs uppercase text-muted-foreground">Student</th>
                <th className="px-4 py-3 text-left text-xs uppercase text-muted-foreground">Course</th>
                <th className="px-4 py-3 text-left text-xs uppercase text-muted-foreground">Batch</th>
                <th className="px-4 py-3 text-center text-xs uppercase text-muted-foreground">Status</th>
              </tr></thead>
              <tbody>
                {students.map((student) => (
                  <tr key={student.id} className="border-b last:border-0">
                    <td className="px-4 py-3"><div className="font-medium">{student.name}</div><div className="text-xs text-muted-foreground">{student.admission_no || student.phone || "-"}</div></td>
                    <td className="px-4 py-3">{student.course_name}</td>
                    <td className="px-4 py-3">{student.batch_name}</td>
                    <td className="px-4 py-3 text-center"><Badge className={`border-0 text-[10px] ${statusBadge(student.status)}`}>{student.status}</Badge></td>
                  </tr>
                ))}
                {students.length === 0 && <tr><td colSpan={4} className="px-4 py-8 text-center text-muted-foreground">No assigned students found</td></tr>}
              </tbody>
            </table>
          </CardContent></Card>
        </TabsContent>

        <TabsContent value="fees" className="mt-4">
          <Card className="border-border/60 shadow-none overflow-hidden"><CardContent className="p-0">
            <table className="w-full text-sm">
              <thead><tr className="border-b bg-muted/50">
                <th className="px-4 py-3 text-left text-xs uppercase text-muted-foreground">Student</th>
                <th className="px-4 py-3 text-left text-xs uppercase text-muted-foreground">Term</th>
                <th className="px-4 py-3 text-right text-xs uppercase text-muted-foreground">Total</th>
                <th className="px-4 py-3 text-right text-xs uppercase text-muted-foreground">Paid</th>
                <th className="px-4 py-3 text-right text-xs uppercase text-muted-foreground">Balance</th>
                <th className="px-4 py-3 text-center text-xs uppercase text-muted-foreground">Status</th>
              </tr></thead>
              <tbody>
                {fees.map((fee) => (
                  <tr key={fee.id} className="border-b last:border-0">
                    <td className="px-4 py-3 font-medium">{fee.student_name}</td>
                    <td className="px-4 py-3">{fee.term}</td>
                    <td className="px-4 py-3 text-right">{fmt(fee.total_amount)}</td>
                    <td className="px-4 py-3 text-right">{fmt(fee.paid_amount)}</td>
                    <td className="px-4 py-3 text-right">{fmt(fee.balance)}</td>
                    <td className="px-4 py-3 text-center"><Badge className={`border-0 text-[10px] ${statusBadge(fee.status)}`}>{fee.status}</Badge></td>
                  </tr>
                ))}
                {fees.length === 0 && <tr><td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">No fee records found</td></tr>}
              </tbody>
            </table>
          </CardContent></Card>
        </TabsContent>

        <TabsContent value="attendance" className="mt-4">
          <Card className="border-border/60 shadow-none overflow-hidden"><CardContent className="p-0">
            <table className="w-full text-sm">
              <thead><tr className="border-b bg-muted/50">
                <th className="px-4 py-3 text-left text-xs uppercase text-muted-foreground">Date</th>
                <th className="px-4 py-3 text-left text-xs uppercase text-muted-foreground">Student</th>
                <th className="px-4 py-3 text-left text-xs uppercase text-muted-foreground">Subject</th>
                <th className="px-4 py-3 text-center text-xs uppercase text-muted-foreground">Status</th>
              </tr></thead>
              <tbody>
                {attendance.map((row) => (
                  <tr key={row.id} className="border-b last:border-0">
                    <td className="px-4 py-3 text-xs text-muted-foreground">{new Date(row.date).toLocaleDateString("en-IN")}</td>
                    <td className="px-4 py-3"><div className="font-medium">{row.student_name}</div><div className="text-xs text-muted-foreground">{row.batch_name}</div></td>
                    <td className="px-4 py-3">{row.subject || "-"}</td>
                    <td className="px-4 py-3 text-center"><Badge className={`border-0 text-[10px] ${statusBadge(row.status)}`}>{row.status}</Badge></td>
                  </tr>
                ))}
                {attendance.length === 0 && <tr><td colSpan={4} className="px-4 py-8 text-center text-muted-foreground">No attendance records found</td></tr>}
              </tbody>
            </table>
          </CardContent></Card>
        </TabsContent>

        <TabsContent value="payouts" className="mt-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
            <Card className="shadow-none"><CardContent className="p-4 text-center"><p className="text-xl font-bold text-primary">{fmt(stats?.total_payout)}</p><p className="text-[11px] text-muted-foreground">Total Payout</p></CardContent></Card>
            <Card className="shadow-none"><CardContent className="p-4 text-center"><p className="text-xl font-bold text-amber-600">{fmt(stats?.pending_payout)}</p><p className="text-[11px] text-muted-foreground">Pending</p></CardContent></Card>
            <Card className="shadow-none"><CardContent className="p-4 text-center"><p className="text-xl font-bold text-emerald-600">{fmt(stats?.paid_payout)}</p><p className="text-[11px] text-muted-foreground">Paid</p></CardContent></Card>
          </div>
          <Card className="border-border/60 shadow-none overflow-hidden"><CardContent className="p-0">
            <table className="w-full text-sm">
              <thead><tr className="border-b bg-muted/50">
                <th className="px-4 py-3 text-left text-xs uppercase text-muted-foreground">Candidate</th>
                <th className="px-4 py-3 text-left text-xs uppercase text-muted-foreground">Course</th>
                <th className="px-4 py-3 text-right text-xs uppercase text-muted-foreground">Fee Paid</th>
                <th className="px-4 py-3 text-center text-xs uppercase text-muted-foreground">Payout %</th>
                <th className="px-4 py-3 text-right text-xs uppercase text-muted-foreground">Payout</th>
                <th className="px-4 py-3 text-center text-xs uppercase text-muted-foreground">Status</th>
              </tr></thead>
              <tbody>
                {payouts.map((payout) => (
                  <tr key={payout.id} className="border-b last:border-0">
                    <td className="px-4 py-3 font-medium">{payout.student_name || payout.lead_name || "-"}</td>
                    <td className="px-4 py-3">{payout.course_name || "-"}</td>
                    <td className="px-4 py-3 text-right">{fmt(payout.fee_paid)}</td>
                    <td className="px-4 py-3 text-center">{Number(payout.payout_percentage || 0)}%</td>
                    <td className="px-4 py-3 text-right font-semibold">{fmt(payout.payout_amount)}</td>
                    <td className="px-4 py-3 text-center"><Badge className={`border-0 text-[10px] ${statusBadge(payout.status)}`}>{payout.status}</Badge></td>
                  </tr>
                ))}
                {payouts.length === 0 && <tr><td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">No payouts recorded yet</td></tr>}
              </tbody>
            </table>
          </CardContent></Card>
        </TabsContent>

        <TabsContent value="batches" className="mt-4">
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {assignments.map((assignment) => (
              <Card key={assignment.id} className="border-border/60 shadow-none">
                <CardContent className="p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h3 className="text-sm font-semibold">{assignment.batch_name || "All Batches"}</h3>
                      <p className="mt-0.5 text-xs text-muted-foreground">{assignment.course_name}</p>
                    </div>
                    <Badge variant="secondary" className="text-[10px]">{assignment.effective_payout_percentage}% payout</Badge>
                  </div>
                  <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                    <div><p className="text-lg font-bold">{assignment.candidates}</p><p className="text-xs text-muted-foreground">Candidates</p></div>
                    <div><p className="text-lg font-bold">{fmt(assignment.fee_collected)}</p><p className="text-xs text-muted-foreground">Fee Collected</p></div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="requests" className="mt-4">
          <LeadAssociationRequestsPanel requesterType="academic_partner" />
        </TabsContent>
      </Tabs>

      <Dialog open={showAddLead} onOpenChange={setShowAddLead}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Add Lead</DialogTitle>
            <DialogDescription>Capture a lead for one of your assigned courses.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="academic-partner-lead-name" className="block text-[11px] font-medium text-muted-foreground mb-1">Name *</label>
                <input id="academic-partner-lead-name" value={leadForm.name} onChange={(e) => setLeadForm((p) => ({ ...p, name: e.target.value }))} className={inputCls} />
              </div>
              <div>
                <label htmlFor="academic-partner-lead-phone" className="block text-[11px] font-medium text-muted-foreground mb-1">Phone *</label>
                <PhoneInput id="academic-partner-lead-phone" aria-label="Phone" value={leadForm.phone} onChange={(phone) => setLeadForm((p) => ({ ...p, phone }))} required />
              </div>
            </div>
            <div>
              <label htmlFor="academic-partner-lead-email" className="block text-[11px] font-medium text-muted-foreground mb-1">Email</label>
              <input id="academic-partner-lead-email" type="email" value={leadForm.email} onChange={(e) => setLeadForm((p) => ({ ...p, email: e.target.value }))} className={inputCls} />
            </div>
            <div>
              <label htmlFor="academic-partner-lead-course" className="block text-[11px] font-medium text-muted-foreground mb-1">Course *</label>
              <select id="academic-partner-lead-course" value={leadForm.course_id} onChange={(e) => setLeadForm((p) => ({ ...p, course_id: e.target.value }))} className={inputCls}>
                <option value="">Select course</option>
                {courses.map((course) => <option key={course.id} value={course.id}>{course.name}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="academic-partner-lead-notes" className="block text-[11px] font-medium text-muted-foreground mb-1">Notes</label>
              <textarea id="academic-partner-lead-notes" rows={2} value={leadForm.notes} onChange={(e) => setLeadForm((p) => ({ ...p, notes: e.target.value }))} className={inputCls} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAddLead(false)}>Cancel</Button>
            <Button onClick={handleAddLead} disabled={saving || !leadForm.name.trim() || !leadForm.phone.trim() || !leadForm.course_id} className="gap-2">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CalendarCheck className="h-4 w-4" />} Add Lead
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
