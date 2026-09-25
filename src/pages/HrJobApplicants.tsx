/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { UserPlus, MessageSquare, ExternalLink, Sparkles, Briefcase, CheckCircle2, XCircle, Clock, Search, CalendarClock, FileText, Star, ClipboardCheck, Upload, Mail, UserCog, UserCheck, MapPin, Ban, Download, LayoutGrid, List, History } from "lucide-react";
import { downloadCsv } from "@/lib/hrReports";
import { Card, CardContent } from "@/components/ui/card";
import { OrbLoader } from "@/components/ui/thinking-orb";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useToast } from "@/hooks/use-toast";
import { usePermissions } from "@/contexts/PermissionContext";

type Status = "all" | "new" | "reviewing" | "shortlisted" | "interview" | "offered" | "rejected" | "hired" | "withdrawn";

type CommStage = "acknowledgement" | "interview_invite" | "offer" | "regret";

const COMM_LABEL: Record<CommStage, string> = {
  acknowledgement: "Acknowledgement",
  interview_invite: "Interview invite",
  offer: "Offer",
  regret: "Regret",
};

const NONE = "__none__";

interface JobApplicantRow {
  id: string;
  lead_id: string;
  status: string;
  name: string | null;
  phone: string | null;
  desired_role: string | null;
  experience_years: number | null;
  resume_url: string | null;
  classification_source: string;
  ai_intent: string | null;
  ai_confidence: number | null;
  ai_reasoning: string | null;
  assigned_to: string | null;
  assigned_to_name: string | null;
  first_message_at: string | null;
  last_message_at: string | null;
  created_at: string;
  email: string | null;
  lead_source: string | null;
  last_message_preview: string | null;
  inbound_message_count: number | null;
  notes: string | null;
  rating: number | null;
  stage_changed_at: string | null;
  job_opening_id: string | null;
  job_opening_title: string | null;
  applied_via: string | null;
  cover_note: string | null;
  source_channel: string | null;
  source_message_id: string | null;
}

interface InterviewRow {
  id: string;
  scheduled_at: string;
  mode: string;
  status: string;
  location: string | null;
  meeting_link: string | null;
  rating: number | null;
  recommend: string | null;
  feedback_notes: string | null;
  feedback_at: string | null;
  duration_mins: number | null;
  panel: string[] | null;
  interviewer_id: string | null;
}

interface ProfileLite {
  user_id: string;
  display_name: string | null;
}

interface OptionRow {
  id: string;
  name: string;
}

interface HiringVenue {
  id: string | null;
  name: string | null;
  address: string | null;
  map_url: string | null;
  kind: string | null;
}

type Recommend = "strong_yes" | "yes" | "no" | "strong_no";

const RECOMMEND_LABEL: Record<string, string> = {
  strong_yes: "Strong yes",
  yes: "Yes",
  no: "No",
  strong_no: "Strong no",
};

const STATUS_TABS: { key: Status; label: string }[] = [
  { key: "all", label: "All" },
  { key: "new", label: "New" },
  { key: "reviewing", label: "Reviewing" },
  { key: "shortlisted", label: "Shortlisted" },
  { key: "interview", label: "Interview" },
  { key: "offered", label: "Offered" },
  { key: "hired", label: "Hired" },
  { key: "rejected", label: "Rejected" },
  { key: "withdrawn", label: "Withdrawn" },
];

const BOARD_STATUSES = ["new", "reviewing", "shortlisted", "interview", "offered", "hired"] as const;

const STATUS_BADGE: Record<string, string> = {
  new: "bg-pastel-blue text-foreground/80",
  reviewing: "bg-pastel-yellow text-foreground/80",
  shortlisted: "bg-pastel-purple text-foreground/80",
  interview: "bg-pastel-orange text-foreground/80",
  offered: "bg-pastel-mint text-foreground/80",
  hired: "bg-pastel-green text-foreground/80",
  rejected: "bg-pastel-red text-foreground/80",
  withdrawn: "bg-muted text-muted-foreground",
};

function formatExp(v: number | null): string {
  if (v == null) return "—";
  if (v < 1) return "<1 yr";
  return `${v} yr${v >= 2 ? "s" : ""}`;
}

function formatDate(s: string | null): string {
  if (!s) return "—";
  return new Date(s).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

function displayName(p: ProfileLite): string {
  return p.display_name || "Unnamed";
}

const HrJobApplicants = () => {
  const navigate = useNavigate();
  const { can } = usePermissions();
  const { toast } = useToast();
  const resumeInputRef = useRef<HTMLInputElement | null>(null);
  const canRecruit = can("hr", "recruitment_edit");
  const canInterview = can("hr", "interviews_edit") || canRecruit;
  const canOffer = can("hr", "documents_generate") || canRecruit;
  const [tab, setTab] = useState<Status>("new");
  const [items, setItems] = useState<JobApplicantRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [viewMode, setViewMode] = useState<"list" | "board">("list");
  const [timeline, setTimeline] = useState<Array<{ id: string; type: string; description: string; actor: string; created_at: string }>>([]);
  const [active, setActive] = useState<JobApplicantRow | null>(null);
  const [activeNotes, setActiveNotes] = useState("");
  const [activeRole, setActiveRole] = useState("");
  const [saving, setSaving] = useState(false);
  const [assignSaving, setAssignSaving] = useState(false);
  const [resumeUploading, setResumeUploading] = useState(false);
  const [commsSending, setCommsSending] = useState<CommStage | null>(null);

  // Reference data
  const [staff, setStaff] = useState<ProfileLite[]>([]);
  const [venues, setVenues] = useState<HiringVenue[]>([]);
  const [departments, setDepartments] = useState<OptionRow[]>([]);
  const [campuses, setCampuses] = useState<OptionRow[]>([]);

  // Interview scheduling
  const [interviews, setInterviews] = useState<InterviewRow[]>([]);
  const [showInterviewForm, setShowInterviewForm] = useState(false);
  const [interviewDateTime, setInterviewDateTime] = useState("");
  const [interviewMode, setInterviewMode] = useState<"in_person" | "phone" | "video">("in_person");
  const [interviewLocation, setInterviewLocation] = useState("");
  const [interviewMeetingLink, setInterviewMeetingLink] = useState("");
  const [interviewNotes, setInterviewNotes] = useState("");
  const [interviewInterviewerId, setInterviewInterviewerId] = useState("");
  const [interviewPanel, setInterviewPanel] = useState<string[]>([]);
  const [interviewDuration, setInterviewDuration] = useState("30");
  const [interviewVenueId, setInterviewVenueId] = useState("");
  const [interviewSaving, setInterviewSaving] = useState(false);

  // Interview feedback
  const [feedbackFor, setFeedbackFor] = useState<string | null>(null);
  const [feedbackRating, setFeedbackRating] = useState(0);
  const [feedbackRecommend, setFeedbackRecommend] = useState<Recommend | "">("");
  const [feedbackNotes, setFeedbackNotes] = useState("");
  const [feedbackSaving, setFeedbackSaving] = useState(false);

  // Offer letter
  const [showOfferForm, setShowOfferForm] = useState(false);
  const [offerRole, setOfferRole] = useState("");
  const [offerCtc, setOfferCtc] = useState("");
  const [offerJoiningDate, setOfferJoiningDate] = useState("");
  const [offerLegalEntity, setOfferLegalEntity] = useState("");
  const [offerSaving, setOfferSaving] = useState(false);

  // Convert to employee
  const [showHireForm, setShowHireForm] = useState(false);
  const [hireJoiningDate, setHireJoiningDate] = useState("");
  const [hireCtc, setHireCtc] = useState("");
  const [hireJobTitle, setHireJobTitle] = useState("");
  const [hireDepartmentId, setHireDepartmentId] = useState("");
  const [hireCampusId, setHireCampusId] = useState("");
  const [hireSaving, setHireSaving] = useState(false);

  useEffect(() => { loadRefData(); }, []);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { fetchAll(); }, [tab]);

  async function loadRefData() {
    const [profilesRes, venuesRes, deptRes, campusRes] = await Promise.all([
      supabase.from("profiles").select("user_id, display_name").order("display_name"),
      supabase.from("hiring_venues" as any).select("id, name, address, map_url, kind").order("name"),
      supabase.from("departments").select("id, name").order("name"),
      supabase.from("campuses").select("id, name").order("name"),
    ]);
    setStaff(((profilesRes.data as any[]) || []).filter(p => p.user_id));
    setVenues((venuesRes.data as any[]) || []);
    setDepartments((deptRes.data as any[]) || []);
    setCampuses((campusRes.data as any[]) || []);
  }

  async function fetchAll() {
    setLoading(true);

    let query = supabase
      .from("job_applicants_inbox" as any)
      .select("*")
      .order("last_message_at", { ascending: false, nullsFirst: false });

    if (tab !== "all") query = query.eq("status", tab);

    const { data, error } = await query;
    if (error) {
      console.error(error);
      toast({ title: "Failed to load", description: error.message, variant: "destructive" });
      setItems([]);
    } else {
      setItems((data as any[]) || []);
    }

    // Counts per status
    const { data: countRows } = await supabase
      .from("job_applicants" as any)
      .select("status");
    const c: Record<string, number> = { all: 0 };
    for (const r of (countRows as any[]) || []) {
      c.all = (c.all || 0) + 1;
      c[r.status] = (c[r.status] || 0) + 1;
    }
    setCounts(c);

    setLoading(false);
  }

  const filtered = useMemo(() => {
    if (!search.trim()) return items;
    const q = search.toLowerCase();
    return items.filter(r =>
      (r.name || "").toLowerCase().includes(q)
      || (r.phone || "").toLowerCase().includes(q)
      || (r.desired_role || "").toLowerCase().includes(q)
      || (r.job_opening_title || "").toLowerCase().includes(q)
      || (r.assigned_to_name || "").toLowerCase().includes(q)
      || (r.last_message_preview || "").toLowerCase().includes(q)
    );
  }, [items, search]);

  function openDetail(row: JobApplicantRow) {
    setActive(row);
    setActiveNotes(row.notes || "");
    setActiveRole(row.desired_role || "");
    setShowInterviewForm(false);
    setInterviewDateTime("");
    setInterviewMode("in_person");
    setInterviewLocation("");
    setInterviewMeetingLink("");
    setInterviewNotes("");
    setInterviewInterviewerId("");
    setInterviewPanel([]);
    setInterviewDuration("30");
    setInterviewVenueId("");
    setFeedbackFor(null);
    setFeedbackRating(0);
    setFeedbackRecommend("");
    setFeedbackNotes("");
    setShowOfferForm(false);
    setOfferRole(row.desired_role || "");
    setOfferCtc("");
    setOfferJoiningDate("");
    setOfferLegalEntity("");
    setShowHireForm(false);
    setHireJoiningDate("");
    setHireCtc("");
    setHireJobTitle(row.desired_role || "");
    setHireDepartmentId("");
    setHireCampusId("");
    setInterviews([]);
    setTimeline([]);
    fetchInterviews(row.id);
    fetchTimeline(row.id);
  }

  async function fetchTimeline(applicantId: string) {
    const { data } = await supabase.rpc("job_applicant_timeline" as any, { _applicant_id: applicantId });
    setTimeline((data as any[]) || []);
  }

  function exportCsv() {
    if (filtered.length === 0) {
      toast({ title: "Nothing to export", description: "No applicants in this view." });
      return;
    }
    downloadCsv(
      `job-applicants-${tab}-${new Date().toISOString().slice(0, 10)}.csv`,
      filtered.map((r) => ({
        name: r.name ?? "",
        phone: r.phone ?? "",
        email: r.email ?? "",
        desired_role: r.desired_role ?? "",
        status: r.status,
        applied_via: r.applied_via ?? "",
        job_opening: r.job_opening_title ?? "",
        experience_years: r.experience_years ?? "",
        assigned_to: r.assigned_to_name ?? "",
        stage_changed_at: r.stage_changed_at ?? "",
        created_at: r.created_at,
      })),
    );
  }

  async function fetchInterviews(applicantId: string) {
    const { data, error } = await supabase
      .from("interviews" as any)
      .select("id, scheduled_at, mode, status, location, meeting_link, rating, recommend, feedback_notes, feedback_at, duration_mins, panel, interviewer_id")
      .eq("job_applicant_id", applicantId)
      .order("scheduled_at", { ascending: false });
    if (error) {
      console.error(error);
      return;
    }
    setInterviews((data as any[]) || []);
  }

  async function moveApplicant(id: string, status: string) {
    setSaving(true);
    const { error } = await supabase.rpc("move_job_applicant" as any, {
      _applicant_id: id,
      _status: status,
      _note: null,
    });
    setSaving(false);
    if (error) {
      toast({ title: "Update failed", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Updated", description: `Status changed to ${status}` });
    setActive(null);
    fetchAll();
  }

  async function assignApplicant(userId: string | null) {
    if (!active) return;
    setAssignSaving(true);
    const { error } = await supabase.rpc("assign_job_applicant" as any, {
      _applicant_id: active.id,
      _user_id: userId,
    });
    setAssignSaving(false);
    if (error) {
      toast({ title: "Assignment failed", description: error.message, variant: "destructive" });
      return;
    }
    const name = userId ? staff.find(s => s.user_id === userId)?.display_name || "recruiter" : null;
    setActive({ ...active, assigned_to: userId, assigned_to_name: name });
    toast({ title: userId ? `Assigned to ${name}` : "Unassigned" });
    fetchAll();
  }

  async function uploadResume(file: File) {
    if (!active) return;
    setResumeUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("filename", file.name);
      fd.append("prefix", `resumes/${active.id}`);
      const { data, error } = await supabase.functions.invoke("r2-upload", { body: fd });
      if (error) throw new Error(error.message || "Upload failed");
      const url = (data as { url?: string; error?: string } | null)?.url;
      if (!url) throw new Error((data as { error?: string } | null)?.error || "Upload returned no URL");

      const { error: updErr } = await supabase
        .from("job_applicants" as any)
        .update({ resume_url: url })
        .eq("id", active.id);
      if (updErr) throw updErr;

      setActive({ ...active, resume_url: url });
      toast({ title: "Resume uploaded" });
      fetchAll();
    } catch (e: any) {
      toast({ title: "Resume upload failed", description: String(e?.message || e), variant: "destructive" });
    } finally {
      setResumeUploading(false);
      if (resumeInputRef.current) resumeInputRef.current.value = "";
    }
  }

  async function scheduleInterview() {
    if (!active || !interviewDateTime) return;
    setInterviewSaving(true);
    const { error } = await supabase.rpc("schedule_job_interview" as any, {
      _applicant_id: active.id,
      _scheduled_at: new Date(interviewDateTime).toISOString(),
      _mode: interviewMode,
      _location: interviewLocation || null,
      _meeting_link: interviewMeetingLink || null,
      _interviewer_id: interviewInterviewerId || null,
      _panel: interviewPanel,
      _duration_mins: interviewDuration ? Number(interviewDuration) : null,
      _notes: interviewNotes || null,
    });
    setInterviewSaving(false);
    if (error) {
      toast({ title: "Failed to schedule interview", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Interview scheduled" });
    setShowInterviewForm(false);
    setInterviewDateTime("");
    setInterviewLocation("");
    setInterviewMeetingLink("");
    setInterviewNotes("");
    setInterviewInterviewerId("");
    setInterviewPanel([]);
    setInterviewDuration("30");
    setInterviewVenueId("");
    setActive(a => (a ? { ...a, status: "interview" } : a));
    fetchInterviews(active.id);
    fetchAll();
  }

  async function submitFeedback() {
    if (!active || !feedbackFor || !feedbackRating || !feedbackRecommend) return;
    setFeedbackSaving(true);
    const { error } = await supabase.rpc("record_interview_feedback" as any, {
      _interview_id: feedbackFor,
      _rating: feedbackRating,
      _recommend: feedbackRecommend,
      _notes: feedbackNotes || null,
    });
    setFeedbackSaving(false);
    if (error) {
      toast({ title: "Failed to record feedback", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Feedback recorded" });
    setFeedbackFor(null);
    setFeedbackRating(0);
    setFeedbackRecommend("");
    setFeedbackNotes("");
    fetchInterviews(active.id);
  }

  async function generateOfferLetter() {
    if (!active) return;
    setOfferSaving(true);
    const { error } = await supabase.rpc("generate_hr_offer_letter" as any, {
      _job_applicant_id: active.id,
      _details: {
        offered_role: offerRole || active.desired_role || null,
        offered_ctc: offerCtc || null,
        joining_date: offerJoiningDate || null,
        legal_entity: offerLegalEntity || null,
      },
    });
    setOfferSaving(false);
    if (error) {
      toast({ title: "Failed to generate offer letter", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Offer letter submitted for approval", description: "Applicant moved to offered." });
    setShowOfferForm(false);
    setActive({ ...active, status: "offered" });
    fetchAll();
  }

  async function hireApplicant() {
    if (!active || !hireJoiningDate) return;
    setHireSaving(true);
    const { error } = await supabase.rpc("hire_job_applicant" as any, {
      _applicant_id: active.id,
      _joining_date: hireJoiningDate,
      _ctc_annual: hireCtc ? Number(hireCtc) : null,
      _job_title: hireJobTitle || active.desired_role || null,
      _department_id: hireDepartmentId || null,
      _campus_id: hireCampusId || null,
    });
    setHireSaving(false);
    if (error) {
      toast({ title: "Failed to convert to employee", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Converted to employee", description: "The applicant is now on the employee roster." });
    setShowHireForm(false);
    setActive(null);
    fetchAll();
  }

  async function sendEmail(stage: CommStage) {
    if (!active) return;
    const interviewId = stage === "interview_invite" ? interviews[0]?.id ?? null : null;
    if (stage === "interview_invite" && !interviewId) {
      toast({
        title: "Schedule an interview first",
        description: "There is no interview to send an invite for.",
        variant: "destructive",
      });
      return;
    }
    setCommsSending(stage);
    const { data, error } = await supabase.functions.invoke("hiring-notify", {
      body: { applicant_id: active.id, stage, interview_id: interviewId },
    });
    setCommsSending(null);
    if (error) {
      toast({ title: "Email failed", description: error.message || "Could not send the email.", variant: "destructive" });
      return;
    }
    if ((data as { skipped?: string } | null)?.skipped === "already_sent") {
      toast({ title: "Already sent", description: `${COMM_LABEL[stage]} email was sent to this candidate earlier.` });
      return;
    }
    toast({ title: "Email sent", description: `Sent the ${COMM_LABEL[stage].toLowerCase()} email.` });
  }

  async function saveDetails() {
    if (!active) return;
    setSaving(true);
    const patch: any = {};
    if (activeRole && activeRole !== (active.desired_role || "")) patch.desired_role = activeRole;
    if (activeNotes !== (active.notes || "")) patch.notes = activeNotes || null;
    if (Object.keys(patch).length === 0) { setSaving(false); return; }

    const { error } = await supabase
      .from("job_applicants" as any)
      .update(patch)
      .eq("id", active.id);
    setSaving(false);
    if (error) {
      toast({ title: "Save failed", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Saved" });
    setActive({ ...active, ...patch });
    fetchAll();
  }

  const canSave = activeNotes !== (active?.notes || "")
    || activeRole !== (active?.desired_role || "");

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <UserPlus className="h-6 w-6" /> Job Applicants
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            People who reached out about employment via WhatsApp — auto-categorized and routed here.
          </p>
        </div>
      </div>

      {/* Status tabs */}
      <div className="flex flex-wrap items-center gap-1 border-b border-border pb-1">
        {STATUS_TABS.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-3 py-1.5 text-[12.5px] font-medium rounded-md transition-colors ${
              tab === t.key
                ? "bg-foreground text-background"
                : "text-muted-foreground hover:bg-muted/50"
            }`}
          >
            {t.label}
            {counts[t.key] != null && (
              <span className={`ml-2 inline-flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-semibold ${
                tab === t.key ? "bg-background/20 text-background" : "bg-muted-foreground/15 text-muted-foreground"
              }`}>{counts[t.key]}</span>
            )}
          </button>
        ))}
        <div className="ml-auto flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search name, phone, role..."
              className="h-8 w-[240px] rounded-md border border-border bg-background pl-8 pr-3 text-[12.5px] focus:outline-none focus:ring-2 focus:ring-ring/20"
            />
          </div>
          <div className="flex items-center gap-0.5 rounded-md border border-border p-0.5">
            <button
              onClick={() => setViewMode("list")}
              title="List view"
              className={`rounded p-1.5 ${viewMode === "list" ? "bg-foreground text-background" : "text-muted-foreground hover:bg-muted/50"}`}
            >
              <List className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={() => setViewMode("board")}
              title="Board view"
              className={`rounded p-1.5 ${viewMode === "board" ? "bg-foreground text-background" : "text-muted-foreground hover:bg-muted/50"}`}
            >
              <LayoutGrid className="h-3.5 w-3.5" />
            </button>
          </div>
          <Button size="sm" variant="outline" className="h-8 gap-1.5 text-xs" onClick={exportCsv}>
            <Download className="h-3.5 w-3.5" /> Export
          </Button>
        </div>
      </div>

      {/* Board / List */}
      {viewMode === "board" ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          {BOARD_STATUSES.map((status) => {
            const rows = filtered.filter((r) => r.status === status);
            return (
              <div key={status} className="rounded-xl border border-border bg-muted/20">
                <div className="flex items-center justify-between border-b border-border px-3 py-2">
                  <span className="text-xs font-semibold capitalize text-foreground">{status}</span>
                  <span className="text-[10px] text-muted-foreground">{rows.length}</span>
                </div>
                <div className="space-y-2 p-2">
                  {rows.length === 0 ? (
                    <p className="px-1 py-3 text-center text-[11px] text-muted-foreground">—</p>
                  ) : rows.map((r) => (
                    <button
                      key={r.id}
                      onClick={() => openDetail(r)}
                      className="w-full rounded-lg border border-border bg-card p-2.5 text-left transition-colors hover:bg-muted/40"
                    >
                      <p className="truncate text-[13px] font-medium text-foreground">{r.name || "—"}</p>
                      <p className="truncate text-[11px] text-muted-foreground">{r.desired_role || r.job_opening_title || "—"}</p>
                      <p className="mt-1 truncate text-[10px] text-muted-foreground capitalize">{r.applied_via || r.lead_source || ""}</p>
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
      <Card className="border-border/60 shadow-none overflow-hidden">
        <CardContent className="p-0">
          {loading ? (
            <div className="flex h-48 items-center justify-center">
              <OrbLoader state="searching" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <Briefcase className="h-10 w-10 text-muted-foreground/40 mb-2" />
              <p className="text-sm text-muted-foreground">No applicants in this view.</p>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/20">
                  <th className="text-left px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Applicant</th>
                  <th className="text-left px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Role</th>
                  <th className="text-left px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Exp</th>
                  <th className="text-left px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Last message</th>
                  <th className="text-left px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Source</th>
                  <th className="text-left px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Received</th>
                  <th className="text-left px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Assignee</th>
                  <th className="text-left px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(r => (
                  <tr key={r.id} className="border-b border-border last:border-0 hover:bg-muted/30 cursor-pointer" onClick={() => openDetail(r)}>
                    <td className="px-4 py-3">
                      <div className="flex flex-col">
                        <span className="font-medium text-foreground">{r.name || "—"}</span>
                        <span className="text-[11px] text-muted-foreground font-mono">{r.phone || "—"}</span>
                        {r.rating != null && r.rating > 0 && (
                          <span className="mt-0.5 inline-flex items-center gap-0.5" title={`Rating ${r.rating}/5`}>
                            {[1, 2, 3, 4, 5].map(n => (
                              <Star key={n} className={`h-2.5 w-2.5 ${n <= (r.rating || 0) ? "fill-amber-400 text-amber-400" : "text-muted-foreground/40"}`} />
                            ))}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-col">
                        <span className="text-foreground/80">{r.desired_role || <span className="text-muted-foreground">—</span>}</span>
                        {r.job_opening_title && <span className="text-[11px] text-muted-foreground">{r.job_opening_title}</span>}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-foreground/80">{formatExp(r.experience_years)}</td>
                    <td className="px-4 py-3 max-w-[280px]">
                      <p className="truncate text-foreground/80" title={r.last_message_preview || ""}>
                        {r.last_message_preview || <span className="text-muted-foreground">—</span>}
                      </p>
                      {r.inbound_message_count != null && r.inbound_message_count > 1 && (
                        <span className="text-[10px] text-muted-foreground">{r.inbound_message_count} messages</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-col gap-0.5">
                        {r.classification_source === "llm" ? (
                          <Badge className="bg-pastel-purple text-foreground/80 border-0 text-[10px] w-fit" title={r.ai_reasoning || ""}>
                            <Sparkles className="h-2.5 w-2.5 mr-1" /> AI
                            {r.ai_confidence != null && ` ${(r.ai_confidence * 100).toFixed(0)}%`}
                          </Badge>
                        ) : r.classification_source === "regex" ? (
                          <Badge className="bg-muted text-muted-foreground border-0 text-[10px] w-fit">Auto</Badge>
                        ) : r.classification_source === "manual" ? (
                          <Badge className="bg-pastel-blue text-foreground/80 border-0 text-[10px] w-fit">Manual</Badge>
                        ) : (
                          <Badge className="bg-muted text-muted-foreground border-0 text-[10px] w-fit">{r.classification_source}</Badge>
                        )}
                        {(r.applied_via || r.cover_note) && (
                          <span className="text-[10px] text-muted-foreground capitalize">{r.applied_via || "note"}</span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-[12px] text-muted-foreground">{formatDate(r.last_message_at || r.created_at)}</td>
                    <td className="px-4 py-3 text-[12.5px] text-foreground/80">{r.assigned_to_name || <span className="text-muted-foreground">—</span>}</td>
                    <td className="px-4 py-3">
                      <Badge className={`${STATUS_BADGE[r.status] || "bg-muted text-muted-foreground"} border-0 text-[10px] capitalize`}>{r.status}</Badge>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-2">
                        {r.resume_url && (
                          <a
                            href={r.resume_url}
                            target="_blank"
                            rel="noreferrer"
                            onClick={e => e.stopPropagation()}
                            className="text-muted-foreground hover:text-foreground"
                            title="Open resume"
                          >
                            <FileText className="h-4 w-4" />
                          </a>
                        )}
                        <button
                          onClick={(e) => { e.stopPropagation(); navigate(`/whatsapp-inbox?phone=${encodeURIComponent(r.phone || "")}`); }}
                          className="text-muted-foreground hover:text-foreground"
                          title="Open conversation"
                        >
                          <MessageSquare className="h-4 w-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
      )}

      {/* Detail dialog */}
      <Dialog open={!!active} onOpenChange={(open) => !open && setActive(null)}>
        <DialogContent className="max-w-2xl">
          {active && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <UserPlus className="h-5 w-5" /> {active.name || active.phone || "Applicant"}
                  <Badge className={`${STATUS_BADGE[active.status] || "bg-muted text-muted-foreground"} border-0 text-[10px] capitalize ml-1`}>{active.status}</Badge>
                </DialogTitle>
              </DialogHeader>

              <div className="space-y-4 text-sm">
                <div className="grid grid-cols-2 gap-3">
                  <div><label className="text-[11px] uppercase tracking-wide text-muted-foreground">Phone</label><p className="font-mono">{active.phone || "—"}</p></div>
                  <div><label className="text-[11px] uppercase tracking-wide text-muted-foreground">Email</label><p>{active.email || "—"}</p></div>
                  <div><label className="text-[11px] uppercase tracking-wide text-muted-foreground">Applied via</label><p className="capitalize">{active.applied_via || active.source_channel || "—"}</p></div>
                  <div><label className="text-[11px] uppercase tracking-wide text-muted-foreground">Job opening</label><p>{active.job_opening_title || "—"}</p></div>
                  <div><label className="text-[11px] uppercase tracking-wide text-muted-foreground">First contact</label><p>{formatDate(active.first_message_at)}</p></div>
                  <div><label className="text-[11px] uppercase tracking-wide text-muted-foreground">Last message</label><p>{formatDate(active.last_message_at)}</p></div>
                  <div><label className="text-[11px] uppercase tracking-wide text-muted-foreground">Experience</label><p>{formatExp(active.experience_years)}</p></div>
                  <div><label className="text-[11px] uppercase tracking-wide text-muted-foreground">Stage changed</label><p>{formatDate(active.stage_changed_at)}</p></div>
                </div>

                {/* Assignment */}
                <div className="flex items-end gap-2">
                  <div className="flex-1">
                    <label className="text-[11px] uppercase tracking-wide text-muted-foreground flex items-center gap-1"><UserCog className="h-3 w-3" /> Assigned to</label>
                    <Select
                      value={active.assigned_to || NONE}
                      onValueChange={v => assignApplicant(v === NONE ? null : v)}
                      disabled={!canRecruit || assignSaving}
                    >
                      <SelectTrigger className="mt-1 h-9"><SelectValue placeholder="Unassigned" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value={NONE}>Unassigned</SelectItem>
                        {staff.map(s => (
                          <SelectItem key={s.user_id} value={s.user_id}>{displayName(s)}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                {/* Resume */}
                <div className="flex items-center gap-2">
                  <label className="text-[11px] uppercase tracking-wide text-muted-foreground">Resume</label>
                  {active.resume_url ? (
                    <a href={active.resume_url} target="_blank" rel="noreferrer" className="text-primary hover:underline inline-flex items-center gap-1 text-[12.5px]">
                      <FileText className="h-3.5 w-3.5" /> View resume
                    </a>
                  ) : (
                    <span className="text-[12.5px] text-muted-foreground">Not uploaded</span>
                  )}
                  {canRecruit && (
                    <>
                      <input
                        ref={resumeInputRef}
                        type="file"
                        accept=".pdf,.doc,.docx"
                        className="hidden"
                        onChange={e => { const f = e.target.files?.[0]; if (f) uploadResume(f); }}
                      />
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 px-2 text-[11px]"
                        disabled={resumeUploading}
                        onClick={() => resumeInputRef.current?.click()}
                      >
                        <Upload className="h-3 w-3 mr-1" /> {resumeUploading ? "Uploading…" : active.resume_url ? "Replace" : "Upload resume"}
                      </Button>
                    </>
                  )}
                </div>

                {active.cover_note && (
                  <div>
                    <label className="text-[11px] uppercase tracking-wide text-muted-foreground">Cover note</label>
                    <p className="rounded-md bg-muted/30 px-3 py-2 mt-1 whitespace-pre-wrap">{active.cover_note}</p>
                  </div>
                )}

                {active.ai_reasoning && (
                  <div className="rounded-lg border border-border bg-muted/20 p-3">
                    <p className="text-[11px] uppercase tracking-wide text-muted-foreground flex items-center gap-1.5 mb-1">
                      <Sparkles className="h-3 w-3" /> Why we routed this here
                    </p>
                    <p className="text-foreground/90 italic">{active.ai_reasoning}</p>
                    {active.ai_confidence != null && (
                      <p className="text-[10px] text-muted-foreground mt-1">Model confidence: {(active.ai_confidence * 100).toFixed(0)}%</p>
                    )}
                  </div>
                )}

                <div>
                  <label className="text-[11px] uppercase tracking-wide text-muted-foreground">Last message</label>
                  <p className="rounded-md bg-muted/30 px-3 py-2 mt-1">{active.last_message_preview || "—"}</p>
                </div>

                <div>
                  <label className="text-[11px] uppercase tracking-wide text-muted-foreground">Desired role</label>
                  <input
                    value={activeRole}
                    onChange={e => setActiveRole(e.target.value)}
                    placeholder="e.g. Faculty - Nursing"
                    className="mt-1 h-9 w-full rounded-md border border-border bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring/20"
                  />
                </div>

                <div>
                  <label className="text-[11px] uppercase tracking-wide text-muted-foreground">Notes</label>
                  <Textarea
                    value={activeNotes}
                    onChange={e => setActiveNotes(e.target.value)}
                    placeholder="Add notes from screening..."
                    className="mt-1"
                    rows={3}
                  />
                </div>

                {/* Stage moves */}
                <div className="flex flex-wrap items-center gap-2 pt-2">
                  {canRecruit && (
                    <>
                      <Button size="sm" variant="outline" onClick={() => moveApplicant(active.id, "reviewing")} disabled={saving}>
                        <Clock className="h-3.5 w-3.5 mr-1" /> Mark reviewing
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => moveApplicant(active.id, "shortlisted")} disabled={saving}>
                        <CheckCircle2 className="h-3.5 w-3.5 mr-1" /> Shortlist
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => moveApplicant(active.id, "offered")} disabled={saving}>
                        <FileText className="h-3.5 w-3.5 mr-1" /> Mark offered
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => moveApplicant(active.id, "rejected")} disabled={saving}>
                        <XCircle className="h-3.5 w-3.5 mr-1" /> Reject
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => moveApplicant(active.id, "withdrawn")} disabled={saving}>
                        <Ban className="h-3.5 w-3.5 mr-1" /> Withdraw
                      </Button>
                    </>
                  )}
                  {canInterview && (
                    <Button size="sm" variant="outline" onClick={() => setShowInterviewForm(v => !v)}>
                      <CalendarClock className="h-3.5 w-3.5 mr-1" /> Schedule interview
                    </Button>
                  )}
                  {canOffer && (
                    <Button size="sm" variant="outline" onClick={() => setShowOfferForm(v => !v)}>
                      <FileText className="h-3.5 w-3.5 mr-1" /> Generate offer letter
                    </Button>
                  )}
                  {canRecruit && (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button size="sm" variant="outline" disabled={!!commsSending}>
                          <Mail className="h-3.5 w-3.5 mr-1" /> {commsSending ? "Sending…" : "Send email"}
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="start">
                        {(Object.keys(COMM_LABEL) as CommStage[]).map(stage => (
                          <DropdownMenuItem key={stage} onSelect={() => sendEmail(stage)}>
                            {COMM_LABEL[stage]}
                          </DropdownMenuItem>
                        ))}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                  {canRecruit && (
                    <Button
                      size="sm"
                      variant={active.status === "offered" || active.status === "hired" ? "default" : "outline"}
                      onClick={() => setShowHireForm(true)}
                    >
                      <UserCheck className="h-3.5 w-3.5 mr-1" /> Convert to employee
                    </Button>
                  )}
                  <Button size="sm" variant="outline" asChild>
                    <Link to={`/whatsapp-inbox?phone=${encodeURIComponent(active.phone || "")}`}>
                      <MessageSquare className="h-3.5 w-3.5 mr-1" /> Open chat
                    </Link>
                  </Button>
                  <Button size="sm" variant="outline" asChild>
                    <Link to={`/admissions/${active.lead_id}`}>
                      <ExternalLink className="h-3.5 w-3.5 mr-1" /> View lead record
                    </Link>
                  </Button>
                  {canRecruit && (
                    <div className="ml-auto">
                      <Button size="sm" onClick={saveDetails} disabled={saving || !canSave}>
                        Save
                      </Button>
                    </div>
                  )}
                </div>

                {/* Activity timeline */}
                {timeline.length > 0 && (
                  <div className="rounded-lg border border-border bg-muted/20 p-3 space-y-2">
                    <p className="text-[11px] uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
                      <History className="h-3 w-3" /> Activity
                    </p>
                    <div className="space-y-1.5 max-h-48 overflow-y-auto">
                      {timeline.map((t) => (
                        <div key={t.id} className="flex items-start gap-2 text-[12px]">
                          <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary/60" />
                          <div className="min-w-0">
                            <p className="text-foreground">{t.description}</p>
                            <p className="text-[10px] text-muted-foreground">{t.actor} · {formatDate(t.created_at)}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {interviews.length > 0 && (
                  <div className="rounded-lg border border-border bg-muted/20 p-3 space-y-2">
                    <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Scheduled interviews</p>
                    {interviews.map(iv => (
                      <div key={iv.id} className="space-y-2 border-b border-border/50 pb-2 last:border-0 last:pb-0">
                        <div className="flex items-center justify-between text-[12.5px]">
                          <span>
                            {new Date(iv.scheduled_at).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}
                            {" · "}<span className="capitalize">{iv.mode.replace("_", " ")}</span>
                            {" · "}<span className="capitalize text-muted-foreground">{iv.status}</span>
                            {iv.duration_mins != null && (
                              <>{ " · " }<span className="text-muted-foreground">{iv.duration_mins} min</span></>
                            )}
                          </span>
                          <div className="flex items-center gap-1">
                            {canInterview && iv.status === "scheduled" && (
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-6 px-2 text-[11px]"
                                onClick={() => {
                                  setFeedbackFor(feedbackFor === iv.id ? null : iv.id);
                                  setFeedbackRating(iv.rating || 0);
                                  setFeedbackRecommend((iv.recommend as Recommend) || "");
                                  setFeedbackNotes(iv.feedback_notes || "");
                                }}
                              >
                                <ClipboardCheck className="h-3 w-3 mr-1" /> Record feedback
                              </Button>
                            )}
                          </div>
                        </div>

                        {iv.location && (
                          <p className="flex items-center gap-1 text-[11.5px] text-muted-foreground">
                            <MapPin className="h-3 w-3" /> {iv.location}
                          </p>
                        )}

                        {iv.rating != null && (
                          <div className="flex items-center gap-2 text-[11.5px] text-muted-foreground">
                            <span className="inline-flex items-center gap-0.5" title={`Rating ${iv.rating}/5`}>
                              {[1, 2, 3, 4, 5].map(n => (
                                <Star
                                  key={n}
                                  className={`h-3 w-3 ${n <= (iv.rating || 0) ? "fill-amber-400 text-amber-400" : "text-muted-foreground/40"}`}
                                />
                              ))}
                            </span>
                            {iv.recommend && (
                              <Badge className="bg-pastel-blue text-foreground/80 border-0 text-[10px]">
                                {RECOMMEND_LABEL[iv.recommend] || iv.recommend}
                              </Badge>
                            )}
                            {iv.feedback_notes && <span className="italic">“{iv.feedback_notes}”</span>}
                          </div>
                        )}

                        {feedbackFor === iv.id && (
                          <div className="rounded-md border border-border bg-background p-3 space-y-3">
                            <div className="grid grid-cols-2 gap-3">
                              <div>
                                <label className="text-[11px] uppercase tracking-wide text-muted-foreground">Rating</label>
                                <div className="mt-1.5 flex items-center gap-1">
                                  {[1, 2, 3, 4, 5].map(n => (
                                    <button
                                      key={n}
                                      type="button"
                                      onClick={() => setFeedbackRating(n)}
                                      className="p-0.5"
                                      aria-label={`Rate ${n} of 5`}
                                    >
                                      <Star className={`h-4 w-4 ${n <= feedbackRating ? "fill-amber-400 text-amber-400" : "text-muted-foreground/40"}`} />
                                    </button>
                                  ))}
                                  <span className="ml-1 text-[11.5px] text-muted-foreground">{feedbackRating || "—"}/5</span>
                                </div>
                              </div>
                              <div>
                                <label className="text-[11px] uppercase tracking-wide text-muted-foreground">Recommendation</label>
                                <select
                                  value={feedbackRecommend}
                                  onChange={e => setFeedbackRecommend(e.target.value as Recommend)}
                                  className="mt-1 h-9 w-full rounded-md border border-border bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring/20"
                                >
                                  <option value="">Select…</option>
                                  <option value="strong_yes">Strong yes</option>
                                  <option value="yes">Yes</option>
                                  <option value="no">No</option>
                                  <option value="strong_no">Strong no</option>
                                </select>
                              </div>
                            </div>
                            <div>
                              <label className="text-[11px] uppercase tracking-wide text-muted-foreground">Notes</label>
                              <Textarea
                                value={feedbackNotes}
                                onChange={e => setFeedbackNotes(e.target.value)}
                                placeholder="Interview observations…"
                                className="mt-1"
                                rows={2}
                              />
                            </div>
                            <div className="flex justify-end gap-2">
                              <Button size="sm" variant="ghost" onClick={() => setFeedbackFor(null)}>Cancel</Button>
                              <Button size="sm" onClick={submitFeedback} disabled={feedbackSaving || !feedbackRating || !feedbackRecommend}>
                                {feedbackSaving ? "Saving..." : "Submit feedback"}
                              </Button>
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {showInterviewForm && (
                  <div className="rounded-lg border border-border p-3 space-y-3">
                    <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Schedule interview</p>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="text-[11px] uppercase tracking-wide text-muted-foreground">Date & time</label>
                        <input
                          type="datetime-local"
                          value={interviewDateTime}
                          onChange={e => setInterviewDateTime(e.target.value)}
                          className="mt-1 h-9 w-full rounded-md border border-border bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring/20"
                        />
                      </div>
                      <div>
                        <label className="text-[11px] uppercase tracking-wide text-muted-foreground">Mode</label>
                        <select
                          value={interviewMode}
                          onChange={e => setInterviewMode(e.target.value as typeof interviewMode)}
                          className="mt-1 h-9 w-full rounded-md border border-border bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring/20"
                        >
                          <option value="in_person">In person</option>
                          <option value="phone">Phone</option>
                          <option value="video">Video</option>
                        </select>
                      </div>
                      <div>
                        <label className="text-[11px] uppercase tracking-wide text-muted-foreground">Venue</label>
                        <Select
                          value={interviewVenueId || NONE}
                          onValueChange={v => {
                            if (v === NONE) { setInterviewVenueId(""); return; }
                            setInterviewVenueId(v);
                            const venue = venues.find(x => x.id === v);
                            if (venue) {
                              setInterviewLocation([venue.name, venue.address].filter(Boolean).join(", "));
                            }
                          }}
                        >
                          <SelectTrigger className="mt-1 h-9"><SelectValue placeholder="Pick a venue" /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value={NONE}>No venue</SelectItem>
                            {venues.filter(v => v.id).map(v => (
                              <SelectItem key={v.id as string} value={v.id as string}>
                                {v.name || "Venue"}{v.address ? ` — ${v.address}` : ""}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div>
                        <label className="text-[11px] uppercase tracking-wide text-muted-foreground">Location</label>
                        <input
                          value={interviewLocation}
                          onChange={e => setInterviewLocation(e.target.value)}
                          placeholder="e.g. Campus office"
                          className="mt-1 h-9 w-full rounded-md border border-border bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring/20"
                        />
                      </div>
                      <div>
                        <label className="text-[11px] uppercase tracking-wide text-muted-foreground">Meeting link</label>
                        <input
                          value={interviewMeetingLink}
                          onChange={e => setInterviewMeetingLink(e.target.value)}
                          placeholder="e.g. https://meet.google.com/..."
                          className="mt-1 h-9 w-full rounded-md border border-border bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring/20"
                        />
                      </div>
                      <div>
                        <label className="text-[11px] uppercase tracking-wide text-muted-foreground">Duration (mins)</label>
                        <Input
                          type="number"
                          min={5}
                          step={5}
                          value={interviewDuration}
                          onChange={e => setInterviewDuration(e.target.value)}
                          className="mt-1 h-9"
                        />
                      </div>
                      <div>
                        <label className="text-[11px] uppercase tracking-wide text-muted-foreground">Interviewer</label>
                        <Select
                          value={interviewInterviewerId || NONE}
                          onValueChange={v => setInterviewInterviewerId(v === NONE ? "" : v)}
                        >
                          <SelectTrigger className="mt-1 h-9"><SelectValue placeholder="Pick interviewer" /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value={NONE}>Unassigned</SelectItem>
                            {staff.map(s => (
                              <SelectItem key={s.user_id} value={s.user_id}>{displayName(s)}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    <div>
                      <label className="text-[11px] uppercase tracking-wide text-muted-foreground">Panel</label>
                      <div className="mt-1 max-h-32 overflow-y-auto rounded-md border border-border p-2 space-y-1">
                        {staff.length === 0 && <p className="text-[11.5px] text-muted-foreground">No staff found.</p>}
                        {staff.map(s => (
                          <label key={s.user_id} className="flex items-center gap-2 text-[12.5px] cursor-pointer">
                            <Checkbox
                              checked={interviewPanel.includes(s.user_id)}
                              onCheckedChange={checked => {
                                setInterviewPanel(prev => checked
                                  ? [...prev, s.user_id]
                                  : prev.filter(id => id !== s.user_id));
                              }}
                            />
                            {displayName(s)}
                          </label>
                        ))}
                      </div>
                    </div>
                    <div>
                      <label className="text-[11px] uppercase tracking-wide text-muted-foreground">Notes</label>
                      <Textarea
                        value={interviewNotes}
                        onChange={e => setInterviewNotes(e.target.value)}
                        placeholder="Optional notes for the interviewer..."
                        className="mt-1"
                        rows={2}
                      />
                    </div>
                    <div className="flex justify-end gap-2">
                      <Button size="sm" variant="ghost" onClick={() => setShowInterviewForm(false)}>Cancel</Button>
                      <Button size="sm" onClick={scheduleInterview} disabled={interviewSaving || !interviewDateTime}>
                        {interviewSaving ? "Scheduling..." : "Schedule"}
                      </Button>
                    </div>
                  </div>
                )}

                {showOfferForm && (
                  <div className="rounded-lg border border-border p-3 space-y-3">
                    <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Generate offer letter</p>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="text-[11px] uppercase tracking-wide text-muted-foreground">Offered role</label>
                        <input
                          value={offerRole}
                          onChange={e => setOfferRole(e.target.value)}
                          className="mt-1 h-9 w-full rounded-md border border-border bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring/20"
                        />
                      </div>
                      <div>
                        <label className="text-[11px] uppercase tracking-wide text-muted-foreground">Offered CTC</label>
                        <input
                          value={offerCtc}
                          onChange={e => setOfferCtc(e.target.value)}
                          placeholder="e.g. 4,80,000 per annum"
                          className="mt-1 h-9 w-full rounded-md border border-border bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring/20"
                        />
                      </div>
                      <div>
                        <label className="text-[11px] uppercase tracking-wide text-muted-foreground">Joining date</label>
                        <input
                          type="date"
                          value={offerJoiningDate}
                          onChange={e => setOfferJoiningDate(e.target.value)}
                          className="mt-1 h-9 w-full rounded-md border border-border bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring/20"
                        />
                      </div>
                      <div>
                        <label className="text-[11px] uppercase tracking-wide text-muted-foreground">Legal entity (optional)</label>
                        <input
                          value={offerLegalEntity}
                          onChange={e => setOfferLegalEntity(e.target.value)}
                          className="mt-1 h-9 w-full rounded-md border border-border bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring/20"
                        />
                      </div>
                    </div>
                    <div className="flex justify-end gap-2">
                      <Button size="sm" variant="ghost" onClick={() => setShowOfferForm(false)}>Cancel</Button>
                      <Button size="sm" onClick={generateOfferLetter} disabled={offerSaving || !offerRole || !offerJoiningDate}>
                        {offerSaving ? "Submitting..." : "Generate"}
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Convert to employee dialog */}
      <Dialog open={showHireForm} onOpenChange={setShowHireForm}>
        <DialogContent className="max-w-lg">
          {active && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <UserCheck className="h-5 w-5" /> Convert to employee
                </DialogTitle>
              </DialogHeader>
              <p className="text-[12.5px] text-muted-foreground -mt-2">
                Onboard {active.name || active.phone || "this applicant"} onto the employee roster.
              </p>
              <div className="space-y-3 text-sm">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-[11px] uppercase tracking-wide text-muted-foreground">Joining date</label>
                    <input
                      type="date"
                      value={hireJoiningDate}
                      onChange={e => setHireJoiningDate(e.target.value)}
                      className="mt-1 h-9 w-full rounded-md border border-border bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring/20"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] uppercase tracking-wide text-muted-foreground">Annual CTC</label>
                    <Input
                      type="number"
                      min={0}
                      value={hireCtc}
                      onChange={e => setHireCtc(e.target.value)}
                      placeholder="e.g. 480000"
                      className="mt-1 h-9"
                    />
                  </div>
                </div>
                <div>
                  <label className="text-[11px] uppercase tracking-wide text-muted-foreground">Job title</label>
                  <Input
                    value={hireJobTitle}
                    onChange={e => setHireJobTitle(e.target.value)}
                    placeholder="e.g. Assistant Professor"
                    className="mt-1 h-9"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-[11px] uppercase tracking-wide text-muted-foreground">Department</label>
                    <Select value={hireDepartmentId || NONE} onValueChange={v => setHireDepartmentId(v === NONE ? "" : v)}>
                      <SelectTrigger className="mt-1 h-9"><SelectValue placeholder="Pick department" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value={NONE}>None</SelectItem>
                        {departments.map(d => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <label className="text-[11px] uppercase tracking-wide text-muted-foreground">Campus</label>
                    <Select value={hireCampusId || NONE} onValueChange={v => setHireCampusId(v === NONE ? "" : v)}>
                      <SelectTrigger className="mt-1 h-9"><SelectValue placeholder="Pick campus" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value={NONE}>None</SelectItem>
                        {campuses.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="flex justify-end gap-2 pt-1">
                  <Button size="sm" variant="ghost" onClick={() => setShowHireForm(false)}>Cancel</Button>
                  <Button size="sm" onClick={hireApplicant} disabled={hireSaving || !hireJoiningDate}>
                    {hireSaving ? "Converting..." : "Convert to employee"}
                  </Button>
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default HrJobApplicants;
