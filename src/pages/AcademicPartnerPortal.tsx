import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { PhoneInput } from "@/components/ui/phone-input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ApplyMagicLinkButton } from "@/components/leads/ApplyMagicLinkButton";
import {
  BookOpen,
  CalendarCheck,
  GraduationCap,
  IndianRupee,
  Loader2,
  PhoneCall,
  Plus,
  FileText,
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
  application_id: string | null;
  application_status: string | null;
  application_payment_status: string | null;
  application_stage: string | null;
  application_submitted_at: string | null;
  application_created_at: string | null;
  application_fee_amount: number | null;
  application_completed_sections: Record<string, boolean> | null;
  application_form_pdf_url: string | null;
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
  student_id: string;
  date: string;
  status: string;
  subject: string | null;
  student_name: string;
  student_admission_no: string | null;
  batch_name: string;
};

type FeeRow = {
  id: string;
  student_id: string;
  student_name: string;
  student_admission_no: string | null;
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

type ApplicationSummary = {
  application_id: string;
  status: string | null;
  payment_status: string | null;
  fee_amount: number | null;
  completed_sections?: Record<string, boolean> | null;
  submitted_at: string | null;
  created_at: string;
  form_pdf_url?: string | null;
};

type LeadRow = Omit<Lead, "course_name" | "campus_name"> & {
  courses?: { name: string | null } | null;
  campuses?: { name: string | null } | null;
  applications?: ApplicationSummary[];
};

type StudentRow = Omit<Student, "course_name" | "batch_name"> & {
  courses?: { name: string | null } | null;
  batches?: { name: string | null } | null;
};

type AttendanceDataRow = Omit<AttendanceRow, "student_name" | "batch_name"> & {
  students?: { name: string | null; admission_no: string | null; pre_admission_no?: string | null } | null;
  batches?: { name: string | null } | null;
};

type FeeDataRow = Omit<FeeRow, "student_name" | "student_admission_no"> & {
  students?: { name: string | null; admission_no: string | null; pre_admission_no?: string | null } | null;
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

const completedCount = (sections: Record<string, boolean> | null | undefined) =>
  Object.values(sections || {}).filter(Boolean).length;

const totalCount = (sections: Record<string, boolean> | null | undefined) =>
  Math.max(Object.keys(sections || {}).length, 0);

const applicationStageLabel = (app: ApplicationSummary | null | undefined) => {
  if (!app) return "Not Started";
  if (app.status === "approved") return "Approved";
  if (app.status === "rejected") return "Rejected";
  if (app.submitted_at || app.status === "submitted" || app.status === "under_review") return "Submitted";
  if (app.payment_status === "paid") return "Fee Paid";
  const total = totalCount(app.completed_sections);
  const completed = completedCount(app.completed_sections);
  if (total > 0 && completed > 0) return `${completed}/${total} Sections`;
  return "Draft";
};

const isCompletedApplication = (lead: Lead) =>
  Boolean(
    lead.application_submitted_at
    || ["submitted", "under_review", "approved", "rejected"].includes(lead.application_status || "")
  );

const attendancePercent = (present: number, total: number) => {
  if (total <= 0) return "-";
  return `${Math.round((present / total) * 100)}%`;
};

const PORTAL_TABS = [
  { label: "Leads", value: "leads" },
  { label: "Applications", value: "applications" },
  { label: "Students", value: "students" },
  { label: "Fee Collection", value: "fees" },
  { label: "Academic Record", value: "attendance" },
  { label: "Payouts", value: "payouts" },
  { label: "Batches", value: "batches" },
  { label: "Requests", value: "requests" },
  { label: "Settings", value: "settings" },
] as const;

const PORTAL_TAB_VALUES = new Set(PORTAL_TABS.map((tab) => tab.value));

export default function AcademicPartnerPortal() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedTab = searchParams.get("tab") || "leads";
  const activeTab = PORTAL_TAB_VALUES.has(requestedTab as any) ? requestedTab : "leads";
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
  const [detailsLead, setDetailsLead] = useState<Lead | null>(null);
  const [saving, setSaving] = useState(false);
  const [profileLoading, setProfileLoading] = useState(false);
  const [savingAgentPhone, setSavingAgentPhone] = useState(false);
  const [callingLeadId, setCallingLeadId] = useState<string | null>(null);
  const [agentPhone, setAgentPhone] = useState("");
  const [leadForm, setLeadForm] = useState({ name: "", phone: "", email: "", course_id: "", notes: "" });

  const courses = useMemo(() => {
    const map = new Map<string, string>();
    assignments.forEach((a) => map.set(a.course_id, a.course_name));
    return Array.from(map.entries()).map(([id, name]) => ({ id, name }));
  }, [assignments]);

  const feeByStudent = useMemo(() => {
    const map = new Map<string, { total: number; paid: number; balance: number; rows: number }>();
    fees.forEach((fee) => {
      const current = map.get(fee.student_id) || { total: 0, paid: 0, balance: 0, rows: 0 };
      current.total += Number(fee.total_amount || 0);
      current.paid += Number(fee.paid_amount || 0);
      current.balance += Number(fee.balance || 0);
      current.rows += 1;
      map.set(fee.student_id, current);
    });
    return map;
  }, [fees]);

  const attendanceByStudent = useMemo(() => {
    const map = new Map<string, { total: number; present: number; absent: number; late: number }>();
    attendance.forEach((row) => {
      const current = map.get(row.student_id) || { total: 0, present: 0, absent: 0, late: 0 };
      current.total += 1;
      if (row.status === "present") current.present += 1;
      if (row.status === "absent") current.absent += 1;
      if (row.status === "late") current.late += 1;
      map.set(row.student_id, current);
    });
    return map;
  }, [attendance]);

  const applicationLeads = useMemo(
    () => leads.filter((lead) => Boolean(lead.application_id || lead.application_status || lead.application_created_at)),
    [leads],
  );

  const fetchPortal = async (partnerId: string) => {
    const [statsRes, assignmentsRes, leadsRes, studentsRes, attendanceRes, feesRes, payoutsRes] = await Promise.all([
      supabase.from("academic_partner_dashboard").select("*").eq("partner_id", partnerId).single(),
      supabase.from("academic_partner_assignment_summary").select("*").eq("partner_id", partnerId).eq("is_active", true).order("course_name"),
      supabase.from("leads").select("id, name, phone, email, stage, application_id, course_id, created_at, courses:course_id(name), campuses:campus_id(name), applications:applications(application_id, status, payment_status, fee_amount, completed_sections, submitted_at, created_at, form_pdf_url)").eq("academic_partner_id", partnerId).order("created_at", { ascending: false }).limit(200),
      supabase.from("students").select("id, name, admission_no, phone, status, courses:course_id(name), batches:batch_id(name)").order("created_at", { ascending: false }).limit(200),
      supabase.from("daily_attendance").select("id, student_id, date, status, subject, students:student_id(name, admission_no, pre_admission_no), batches:batch_id(name)").order("date", { ascending: false }).limit(200),
      supabase.from("fee_ledger").select("id, student_id, term, total_amount, paid_amount, balance, status, students:student_id(name, admission_no, pre_admission_no)").order("due_date", { ascending: false }).limit(300),
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
      application_id: l.applications?.[0]?.application_id || l.application_id || null,
      application_status: l.applications?.[0]?.status || null,
      application_payment_status: l.applications?.[0]?.payment_status || null,
      application_stage: applicationStageLabel(l.applications?.[0]),
      application_submitted_at: l.applications?.[0]?.submitted_at || null,
      application_created_at: l.applications?.[0]?.created_at || null,
      application_fee_amount: l.applications?.[0]?.fee_amount || null,
      application_completed_sections: l.applications?.[0]?.completed_sections || null,
      application_form_pdf_url: l.applications?.[0]?.form_pdf_url || null,
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
      student_admission_no: a.students?.admission_no || a.students?.pre_admission_no || null,
      batch_name: a.batches?.name || "-",
    })));
    setFees(((feesRes.data || []) as unknown as FeeDataRow[]).map((f) => ({
      ...f,
      student_name: f.students?.name || "-",
      student_admission_no: f.students?.admission_no || f.students?.pre_admission_no || null,
    })));
    setPayouts(((payoutsRes.data || []) as unknown as PayoutRow[]).map((p) => ({
      ...p,
      lead_name: p.leads?.name,
      student_name: p.students?.name,
      course_name: p.courses?.name,
    })));
  };

  const fetchCallingAgentPhone = async () => {
    if (!user?.id) return;
    setProfileLoading(true);
    const { data, error } = await supabase
      .from("profiles")
      .select("phone")
      .eq("user_id", user.id)
      .maybeSingle();

    if (error) {
      toast({ title: "Calling number not loaded", description: error.message, variant: "destructive" });
    } else {
      setAgentPhone(data?.phone || "");
    }
    setProfileLoading(false);
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
      await fetchCallingAgentPhone();
      await fetchPortal((data as Partner).id);
      setLoading(false);
    })();
  }, [user?.id]);

  const saveCallingAgentPhone = async () => {
    if (!user?.id) return;
    const normalized = agentPhone.trim();
    const digits = normalized.replace(/\D/g, "");

    if (digits.length < 10) {
      toast({
        title: "Enter a valid number",
        description: "Cloud calls need a reachable calling agent number before connecting to the lead.",
        variant: "destructive",
      });
      return;
    }

    setSavingAgentPhone(true);
    const { error } = await supabase
      .from("profiles")
      .update({ phone: normalized })
      .eq("user_id", user.id);

    if (error) {
      toast({ title: "Calling number not saved", description: error.message, variant: "destructive" });
    } else {
      setAgentPhone(normalized);
      toast({
        title: "Calling agent number saved",
        description: "Cloud calls will ring this number first, then connect to the lead.",
      });
    }
    setSavingAgentPhone(false);
  };

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

  const placeCloudCall = async (lead: Lead) => {
    if (!lead.phone) {
      toast({ title: "Call unavailable", description: "This lead has no phone number.", variant: "destructive" });
      return;
    }
    setCallingLeadId(lead.id);
    try {
      const { data, error } = await supabase.functions.invoke("manual-call", {
        body: { lead_id: lead.id },
      });
      if (error || data?.error) {
        toast({
          title: "Call failed",
          description: data?.error || error?.message || "Unable to start cloud call.",
          variant: "destructive",
        });
        return;
      }
      toast({
        title: "Calling you",
        description: data?.message || `Pick up your phone to connect to ${lead.name}.`,
      });
    } catch (error: any) {
      toast({ title: "Call failed", description: error?.message || "Unable to start cloud call.", variant: "destructive" });
    } finally {
      setCallingLeadId(null);
    }
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

      <Tabs
        value={activeTab}
        onValueChange={(value) => setSearchParams(value === "leads" ? {} : { tab: value })}
        className="w-full"
      >
        <TabsList className="bg-transparent border-b border-border rounded-none p-0 h-auto gap-0 w-full justify-start overflow-x-auto">
          {PORTAL_TABS.map((tab) => (
            <TabsTrigger key={tab.value} value={tab.value} className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none px-4 py-2 text-sm">
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="leads" className="mt-4">
          <Card className="border-border/60 shadow-none overflow-hidden"><CardContent className="p-0">
            <div className="overflow-x-auto">
            <table className="w-full min-w-[980px] text-sm">
              <thead><tr className="border-b bg-muted/50">
                <th className="px-4 py-3 text-left text-xs uppercase text-muted-foreground">Lead</th>
                <th className="px-4 py-3 text-left text-xs uppercase text-muted-foreground">Course</th>
                <th className="px-4 py-3 text-center text-xs uppercase text-muted-foreground">Lead Stage</th>
                <th className="px-4 py-3 text-left text-xs uppercase text-muted-foreground">Date</th>
                <th className="px-4 py-3 text-right text-xs uppercase text-muted-foreground">Actions</th>
              </tr></thead>
              <tbody>
                {leads.map((lead) => (
                  <tr key={lead.id} className="border-b last:border-0 hover:bg-muted/30">
                    <td className="px-4 py-3"><div className="font-medium">{lead.name}</div><div className="text-xs text-muted-foreground">{lead.phone}</div></td>
                    <td className="px-4 py-3"><div>{lead.course_name}</div><div className="text-xs text-muted-foreground">{lead.campus_name}</div></td>
                    <td className="px-4 py-3 text-center"><Badge className={`border-0 text-[10px] ${statusBadge(lead.stage)}`}>{STAGE_LABELS[lead.stage] || lead.stage}</Badge></td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">{new Date(lead.created_at).toLocaleDateString("en-IN")}</td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex flex-wrap justify-end gap-2">
                      <ApplyMagicLinkButton
                        leadId={lead.id}
                        leadName={lead.name}
                        leadPhone={lead.phone}
                        mode="academic_partner_on_behalf"
                        label={lead.application_id ? "Continue Application" : "Complete Application"}
                        directOpen
                      />
                      <Button size="sm" variant="outline" className="gap-2" onClick={() => placeCloudCall(lead)} disabled={callingLeadId === lead.id}>
                        {callingLeadId === lead.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <PhoneCall className="h-3.5 w-3.5" />}
                        Call
                      </Button>
                      </div>
                    </td>
                  </tr>
                ))}
                {leads.length === 0 && <tr><td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">No leads added yet</td></tr>}
              </tbody>
            </table>
            </div>
          </CardContent></Card>
        </TabsContent>

        <TabsContent value="applications" className="mt-4">
          <Card className="border-border/60 shadow-none overflow-hidden"><CardContent className="p-0">
            <div className="overflow-x-auto">
            <table className="w-full min-w-[980px] text-sm">
              <thead><tr className="border-b bg-muted/50">
                <th className="px-4 py-3 text-left text-xs uppercase text-muted-foreground">Candidate</th>
                <th className="px-4 py-3 text-left text-xs uppercase text-muted-foreground">Course</th>
                <th className="px-4 py-3 text-left text-xs uppercase text-muted-foreground">Application</th>
                <th className="px-4 py-3 text-center text-xs uppercase text-muted-foreground">Application Stage</th>
                <th className="px-4 py-3 text-center text-xs uppercase text-muted-foreground">Payment</th>
                <th className="px-4 py-3 text-left text-xs uppercase text-muted-foreground">Submitted</th>
              </tr></thead>
              <tbody>
                {applicationLeads.map((lead) => {
                  const completed = isCompletedApplication(lead);
                  return (
                  <tr key={lead.id} className="border-b last:border-0 hover:bg-muted/30">
                    <td className="px-4 py-3"><div className="font-medium">{lead.name}</div><div className="text-xs text-muted-foreground">{lead.phone}</div></td>
                    <td className="px-4 py-3"><div>{lead.course_name}</div><div className="text-xs text-muted-foreground">{lead.campus_name}</div></td>
                    <td className="px-4 py-3 min-w-[300px]">
                      <div className="font-medium">{lead.application_id || "-"}</div>
                      <div className="text-xs text-muted-foreground">
                        Status: {lead.application_status || "not started"}
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <Button size="sm" variant="outline" onClick={() => setDetailsLead(lead)}>
                          View Application
                        </Button>
                        <Button size="sm" variant="outline" className="gap-2" onClick={() => placeCloudCall(lead)} disabled={callingLeadId === lead.id}>
                          {callingLeadId === lead.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <PhoneCall className="h-3.5 w-3.5" />}
                          Call
                        </Button>
                        <ApplyMagicLinkButton leadId={lead.id} leadName={lead.name} leadPhone={lead.phone} directOpen />
                        <ApplyMagicLinkButton leadId={lead.id} leadName={lead.name} leadPhone={lead.phone} />
                        <ApplyMagicLinkButton
                          leadId={lead.id}
                          leadName={lead.name}
                          leadPhone={lead.phone}
                          mode="academic_partner_on_behalf"
                          label={completed ? "Open Application" : lead.application_id ? "Continue Application" : "Complete Application"}
                          directOpen
                        />
                        {completed && lead.application_form_pdf_url && (
                          <a
                            href={lead.application_form_pdf_url}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-input bg-background px-3 text-sm font-medium shadow-sm transition-colors hover:bg-accent hover:text-accent-foreground"
                          >
                            <FileText className="h-3.5 w-3.5" />
                            View/Download PDF
                          </a>
                        )}
                        {completed && (
                          <ApplyMagicLinkButton
                            leadId={lead.id}
                            leadName={lead.name}
                            leadPhone={lead.phone}
                            mode="academic_partner_on_behalf"
                            label="Start New Application"
                            startNew
                            directOpen
                          />
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <Badge className={`border-0 text-[10px] ${statusBadge(lead.application_status || lead.application_stage || "")}`}>
                        {lead.application_stage || "Not Started"}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <Badge className={`border-0 text-[10px] ${statusBadge(lead.application_payment_status || "pending")}`}>
                        {lead.application_payment_status || "pending"}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">
                      {lead.application_submitted_at ? new Date(lead.application_submitted_at).toLocaleDateString("en-IN") : "-"}
                    </td>
                  </tr>
                  );
                })}
                {applicationLeads.length === 0 && <tr><td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">No applications found for assigned leads</td></tr>}
              </tbody>
            </table>
            </div>
          </CardContent></Card>
        </TabsContent>

        <TabsContent value="students" className="mt-4">
          <Card className="border-border/60 shadow-none overflow-hidden"><CardContent className="p-0">
            <table className="w-full text-sm">
              <thead><tr className="border-b bg-muted/50">
                <th className="px-4 py-3 text-left text-xs uppercase text-muted-foreground">Student</th>
                <th className="px-4 py-3 text-left text-xs uppercase text-muted-foreground">Course</th>
                <th className="px-4 py-3 text-left text-xs uppercase text-muted-foreground">Batch</th>
                <th className="px-4 py-3 text-right text-xs uppercase text-muted-foreground">Fee Paid</th>
                <th className="px-4 py-3 text-center text-xs uppercase text-muted-foreground">Attendance</th>
                <th className="px-4 py-3 text-center text-xs uppercase text-muted-foreground">Status</th>
              </tr></thead>
              <tbody>
                {students.map((student) => {
                  const fee = feeByStudent.get(student.id);
                  const att = attendanceByStudent.get(student.id);
                  return (
                    <tr key={student.id} className="border-b last:border-0">
                      <td className="px-4 py-3"><div className="font-medium">{student.name}</div><div className="text-xs text-muted-foreground">{student.admission_no || student.phone || "-"}</div></td>
                      <td className="px-4 py-3">{student.course_name}</td>
                      <td className="px-4 py-3">{student.batch_name}</td>
                      <td className="px-4 py-3 text-right"><div className="font-medium">{fmt(fee?.paid)}</div><div className="text-xs text-muted-foreground">Balance {fmt(fee?.balance)}</div></td>
                      <td className="px-4 py-3 text-center"><div className="font-medium">{attendancePercent(att?.present || 0, att?.total || 0)}</div><div className="text-xs text-muted-foreground">{att?.present || 0}/{att?.total || 0} present</div></td>
                      <td className="px-4 py-3 text-center"><Badge className={`border-0 text-[10px] ${statusBadge(student.status)}`}>{student.status}</Badge></td>
                    </tr>
                  );
                })}
                {students.length === 0 && <tr><td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">No assigned students found</td></tr>}
              </tbody>
            </table>
          </CardContent></Card>
        </TabsContent>

        <TabsContent value="fees" className="mt-4">
          <Card className="border-border/60 shadow-none overflow-hidden mb-4"><CardContent className="p-0">
            <table className="w-full text-sm">
              <thead><tr className="border-b bg-muted/50">
                <th className="px-4 py-3 text-left text-xs uppercase text-muted-foreground">Student</th>
                <th className="px-4 py-3 text-right text-xs uppercase text-muted-foreground">Total Fee</th>
                <th className="px-4 py-3 text-right text-xs uppercase text-muted-foreground">Collected</th>
                <th className="px-4 py-3 text-right text-xs uppercase text-muted-foreground">Balance</th>
                <th className="px-4 py-3 text-center text-xs uppercase text-muted-foreground">Ledger Rows</th>
              </tr></thead>
              <tbody>
                {Array.from(feeByStudent.entries()).map(([studentId, summary]) => {
                  const fee = fees.find((row) => row.student_id === studentId);
                  return (
                    <tr key={studentId} className="border-b last:border-0">
                      <td className="px-4 py-3"><div className="font-medium">{fee?.student_name || "-"}</div><div className="text-xs text-muted-foreground">{fee?.student_admission_no || "-"}</div></td>
                      <td className="px-4 py-3 text-right">{fmt(summary.total)}</td>
                      <td className="px-4 py-3 text-right font-semibold text-emerald-700">{fmt(summary.paid)}</td>
                      <td className="px-4 py-3 text-right">{fmt(summary.balance)}</td>
                      <td className="px-4 py-3 text-center">{summary.rows}</td>
                    </tr>
                  );
                })}
                {feeByStudent.size === 0 && <tr><td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">No fee collection found for assigned candidates</td></tr>}
              </tbody>
            </table>
          </CardContent></Card>

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
                    <td className="px-4 py-3"><div className="font-medium">{fee.student_name}</div><div className="text-xs text-muted-foreground">{fee.student_admission_no || "-"}</div></td>
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
          <Card className="border-border/60 shadow-none overflow-hidden mb-4"><CardContent className="p-0">
            <table className="w-full text-sm">
              <thead><tr className="border-b bg-muted/50">
                <th className="px-4 py-3 text-left text-xs uppercase text-muted-foreground">Student</th>
                <th className="px-4 py-3 text-left text-xs uppercase text-muted-foreground">Batch</th>
                <th className="px-4 py-3 text-center text-xs uppercase text-muted-foreground">Present</th>
                <th className="px-4 py-3 text-center text-xs uppercase text-muted-foreground">Absent</th>
                <th className="px-4 py-3 text-center text-xs uppercase text-muted-foreground">Late</th>
                <th className="px-4 py-3 text-center text-xs uppercase text-muted-foreground">Attendance %</th>
              </tr></thead>
              <tbody>
                {students.map((student) => {
                  const att = attendanceByStudent.get(student.id) || { total: 0, present: 0, absent: 0, late: 0 };
                  return (
                    <tr key={student.id} className="border-b last:border-0">
                      <td className="px-4 py-3"><div className="font-medium">{student.name}</div><div className="text-xs text-muted-foreground">{student.admission_no || student.phone || "-"}</div></td>
                      <td className="px-4 py-3">{student.batch_name}</td>
                      <td className="px-4 py-3 text-center text-emerald-700 font-medium">{att.present}</td>
                      <td className="px-4 py-3 text-center text-red-700 font-medium">{att.absent}</td>
                      <td className="px-4 py-3 text-center text-amber-700 font-medium">{att.late}</td>
                      <td className="px-4 py-3 text-center">{attendancePercent(att.present, att.total)}</td>
                    </tr>
                  );
                })}
                {students.length === 0 && <tr><td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">No assigned students found</td></tr>}
              </tbody>
            </table>
          </CardContent></Card>

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
                    <td className="px-4 py-3"><div className="font-medium">{row.student_name}</div><div className="text-xs text-muted-foreground">{row.student_admission_no || row.batch_name}</div></td>
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

        <TabsContent value="settings" className="mt-4">
          <Card className="border-border/60 shadow-none">
            <CardContent className="p-5">
              <div className="max-w-xl space-y-4">
                <div>
                  <h3 className="text-sm font-semibold text-foreground">Cloud Call Settings</h3>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Cloud calls ring this calling agent number first, then bridge the lead or application candidate.
                  </p>
                </div>
                <div className="space-y-2">
                  <label htmlFor="academic-partner-agent-phone" className="text-xs font-medium uppercase text-muted-foreground">
                    Calling agent number
                  </label>
                  <PhoneInput
                    id="academic-partner-agent-phone"
                    value={agentPhone}
                    onChange={setAgentPhone}
                    placeholder="Enter calling agent number"
                    disabled={profileLoading || savingAgentPhone}
                    aria-label="Calling agent number"
                  />
                  <p className="text-xs text-muted-foreground">
                    Use the phone number where Plivo should connect the academic partner before calling the candidate.
                  </p>
                </div>
                <Button onClick={saveCallingAgentPhone} disabled={profileLoading || savingAgentPhone} className="gap-2">
                  {savingAgentPhone ? <Loader2 className="h-4 w-4 animate-spin" /> : <PhoneCall className="h-4 w-4" />}
                  Save Calling Number
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <Dialog open={!!detailsLead} onOpenChange={(open) => !open && setDetailsLead(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Application Details</DialogTitle>
            <DialogDescription>
              {detailsLead?.name || "Candidate"} {detailsLead?.application_id ? `- ${detailsLead.application_id}` : ""}
            </DialogDescription>
          </DialogHeader>
          {detailsLead && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
              <div className="rounded-lg border border-border p-3">
                <p className="text-[11px] uppercase text-muted-foreground">Application ID</p>
                <p className="mt-1 font-medium">{detailsLead.application_id || "Not started"}</p>
              </div>
              <div className="rounded-lg border border-border p-3">
                <p className="text-[11px] uppercase text-muted-foreground">Application Stage</p>
                <p className="mt-1 font-medium">{detailsLead.application_stage || "Not Started"}</p>
              </div>
              <div className="rounded-lg border border-border p-3">
                <p className="text-[11px] uppercase text-muted-foreground">Application Status</p>
                <p className="mt-1 font-medium">{detailsLead.application_status || "not started"}</p>
              </div>
              <div className="rounded-lg border border-border p-3">
                <p className="text-[11px] uppercase text-muted-foreground">Payment Status</p>
                <p className="mt-1 font-medium">{detailsLead.application_payment_status || "pending"}</p>
              </div>
              <div className="rounded-lg border border-border p-3">
                <p className="text-[11px] uppercase text-muted-foreground">Application Fee</p>
                <p className="mt-1 font-medium">{fmt(detailsLead.application_fee_amount)}</p>
              </div>
              <div className="rounded-lg border border-border p-3">
                <p className="text-[11px] uppercase text-muted-foreground">Form Progress</p>
                <p className="mt-1 font-medium">
                  {completedCount(detailsLead.application_completed_sections)}/{totalCount(detailsLead.application_completed_sections)} sections
                </p>
              </div>
              <div className="rounded-lg border border-border p-3">
                <p className="text-[11px] uppercase text-muted-foreground">Course</p>
                <p className="mt-1 font-medium">{detailsLead.course_name}</p>
                <p className="text-xs text-muted-foreground">{detailsLead.campus_name}</p>
              </div>
              <div className="rounded-lg border border-border p-3">
                <p className="text-[11px] uppercase text-muted-foreground">Candidate Contact</p>
                <p className="mt-1 font-medium">{detailsLead.phone}</p>
                <p className="text-xs text-muted-foreground">{detailsLead.email || "-"}</p>
              </div>
              <div className="rounded-lg border border-border p-3">
                <p className="text-[11px] uppercase text-muted-foreground">Started</p>
                <p className="mt-1 font-medium">
                  {detailsLead.application_created_at ? new Date(detailsLead.application_created_at).toLocaleString("en-IN") : "-"}
                </p>
              </div>
              <div className="rounded-lg border border-border p-3">
                <p className="text-[11px] uppercase text-muted-foreground">Submitted</p>
                <p className="mt-1 font-medium">
                  {detailsLead.application_submitted_at ? new Date(detailsLead.application_submitted_at).toLocaleString("en-IN") : "-"}
                </p>
              </div>
            </div>
          )}
          {detailsLead && (
            <DialogFooter className="gap-2 sm:gap-2">
              <Button variant="outline" className="gap-2" onClick={() => placeCloudCall(detailsLead)} disabled={callingLeadId === detailsLead.id}>
                {callingLeadId === detailsLead.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <PhoneCall className="h-4 w-4" />}
                Cloud Call
              </Button>
              <ApplyMagicLinkButton leadId={detailsLead.id} leadName={detailsLead.name} leadPhone={detailsLead.phone} directOpen />
              <ApplyMagicLinkButton leadId={detailsLead.id} leadName={detailsLead.name} leadPhone={detailsLead.phone} />
            </DialogFooter>
          )}
        </DialogContent>
      </Dialog>

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
