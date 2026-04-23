import { useState, useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { useCourseCampusLink } from "@/hooks/useCourseCampusLink";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { PhoneInput } from "@/components/ui/phone-input";
import { ReceiptDialog, ReceiptData } from "@/components/receipts/ReceiptDialog";
import {
  Loader2, Plus, Users, TrendingUp, IndianRupee, ArrowUpRight,
  Download, Clock, CheckCircle, CreditCard, Eye, X,
} from "lucide-react";
import { CourseInfoPanel } from "@/components/leads/CourseInfoPanel";
import { useNavigate } from "react-router-dom";
import { ConsultantTour } from "@/components/consultant/ConsultantTour";
import { VoiceMessageRecorder } from "@/components/consultant/VoiceMessageRecorder";
import { BookOpen } from "lucide-react";

interface DashboardStats {
  consultant_id: string;
  consultant_name: string;
  total_leads: number;
  conversions: number;
  pipeline: number;
  total_fee_collected: number;
  total_commission: number;
  commission_paid: number;
  commission_pending: number;
}

interface Lead {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  stage: string;
  course_name: string;
  campus_name: string;
  course_id: string | null;
  created_at: string;
}

interface Payment {
  id: string;
  lead_id: string;
  type: string;
  amount: number;
  payment_mode: string;
  transaction_ref: string | null;
  receipt_no: string | null;
  status: string;
  payment_date: string;
  lead_name?: string;
}

interface Payout {
  id: string;
  lead_id: string;
  payout_amount: number;
  student_fee_paid: number;
  fee_paid_pct: number;
  status: string;
  created_at: string;
  lead_name?: string;
  course_name?: string;
}

const STAGE_LABELS: Record<string, string> = {
  new_lead: "New Lead", application_in_progress: "App In Progress",
  application_fee_paid: "Fee Paid", application_submitted: "Submitted",
  ai_called: "AI Called", counsellor_call: "In Follow Up",
  visit_scheduled: "Visit Scheduled", interview: "Interview", offer_sent: "Offer Sent",
  token_paid: "Token Paid", pre_admitted: "Pre-Admitted", admitted: "Admitted",
  waitlisted: "Waitlisted", rejected: "Rejected",
};

const STAGE_COLORS: Record<string, string> = {
  new_lead: "bg-gray-100 text-gray-700", admitted: "bg-emerald-100 text-emerald-700",
  rejected: "bg-red-100 text-red-700", waitlisted: "bg-amber-100 text-amber-700",
};

const TYPE_LABELS: Record<string, string> = {
  application_fee: "Application Fee", token_fee: "Token Fee",
  registration_fee: "Registration Fee", other: "Other",
};

const MODE_LABELS: Record<string, string> = {
  cash: "Cash", upi: "UPI", bank_transfer: "Bank Transfer",
  cheque: "Cheque / DD", online: "Online", gateway: "Gateway",
};

const PAYOUT_STATUS: Record<string, { label: string; cls: string }> = {
  pending: { label: "Pending", cls: "bg-amber-100 text-amber-700" },
  approved: { label: "Approved", cls: "bg-blue-100 text-blue-700" },
  paid: { label: "Paid", cls: "bg-emerald-100 text-emerald-700" },
  cancelled: { label: "Cancelled", cls: "bg-red-100 text-red-700" },
};

const ConsultantPortal = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const { coursesByDepartment, getCampusesForCourse } = useCourseCampusLink();
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [payouts, setPayouts] = useState<Payout[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [showPayment, setShowPayment] = useState(false);
  const [paymentLeadId, setPaymentLeadId] = useState<string | null>(null);
  const [consultantId, setConsultantId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [receiptData, setReceiptData] = useState<ReceiptData | null>(null);
  const [viewCourseId, setViewCourseId] = useState<string | null>(null);

  const [form, setForm] = useState({
    name: "", phone: "", email: "", course_id: "", campus_id: "", notes: "",
  });

  const [payForm, setPayForm] = useState({
    type: "application_fee", amount: "", mode: "upi", transaction_ref: "", notes: "",
  });

  const fetchAll = async (cId: string) => {
    const [statsRes, leadsRes, paymentsRes, payoutsRes] = await Promise.all([
      supabase.from("consultant_dashboard" as any).select("*").eq("consultant_id", cId).single(),
      supabase.from("leads")
        .select("id, name, phone, email, stage, course_id, created_at, courses:course_id(name), campuses:campus_id(name)")
        .eq("consultant_id", cId)
        .order("created_at", { ascending: false })
        .limit(200),
      supabase.from("lead_payments" as any)
        .select("*, leads:lead_id(name)")
        .in("lead_id", (await supabase.from("leads").select("id").eq("consultant_id", cId)).data?.map((l: any) => l.id) || [])
        .order("payment_date", { ascending: false })
        .limit(100),
      supabase.from("consultant_payouts" as any)
        .select("*, leads:lead_id(name), courses:course_id(name)")
        .eq("consultant_id", cId)
        .order("created_at", { ascending: false })
        .limit(100),
    ]);

    if (statsRes.data) setStats(statsRes.data as any);
    if (leadsRes.data) setLeads((leadsRes.data as any[]).map(l => ({ ...l, course_name: l.courses?.name || "—", campus_name: l.campuses?.name || "—" })));
    if (paymentsRes.data) setPayments((paymentsRes.data as any[]).map(p => ({ ...p, lead_name: (p.leads as any)?.name })));
    if (payoutsRes.data) setPayouts((payoutsRes.data as any[]).map(p => ({ ...p, lead_name: (p.leads as any)?.name, course_name: (p.courses as any)?.name })));
  };

  useEffect(() => {
    (async () => {
      if (!user?.id) return;
      const { data: consultant } = await supabase.from("consultants").select("id").eq("user_id", user.id).single();
      if (!consultant) { setLoading(false); return; }
      setConsultantId(consultant.id);
      await fetchAll(consultant.id);
      setLoading(false);
    })();
  }, [user?.id]);

  const handleCourseChange = (courseId: string) => {
    const campuses = getCampusesForCourse(courseId || null);
    setForm(p => ({ ...p, course_id: courseId, campus_id: campuses.length === 1 ? campuses[0].id : "" }));
  };

  const handleAddLead = async () => {
    if (!form.name.trim() || !form.phone.trim() || !consultantId) return;
    setSaving(true);
    const { data, error } = await supabase.from("leads").insert({
      name: form.name.trim(), phone: form.phone.trim(), email: form.email.trim() || null,
      source: "consultant" as any, consultant_id: consultantId,
      course_id: form.course_id || null, campus_id: form.campus_id || null,
      notes: form.notes.trim() || null,
    }).select("id").single();
    if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); }
    else {
      if (data) await supabase.from("lead_activities").insert({ lead_id: data.id, type: "lead_created", description: "Lead added via consultant portal", user_id: user?.id || null });
      toast({ title: "Lead added" });
      setForm({ name: "", phone: "", email: "", course_id: "", campus_id: "", notes: "" });
      setShowAdd(false);
      await fetchAll(consultantId);
    }
    setSaving(false);
  };

  const openPayment = (leadId: string) => {
    setPaymentLeadId(leadId);
    setPayForm({ type: "application_fee", amount: "", mode: "upi", transaction_ref: "", notes: "" });
    setShowPayment(true);
  };

  const handleRecordPayment = async () => {
    if (!paymentLeadId || !payForm.amount || !consultantId) return;
    setSaving(true);

    let profileId: string | null = null;
    if (user?.id) {
      const { data: p } = await supabase.from("profiles").select("id").eq("user_id", user.id).single();
      profileId = p?.id || null;
    }

    const { error } = await supabase.from("lead_payments" as any).insert({
      lead_id: paymentLeadId,
      type: payForm.type,
      amount: parseFloat(payForm.amount),
      payment_mode: payForm.mode,
      transaction_ref: payForm.transaction_ref || null,
      notes: payForm.notes ? `Paid by consultant. ${payForm.notes}` : "Paid by consultant",
      recorded_by: profileId,
      status: "confirmed",
    } as any);

    if (error) {
      toast({ title: "Payment failed", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Payment recorded", description: `₹${parseFloat(payForm.amount).toLocaleString("en-IN")} recorded` });
      setShowPayment(false);
      await fetchAll(consultantId);
    }
    setSaving(false);
  };

  const downloadReceipt = (p: Payment) => {
    const lead = leads.find(l => l.id === p.lead_id);
    setReceiptData({
      type: "student_fee",
      receipt_no: p.receipt_no || p.id.slice(0, 8).toUpperCase(),
      student_name: lead?.name || p.lead_name || "Unknown",
      amount: p.amount,
      payment_ref: p.transaction_ref,
      payment_date: p.payment_date,
      payment_mode: MODE_LABELS[p.payment_mode] || p.payment_mode,
      fee_description: TYPE_LABELS[p.type] || p.type,
      institution_name: "NIMT Educational Institutions",
      campus_name: lead?.campus_name,
    });
  };

  const filteredCampuses = getCampusesForCourse(form.course_id || null);
  const inputCls = "w-full rounded-xl border border-input bg-background px-3 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring/20";
  const fmt = (n: number) => `₹${Number(n).toLocaleString("en-IN")}`;

  if (loading) return <div className="flex h-64 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  if (!consultantId) return <div className="flex h-64 items-center justify-center"><p className="text-sm text-muted-foreground">No consultant profile linked to your account.</p></div>;

  return (
    <div className="space-y-6 animate-fade-in">
      {/* First-time tour overlay */}
      <ConsultantTour onDownloadGuide={() => navigate("/consultant-guide")} />

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Consultant Dashboard</h1>
          <p className="text-sm text-muted-foreground mt-1">Welcome, {stats?.consultant_name || "Consultant"}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" className="gap-1.5" onClick={() => navigate("/consultant-guide")}>
            <BookOpen className="h-3.5 w-3.5" /> View Guide
          </Button>
          <Button onClick={() => setShowAdd(true)} className="gap-2" data-tour="add-lead">
            <Plus className="h-4 w-4" /> Add Lead
          </Button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {[
          { label: "Total Leads", value: stats?.total_leads || 0, icon: Users, bg: "bg-pastel-blue" },
          { label: "Pipeline", value: stats?.pipeline || 0, icon: ArrowUpRight, bg: "bg-pastel-orange" },
          { label: "Conversions", value: stats?.conversions || 0, icon: TrendingUp, bg: "bg-pastel-green" },
          { label: "Fee Collected", value: fmt(Number(stats?.total_fee_collected || 0)), icon: CreditCard, bg: "bg-pastel-mint" },
          { label: "Commission Earned", value: fmt(Number(stats?.total_commission || 0)), icon: IndianRupee, bg: "bg-pastel-purple" },
          { label: "Pending Payout", value: fmt(Number(stats?.commission_pending || 0)), icon: Clock, bg: "bg-pastel-yellow" },
        ].map(s => (
          <Card key={s.label} className="border-border/60 shadow-none">
            <CardContent className="p-4">
              <div className={`inline-flex h-9 w-9 items-center justify-center rounded-lg ${s.bg} mb-2`}>
                <s.icon className="h-4 w-4 text-foreground/70" />
              </div>
              <p className="text-xl font-bold text-foreground">{s.value}</p>
              <p className="text-[11px] text-muted-foreground">{s.label}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Voice message to admission team */}
      <div data-tour="voice-message">
        {consultantId && <VoiceMessageRecorder consultantId={consultantId} />}
      </div>

      <Tabs defaultValue="leads" className="w-full">
        <TabsList className="bg-transparent border-b border-border rounded-none p-0 h-auto gap-0 w-full justify-start">
          {["Leads", "Payments", "Commissions"].map(t => (
            <TabsTrigger key={t} value={t.toLowerCase()} data-tour={`${t.toLowerCase()}-tab`}
              className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none text-sm px-4 py-2 text-muted-foreground data-[state=active]:text-foreground data-[state=active]:font-semibold">
              {t}
            </TabsTrigger>
          ))}
        </TabsList>

        {/* LEADS TAB */}
        <TabsContent value="leads" className="mt-4">
          <Card className="border-border/60 shadow-none overflow-hidden">
            <CardContent className="p-0">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/50">
                    <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase">Lead</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase">Course</th>
                    <th className="px-4 py-3 text-center text-xs font-semibold text-muted-foreground uppercase">Stage</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase">Date</th>
                    <th className="px-4 py-3 text-center text-xs font-semibold text-muted-foreground uppercase">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {leads.map(l => (
                    <tr key={l.id} className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors">
                      <td className="px-4 py-3">
                        <div className="font-medium text-foreground">{l.name}</div>
                        <div className="text-xs text-muted-foreground">{l.phone}</div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="text-foreground">{l.course_name}</div>
                        <div className="text-xs text-muted-foreground">{l.campus_name}</div>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <Badge className={`text-[10px] font-medium border-0 ${STAGE_COLORS[l.stage] || "bg-muted text-muted-foreground"}`}>
                          {STAGE_LABELS[l.stage] || l.stage}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground text-xs">{new Date(l.created_at).toLocaleDateString("en-IN")}</td>
                      <td className="px-4 py-3 text-center">
                        <div className="flex items-center justify-center gap-1">
                          {l.course_id && (
                            <Button variant="ghost" size="sm" className="h-7 text-xs gap-1" onClick={() => setViewCourseId(l.course_id)}>
                              <Eye className="h-3 w-3" /> Info
                            </Button>
                          )}
                          <Button variant="ghost" size="sm" className="h-7 text-xs gap-1" onClick={() => openPayment(l.id)}>
                            <IndianRupee className="h-3 w-3" /> Pay Fee
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {leads.length === 0 && (
                    <tr><td colSpan={5} className="px-4 py-8 text-center text-sm text-muted-foreground">No leads added yet</td></tr>
                  )}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* PAYMENTS TAB */}
        <TabsContent value="payments" className="mt-4">
          <Card className="border-border/60 shadow-none overflow-hidden">
            <CardContent className="p-0">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/50">
                    <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase">Student</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase">Type</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-muted-foreground uppercase">Amount</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase">Mode</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase">Date</th>
                    <th className="px-4 py-3 text-center text-xs font-semibold text-muted-foreground uppercase">Receipt</th>
                  </tr>
                </thead>
                <tbody>
                  {payments.map(p => (
                    <tr key={p.id} className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors">
                      <td className="px-4 py-3 font-medium text-foreground">{p.lead_name || "—"}</td>
                      <td className="px-4 py-3 text-muted-foreground">{TYPE_LABELS[p.type] || p.type}</td>
                      <td className="px-4 py-3 text-right font-semibold text-foreground">{fmt(p.amount)}</td>
                      <td className="px-4 py-3 text-muted-foreground text-xs">{MODE_LABELS[p.payment_mode] || p.payment_mode}</td>
                      <td className="px-4 py-3 text-muted-foreground text-xs">{new Date(p.payment_date).toLocaleDateString("en-IN")}</td>
                      <td className="px-4 py-3 text-center">
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => downloadReceipt(p)}>
                          <Download className="h-3.5 w-3.5" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                  {payments.length === 0 && (
                    <tr><td colSpan={6} className="px-4 py-8 text-center text-sm text-muted-foreground">No payments recorded yet</td></tr>
                  )}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* COMMISSIONS TAB */}
        <TabsContent value="commissions" className="mt-4 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Card className="border-border/60 shadow-none">
              <CardContent className="p-4 text-center">
                <p className="text-xl font-bold text-primary">{fmt(Number(stats?.total_commission || 0))}</p>
                <p className="text-[11px] text-muted-foreground">Total Earned</p>
              </CardContent>
            </Card>
            <Card className="border-border/60 shadow-none">
              <CardContent className="p-4 text-center">
                <p className="text-xl font-bold text-emerald-600">{fmt(Number(stats?.commission_paid || 0))}</p>
                <p className="text-[11px] text-muted-foreground">Paid Out</p>
              </CardContent>
            </Card>
            <Card className="border-border/60 shadow-none">
              <CardContent className="p-4 text-center">
                <p className="text-xl font-bold text-amber-600">{fmt(Number(stats?.commission_pending || 0))}</p>
                <p className="text-[11px] text-muted-foreground">Pending</p>
              </CardContent>
            </Card>
          </div>

          <Card className="border-border/60 shadow-none overflow-hidden">
            <CardContent className="p-0">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/50">
                    <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase">Student</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase">Course</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-muted-foreground uppercase">Fee Paid</th>
                    <th className="px-4 py-3 text-center text-xs font-semibold text-muted-foreground uppercase">Fee %</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-muted-foreground uppercase">Payout</th>
                    <th className="px-4 py-3 text-center text-xs font-semibold text-muted-foreground uppercase">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {payouts.map(p => {
                    const sc = PAYOUT_STATUS[p.status] || PAYOUT_STATUS.pending;
                    return (
                      <tr key={p.id} className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors">
                        <td className="px-4 py-3 font-medium text-foreground">{p.lead_name || "—"}</td>
                        <td className="px-4 py-3 text-muted-foreground">{p.course_name || "—"}</td>
                        <td className="px-4 py-3 text-right text-muted-foreground">{fmt(p.student_fee_paid)}</td>
                        <td className="px-4 py-3 text-center">
                          <Badge className={`text-[10px] border-0 ${Number(p.fee_paid_pct) >= 25 ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700"}`}>
                            {p.fee_paid_pct}%
                          </Badge>
                        </td>
                        <td className="px-4 py-3 text-right font-semibold text-foreground">{fmt(p.payout_amount)}</td>
                        <td className="px-4 py-3 text-center">
                          <Badge className={`text-[10px] border-0 ${sc.cls}`}>{sc.label}</Badge>
                        </td>
                      </tr>
                    );
                  })}
                  {payouts.length === 0 && (
                    <tr><td colSpan={6} className="px-4 py-8 text-center text-sm text-muted-foreground">No commission payouts yet</td></tr>
                  )}
                </tbody>
              </table>
            </CardContent>
          </Card>

          <p className="text-[10px] text-muted-foreground">
            Commission payouts are released proportionally to student fee payments. Minimum 25% of annual fee must be paid by the student before payout is eligible.
          </p>
        </TabsContent>
      </Tabs>

      {/* Add Lead Dialog */}
      <Dialog open={showAdd} onOpenChange={setShowAdd}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Add New Lead</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-medium text-muted-foreground mb-1">Name *</label>
                <input value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} placeholder="Student name" className={inputCls} />
              </div>
              <div className="min-w-0">
                <label className="block text-[11px] font-medium text-muted-foreground mb-1">Phone *</label>
                <PhoneInput value={form.phone} onChange={phone => setForm(p => ({ ...p, phone }))} required />
              </div>
            </div>
            <div>
              <label className="block text-[11px] font-medium text-muted-foreground mb-1">Email</label>
              <input type="email" value={form.email} onChange={e => setForm(p => ({ ...p, email: e.target.value }))} placeholder="email@example.com" className={inputCls} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-medium text-muted-foreground mb-1">Course</label>
                <select value={form.course_id} onChange={e => handleCourseChange(e.target.value)} className={inputCls}>
                  <option value="">Select course</option>
                  {coursesByDepartment.map(g => (
                    <optgroup key={g.department} label={g.department}>
                      {g.courses.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </optgroup>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-[11px] font-medium text-muted-foreground mb-1">Campus</label>
                <select value={form.campus_id} onChange={e => setForm(p => ({ ...p, campus_id: e.target.value }))} className={inputCls} disabled={filteredCampuses.length <= 1}>
                  {!form.course_id ? <option value="">Select course first</option> :
                    filteredCampuses.length === 1 ? <option value={filteredCampuses[0].id}>{filteredCampuses[0].name}</option> :
                      <><option value="">Select campus</option>{filteredCampuses.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</>}
                </select>
              </div>
            </div>
            <div>
              <label className="block text-[11px] font-medium text-muted-foreground mb-1">Notes</label>
              <textarea value={form.notes} onChange={e => setForm(p => ({ ...p, notes: e.target.value }))} rows={2} className={inputCls} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAdd(false)}>Cancel</Button>
            <Button onClick={handleAddLead} disabled={!form.name.trim() || !form.phone.trim() || saving} className="gap-1.5">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Add Lead
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Pay Fee Dialog */}
      <Dialog open={showPayment} onOpenChange={setShowPayment}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <IndianRupee className="h-5 w-5 text-primary" /> Record Payment
            </DialogTitle>
            <p className="text-sm text-muted-foreground">
              {leads.find(l => l.id === paymentLeadId)?.name || "Student"}
            </p>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-medium text-muted-foreground mb-1">Payment Type</label>
                <select value={payForm.type} onChange={e => setPayForm(p => ({ ...p, type: e.target.value }))} className={inputCls}>
                  <option value="application_fee">Application Fee</option>
                  <option value="token_fee">Token Fee</option>
                  <option value="registration_fee">Registration Fee</option>
                  <option value="other">Other</option>
                </select>
              </div>
              <div>
                <label className="block text-[11px] font-medium text-muted-foreground mb-1">Amount *</label>
                <div className="relative">
                  <IndianRupee className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                  <input type="number" min="0" value={payForm.amount} onChange={e => setPayForm(p => ({ ...p, amount: e.target.value }))} placeholder="0.00" className={`${inputCls} pl-8`} />
                </div>
              </div>
            </div>
            <div>
              <label className="block text-[11px] font-medium text-muted-foreground mb-1">Payment Mode</label>
              <div className="grid grid-cols-3 gap-1.5">
                {[{ v: "cash", l: "Cash" }, { v: "upi", l: "UPI" }, { v: "bank_transfer", l: "Bank Transfer" }, { v: "cheque", l: "Cheque" }, { v: "online", l: "Online" }].map(m => (
                  <button key={m.v} onClick={() => setPayForm(p => ({ ...p, mode: m.v }))}
                    className={`rounded-lg border px-2 py-2 text-xs font-medium transition-colors ${payForm.mode === m.v ? "border-primary bg-primary/5 text-primary" : "border-border text-muted-foreground hover:border-primary/40"}`}>
                    {m.l}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="block text-[11px] font-medium text-muted-foreground mb-1">Transaction Ref / UTR</label>
              <input value={payForm.transaction_ref} onChange={e => setPayForm(p => ({ ...p, transaction_ref: e.target.value }))} placeholder="Optional" className={inputCls} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowPayment(false)}>Cancel</Button>
            <Button onClick={handleRecordPayment} disabled={!payForm.amount || parseFloat(payForm.amount) <= 0 || saving} className="gap-2">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <IndianRupee className="h-4 w-4" />} Record Payment
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Course Info Dialog */}
      <Dialog open={!!viewCourseId} onOpenChange={(o) => { if (!o) setViewCourseId(null); }}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Course Information</DialogTitle>
          </DialogHeader>
          {viewCourseId && <CourseInfoPanel courseId={viewCourseId} />}
        </DialogContent>
      </Dialog>

      {/* Receipt Download */}
      {receiptData && (
        <ReceiptDialog data={receiptData} onClose={() => setReceiptData(null)} />
      )}
    </div>
  );
};

export default ConsultantPortal;
