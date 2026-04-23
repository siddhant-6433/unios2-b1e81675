import { useState, useEffect } from "react";
import { useParams, Link, useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useIsTeamLeader } from "@/hooks/useTeamLeader";
import { useToast } from "@/hooks/use-toast";
import {
  ArrowLeft, Loader2, Trash2, ArrowRightLeft, Phone, MessageSquare,
  Calendar, CalendarDays, Clock, FileText, Bot, UserCheck, Mail, IndianRupee, MapPin, ThumbsDown, CheckCircle, Footprints,
  ChevronRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
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
import { useCallQueue } from "@/hooks/useCallQueue";
import { ScorePopup } from "@/components/admissions/ScorePopup";

// Score points for each disposition (mirrors DB trigger)
const DISPOSITION_POINTS: Record<string, { points: number; label: string }> = {
  interested: { points: 10, label: "Interested call" },
  call_back: { points: 3, label: "Call back scheduled" },
  not_answered: { points: 1, label: "Call attempted" },
  busy: { points: 1, label: "Call attempted" },
  voicemail: { points: 1, label: "Voicemail left" },
  not_interested: { points: -3, label: "Not interested" },
  do_not_contact: { points: -2, label: "Do not contact" },
  wrong_number: { points: -2, label: "Wrong number" },
};

const STAGE_LABELS: Record<string, string> = {
  new_lead: "New Lead", application_in_progress: "Application In Progress", application_submitted: "Application Submitted",
  ai_called: "AI Called", counsellor_call: "In Follow Up",
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
  const [searchParams, setSearchParams] = useSearchParams();
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
  const [showWalkinCompletion, setShowWalkinCompletion] = useState(false);
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
  const [showNextLeadPrompt, setShowNextLeadPrompt] = useState(false);
  const [lastDisposition, setLastDisposition] = useState<string>("");
  const [scorePopup, setScorePopup] = useState<{ points: number; label: string; visible: boolean }>({ points: 0, label: "", visible: false });
  const { buckets, nextLead, refetch: refetchQueue } = useCallQueue(id);

  useEffect(() => { if (id) fetchAll(); }, [id]);

  // Auto-open call dialog when navigated with ?action=call
  useEffect(() => {
    if (searchParams.get("action") === "call" && !loading && lead) {
      setShowCallDisposition(true);
      setSearchParams({}, { replace: true });
    }
  }, [loading, lead, searchParams]);

  const fetchAll = async (silent = false) => {
    if (!silent) setLoading(true);
    const [leadRes, notesRes, followupsRes, visitsRes, activitiesRes, campusesRes, callLogsRes, coursesRes, profileRes] = await Promise.all([
      supabase.from("leads").select("*").eq("id", id).single(),
      supabase.from("lead_notes").select("*").eq("lead_id", id).order("created_at", { ascending: false }).limit(50),
      supabase.from("lead_followups").select("*").eq("lead_id", id).order("scheduled_at", { ascending: true }).limit(30),
      supabase.from("campus_visits").select("*").eq("lead_id", id).order("visit_date", { ascending: false }).limit(20),
      supabase.from("lead_activities").select("*").eq("lead_id", id).order("created_at", { ascending: false }).limit(50),
      supabase.from("campuses").select("id, name"),
      supabase.from("call_logs").select("*").eq("lead_id", id!).order("called_at", { ascending: false }).limit(20),
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
        autoTemplate = "ai_call_course_info";
        const campusLabel = campusName || "NIMT campus";
        autoParams = [lead.name, course, campusLabel, "https://www.nimt.ac.in/courses", "https://uni.nimt.ac.in/apply/nimt"];
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
    refetchQueue();

    // Show score animation
    const scoreInfo = DISPOSITION_POINTS[data.disposition];
    if (scoreInfo) {
      // Check if first contact bonus applies
      const isFirstContact = !lead.first_contact_at;
      const totalPoints = scoreInfo.points + (isFirstContact && scoreInfo.points > 0 ? 5 : 0);
      const totalLabel = isFirstContact && scoreInfo.points > 0
        ? `${scoreInfo.label} + First contact bonus`
        : scoreInfo.label;
      setScorePopup({ points: totalPoints, label: totalLabel, visible: true });
    }

    // 5. Chain to follow-up dialog if requested
    if (data.schedule_followup) {
      setShowFollowup(true);
    }
    // 6. Schedule visit inline if provided
    if (data.visit) {
      await scheduleVisit(data.visit);
    }

    // 7. Show next lead prompt (if not chaining to followup)
    if (!data.schedule_followup) {
      setLastDisposition(label);
      setShowNextLeadPrompt(true);
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
      // Supabase edge function gateway rejects ES256 user JWTs — send anon key instead.
      // The function receives the caller's user_id in the body for audit purposes.
      const { data: { user: currentUser } } = await supabase.auth.getUser();
      const { data, error } = await supabase.functions.invoke("voice-call", {
        body: { action: "outbound", lead_id: id, caller_user_id: currentUser?.id },
        headers: { Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}` },
      });

      if (error) {
        let detail = error.message;
        try {
          const ctx = (error as any).context as Response | undefined;
          if (ctx) {
            const rawText = await ctx.text().catch(() => "");
            try { detail = JSON.parse(rawText)?.error || rawText || error.message; } catch { detail = rawText || error.message; }
          }
        } catch { /* ignore */ }
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

      {/* Lead Queue Navigation Bar */}
      {buckets.length > 0 && (
        <div className="flex items-center gap-2 rounded-xl border border-border bg-card px-3 py-2 overflow-x-auto">
          <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide shrink-0">Queue:</span>
          {buckets.map(b => (
            <button
              key={b.key}
              onClick={() => {
                const next = b.leads.find(l => l.id !== id);
                if (next) navigate(`/admissions/${next.id}?action=call`);
              }}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium hover:bg-muted/50 transition-colors shrink-0"
              title={`${b.count} leads — click to go to next`}
            >
              <span className={`h-2 w-2 rounded-full ${b.color} shrink-0`} />
              {b.label}
              <span className="inline-flex h-4.5 min-w-[18px] items-center justify-center rounded-full bg-muted px-1 text-[10px] font-bold text-foreground">
                {b.count}
              </span>
            </button>
          ))}
          {nextLead && (
            <Button
              size="sm"
              className="ml-auto gap-1.5 text-xs shrink-0"
              onClick={() => navigate(`/admissions/${nextLead.id}?action=call`)}
            >
              <Phone className="h-3 w-3" />
              Call Next: {nextLead.name.split(" ")[0]}
              <ChevronRight className="h-3 w-3" />
            </Button>
          )}
        </div>
      )}

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
          { icon: Footprints, label: "Walk-in", color: "text-emerald-600 bg-emerald-100 dark:bg-emerald-900/30", action: () => setShowWalkinCompletion(true) },
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
          {/* What's Next — upcoming followups + visits (TOP priority) */}
          {(() => {
            const pendingFollowups = followups.filter((f: any) => f.status === "pending").sort((a: any, b: any) => new Date(a.scheduled_at).getTime() - new Date(b.scheduled_at).getTime());
            const upcomingVisits = visits.filter((v: any) => ["scheduled", "confirmed"].includes(v.status)).sort((a: any, b: any) => new Date(a.visit_date).getTime() - new Date(b.visit_date).getTime());
            if (pendingFollowups.length === 0 && upcomingVisits.length === 0) return null;

            return (
              <div className="rounded-xl border border-blue-200 dark:border-blue-800/40 bg-blue-50/50 dark:bg-blue-950/20 p-4 space-y-2.5">
                <h3 className="text-xs font-semibold text-blue-700 dark:text-blue-300 uppercase tracking-wide flex items-center gap-1.5">
                  <Calendar className="h-3.5 w-3.5" /> What's Next
                </h3>

                {pendingFollowups.map((f: any) => {
                  const dt = new Date(f.scheduled_at);
                  const isOverdue = dt < new Date();
                  const isToday = dt.toDateString() === new Date().toDateString();
                  return (
                    <div key={f.id} className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm ${isOverdue ? "bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800/40" : "bg-white dark:bg-card border border-border/50"}`}>
                      <div className={`flex h-7 w-7 items-center justify-center rounded-full shrink-0 ${isOverdue ? "bg-red-500" : isToday ? "bg-amber-500" : "bg-blue-500"} text-white`}>
                        <Phone className="h-3.5 w-3.5" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium text-foreground">
                          {f.type === "call" ? "Follow-up Call" : f.type === "visit" ? "Follow-up Visit" : `Follow-up (${f.type})`}
                        </p>
                        <p className={`text-[10px] ${isOverdue ? "text-red-600 font-semibold" : "text-muted-foreground"}`}>
                          {isOverdue ? "⚠️ Overdue — " : isToday ? "Today — " : ""}
                          {dt.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" })}
                          {f.notes && ` · ${f.notes}`}
                        </p>
                      </div>
                      {f.status === "pending" && (
                        <button
                          onClick={() => setShowCallDisposition(true)}
                          className="rounded-lg bg-primary px-2.5 py-1 text-[10px] font-medium text-white hover:bg-primary/90 shrink-0 flex items-center gap-1"
                        ><Phone className="h-2.5 w-2.5" /> Log Call</button>
                      )}
                    </div>
                  );
                })}

                {upcomingVisits.slice(0, 2).map((v: any) => {
                  const dt = new Date(v.visit_date);
                  const isToday = dt.toDateString() === new Date().toDateString();
                  const campusName = campuses.find((c: any) => c.id === v.campus_id)?.name || "Campus";
                  return (
                    <div key={v.id} className="flex items-center gap-3 rounded-lg bg-white dark:bg-card border border-border/50 px-3 py-2 text-sm">
                      <div className={`flex h-7 w-7 items-center justify-center rounded-full shrink-0 ${isToday ? "bg-violet-500" : "bg-violet-400"} text-white`}>
                        <MapPin className="h-3.5 w-3.5" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium text-foreground">Campus Visit</p>
                        <p className="text-[10px] text-muted-foreground">
                          {isToday ? "Today — " : ""}
                          {dt.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" })} at {dt.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true })} · {campusName}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })()}

          {/* AI Call Summary */}
          <AiCallSummary leadId={id!} />

          {/* Scheduled Visits with completion dialog */}
          <ScheduledVisitsSection
            visits={visits}
            campuses={campuses}
            courses={courses}
            leadId={id!}
            userId={user?.id || null}
            onRefresh={() => fetchAll(true)}
            showWalkin={showWalkinCompletion}
            onCloseWalkin={() => setShowWalkinCompletion(false)}
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
            onUpdateVisitStatus={async (vid, status, newDate) => {
              const updates: Record<string, any> = { status };
              if (newDate) updates.visit_date = newDate;
              await supabase.from("campus_visits").update(updates).eq("id", vid);
              await supabase.from("lead_activities").insert({
                lead_id: id!, user_id: user?.id || null, type: "visit",
                description: newDate
                  ? `Campus visit rescheduled to ${new Date(newDate).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}`
                  : `Campus visit status updated to ${status}`,
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

      {/* Score animation popup */}
      <ScorePopup
        points={scorePopup.points}
        label={scorePopup.label}
        visible={scorePopup.visible}
        onDone={() => setScorePopup(p => ({ ...p, visible: false }))}
      />

      {/* Next Lead Prompt — after call disposition */}
      {showNextLeadPrompt && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 w-[90%] max-w-lg animate-fade-in">
          <div className="rounded-xl border border-primary/20 bg-card shadow-lg px-5 py-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-green-100 dark:bg-green-900/30 shrink-0">
                <CheckCircle className="h-5 w-5 text-green-600" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-foreground">Call logged: {lastDisposition}</p>
                {nextLead ? (
                  <p className="text-xs text-muted-foreground mt-0.5 truncate">
                    Next: <span className="font-medium text-foreground">{nextLead.name}</span> — {nextLead.bucketName}
                  </p>
                ) : (
                  <p className="text-xs text-muted-foreground mt-0.5">No more leads in queue</p>
                )}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {nextLead && (
                  <Button
                    size="sm"
                    className="gap-1.5 text-xs"
                    onClick={() => {
                      setShowNextLeadPrompt(false);
                      navigate(`/admissions/${nextLead.id}?action=call`);
                    }}
                  >
                    <Phone className="h-3.5 w-3.5" />
                    Call Next
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-xs text-muted-foreground"
                  onClick={() => setShowNextLeadPrompt(false)}
                >
                  Stay
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

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

// ── Scheduled Visits Section with Completion Dialog ──────────────────
function ScheduledVisitsSection({ visits, campuses, courses, leadId, userId, onRefresh, showWalkin, onCloseWalkin }: {
  visits: any[]; campuses: any[]; courses: any[]; leadId: string; userId: string | null; onRefresh: () => void;
  showWalkin?: boolean; onCloseWalkin?: () => void;
}) {
  const { toast } = useToast();
  const [completingVisitId, setCompletingVisitId] = useState<string | null>(null);
  const [isWalkin, setIsWalkin] = useState(false);
  const [walkinCampusId, setWalkinCampusId] = useState(campuses[0]?.id || "");
  const [feedback, setFeedback] = useState("");
  const [courseInterest, setCourseInterest] = useState("");
  const [expectedAdmissionDate, setExpectedAdmissionDate] = useState("");
  const [followupType, setFollowupType] = useState<"call" | "visit">("call");
  const [followupDate, setFollowupDate] = useState("");
  const [saving, setSaving] = useState(false);

  // Open walk-in dialog when triggered from parent
  useEffect(() => {
    if (showWalkin) {
      setIsWalkin(true);
      setCompletingVisitId("walkin");
      setFeedback(""); setCourseInterest(""); setExpectedAdmissionDate(""); setFollowupDate("");
      setWalkinCampusId(campuses[0]?.id || "");
    }
  }, [showWalkin]);

  const scheduled = visits.filter((v: any) => ["scheduled", "confirmed"].includes(v.status));

  const completingVisit = completingVisitId && completingVisitId !== "walkin"
    ? visits.find((v: any) => v.id === completingVisitId)
    : null;

  // Max followup date: 3 days from visit date
  // Max followup: 3 days from visit date (or today for walk-ins)
  const visitDateForMax = completingVisit ? new Date(completingVisit.visit_date) : new Date();
  const maxFollowupDate = new Date(visitDateForMax.getTime() + 3 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const todayStr = new Date().toISOString().slice(0, 10);

  const handleComplete = async () => {
    if (!completingVisitId || !followupDate) {
      toast({ title: "Follow-up required", description: "Schedule a follow-up within 3 days of the visit.", variant: "destructive" });
      return;
    }
    setSaving(true);

    const feedbackText = [
      feedback ? `Feedback: ${feedback}` : "",
      courseInterest ? `Course Interest: ${courseInterest}` : "",
      expectedAdmissionDate ? `Expected Admission: ${expectedAdmissionDate}` : "",
    ].filter(Boolean).join("\n") || null;

    if (isWalkin) {
      // Walk-in: create a new campus_visits record as completed
      await supabase.from("campus_visits").insert({
        lead_id: leadId,
        campus_id: walkinCampusId || null,
        scheduled_by: userId,
        visit_date: new Date().toISOString(),
        status: "completed",
        visit_type: "walk_in",
        feedback: feedbackText,
      });
      await supabase.from("lead_activities").insert({
        lead_id: leadId, user_id: userId, type: "visit",
        description: `Walk-in visit recorded.${feedback ? ` Feedback: ${feedback}` : ""}${courseInterest ? ` Course interest: ${courseInterest}` : ""}`,
      });
    } else {
      // Scheduled visit: update existing record
      await supabase.from("campus_visits").update({
        status: "completed",
        feedback: feedbackText,
      }).eq("id", completingVisitId);
      await supabase.from("lead_activities").insert({
        lead_id: leadId, user_id: userId, type: "visit",
        description: `Campus visit completed.${feedback ? ` Feedback: ${feedback}` : ""}${courseInterest ? ` Course interest: ${courseInterest}` : ""}`,
      });
    }

    // Schedule mandatory follow-up
    await supabase.from("lead_followups").insert({
      lead_id: leadId,
      user_id: userId,
      scheduled_at: new Date(`${followupDate}T10:00:00`).toISOString(),
      type: followupType,
      notes: `Post-visit follow-up${feedback ? `. Visit feedback: ${feedback}` : ""}`,
      status: "pending",
    });

    await supabase.from("lead_activities").insert({
      lead_id: leadId, user_id: userId, type: "followup",
      description: `Post-visit follow-up (${followupType}) scheduled for ${new Date(followupDate).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}`,
    });

    toast({ title: isWalkin ? "Walk-in visit recorded" : "Visit completed", description: "Follow-up scheduled." });
    setSaving(false);
    setCompletingVisitId(null);
    setIsWalkin(false);
    setFeedback(""); setCourseInterest(""); setExpectedAdmissionDate(""); setFollowupDate("");
    if (onCloseWalkin) onCloseWalkin();
    onRefresh();
  };

  const inputCls = "w-full rounded-xl border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring/20";

  return (
    <>
      <div className="rounded-xl border border-violet-200 dark:border-violet-800/40 bg-violet-50/50 dark:bg-violet-950/20 p-4 space-y-3">
        <h3 className="text-xs font-semibold text-violet-700 dark:text-violet-300 uppercase tracking-wide flex items-center gap-1.5">
          <MapPin className="h-3.5 w-3.5" /> Scheduled Visits
        </h3>
        {scheduled.map((v: any) => {
          const visitDate = new Date(v.visit_date);
          const campusName = campuses.find((c: any) => c.id === v.campus_id)?.name || "Campus";
          return (
            <div key={v.id} className="flex items-center justify-between gap-3 rounded-lg bg-white dark:bg-card border border-border/50 px-3 py-2.5">
              <div className="min-w-0">
                <p className="text-sm font-medium text-foreground">
                  {visitDate.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" })} at {visitDate.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true })}
                </p>
                <p className="text-xs text-muted-foreground">{campusName}</p>
              </div>
              <div className="flex gap-1.5 shrink-0">
                <button
                  onClick={async () => {
                    const newDateStr = prompt("Enter new date/time (YYYY-MM-DD HH:MM):", visitDate.toISOString().slice(0, 16));
                    if (!newDateStr) return;
                    const newDate = new Date(newDateStr);
                    if (isNaN(newDate.getTime())) { toast({ title: "Invalid date", variant: "destructive" }); return; }
                    await supabase.from("campus_visits").update({ visit_date: newDate.toISOString(), status: "scheduled" }).eq("id", v.id);
                    await supabase.from("lead_activities").insert({
                      lead_id: leadId, user_id: userId, type: "visit",
                      description: `Visit rescheduled to ${newDate.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}`,
                    });
                    toast({ title: "Visit rescheduled" });
                    onRefresh();
                  }}
                  className="rounded-lg border border-input bg-card px-2.5 py-1 text-xs font-medium text-foreground hover:bg-muted"
                >Reschedule</button>
                <button
                  onClick={() => {
                    setCompletingVisitId(v.id);
                    setFollowupDate("");
                    setFeedback("");
                    setCourseInterest("");
                    setExpectedAdmissionDate("");
                  }}
                  className="rounded-lg bg-emerald-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-emerald-700"
                >Mark Complete</button>
                <button
                  onClick={async () => {
                    await supabase.from("campus_visits").update({ status: "no_show" }).eq("id", v.id);
                    await supabase.from("lead_activities").insert({
                      lead_id: leadId, user_id: userId, type: "visit", description: "Campus visit: student did not show up",
                    });
                    toast({ title: "Marked as no-show", description: "Schedule a follow-up to reschedule." });
                    onRefresh();
                  }}
                  className="rounded-lg border border-amber-200 px-2.5 py-1 text-xs font-medium text-amber-600 hover:bg-amber-50"
                >No Show</button>
                <button
                  onClick={async () => {
                    await supabase.from("campus_visits").update({ status: "cancelled" }).eq("id", v.id);
                    await supabase.from("lead_activities").insert({
                      lead_id: leadId, user_id: userId, type: "visit", description: "Campus visit cancelled",
                    });
                    toast({ title: "Visit cancelled" });
                    onRefresh();
                  }}
                  className="rounded-lg border border-red-200 px-2.5 py-1 text-xs font-medium text-red-600 hover:bg-red-50"
                >Cancel</button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Visit Completion Dialog */}
      <Dialog open={!!completingVisitId} onOpenChange={(o) => { if (!o) { setCompletingVisitId(null); setIsWalkin(false); if (onCloseWalkin) onCloseWalkin(); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {isWalkin ? <Footprints className="h-4 w-4 text-emerald-600" /> : <CheckCircle className="h-4 w-4 text-emerald-600" />}
              {isWalkin ? "Log Walk-in Visit" : "Complete Visit"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            {/* Campus selector for walk-ins */}
            {isWalkin && campuses.length > 0 && (
              <div>
                <label className="block text-[11px] font-medium text-muted-foreground mb-1">Campus *</label>
                <select value={walkinCampusId} onChange={(e) => setWalkinCampusId(e.target.value)} className={inputCls}>
                  {campuses.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
            )}
            <div>
              <label className="block text-[11px] font-medium text-muted-foreground mb-1">Candidate Feedback *</label>
              <textarea value={feedback} onChange={(e) => setFeedback(e.target.value)} rows={2}
                placeholder="How was the visit? What was the candidate's impression?"
                className={inputCls} />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-muted-foreground mb-1">Course Interested In</label>
              <select value={courseInterest} onChange={(e) => setCourseInterest(e.target.value)} className={inputCls}>
                <option value="">Select course</option>
                {courses.map((c: any) => <option key={c.id} value={c.name}>{c.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-[11px] font-medium text-muted-foreground mb-1">Expected Date of Admission</label>
              <div
                className={`${inputCls} relative flex items-center justify-between cursor-pointer`}
                onClick={() => (document.getElementById("expected-admission-date") as HTMLInputElement)?.showPicker?.()}
              >
                <span className={expectedAdmissionDate ? "text-foreground" : "text-muted-foreground"}>
                  {expectedAdmissionDate
                    ? (() => { const [y,m,d] = expectedAdmissionDate.split("-"); return `${d}/${m}/${y.slice(2)}`; })()
                    : "dd/mm/yy"}
                </span>
                <CalendarDays className="h-3.5 w-3.5 text-muted-foreground" />
                <input id="expected-admission-date" type="date" value={expectedAdmissionDate}
                  onChange={(e) => setExpectedAdmissionDate(e.target.value)}
                  min={todayStr} className="absolute inset-0 opacity-0 w-full h-full cursor-pointer" tabIndex={-1} />
              </div>
            </div>

            <div className="rounded-xl border border-emerald-200 dark:border-emerald-800/40 bg-emerald-50/50 dark:bg-emerald-950/20 p-3 space-y-3">
              <p className="text-xs font-semibold text-emerald-700 dark:text-emerald-300 uppercase tracking-wide">
                Mandatory Follow-up (within 3 days)
              </p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[10px] text-muted-foreground mb-1">Type</label>
                  <select value={followupType} onChange={(e) => setFollowupType(e.target.value as any)} className={inputCls}>
                    <option value="call">Call</option>
                    <option value="visit">Visit</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] text-muted-foreground mb-1">Date *</label>
                  <div
                    className={`${inputCls} relative flex items-center justify-between cursor-pointer`}
                    onClick={() => (document.getElementById("followup-date-picker") as HTMLInputElement)?.showPicker?.()}
                  >
                    <span className={followupDate ? "text-foreground" : "text-muted-foreground"}>
                      {followupDate
                        ? (() => { const [y,m,d] = followupDate.split("-"); return `${d}/${m}/${y.slice(2)}`; })()
                        : "dd/mm/yy"}
                    </span>
                    <input id="followup-date-picker" type="date" value={followupDate}
                      onChange={(e) => setFollowupDate(e.target.value)}
                      min={todayStr} max={maxFollowupDate}
                      className="absolute inset-0 opacity-0 w-full h-full cursor-pointer" tabIndex={-1} />
                  </div>
                </div>
              </div>
              {maxFollowupDate && (
                <p className="text-[10px] text-emerald-600">Follow-up must be by {new Date(maxFollowupDate).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}</p>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCompletingVisitId(null)}>Cancel</Button>
            <Button onClick={handleComplete} disabled={!followupDate || saving} className="gap-2 bg-emerald-600 hover:bg-emerald-700">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle className="h-4 w-4" />}
              {isWalkin ? "Save Walk-in & Schedule Follow-up" : "Complete & Schedule Follow-up"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export default LeadDetail;
