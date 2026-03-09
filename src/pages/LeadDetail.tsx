import { useState, useEffect } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, Loader2 } from "lucide-react";
import { AiCallSummary } from "@/components/leads/AiCallSummary";
import { LeadInfoCard } from "@/components/leads/LeadInfoCard";
import { QuickActions } from "@/components/leads/QuickActions";
import { NextFollowup } from "@/components/leads/NextFollowup";
import { LeadTimeline } from "@/components/leads/LeadTimeline";
import { InterviewScoringDialog } from "@/components/admissions/InterviewScoringDialog";
import { OfferLetterDialog } from "@/components/admissions/OfferLetterDialog";
import { ConvertToStudentDialog } from "@/components/admissions/ConvertToStudentDialog";
import { SendWhatsAppDialog } from "@/components/leads/SendWhatsAppDialog";
import { AddSecondaryCounsellorDialog } from "@/components/leads/AddSecondaryCounsellorDialog";
import { useCourseCampusLink } from "@/hooks/useCourseCampusLink";

const STAGE_LABELS: Record<string, string> = {
  new_lead: "New Lead", application_in_progress: "Application In Progress", application_submitted: "Application Submitted",
  ai_called: "AI Called", counsellor_call: "Counsellor Call",
  visit_scheduled: "Visit Scheduled", interview: "Interview", offer_sent: "Offer Sent",
  token_paid: "Token Paid", pre_admitted: "Pre-Admitted", admitted: "Admitted", rejected: "Rejected",
};

const LeadDetail = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { user } = useAuth();
  const { coursesByDepartment, getCampusesForCourse, courseOptions } = useCourseCampusLink();
  const [lead, setLead] = useState<any>(null);
  const [notes, setNotes] = useState<any[]>([]);
  const [followups, setFollowups] = useState<any[]>([]);
  const [visits, setVisits] = useState<any[]>([]);
  const [activities, setActivities] = useState<any[]>([]);
  const [callLogs, setCallLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [newNote, setNewNote] = useState("");
  const [savingNote, setSavingNote] = useState(false);
  const [campuses, setCampuses] = useState<any[]>([]);
  const [courses, setCourses] = useState<any[]>([]);
  const [showInterview, setShowInterview] = useState(false);
  const [showOfferLetter, setShowOfferLetter] = useState(false);
  const [showConvert, setShowConvert] = useState(false);
  const [showWhatsApp, setShowWhatsApp] = useState(false);
  const [aiCalling, setAiCalling] = useState(false);
  const [showSecondaryCounsellor, setShowSecondaryCounsellor] = useState(false);
  const [counsellorName, setCounsellorName] = useState<string | undefined>();
  const [courseName, setCourseName] = useState<string | undefined>();
  const [campusName, setCampusName] = useState<string | undefined>();
  const [profileId, setProfileId] = useState<string | null>(null);

  useEffect(() => { if (id) fetchAll(); }, [id]);

  const fetchAll = async () => {
    setLoading(true);
    const [leadRes, notesRes, followupsRes, visitsRes, activitiesRes, campusesRes, callLogsRes, coursesRes, profileRes] = await Promise.all([
      supabase.from("leads").select("*").eq("id", id).single(),
      supabase.from("lead_notes").select("*").eq("lead_id", id).order("created_at", { ascending: false }),
      supabase.from("lead_followups").select("*").eq("lead_id", id).order("scheduled_at", { ascending: true }),
      supabase.from("campus_visits").select("*").eq("lead_id", id).order("visit_date", { ascending: false }),
      supabase.from("lead_activities").select("*").eq("lead_id", id).order("created_at", { ascending: false }).limit(50),
      supabase.from("campuses").select("id, name"),
      supabase.from("call_logs").select("*").eq("lead_id", id!).order("called_at", { ascending: false }),
      supabase.from("courses").select("id, name"),
      user?.id ? supabase.from("profiles").select("id").eq("user_id", user.id).single() : Promise.resolve({ data: null }),
    ]);
    if (profileRes.data) setProfileId((profileRes.data as any).id);
    if (leadRes.data) {
      setLead(leadRes.data);
      if (leadRes.data.counsellor_id) {
        const { data } = await supabase.from("profiles").select("display_name").eq("id", leadRes.data.counsellor_id).single();
        setCounsellorName(data?.display_name || undefined);
      }
      if (leadRes.data.course_id) {
        const { data } = await supabase.from("courses").select("name").eq("id", leadRes.data.course_id).single();
        setCourseName(data?.name || undefined);
      }
      if (leadRes.data.campus_id) {
        const { data } = await supabase.from("campuses").select("name").eq("id", leadRes.data.campus_id).single();
        setCampusName(data?.name || undefined);
      }
    }
    if (notesRes.data) setNotes(notesRes.data);
    if (followupsRes.data) setFollowups(followupsRes.data);
    if (visitsRes.data) setVisits(visitsRes.data);
    if (activitiesRes.data) setActivities(activitiesRes.data);
    if (campusesRes.data) setCampuses(campusesRes.data);
    if (callLogsRes.data) setCallLogs(callLogsRes.data);
    if (coursesRes.data) setCourses(coursesRes.data);
    setLoading(false);
  };

  const addNote = async () => {
    if (!newNote.trim() || !id) return;
    setSavingNote(true);
    const { error } = await supabase.from("lead_notes").insert({ lead_id: id, user_id: profileId, content: newNote.trim() });
    if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); }
    else {
      await supabase.from("lead_activities").insert({
        lead_id: id, user_id: profileId, type: "note",
        description: newNote.trim(),
      });
      setNewNote(""); await fetchAll();
    }
    setSavingNote(false);
  };

  const addFollowup = async (data: { scheduled_at: string; type: string; notes: string }) => {
    if (!data.scheduled_at || !id) return;
    const { error } = await supabase.from("lead_followups").insert({
      lead_id: id, user_id: user?.id,
      scheduled_at: data.scheduled_at, type: data.type, notes: data.notes || null,
    });
    if (error) toast({ title: "Error", description: error.message, variant: "destructive" });
    else {
      await supabase.from("lead_activities").insert({
        lead_id: id, user_id: profileId, type: "followup",
        description: `Follow-up scheduled (${data.type}) for ${new Date(data.scheduled_at).toLocaleDateString("en-IN")}${data.notes ? `. ${data.notes}` : ""}`,
      });
      await fetchAll();
    }
  };

  const completeFollowup = async (fid: string) => {
    await supabase.from("lead_followups").update({ status: "completed", completed_at: new Date().toISOString() }).eq("id", fid);
    await supabase.from("lead_activities").insert({
      lead_id: id!, user_id: profileId, type: "followup",
      description: "Follow-up marked as completed",
    });
    await fetchAll();
  };

  const scheduleVisit = async (data: { visit_date: string; campus_id: string }) => {
    if (!data.visit_date || !id) return;
    const campusLabel = campuses.find(c => c.id === data.campus_id)?.name || "";
    const { error } = await supabase.from("campus_visits").insert({
      lead_id: id, scheduled_by: user?.id,
      visit_date: data.visit_date, campus_id: data.campus_id || null,
    });
    if (error) toast({ title: "Error", description: error.message, variant: "destructive" });
    else {
      await supabase.from("lead_activities").insert({
        lead_id: id, user_id: profileId, type: "visit",
        description: `Campus visit scheduled for ${new Date(data.visit_date).toLocaleDateString("en-IN")}${campusLabel ? ` at ${campusLabel}` : ""}`,
      });
      await fetchAll();
    }
  };

  const updateStage = async (newStage: string) => {
    if (!id || !lead || lead.stage === newStage) return;
    const { error } = await supabase.from("leads").update({ stage: newStage as any }).eq("id", id);
    if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); return; }
    await supabase.from("lead_activities").insert({
      lead_id: id, user_id: profileId, type: "stage_change",
      description: `Stage changed from ${STAGE_LABELS[lead.stage] || lead.stage} to ${STAGE_LABELS[newStage] || newStage}`,
      old_stage: lead.stage as any, new_stage: newStage as any,
    });
    await fetchAll();
  };

  const updateField = async (field: string, value: string | null, label: string) => {
    if (!id || !lead) return;
    const oldValue = lead[field];
    const { error } = await supabase.from("leads").update({ [field]: value } as any).eq("id", id);
    if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); return; }

    let oldDisplay = oldValue || "Not set";
    let newDisplay = value || "Not set";
    if (field === "course_id") {
      oldDisplay = courses.find(c => c.id === oldValue)?.name || "Not set";
      newDisplay = courses.find(c => c.id === value)?.name || "Not set";
    } else if (field === "campus_id") {
      oldDisplay = campuses.find(c => c.id === oldValue)?.name || "Not set";
      newDisplay = campuses.find(c => c.id === value)?.name || "Not set";
    }

    const activityPayload = {
      lead_id: id, user_id: profileId || null, type: "info_update" as const,
      description: `${label} changed from "${oldDisplay}" to "${newDisplay}"`,
    };
    console.log("Inserting activity:", activityPayload, "profileId:", profileId);
    const { error: actError, data: actData } = await supabase.from("lead_activities").insert(activityPayload).select();
    if (actError) {
      console.error("Activity log failed:", actError);
      toast({ title: "Warning", description: "Field updated but activity log failed: " + actError.message, variant: "destructive" });
    } else {
      console.log("Activity logged:", actData);
    }
    toast({ title: `${label} updated` });
    await fetchAll();
  };

  const triggerAiCall = async () => {
    setAiCalling(true);
    const { error } = await supabase.functions.invoke("ai-first-call", { body: { lead_id: id } });
    setAiCalling(false);
    if (error) toast({ title: "AI Call Error", description: error.message, variant: "destructive" });
    else { toast({ title: "AI Call Complete" }); fetchAll(); }
  };

  if (loading) return <div className="flex h-64 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  if (!lead) return <div className="text-center py-20"><p className="text-muted-foreground">Lead not found</p></div>;

  return (
    <div className="space-y-4 animate-fade-in px-0">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm overflow-x-auto">
        <Link to="/admissions" className="text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1 shrink-0">
          <ArrowLeft className="h-3.5 w-3.5" /> Leads
        </Link>
        <span className="text-muted-foreground/50 shrink-0">/</span>
        <span className="font-medium text-foreground truncate">{lead.name}</span>
        {lead.application_id && (
          <span className="text-xs font-mono text-muted-foreground ml-1 shrink-0">{lead.application_id}</span>
        )}
      </div>

      {/* Two-column layout */}
      <div className="grid grid-cols-1 lg:grid-cols-[380px_1fr] gap-5">
        {/* Left Column */}
        <div className="space-y-4">
          <LeadInfoCard
            lead={lead}
            counsellorName={counsellorName}
            courseName={courseName}
            campusName={campusName}
            coursesByDepartment={coursesByDepartment}
            getCampusesForCourse={getCampusesForCourse}
            onStageChange={updateStage}
            onFieldUpdate={updateField}
          />
          <QuickActions
            onCall={() => {
              if (lead.phone) window.open(`tel:${lead.phone}`);
            }}
            onWhatsApp={() => setShowWhatsApp(true)}
            onScheduleVisit={() => scheduleVisit({
              visit_date: new Date(Date.now() + 86400000).toISOString(),
              campus_id: lead.campus_id || "",
            })}
            onInterview={() => setShowInterview(true)}
            onOffer={() => setShowOfferLetter(true)}
            onConvert={() => setShowConvert(true)}
            onAiCall={triggerAiCall}
            aiCalling={aiCalling}
            onAddSecondaryCounsellor={() => setShowSecondaryCounsellor(true)}
          />
          <NextFollowup
            followups={followups}
            onSchedule={addFollowup}
            campuses={campuses}
            onScheduleVisit={scheduleVisit}
          />
        </div>

        {/* Right Column */}
        <div className="space-y-4">
          {/* AI Call Summary - golden highlight card */}
          <AiCallSummary
            callLog={callLogs.find((c) => c.direction === "outbound" && c.notes) || callLogs[0] || null}
          />
          <LeadTimeline
            activities={activities}
            notes={notes}
            followups={followups}
            visits={visits}
            callLogs={callLogs}
            newNote={newNote}
            setNewNote={setNewNote}
            onAddNote={addNote}
            savingNote={savingNote}
            onCompleteFollowup={completeFollowup}
            onAddFollowup={addFollowup}
            onScheduleVisit={scheduleVisit}
            onUpdateVisitStatus={async (vid, status) => {
              await supabase.from("campus_visits").update({ status }).eq("id", vid);
              await supabase.from("lead_activities").insert({
                lead_id: id!, user_id: user?.id || null, type: "visit",
                description: `Campus visit status updated to ${status}`,
              });
              await fetchAll();
            }}
            campuses={campuses}
          />
        </div>
      </div>

      {/* Dialogs */}
      <InterviewScoringDialog open={showInterview} onOpenChange={setShowInterview}
        leadId={lead.id} leadName={lead.name} currentScore={lead.interview_score} currentResult={lead.interview_result} onSuccess={fetchAll} />
      <OfferLetterDialog open={showOfferLetter} onOpenChange={setShowOfferLetter}
        leadId={lead.id} leadName={lead.name} courseId={lead.course_id} campusId={lead.campus_id} onSuccess={fetchAll} />
      <ConvertToStudentDialog open={showConvert} onOpenChange={setShowConvert} lead={lead} onSuccess={fetchAll} />
      <SendWhatsAppDialog
        open={showWhatsApp}
        onOpenChange={setShowWhatsApp}
        lead={{ id: lead.id, name: lead.name, phone: lead.phone, application_id: lead.application_id }}
        courseName={courseName}
        campusName={campusName}
        onSuccess={fetchAll}
      />
      <AddSecondaryCounsellorDialog
        open={showSecondaryCounsellor}
        onOpenChange={setShowSecondaryCounsellor}
        leadId={lead.id}
        leadName={lead.name}
        onSuccess={fetchAll}
      />
    </div>
  );
};

export default LeadDetail;
