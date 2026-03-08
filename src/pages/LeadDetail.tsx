import { useState, useEffect } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  ArrowLeft, Phone, Mail, MapPin, Calendar, User, MessageSquare,
  FileText, Clock, Plus, Send, Check, X, Loader2, ChevronRight,
  StickyNote, CalendarClock, Building2, Gift, UserCheck, Bot, ArrowRight
} from "lucide-react";
import { InterviewScoringDialog } from "@/components/admissions/InterviewScoringDialog";
import { OfferLetterDialog } from "@/components/admissions/OfferLetterDialog";
import { ConvertToStudentDialog } from "@/components/admissions/ConvertToStudentDialog";

const STAGE_LABELS: Record<string, string> = {
  new_lead: "New Lead", application_in_progress: "Application In Progress", application_submitted: "Application Submitted",
  ai_called: "AI Called", counsellor_call: "Counsellor Call",
  visit_scheduled: "Visit Scheduled", interview: "Interview", offer_sent: "Offer Sent",
  token_paid: "Token Paid", pre_admitted: "Pre-Admitted", admitted: "Admitted", rejected: "Rejected",
};

const STAGE_COLORS: Record<string, string> = {
  new_lead: "bg-pastel-blue", application_in_progress: "bg-pastel-yellow", application_submitted: "bg-pastel-mint",
  ai_called: "bg-pastel-purple", counsellor_call: "bg-pastel-orange",
  visit_scheduled: "bg-pastel-yellow", interview: "bg-pastel-mint", offer_sent: "bg-pastel-green",
  token_paid: "bg-primary/15", pre_admitted: "bg-primary/20", admitted: "bg-primary text-primary-foreground", rejected: "bg-pastel-red",
};

const LeadDetail = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { user } = useAuth();
  const [lead, setLead] = useState<any>(null);
  const [notes, setNotes] = useState<any[]>([]);
  const [followups, setFollowups] = useState<any[]>([]);
  const [visits, setVisits] = useState<any[]>([]);
  const [activities, setActivities] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [newNote, setNewNote] = useState("");
  const [savingNote, setSavingNote] = useState(false);
  const [showFollowupForm, setShowFollowupForm] = useState(false);
  const [followupData, setFollowupData] = useState({ scheduled_at: "", type: "call", notes: "" });
  const [showVisitForm, setShowVisitForm] = useState(false);
  const [visitData, setVisitData] = useState({ visit_date: "", campus_id: "" });
  const [campuses, setCampuses] = useState<any[]>([]);
  const [showInterview, setShowInterview] = useState(false);
  const [showOfferLetter, setShowOfferLetter] = useState(false);
  const [showConvert, setShowConvert] = useState(false);
  const [aiCalling, setAiCalling] = useState(false);

  useEffect(() => {
    if (!id) return;
    fetchAll();
  }, [id]);

  const fetchAll = async () => {
    setLoading(true);
    const [leadRes, notesRes, followupsRes, visitsRes, activitiesRes, campusesRes] = await Promise.all([
      supabase.from("leads").select("*").eq("id", id).single(),
      supabase.from("lead_notes").select("*").eq("lead_id", id).order("created_at", { ascending: false }),
      supabase.from("lead_followups").select("*").eq("lead_id", id).order("scheduled_at", { ascending: true }),
      supabase.from("campus_visits").select("*").eq("lead_id", id).order("visit_date", { ascending: false }),
      supabase.from("lead_activities").select("*").eq("lead_id", id).order("created_at", { ascending: false }).limit(50),
      supabase.from("campuses").select("id, name"),
    ]);
    if (leadRes.data) setLead(leadRes.data);
    if (notesRes.data) setNotes(notesRes.data);
    if (followupsRes.data) setFollowups(followupsRes.data);
    if (visitsRes.data) setVisits(visitsRes.data);
    if (activitiesRes.data) setActivities(activitiesRes.data);
    if (campusesRes.data) setCampuses(campusesRes.data);
    setLoading(false);
  };

  const addNote = async () => {
    if (!newNote.trim() || !id) return;
    setSavingNote(true);
    const { error } = await supabase.from("lead_notes").insert({ lead_id: id, user_id: user?.id, content: newNote.trim() });
    if (error) toast({ title: "Error", description: error.message, variant: "destructive" });
    else { setNewNote(""); await fetchAll(); }
    setSavingNote(false);
  };

  const addFollowup = async () => {
    if (!followupData.scheduled_at || !id) return;
    const { error } = await supabase.from("lead_followups").insert({
      lead_id: id, user_id: user?.id,
      scheduled_at: followupData.scheduled_at,
      type: followupData.type,
      notes: followupData.notes || null,
    });
    if (error) toast({ title: "Error", description: error.message, variant: "destructive" });
    else { setShowFollowupForm(false); setFollowupData({ scheduled_at: "", type: "call", notes: "" }); await fetchAll(); }
  };

  const completeFollowup = async (fid: string) => {
    await supabase.from("lead_followups").update({ status: "completed", completed_at: new Date().toISOString() }).eq("id", fid);
    await fetchAll();
  };

  const scheduleVisit = async () => {
    if (!visitData.visit_date || !id) return;
    const { error } = await supabase.from("campus_visits").insert({
      lead_id: id, scheduled_by: user?.id,
      visit_date: visitData.visit_date,
      campus_id: visitData.campus_id || null,
    });
    if (error) toast({ title: "Error", description: error.message, variant: "destructive" });
    else { setShowVisitForm(false); setVisitData({ visit_date: "", campus_id: "" }); await fetchAll(); }
  };

  const updateVisitStatus = async (vid: string, status: string) => {
    await supabase.from("campus_visits").update({ status }).eq("id", vid);
    await fetchAll();
  };

  const updateStage = async (newStage: string) => {
    if (!id || !lead) return;
    const { error } = await supabase.from("leads").update({ stage: newStage as any }).eq("id", id);
    if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); return; }
    await supabase.from("lead_activities").insert({
      lead_id: id, user_id: user?.id || null, type: "stage_change",
      description: `Stage changed from ${STAGE_LABELS[lead.stage] || lead.stage} to ${STAGE_LABELS[newStage] || newStage}`,
      old_stage: lead.stage as any, new_stage: newStage as any,
    });
    await fetchAll();
  };

  if (loading) return <div className="flex h-64 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  if (!lead) return <div className="text-center py-20"><p className="text-muted-foreground">Lead not found</p></div>;

  const inputCls = "w-full rounded-xl border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/20";

  return (
    <div className="space-y-6 animate-fade-in">
      <Link to="/admissions" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors">
        <ArrowLeft className="h-4 w-4" /> Back to CRM
      </Link>

      {/* Header Card */}
      <Card className="border-border/60">
        <CardContent className="p-6">
          <div className="flex flex-col sm:flex-row gap-5">
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10 text-xl font-bold text-primary shrink-0">
              {lead.name.split(" ").map((n: string) => n[0]).join("").slice(0, 2).toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex flex-wrap items-center gap-3">
                <h1 className="text-xl font-bold text-foreground">{lead.name}</h1>
                <Badge className={`text-[11px] border-0 ${STAGE_COLORS[lead.stage] || "bg-muted"}`}>
                  {STAGE_LABELS[lead.stage] || lead.stage}
                </Badge>
              </div>
              <div className="flex flex-wrap gap-x-5 gap-y-1.5 mt-2 text-sm text-muted-foreground">
                <span className="flex items-center gap-1.5"><Phone className="h-3.5 w-3.5" />{lead.phone}</span>
                {lead.email && <span className="flex items-center gap-1.5"><Mail className="h-3.5 w-3.5" />{lead.email}</span>}
                {lead.application_id && <span className="flex items-center gap-1.5 font-mono text-primary"><FileText className="h-3.5 w-3.5" />{lead.application_id}</span>}
              </div>
              {(lead.pre_admission_no || lead.admission_no) && (
                <div className="flex gap-2 mt-2">
                  {lead.pre_admission_no && <Badge variant="outline" className="text-xs text-primary border-primary/30">PAN: {lead.pre_admission_no}</Badge>}
                  {lead.admission_no && <Badge className="text-xs bg-primary text-primary-foreground">AN: {lead.admission_no}</Badge>}
                </div>
              )}
            </div>
            <div className="flex flex-wrap gap-2 shrink-0">
              <Button size="sm" variant="outline" className="gap-1.5"><Phone className="h-3.5 w-3.5" />Call</Button>
              <Button size="sm" variant="outline" className="gap-1.5"><MessageSquare className="h-3.5 w-3.5" />WhatsApp</Button>
              <Button size="sm" variant="outline" className="gap-1.5" onClick={async () => {
                setAiCalling(true);
                const { data, error } = await supabase.functions.invoke("ai-first-call", { body: { lead_id: id } });
                setAiCalling(false);
                if (error) toast({ title: "AI Call Error", description: error.message, variant: "destructive" });
                else { toast({ title: "AI Call Complete" }); fetchAll(); }
              }} disabled={aiCalling}>
                {aiCalling ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Bot className="h-3.5 w-3.5" />}AI Call
              </Button>
              <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setShowInterview(true)}><UserCheck className="h-3.5 w-3.5" />Interview</Button>
              <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setShowOfferLetter(true)}><FileText className="h-3.5 w-3.5" />Offer</Button>
              <Button size="sm" className="gap-1.5" onClick={() => setShowConvert(true)}><ArrowRight className="h-3.5 w-3.5" />Convert</Button>
            </div>
          </div>

          {/* Stage progression */}
          <div className="mt-6 pt-4 border-t border-border">
            <p className="text-[11px] font-medium text-muted-foreground mb-2 uppercase tracking-wide">Move to Stage</p>
            <div className="flex flex-wrap gap-1.5">
              {Object.entries(STAGE_LABELS).map(([key, label]) => (
                <button
                  key={key}
                  onClick={() => updateStage(key)}
                  disabled={lead.stage === key}
                  className={`rounded-lg px-3 py-1.5 text-[11px] font-medium transition-colors ${
                    lead.stage === key ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/80 hover:text-foreground"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Tabs */}
      <Tabs defaultValue="info" className="w-full">
        <TabsList className="bg-card border border-border rounded-xl p-1 h-auto flex-wrap">
          <TabsTrigger value="info" className="rounded-lg text-sm data-[state=active]:bg-primary data-[state=active]:text-primary-foreground gap-1.5">
            <User className="h-3.5 w-3.5" />Info
          </TabsTrigger>
          <TabsTrigger value="notes" className="rounded-lg text-sm data-[state=active]:bg-primary data-[state=active]:text-primary-foreground gap-1.5">
            <StickyNote className="h-3.5 w-3.5" />Notes ({notes.length})
          </TabsTrigger>
          <TabsTrigger value="followups" className="rounded-lg text-sm data-[state=active]:bg-primary data-[state=active]:text-primary-foreground gap-1.5">
            <CalendarClock className="h-3.5 w-3.5" />Followups ({followups.length})
          </TabsTrigger>
          <TabsTrigger value="visits" className="rounded-lg text-sm data-[state=active]:bg-primary data-[state=active]:text-primary-foreground gap-1.5">
            <Building2 className="h-3.5 w-3.5" />Visits ({visits.length})
          </TabsTrigger>
          <TabsTrigger value="activity" className="rounded-lg text-sm data-[state=active]:bg-primary data-[state=active]:text-primary-foreground gap-1.5">
            <Clock className="h-3.5 w-3.5" />Activity ({activities.length})
          </TabsTrigger>
        </TabsList>

        {/* Info Tab */}
        <TabsContent value="info">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
            <Card className="border-border/60"><CardContent className="p-5 space-y-3">
              <h3 className="text-sm font-semibold text-foreground">Contact Information</h3>
              <div className="grid grid-cols-2 gap-y-3 gap-x-4 text-sm">
                <Detail label="Phone" value={lead.phone} />
                <Detail label="Email" value={lead.email || "—"} />
                <Detail label="Guardian" value={lead.guardian_name || "—"} />
                <Detail label="Guardian Phone" value={lead.guardian_phone || "—"} />
              </div>
            </CardContent></Card>
            <Card className="border-border/60"><CardContent className="p-5 space-y-3">
              <h3 className="text-sm font-semibold text-foreground">Lead Details</h3>
              <div className="grid grid-cols-2 gap-y-3 gap-x-4 text-sm">
                <Detail label="Source" value={lead.source} />
                <Detail label="Stage" value={STAGE_LABELS[lead.stage] || lead.stage} />
                <Detail label="Interview Result" value={lead.interview_result || "—"} />
                <Detail label="Interview Score" value={lead.interview_score ? String(lead.interview_score) : "—"} />
                <Detail label="Offer Amount" value={lead.offer_amount ? `₹${Number(lead.offer_amount).toLocaleString("en-IN")}` : "—"} />
                <Detail label="Token Amount" value={lead.token_amount ? `₹${Number(lead.token_amount).toLocaleString("en-IN")}` : "—"} />
              </div>
            </CardContent></Card>
            {lead.notes && (
              <Card className="border-border/60 md:col-span-2"><CardContent className="p-5">
                <h3 className="text-sm font-semibold text-foreground mb-2">Notes</h3>
                <p className="text-sm text-muted-foreground">{lead.notes}</p>
              </CardContent></Card>
            )}
          </div>
        </TabsContent>

        {/* Notes Tab */}
        <TabsContent value="notes">
          <div className="mt-4 space-y-4">
            <div className="flex gap-2">
              <input type="text" value={newNote} onChange={(e) => setNewNote(e.target.value)} placeholder="Add a note..." className={inputCls}
                onKeyDown={(e) => e.key === "Enter" && addNote()} />
              <Button onClick={addNote} disabled={savingNote || !newNote.trim()} size="sm" className="gap-1.5 shrink-0">
                {savingNote ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Add
              </Button>
            </div>
            <div className="space-y-2">
              {notes.map((note) => (
                <Card key={note.id} className="border-border/60"><CardContent className="p-4">
                  <p className="text-sm text-foreground">{note.content}</p>
                  <p className="text-[10px] text-muted-foreground mt-2">{new Date(note.created_at).toLocaleString("en-IN")}</p>
                </CardContent></Card>
              ))}
              {notes.length === 0 && <p className="text-sm text-muted-foreground text-center py-8">No notes yet</p>}
            </div>
          </div>
        </TabsContent>

        {/* Followups Tab */}
        <TabsContent value="followups">
          <div className="mt-4 space-y-4">
            {!showFollowupForm ? (
              <Button onClick={() => setShowFollowupForm(true)} size="sm" className="gap-1.5"><Plus className="h-4 w-4" />Schedule Followup</Button>
            ) : (
              <Card className="border-border/60"><CardContent className="p-4 space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div><label className="block text-[11px] font-medium text-muted-foreground mb-1">Date & Time *</label>
                    <input type="datetime-local" value={followupData.scheduled_at} onChange={(e) => setFollowupData(p => ({ ...p, scheduled_at: e.target.value }))} className={inputCls} /></div>
                  <div><label className="block text-[11px] font-medium text-muted-foreground mb-1">Type</label>
                    <select value={followupData.type} onChange={(e) => setFollowupData(p => ({ ...p, type: e.target.value }))} className={inputCls}>
                      <option value="call">Call</option><option value="whatsapp">WhatsApp</option><option value="email">Email</option><option value="visit">Visit</option>
                    </select></div>
                </div>
                <input type="text" value={followupData.notes} onChange={(e) => setFollowupData(p => ({ ...p, notes: e.target.value }))} placeholder="Notes (optional)" className={inputCls} />
                <div className="flex gap-2">
                  <Button onClick={addFollowup} size="sm" className="gap-1.5"><Plus className="h-4 w-4" />Save</Button>
                  <Button onClick={() => setShowFollowupForm(false)} size="sm" variant="outline">Cancel</Button>
                </div>
              </CardContent></Card>
            )}
            <div className="space-y-2">
              {followups.map((f) => (
                <Card key={f.id} className="border-border/60"><CardContent className="p-4 flex items-center gap-4">
                  <div className={`h-8 w-8 rounded-lg flex items-center justify-center shrink-0 ${f.status === "completed" ? "bg-pastel-green" : "bg-pastel-yellow"}`}>
                    {f.status === "completed" ? <Check className="h-4 w-4 text-foreground/70" /> : <Clock className="h-4 w-4 text-foreground/70" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground capitalize">{f.type} followup</p>
                    <p className="text-xs text-muted-foreground">{new Date(f.scheduled_at).toLocaleString("en-IN")}</p>
                    {f.notes && <p className="text-xs text-muted-foreground mt-1">{f.notes}</p>}
                  </div>
                  {f.status === "pending" && (
                    <Button onClick={() => completeFollowup(f.id)} size="sm" variant="outline" className="gap-1 shrink-0">
                      <Check className="h-3.5 w-3.5" />Done
                    </Button>
                  )}
                </CardContent></Card>
              ))}
              {followups.length === 0 && <p className="text-sm text-muted-foreground text-center py-8">No followups scheduled</p>}
            </div>
          </div>
        </TabsContent>

        {/* Visits Tab */}
        <TabsContent value="visits">
          <div className="mt-4 space-y-4">
            {!showVisitForm ? (
              <Button onClick={() => setShowVisitForm(true)} size="sm" className="gap-1.5"><Plus className="h-4 w-4" />Schedule Visit</Button>
            ) : (
              <Card className="border-border/60"><CardContent className="p-4 space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div><label className="block text-[11px] font-medium text-muted-foreground mb-1">Visit Date *</label>
                    <input type="datetime-local" value={visitData.visit_date} onChange={(e) => setVisitData(p => ({ ...p, visit_date: e.target.value }))} className={inputCls} /></div>
                  <div><label className="block text-[11px] font-medium text-muted-foreground mb-1">Campus</label>
                    <select value={visitData.campus_id} onChange={(e) => setVisitData(p => ({ ...p, campus_id: e.target.value }))} className={inputCls}>
                      <option value="">Select campus</option>
                      {campuses.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select></div>
                </div>
                <div className="flex gap-2">
                  <Button onClick={scheduleVisit} size="sm" className="gap-1.5"><Calendar className="h-4 w-4" />Schedule</Button>
                  <Button onClick={() => setShowVisitForm(false)} size="sm" variant="outline">Cancel</Button>
                </div>
              </CardContent></Card>
            )}
            <div className="space-y-2">
              {visits.map((v) => {
                const statusColors: Record<string, string> = { scheduled: "bg-pastel-blue", completed: "bg-pastel-green", no_show: "bg-pastel-red", rescheduled: "bg-pastel-yellow" };
                return (
                  <Card key={v.id} className="border-border/60"><CardContent className="p-4 flex items-center gap-4">
                    <div className={`h-8 w-8 rounded-lg flex items-center justify-center shrink-0 ${statusColors[v.status] || "bg-muted"}`}>
                      <MapPin className="h-4 w-4 text-foreground/70" />
                    </div>
                    <div className="flex-1">
                      <p className="text-sm font-medium text-foreground">{new Date(v.visit_date).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}</p>
                      <p className="text-xs text-muted-foreground capitalize">{v.status}</p>
                    </div>
                    {v.status === "scheduled" && (
                      <div className="flex gap-1.5">
                        <Button onClick={() => updateVisitStatus(v.id, "completed")} size="sm" variant="outline" className="text-xs gap-1"><Check className="h-3 w-3" />Completed</Button>
                        <Button onClick={() => updateVisitStatus(v.id, "no_show")} size="sm" variant="outline" className="text-xs gap-1"><X className="h-3 w-3" />No Show</Button>
                      </div>
                    )}
                  </CardContent></Card>
                );
              })}
              {visits.length === 0 && <p className="text-sm text-muted-foreground text-center py-8">No visits scheduled</p>}
            </div>
          </div>
        </TabsContent>

        {/* Activity Tab */}
        <TabsContent value="activity">
          <div className="mt-4 space-y-2">
            {activities.map((a) => (
              <Card key={a.id} className="border-border/60"><CardContent className="p-4 flex items-start gap-3">
                <div className="h-2 w-2 rounded-full bg-primary mt-2 shrink-0" />
                <div>
                  <p className="text-sm text-foreground">{a.description}</p>
                  <p className="text-[10px] text-muted-foreground mt-1">{new Date(a.created_at).toLocaleString("en-IN")}</p>
                </div>
              </CardContent></Card>
            ))}
            {activities.length === 0 && <p className="text-sm text-muted-foreground text-center py-8">No activity recorded</p>}
          </div>
        </TabsContent>
      </Tabs>

      {lead && (
        <>
          <InterviewScoringDialog open={showInterview} onOpenChange={setShowInterview}
            leadId={lead.id} leadName={lead.name} currentScore={lead.interview_score} currentResult={lead.interview_result} onSuccess={fetchAll} />
          <OfferLetterDialog open={showOfferLetter} onOpenChange={setShowOfferLetter}
            leadId={lead.id} leadName={lead.name} courseId={lead.course_id} campusId={lead.campus_id} onSuccess={fetchAll} />
          <ConvertToStudentDialog open={showConvert} onOpenChange={setShowConvert} lead={lead} onSuccess={fetchAll} />
        </>
      )}
    </div>
  );
};

const Detail = ({ label, value }: { label: string; value: string }) => (
  <div><p className="text-[11px] text-muted-foreground">{label}</p><p className="text-sm font-medium text-foreground mt-0.5">{value}</p></div>
);

export default LeadDetail;
