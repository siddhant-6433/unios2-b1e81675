import { useState, useEffect } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useIsTeamLeader } from "@/hooks/useTeamLeader";
import { useToast } from "@/hooks/use-toast";
import {
  ArrowLeft, Loader2, Trash2, ArrowRightLeft, Phone, MessageSquare,
  Calendar, Clock, FileText, Bot, UserCheck, Mail, IndianRupee, MapPin, ThumbsDown,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { TransferLeadDialog } from "@/components/admissions/TransferLeadDialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { AiCallSummary } from "@/components/leads/AiCallSummary";
import { LeadInfoCard } from "@/components/leads/LeadInfoCard";
import { LeadTimeline } from "@/components/leads/LeadTimeline";
import { InterviewScoringDialog } from "@/components/admissions/InterviewScoringDialog";
import { OfferLetterDialog } from "@/components/admissions/OfferLetterDialog";
import { ConvertToStudentDialog } from "@/components/admissions/ConvertToStudentDialog";
import { SendWhatsAppDialog } from "@/components/leads/SendWhatsAppDialog";
import { AddSecondaryCounsellorDialog } from "@/components/leads/AddSecondaryCounsellorDialog";
import { ScheduleVisitDialog } from "@/components/admissions/ScheduleVisitDialog";
import { ScheduleFollowupDialog } from "@/components/admissions/ScheduleFollowupDialog";
import { CallDispositionDialog, type CallDispositionData } from "@/components/admissions/CallDispositionDialog";
import { RecordPaymentDialog } from "@/components/admissions/RecordPaymentDialog";
import { LeadPaymentHistory } from "@/components/admissions/LeadPaymentHistory";
import { FuzzyDuplicateAlert } from "@/components/admissions/FuzzyDuplicateAlert";
import { ApplicationProgress } from "@/components/leads/ApplicationProgress";
import { FeeStructureViewer } from "@/components/finance/FeeStructureViewer";
import { SendEmailDialog } from "@/components/leads/SendEmailDialog";
import { useCourseCampusLink } from "@/hooks/useCourseCampusLink";

const STAGE_LABELS: Record<string, string> = {
  new_lead: "New Lead", application_in_progress: "Application In Progress", application_submitted: "Application Submitted",
  ai_called: "AI Called", counsellor_call: "Counsellor Call",
  visit_scheduled: "Visit Scheduled", interview: "Interview", offer_sent: "Offer Sent",
  token_paid: "Token Paid", pre_admitted: "Pre-Admitted", admitted: "Admitted", rejected: "Rejected",
};

const STAGE_ORDER = [
  "new_lead", "application_in_progress", "application_submitted",
  "ai_called", "counsellor_call", "visit_scheduled", "interview",
  "offer_sent", "token_paid", "pre_admitted", "admitted",
];

const stageIndex = (stage: string) => {
  const idx = STAGE_ORDER.indexOf(stage);
  return idx === -1 ? -1 : idx;
};

/** Auto-advance lead stage only if newStage is ahead of current stage (forward-only). */
const shouldAutoAdvance = (currentStage: string, newStage: string) => {
  if (currentStage === "rejected" || currentStage === "not_interested") return false;
  return stageIndex(newStage) > stageIndex(currentStage);
};

const LeadDetail = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { user, role, profile } = useAuth();
  const isTeamLeader = useIsTeamLeader();
  const isSuperAdmin = role === "super_admin";
  const canTransfer = isSuperAdmin || isTeamLeader;
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
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showTransfer, setShowTransfer] = useState(false);
  const [showScheduleVisit, setShowScheduleVisit] = useState(false);
  const [showFollowup, setShowFollowup] = useState(false);
  const [showCallDisposition, setShowCallDisposition] = useState(false);
  const [dispositionWaSent, setDispositionWaSent] = useState(false);
  const [showRecordPayment, setShowRecordPayment] = useState(false);
  const [showSendEmail, setShowSendEmail] = useState(false);
  const [paymentRefreshKey, setPaymentRefreshKey] = useState(0);
  const [deletingLead, setDeletingLead] = useState(false);
  const [showNotInterested, setShowNotInterested] = useState(false);
  const [notInterestedReason, setNotInterestedReason] = useState("");
  const [savingNotInterested, setSavingNotInterested] = useState(false);
  const [counsellorName, setCounsellorName] = useState<string | undefined>();
  const [courseName, setCourseName] = useState<string | undefined>();
  const [courseDuration, setCourseDuration] = useState<number | undefined>();
  const [courseType, setCourseType] = useState<string | undefined>();
  const [campusName, setCampusName] = useState<string | undefined>();
  const [campusCity, setCampusCity] = useState<string | undefined>();
  const [profileId, setProfileId] = useState<string | null>(null);

  useEffect(() => { if (id) fetchAll(); }, [id]);

  const fetchAll = async (silent = false) => {
    if (!silent) setLoading(true);
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
      } else {
        setCounsellorName(undefined);
      }
      if (leadRes.data.course_id) {
        const { data } = await supabase.from("courses").select("name, duration_years, type").eq("id", leadRes.data.course_id).single();
        setCourseName(data?.name || undefined);
        setCourseDuration(data?.duration_years || undefined);
        setCourseType(data?.type || undefined);
      }
      if (leadRes.data.campus_id) {
        const { data } = await supabase.from("campuses").select("name, city, state").eq("id", leadRes.data.campus_id).single();
        setCampusName(data?.name || undefined);
        setCampusCity(data?.city ? (data.state ? `${data.city}, ${data.state}` : data.city) : undefined);
      } else {
        setCampusCity(undefined);
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
    const { error } = await supabase.from("lead_notes").insert({ lead_id: id, user_id: user?.id, content: newNote.trim() });
    if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); }
    else {
      await supabase.from("lead_activities").insert({
        lead_id: id, user_id: profileId, type: "note",
        description: newNote.trim(),
      });
      setNewNote(""); await fetchAll(true);
    }
    setSavingNote(false);
  };

  const logCallDisposition = async (data: CallDispositionData) => {
    if (!id || !lead) return;

    const dispositionLabels: Record<string, string> = {
      interested: "Interested", not_interested: "Not Interested",
      ineligible: "Ineligible",
      not_answered: "Not Answered", wrong_number: "Wrong Number",
      call_back: "Call Back Later", do_not_contact: "Do Not Contact",
      voicemail: "Voicemail", busy: "Busy",
    };
    const label = dispositionLabels[data.disposition] || data.disposition;

    // 1. Insert into call_logs
    await supabase.from("call_logs").insert({
      lead_id: id,
      user_id: user?.id,
      direction: "outbound",
      duration_seconds: data.duration_seconds,
      disposition: data.disposition,
      notes: data.notes || null,
    });

    // 1b. Mark any pending follow-ups on this lead as completed — the call has been made
    await supabase
      .from("lead_followups")
      .update({ status: "completed", completed_at: new Date().toISOString() } as any)
      .eq("lead_id", id)
      .eq("status", "pending");

    // 2. Log activity
    const durationStr = data.duration_seconds > 0
      ? ` (${Math.floor(data.duration_seconds / 60)}m${data.duration_seconds % 60 ? ` ${data.duration_seconds % 60}s` : ""})`
      : "";
    await supabase.from("lead_activities").insert({
      lead_id: id, user_id: profileId, type: "call",
      description: `Call: ${label}${durationStr}${data.notes ? ` — ${data.notes}` : ""}`,
    });

    // 3. Auto-advance stage based on disposition
    if (data.disposition === "interested" || data.disposition === "call_back" || data.disposition === "not_answered") {
      await autoAdvanceStage("counsellor_call");
    } else if (data.disposition === "not_interested" || data.disposition === "do_not_contact") {
      await supabase.from("leads").update({ stage: "rejected" as any }).eq("id", id);
      await supabase.from("lead_activities").insert({
        lead_id: id, user_id: profileId, type: "stage_change",
        description: `Stage changed to Rejected (${label})`,
        old_stage: lead.stage as any, new_stage: "rejected" as any,
      });
    } else if (data.disposition === "ineligible") {
      // Mark as rejected for current session, save future eligibility if provided
      const updates: Record<string, any> = { stage: "rejected" as any };
      if (data.future_eligible_session) {
        updates.future_eligible_session = data.future_eligible_session;
      }
      await supabase.from("leads").update(updates).eq("id", id);
      const futureNote = data.future_eligible_session
        ? ` — eligible for ${data.future_eligible_session}`
        : "";
      await supabase.from("lead_activities").insert({
        lead_id: id, user_id: profileId, type: "stage_change",
        description: `Stage changed to Rejected (Ineligible${futureNote})`,
        old_stage: lead.stage as any, new_stage: "rejected" as any,
      });
    }

    // 4. Auto-send WhatsApp to lead based on disposition (fire-and-forget)
    if (lead.phone) {
      const course = courseName || "your selected course";
      let autoTemplate: string | null = null;
      let autoParams: string[] = [];

      if (data.disposition === "interested") {
        autoTemplate = "course_details";
        autoParams = [lead.name, course];
      } else if (data.disposition === "not_answered" || data.disposition === "busy" || data.disposition === "voicemail") {
        autoTemplate = "missed_call";
        autoParams = [lead.name, course];
      } else if (data.disposition === "call_back") {
        autoTemplate = "callback_scheduled";
        autoParams = [lead.name, course];
      }

      if (autoTemplate) {
        setDispositionWaSent(true);
        supabase.functions.invoke("whatsapp-send", {
          body: {
            template_key: autoTemplate,
            phone: lead.phone,
            params: autoParams,
            lead_id: id,
          },
        }).then(({ error, data }) => {
          if (error || data?.error) {
            const detail = data?.error || data?.meta_error || error?.message || "Unknown error";
            console.error("Auto WA after disposition failed:", detail);
            toast({ title: "Auto WhatsApp failed", description: detail, variant: "destructive" });
          }
        });
      }
    }

    toast({ title: "Call logged", description: label });
    await fetchAll(true);

    // 5. Chain to follow-up dialog if requested
    if (data.schedule_followup) {
      setShowFollowup(true);
    }
    // 6. Schedule visit inline if provided
    if (data.visit) {
      await scheduleVisit(data.visit);
    }
  };

  const addFollowup = async (data: { scheduled_at: string; type: string; notes: string }) => {
    if (!data.scheduled_at || !id) return;
    // Mark all existing pending follow-ups for this lead as completed
    // (creating a new follow-up implies the previous ones have been acted on)
    await supabase
      .from("lead_followups")
      .update({ status: "completed", completed_at: new Date().toISOString() } as any)
      .eq("lead_id", id)
      .eq("status", "pending");

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
      // Auto-advance to counsellor_call when a call followup is scheduled
      if (data.type === "call") {
        await autoAdvanceStage("counsellor_call");
      }

      // Send WhatsApp to lead: "callback scheduled" notification
      // Skip if disposition already sent a WhatsApp (avoid duplicate messages)
      if (lead?.phone && data.type === "call" && !dispositionWaSent) {
        supabase.functions.invoke("whatsapp-send", {
          body: {
            template_key: "callback_scheduled",
            phone: lead.phone,
            params: [lead.name || "Student", courseName || "your selected course"],
            lead_id: id,
          },
        }).catch(e => console.error("Follow-up WA failed:", e));
      }

      setDispositionWaSent(false); // reset flag
      await fetchAll(true);
    }
  };

  const completeFollowup = async (fid: string) => {
    await supabase.from("lead_followups").update({ status: "completed", completed_at: new Date().toISOString() }).eq("id", fid);
    await supabase.from("lead_activities").insert({
      lead_id: id!, user_id: profileId, type: "followup",
      description: "Follow-up marked as completed",
    });
    await fetchAll(true);
  };

  const scheduleVisit = async (data: { visit_date: string; campus_id: string }) => {
    if (!data.visit_date || !id) return;
    const campusLabel = campuses.find(c => c.id === data.campus_id)?.name || "";
    const { error } = await supabase.from("campus_visits").insert({
      lead_id: id, scheduled_by: user?.id,
      visit_date: data.visit_date, campus_id: data.campus_id || null,
    });
    if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); return; }

    const visitDateFormatted = new Date(data.visit_date).toLocaleDateString("en-GB", {
      day: "2-digit", month: "2-digit", year: "2-digit",
    }) + " " + new Date(data.visit_date).toLocaleTimeString("en-IN", {
      hour: "2-digit", minute: "2-digit", hour12: true,
    });

    await supabase.from("lead_activities").insert({
      lead_id: id, user_id: profileId, type: "visit",
      description: `Campus visit scheduled for ${visitDateFormatted}${campusLabel ? ` at ${campusLabel}` : ""}`,
    });
    await autoAdvanceStage("visit_scheduled");

    // Send WhatsApp visit_confirmation template
    const sentChannels: string[] = [];
    if (lead?.phone) {
      const { error: waErr, data: waData } = await supabase.functions.invoke("whatsapp-send", {
        body: {
          template_key: "visit_confirmation",
          phone: lead.phone,
          params: [lead.name || "Student", visitDateFormatted, campusLabel || "NIMT Educational Institutions"],
          lead_id: id,
          button_urls: ["1820424915210710582"], // Google Maps CID for campus location
        },
      });
      if (waErr) {
        console.error("Visit WhatsApp failed:", waErr.message);
        toast({ title: "WhatsApp failed", description: waErr.message, variant: "destructive" });
      } else {
        sentChannels.push("WhatsApp");
      }
    }

    // Send email visit confirmation
    if (lead?.email) {
      const { error: emErr } = await supabase.functions.invoke("send-email", {
        body: {
          to_email: lead.email,
          lead_id: id,
          custom_subject: `Campus Visit Confirmed — ${visitDateFormatted}${campusLabel ? ` at ${campusLabel}` : ""}`,
          custom_body: `<div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:24px"><img src="https://uni.nimt.ac.in/unios-logo.png" alt="NIMT Educational Institutions" style="height:40px;margin-bottom:16px" /><h2 style="color:#1e293b;margin:0 0 8px">Campus Visit Confirmed!</h2><p style="color:#475569;line-height:1.6">Hi ${lead.name || "Student"},</p><p style="color:#475569;line-height:1.6">Your campus visit has been scheduled:</p><div style="background:#f1f5f9;border-radius:8px;padding:16px;margin:16px 0"><p style="color:#1e293b;margin:0"><strong>Date &amp; Time:</strong> ${visitDateFormatted}</p>${campusLabel ? `<p style="color:#1e293b;margin:4px 0 0"><strong>Campus:</strong> ${campusLabel}</p>` : ""}</div><p style="color:#475569;line-height:1.6">Please carry a valid photo ID. We look forward to welcoming you!</p><hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0" /><p style="color:#94a3b8;font-size:12px;margin:0">NIMT Educational Institutions — Admissions</p></div>`,
        },
      });
      if (emErr) console.error("Visit email failed:", emErr.message);
      else sentChannels.push("Email");
    }

    toast({ title: "Visit scheduled", description: sentChannels.length ? `Confirmation sent via ${sentChannels.join(" & ")}` : undefined });
    await fetchAll(true);
  };

  const updateStage = async (newStage: string) => {
    if (!id || !lead || lead.stage === newStage) return;
    // Prevent going back to new_lead once moved past it
    if (newStage === "new_lead" && lead.stage !== "new_lead") {
      toast({ title: "Cannot revert", description: "Lead cannot be moved back to New Lead stage.", variant: "destructive" });
      return;
    }
    const { error } = await supabase.from("leads").update({ stage: newStage as any }).eq("id", id);
    if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); return; }
    await supabase.from("lead_activities").insert({
      lead_id: id, user_id: profileId, type: "stage_change",
      description: `Stage changed from ${STAGE_LABELS[lead.stage] || lead.stage} to ${STAGE_LABELS[newStage] || newStage}`,
      old_stage: lead.stage as any, new_stage: newStage as any,
    });
    await fetchAll(true);
  };

  /** Auto-advance stage when an action implies progression */
  const autoAdvanceStage = async (targetStage: string) => {
    if (!id || !lead) return;
    if (shouldAutoAdvance(lead.stage, targetStage)) {
      await supabase.from("leads").update({ stage: targetStage as any }).eq("id", id);
      await supabase.from("lead_activities").insert({
        lead_id: id, user_id: profileId, type: "stage_change",
        description: `Stage auto-advanced from ${STAGE_LABELS[lead.stage] || lead.stage} to ${STAGE_LABELS[targetStage] || targetStage}`,
        old_stage: lead.stage as any, new_stage: targetStage as any,
      });
    }
  };

  const updateField = async (field: string, value: string | null, label: string) => {
    if (!id || !lead) return;
    const oldValue = lead[field];
    const { error } = await supabase.from("leads").update({ [field]: value } as any).eq("id", id);
    if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); return; }

    let oldDisplay = oldValue || "Not set";
    let newDisplay = value || "Not set";
    if (field === "course_id") {
      oldDisplay = courseOptions.find(c => c.id === oldValue)?.name || "Not set";
      newDisplay = courseOptions.find(c => c.id === value)?.name || "Not set";
    } else if (field === "campus_id") {
      oldDisplay = courseOptions.find(c => c.campus_id === oldValue)?.campus_name || campuses.find(c => c.id === oldValue)?.name || "Not set";
      newDisplay = courseOptions.find(c => c.campus_id === value)?.campus_name || campuses.find(c => c.id === value)?.name || "Not set";
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
    await fetchAll(true);
  };

  const triggerAiCall = async () => {
    setAiCalling(true);
    try {
      const { data, error } = await supabase.functions.invoke("voice-call", {
        body: { action: "outbound", lead_id: id },
      });

      if (error) {
        const errBody = (error as any).data;
        const detail = errBody?.error || error.message;
        toast({ title: "AI Call Error", description: detail, variant: "destructive" });
      } else if (data?.error) {
        toast({ title: "AI Call Error", description: data.error, variant: "destructive" });
      } else {
        toast({ title: "AI Call Started", description: data?.message || "Calling lead..." });
        fetchAll(true);
      }
    } catch (e: any) {
      toast({ title: "AI Call Error", description: e.message, variant: "destructive" });
    }
    setAiCalling(false);
  };

  const handleNotInterested = async () => {
    const wordCount = notInterestedReason.trim().split(/\s+/).length;
    if (wordCount < 5) {
      toast({ title: "Reason too short", description: "Please enter at least 5 words", variant: "destructive" });
      return;
    }
    if (!id) return;
    setSavingNotInterested(true);

    // Update lead stage to not_interested
    const { error: stageErr } = await supabase.from("leads").update({ stage: "not_interested" } as any).eq("id", id);
    if (stageErr) {
      toast({ title: "Error", description: stageErr.message, variant: "destructive" });
      setSavingNotInterested(false);
      return;
    }

    // Add reason as a note
    await supabase.from("lead_notes").insert({
      lead_id: id,
      content: `[Not Interested] ${notInterestedReason.trim()}`,
      created_by: profileId,
    } as any);

    // Log activity
    await supabase.from("lead_activities").insert({
      lead_id: id,
      type: "stage_change",
      description: `Marked as Not Interested: ${notInterestedReason.trim()}`,
      performed_by: profileId,
    } as any);

    toast({ title: "Marked as Not Interested" });
    setShowNotInterested(false);
    setNotInterestedReason("");
    setSavingNotInterested(false);
    fetchAll(true);
  };

  const handleDeleteLead = async () => {
    if (!id) return;
    setDeletingLead(true);
    const { error } = await supabase.from("leads").delete().eq("id", id);
    if (error) {
      toast({ title: "Delete failed", description: error.message, variant: "destructive" });
      setDeletingLead(false);
      setShowDeleteConfirm(false);
    } else {
      toast({ title: "Lead deleted", description: `${lead?.name || "Lead"} has been deleted.` });
      navigate("/admissions");
    }
  };

  if (loading) return <div className="flex h-64 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  if (!lead) return <div className="text-center py-20"><p className="text-muted-foreground">Lead not found</p></div>;

  return (
    <div className="space-y-4 animate-fade-in px-0">
      {/* Breadcrumb + Actions */}
      <div className="flex items-center gap-2 text-sm overflow-x-auto">
        <Link to="/admissions" className="text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1 shrink-0">
          <ArrowLeft className="h-3.5 w-3.5" /> Leads
        </Link>
        <span className="text-muted-foreground/50 shrink-0">/</span>
        <span className="font-medium text-foreground truncate">{lead.name}</span>
        {lead.application_id && (
          <span className="text-xs font-mono text-muted-foreground ml-1 shrink-0">{lead.application_id}</span>
        )}
        {/* Assigned counsellor badge */}
        <div className="ml-auto flex items-center gap-2 shrink-0">
          <span
            className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium ${
              counsellorName
                ? "bg-pink-100 text-pink-700 dark:bg-pink-900/30 dark:text-pink-400"
                : "bg-muted text-muted-foreground"
            }`}
            title={counsellorName ? "Assigned counsellor" : "This lead is unassigned"}
          >
            <UserCheck className="h-3 w-3" />
            {counsellorName || "Unassigned"}
          </span>
          {canTransfer && (
            <Button variant="outline" size="sm" className="gap-1.5 text-xs" onClick={() => setShowTransfer(true)}>
              <ArrowRightLeft className="h-3.5 w-3.5" /> Transfer
            </Button>
          )}
          {isSuperAdmin && (
            <Button variant="outline" size="sm" className="gap-1.5 text-xs text-destructive border-destructive/30 hover:bg-destructive/10" onClick={() => setShowDeleteConfirm(true)}>
              <Trash2 className="h-3.5 w-3.5" /> Delete
            </Button>
          )}
        </div>
      </div>

      {/* Quick action icon bar */}
      {(() => {
        // Payment is restricted to super_admin only
        const canRecordPayment = role === "super_admin";
        // Offer requires application to be submitted (or later stage). Pre-offer stages can't issue.
        const appSubmittedOrLater = stageIndex(lead.stage) >= stageIndex("application_submitted");
        const canIssueOffer = appSubmittedOrLater && (
          role === "super_admin" || role === "principal" || role === "counsellor" || role === "admission_head" || role === "campus_admin"
        );
        const offerDisabledReason = !appSubmittedOrLater
          ? "Offer can only be issued after application is submitted"
          : !canIssueOffer
          ? "You do not have permission to issue offers"
          : undefined;

        const actions = [
          { icon: Phone, label: "Call", color: "text-blue-600 bg-blue-100 dark:bg-blue-900/30", action: () => {
            setShowCallDisposition(true);
          } },
          { icon: MessageSquare, label: "WhatsApp", color: "text-green-600 bg-green-100 dark:bg-green-900/30", action: () => setShowWhatsApp(true) },
          { icon: Clock, label: "Follow Up", color: "text-orange-600 bg-orange-100 dark:bg-orange-900/30", action: () => setShowFollowup(true) },
          { icon: MapPin, label: "Visit", color: "text-violet-600 bg-violet-100 dark:bg-violet-900/30", action: () => setShowScheduleVisit(true) },
          { icon: Mail, label: "Email", color: "text-sky-600 bg-sky-100 dark:bg-sky-900/30", action: () => setShowSendEmail(true) },
          { icon: Bot, label: "AI Call", color: "text-amber-600 bg-amber-100 dark:bg-amber-900/30", action: triggerAiCall, disabled: aiCalling },
          { icon: UserCheck, label: "Interview", color: "text-indigo-600 bg-indigo-100 dark:bg-indigo-900/30", action: () => setShowInterview(true) },
          {
            icon: FileText, label: "Offer",
            color: "text-teal-600 bg-teal-100 dark:bg-teal-900/30",
            action: () => setShowOfferLetter(true),
            disabled: !canIssueOffer,
            tooltip: offerDisabledReason,
          },
          // Payment only visible for super_admin
          ...(canRecordPayment ? [{
            icon: IndianRupee, label: "Payment",
            color: "text-emerald-600 bg-emerald-100 dark:bg-emerald-900/30",
            action: () => setShowRecordPayment(true),
          }] : []),
          { icon: ThumbsDown, label: "Not Interested", color: "text-red-600 bg-red-100 dark:bg-red-900/30", action: () => setShowNotInterested(true) },
        ];

        return (
          <div className="flex items-center gap-1 overflow-x-auto pb-1">
            {actions.map(({ icon: Icon, label, color, action, disabled, tooltip }: any) => (
              <button
                key={label}
                onClick={action}
                disabled={disabled}
                className="flex flex-col items-center gap-1 px-3 py-2 rounded-xl hover:bg-muted/50 transition-colors shrink-0 disabled:opacity-40 disabled:cursor-not-allowed"
                title={tooltip || label}
              >
                <div className={`flex h-9 w-9 items-center justify-center rounded-xl ${color}`}>
                  {disabled && label === "AI Call" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Icon className="h-4 w-4" />}
                </div>
                <span className="text-[10px] font-medium text-muted-foreground">{label}</span>
              </button>
            ))}
          </div>
        );
      })()}

      {/* Application Progress — top of page, full width, for applicants */}
      {(lead.person_role === "applicant" || lead.application_id) && (
        <ApplicationProgress
          leadId={lead.id}
          leadPhone={lead.phone}
          applicationId={lead.application_id}
          canImpersonate={role === "super_admin" || role === "principal" || role === "campus_admin" || role === "admission_head" || role === "counsellor"}
        />
      )}

      {/* Two-column layout */}
      <div className="grid grid-cols-1 lg:grid-cols-[380px_1fr] gap-5">
        {/* Left Column */}
        <div className="space-y-4">
          <LeadInfoCard
            lead={lead}
            counsellorName={counsellorName}
            courseName={courseName}
            campusName={campusName}
            campusCity={campusCity}
            coursesByDepartment={coursesByDepartment}
            getCampusesForCourse={getCampusesForCourse}
            onStageChange={updateStage}
            onFieldUpdate={updateField}
          />
          <FuzzyDuplicateAlert leadId={lead.id} leadName={lead.name} leadPhone={lead.phone} leadEmail={lead.email} />
          <LeadPaymentHistory leadId={lead.id} refreshKey={paymentRefreshKey} />
          {lead.course_id && (
            <Card className="border-border/60">
              <CardContent className="p-4">
                <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Fee Structure</h3>
                <FeeStructureViewer courseId={lead.course_id} compact newAdmissionOnly />
              </CardContent>
            </Card>
          )}
        </div>

        {/* Right Column */}
        <div className="space-y-4">
          {/* AI Call Summary - golden highlight card */}
          <AiCallSummary leadId={id!} />
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
              await fetchAll(true);
            }}
            campuses={campuses}
            leadId={lead.id}
            courseId={lead.course_id}
          />
        </div>
      </div>

      {/* Dialogs */}
      <InterviewScoringDialog open={showInterview} onOpenChange={setShowInterview}
        leadId={lead.id} leadName={lead.name} currentScore={lead.interview_score} currentResult={lead.interview_result} onSuccess={() => fetchAll(true)} />
      <OfferLetterDialog open={showOfferLetter} onOpenChange={setShowOfferLetter}
        leadId={lead.id} leadName={lead.name} courseId={lead.course_id} campusId={lead.campus_id} onSuccess={() => fetchAll(true)} />
      <ConvertToStudentDialog open={showConvert} onOpenChange={setShowConvert} lead={lead} courseName={courseName} campusName={campusName} onSuccess={() => fetchAll(true)} />
      <SendWhatsAppDialog
        open={showWhatsApp}
        onOpenChange={setShowWhatsApp}
        lead={{ id: lead.id, name: lead.name, phone: lead.phone, application_id: lead.application_id, source: lead.source }}
        courseName={courseName}
        campusName={campusName}
        courseDuration={courseDuration}
        courseType={courseType}
        onSuccess={() => fetchAll(true)}
      />
      <AddSecondaryCounsellorDialog
        open={showSecondaryCounsellor}
        onOpenChange={setShowSecondaryCounsellor}
        leadId={lead.id}
        leadName={lead.name}
        onSuccess={() => fetchAll(true)}
      />

      {/* Send Email Dialog */}
      <SendEmailDialog
        open={showSendEmail}
        onOpenChange={setShowSendEmail}
        lead={{ id: lead.id, name: lead.name, email: lead.email }}
        onSuccess={() => fetchAll(true)}
      />

      {/* Record Payment Dialog */}
      <RecordPaymentDialog
        open={showRecordPayment}
        onOpenChange={setShowRecordPayment}
        leadId={lead.id}
        leadName={lead.name}
        onSuccess={() => { fetchAll(true); setPaymentRefreshKey(k => k + 1); }}
      />

      {/* Schedule Visit Dialog */}
      <ScheduleVisitDialog
        open={showScheduleVisit}
        onOpenChange={setShowScheduleVisit}
        campuses={campuses}
        defaultCampusId={lead.campus_id || undefined}
        onSchedule={scheduleVisit}
      />

      {/* Schedule Follow-up Dialog */}
      <ScheduleFollowupDialog
        open={showFollowup}
        onOpenChange={setShowFollowup}
        onSchedule={addFollowup}
      />

      {/* Call Disposition Dialog */}
      <CallDispositionDialog
        open={showCallDisposition}
        onOpenChange={setShowCallDisposition}
        leadName={lead.name}
        leadPhone={lead.phone}
        campuses={campuses}
        defaultCampusId={lead.campus_id || undefined}
        onSubmit={logCallDisposition}
        onCallNow={async () => {
          if (!profile?.phone || !lead.phone) return;
          const leadPhoneFormatted = lead.phone.startsWith("+") ? lead.phone : `+91${lead.phone.replace(/^91/, "")}`;
          const { data, error } = await supabase.functions.invoke("whatsapp-send", {
            body: {
              template_key: "counsellor_call_lead",
              phone: profile.phone,
              params: [
                profile.display_name || "Counsellor",
                lead.name,
                leadPhoneFormatted,
                courseName || "N/A",
              ],
              button_urls: [lead.id],
            },
          });
          if (error) {
            let detail = error.message;
            try {
              if ((error as any).context?.json) {
                const body = await (error as any).context.json();
                detail = body?.error || detail;
              }
            } catch {}
            // Ignore "template not approved yet" errors silently
            if (!detail?.includes("132001") && !detail?.includes("does not exist in the translation")) {
              toast({ title: "Tap-to-call WA failed", description: detail, variant: "destructive" });
            }
          } else if (data?.error) {
            if (!data.error.includes("132001") && !data.error.includes("does not exist in the translation")) {
              toast({ title: "Tap-to-call WA failed", description: data.error, variant: "destructive" });
            }
          }
        }}
      />

      {/* Transfer Dialog */}
      <TransferLeadDialog
        open={showTransfer}
        onOpenChange={setShowTransfer}
        leadIds={id ? [id] : []}
        leadNames={[lead.name]}
        onSuccess={() => fetchAll(true)}
      />

      {/* Not Interested Dialog */}
      <AlertDialog open={showNotInterested} onOpenChange={(o) => { if (!savingNotInterested) { setShowNotInterested(o); if (!o) setNotInterestedReason(""); } }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <ThumbsDown className="h-5 w-5 text-destructive" /> Mark as Not Interested
            </AlertDialogTitle>
            <AlertDialogDescription>
              This will move <strong>{lead.name}</strong> to <strong>Not Interested</strong>. Please provide a reason (minimum 5 words).
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="py-2">
            <textarea
              className="w-full rounded-xl border border-input bg-background px-3 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring/20 min-h-[90px] resize-none"
              placeholder="e.g. Parent decided to go with another school due to distance"
              value={notInterestedReason}
              onChange={e => setNotInterestedReason(e.target.value)}
            />
            <p className={`text-[11px] mt-1 ${notInterestedReason.trim().split(/\s+/).filter(Boolean).length >= 5 ? "text-muted-foreground" : "text-destructive"}`}>
              {notInterestedReason.trim().split(/\s+/).filter(Boolean).length}/5 words minimum
            </p>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={savingNotInterested}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleNotInterested}
              disabled={savingNotInterested || notInterestedReason.trim().split(/\s+/).filter(Boolean).length < 5}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {savingNotInterested && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              Mark Not Interested
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete Confirmation */}
      <AlertDialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete "{lead.name}"?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete this lead and all associated data (notes, activities, follow-ups, offer letters, etc.). This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deletingLead}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteLead} disabled={deletingLead} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              {deletingLead && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default LeadDetail;
