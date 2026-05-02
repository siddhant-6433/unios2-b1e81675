import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useIsTeamLeader } from "@/hooks/useTeamLeader";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  User, Users, BookOpen, Trophy, CreditCard, Upload, FileSearch, Baby,
  MessageSquare, CheckCircle, Lock, Eye, Loader2, History, Save, X,
  KeyRound, ShieldCheck, AlertCircle, Clock, Unlock,
} from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { PersonalDetails } from "@/components/apply/PersonalDetails";
import { ParentDetails } from "@/components/apply/ParentDetails";
import { SiblingDetails } from "@/components/apply/SiblingDetails";
import { ParentQuestionnaire } from "@/components/apply/ParentQuestionnaire";
import { AcademicDetails } from "@/components/apply/AcademicDetails";
import { ExtracurricularDetails } from "@/components/apply/ExtracurricularDetails";
import { DocumentUpload } from "@/components/apply/DocumentUpload";
import { PortalProvider } from "@/components/apply/PortalContext";
import type { ApplicationData } from "@/components/apply/types";
import { ApplyMagicLinkButton } from "@/components/leads/ApplyMagicLinkButton";

interface ApplicationRow {
  id: string;
  application_id: string;
  lead_id: string | null;
  full_name: string | null;
  phone: string | null;
  email: string | null;
  status: string;
  program_category: string | null;
  course_selections: any;
  completed_sections: any;
  payment_status: string | null;
  fee_amount: number | null;
  address: any;
  father: any;
  mother: any;
  guardian: any;
  academic_details: any;
  result_status: any;
  extracurricular: any;
  school_details: any;
  dob: string | null;
  gender: string | null;
  nationality: string | null;
  category: string | null;
  aadhaar: string | null;
  apaar_id: string | null;
  pen_number: string | null;
  flags: string[] | null;
  submitted_at: string | null;
  created_at: string;
  edit_unlocked_until: string | null;
  edit_unlocked_sections: string[] | null;
}

interface EditRequest {
  id: string;
  application_id: string;
  requested_by: string;
  requested_by_name: string | null;
  requested_by_role: string | null;
  reason: string;
  sections: string[] | null;
  duration_hours: number;
  status: string;
  reviewed_by: string | null;
  reviewed_by_name: string | null;
  reviewed_at: string | null;
  review_notes: string | null;
  expires_at: string | null;
  created_at: string;
}

interface AuditEntry {
  id: string;
  section: string;
  field_path: string;
  old_value: any;
  new_value: any;
  changed_by_name: string | null;
  changed_by_role: string | null;
  created_at: string;
}

const DEFAULT_STEPS = [
  { key: "personal", label: "Personal", icon: User },
  { key: "parents", label: "Parents", icon: Users },
  { key: "academic", label: "Academic", icon: BookOpen },
  { key: "extracurricular", label: "Extra", icon: Trophy },
  { key: "payment", label: "Payment", icon: CreditCard },
  { key: "documents", label: "Documents", icon: Upload },
  { key: "review", label: "Review", icon: FileSearch },
];

const SCHOOL_STEPS = [
  { key: "personal", label: "Personal", icon: User },
  { key: "parents", label: "Parents", icon: Users },
  { key: "siblings", label: "Siblings", icon: Baby },
  { key: "questionnaire", label: "Questionnaire", icon: MessageSquare },
  { key: "academic", label: "Academic", icon: BookOpen },
  { key: "payment", label: "Payment", icon: CreditCard },
  { key: "documents", label: "Documents", icon: Upload },
  { key: "review", label: "Review", icon: FileSearch },
];

interface Props {
  leadId: string;
  leadPhone?: string;
  applicationId?: string | null;
  canImpersonate?: boolean;
  /** When true renders without the wrapper Card (for full-width top placement) */
  compact?: boolean;
}

export function ApplicationProgress({ leadId, leadPhone, applicationId, canImpersonate, compact }: Props) {
  const [app, setApp] = useState<ApplicationRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [showPreview, setShowPreview] = useState(false);

  const fetchApp = async () => {
    setLoading(true);
    if (leadId) {
      const { data: byLead } = await (supabase as any)
        .from("applications").select("*")
        .eq("lead_id", leadId)
        .order("created_at", { ascending: false })
        .limit(1).maybeSingle();
      if (byLead) { setApp(byLead); setLoading(false); return; }
    }
    if (applicationId) {
      const { data: byAppId } = await (supabase as any)
        .from("applications").select("*")
        .eq("application_id", applicationId).maybeSingle();
      if (byAppId) { setApp(byAppId); setLoading(false); return; }
    }
    if (leadPhone) {
      const { data: byPhone } = await (supabase as any)
        .from("applications").select("*")
        .eq("phone", leadPhone)
        .order("created_at", { ascending: false })
        .limit(1).maybeSingle();
      if (byPhone) { setApp(byPhone); setLoading(false); return; }
    }
    setApp(null);
    setLoading(false);
  };

  useEffect(() => { fetchApp(); }, [leadId, leadPhone, applicationId]);

  if (loading) {
    return (
      <Card className="border-border/60">
        <CardContent className="p-4 flex items-center justify-center">
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  if (!app) {
    if (compact) return null;
    return (
      <Card className="border-border/60 border-dashed">
        <CardContent className="p-4">
          <div className="flex items-center gap-2">
            <FileSearch className="h-4 w-4 text-muted-foreground" />
            <p className="text-xs text-muted-foreground">No application started yet</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  const isSchool = app.program_category === "school";
  const steps = isSchool ? SCHOOL_STEPS : DEFAULT_STEPS;
  const cs = (app.completed_sections || {}) as Record<string, boolean>;
  const isPaid = app.payment_status === "paid";
  const isSubmitted = app.status === "submitted";
  const paymentIdx = steps.findIndex(s => s.key === "payment");
  const completedCount = steps.filter(s => cs[s.key] === true).length;

  const statusBadge = (
    <Badge className={`text-[10px] border-0 ${
      isSubmitted ? "bg-pastel-green text-foreground/80"
      : isPaid ? "bg-pastel-blue text-foreground/80"
      : "bg-pastel-yellow text-foreground/80"
    }`}>
      {isSubmitted ? "Submitted" : isPaid ? "Paid" : app.status}
    </Badge>
  );

  const stepperRow = (
    <div className="flex items-center gap-1 overflow-x-auto">
      {steps.map((s, i) => {
        const done = cs[s.key] === true;
        const locked = isPaid && i < paymentIdx;
        const Icon = s.icon;
        return (
          <div
            key={s.key}
            title={locked ? "Locked after payment" : done ? "Completed" : "Not started"}
            className={`flex-1 min-w-[44px] flex flex-col items-center gap-1 px-2 py-1.5 rounded-lg text-[10px] font-medium transition-all ${
              done ? "bg-green-100 text-green-700 dark:bg-green-950/40 dark:text-green-400"
              : locked ? "text-muted-foreground/40"
              : "text-muted-foreground"
            }`}
          >
            {done ? <CheckCircle className="h-3.5 w-3.5" /> : locked ? <Lock className="h-3.5 w-3.5" /> : <Icon className="h-3.5 w-3.5" />}
            <span className="truncate">{s.label}</span>
          </div>
        );
      })}
    </div>
  );

  return (
    <>
      <Card className="border-border/60">
        <CardContent className="px-4 py-2.5 space-y-2">
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide shrink-0">Application</span>
            <span className="text-[10px] font-mono text-muted-foreground truncate">{app.application_id}</span>
            {statusBadge}
            <span className="text-[10px] text-muted-foreground whitespace-nowrap ml-auto">{completedCount}/{steps.length} done</span>
            {canImpersonate && (
              <>
                <Button variant="outline" size="sm" className="h-6 gap-1 text-[10px] px-2 shrink-0" onClick={() => setShowPreview(true)}>
                  <Eye className="h-3 w-3" />
                  View / Edit
                </Button>
                {leadId && (
                  <ApplyMagicLinkButton
                    leadId={leadId}
                    leadName={null}
                    leadPhone={leadPhone || null}
                    compact
                    directOpen
                  />
                )}
              </>
            )}
          </div>
          {stepperRow}
        </CardContent>
      </Card>

      {showPreview && (
        <ApplicationEditDialog
          app={app}
          steps={steps}
          isSchool={isSchool}
          onClose={() => setShowPreview(false)}
          onSaved={fetchApp}
        />
      )}
    </>
  );
}

// ─── Edit dialog using the actual step components ───
function ApplicationEditDialog({ app, steps, isSchool, onClose, onSaved }: {
  app: ApplicationRow;
  steps: typeof DEFAULT_STEPS;
  isSchool: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { role } = useAuth();
  const isTeamLeader = useIsTeamLeader();
  const { toast } = useToast();
  const [data, setData] = useState<ApplicationData>(() => appRowToData(app));
  const [initialData, setInitialData] = useState<ApplicationData>(() => appRowToData(app));
  const [activeTab, setActiveTab] = useState<string>("personal");
  const [saving, setSaving] = useState(false);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [editRequests, setEditRequests] = useState<EditRequest[]>([]);
  const [view, setView] = useState<"edit" | "audit" | "access">("edit");
  const [currentApp, setCurrentApp] = useState<ApplicationRow>(app);

  const isAdmin = role === "super_admin" || role === "admission_head" || role === "principal" || role === "campus_admin" || isTeamLeader;
  const canRequest = isAdmin || role === "counsellor";

  const onChange = (updates: Partial<ApplicationData>) => {
    setData(prev => ({ ...prev, ...updates }));
  };

  const fetchAudit = async () => {
    const { data: rows } = await (supabase as any)
      .from("application_audit_log")
      .select("*")
      .eq("application_id", app.id)
      .order("created_at", { ascending: false })
      .limit(100);
    setAudit((rows || []) as AuditEntry[]);
  };

  const fetchEditRequests = async () => {
    const { data: rows } = await (supabase as any)
      .from("application_edit_requests")
      .select("*")
      .eq("application_id", app.id)
      .order("created_at", { ascending: false });
    setEditRequests((rows || []) as EditRequest[]);
  };

  const refreshApp = async () => {
    const { data: row } = await (supabase as any)
      .from("applications")
      .select("*")
      .eq("id", app.id)
      .maybeSingle();
    if (row) setCurrentApp(row as ApplicationRow);
  };

  useEffect(() => {
    fetchAudit();
    fetchEditRequests();
  }, [app.id]);

  const saveSection = async (sectionKey: string) => {
    setSaving(true);
    // Build updates object with only the keys relevant to this section
    const sectionFields: Record<string, string[]> = {
      personal: ["full_name", "dob", "gender", "nationality", "category", "aadhaar", "apaar_id", "pen_number", "email", "address"],
      parents: ["father", "mother", "guardian"],
      siblings: ["extracurricular"], // siblings stored under extracurricular.siblings in some flows
      questionnaire: ["extracurricular"],
      academic: ["academic_details", "result_status", "school_details"],
      extracurricular: ["extracurricular"],
      documents: [], // documents are files, not fields — handled separately
    };

    const keys = sectionFields[sectionKey] || [];
    const updates: any = {};
    for (const k of keys) {
      updates[k] = (data as any)[k];
    }
    // Also mark section as complete
    updates.completed_sections = { ...(data.completed_sections as any), [sectionKey]: true };

    const { error } = await (supabase as any).rpc("staff_update_application", {
      _application_id: app.id,
      _section: sectionKey,
      _updates: updates,
    });

    setSaving(false);
    if (error) {
      toast({ title: "Save failed", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Saved", description: `Changes to ${sectionKey} section logged.` });
    setInitialData({ ...data });
    await fetchAudit();
    onSaved();
  };

  const sectionHasChanges = (sectionKey: string): boolean => {
    const sectionFields: Record<string, string[]> = {
      personal: ["full_name", "dob", "gender", "nationality", "category", "aadhaar", "apaar_id", "pen_number", "email", "address"],
      parents: ["father", "mother", "guardian"],
      academic: ["academic_details", "result_status", "school_details"],
      extracurricular: ["extracurricular"],
      siblings: ["extracurricular"],
      questionnaire: ["extracurricular"],
    };
    const keys = sectionFields[sectionKey] || [];
    return keys.some(k => JSON.stringify((data as any)[k]) !== JSON.stringify((initialData as any)[k]));
  };

  // Build a no-op onNext that just saves the current section
  const onNextSave = (sectionKey: string) => async () => {
    await saveSection(sectionKey);
  };

  const stepTabs = steps.filter(s => s.key !== "payment" && s.key !== "review");

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-5xl max-h-[92vh] p-0 flex flex-col">
        <DialogHeader className="px-6 pt-5 pb-3 border-b border-border">
          <DialogTitle className="flex items-center gap-2">
            <FileSearch className="h-5 w-5" />
            <span>Application Review</span>
            <span className="text-xs font-mono text-muted-foreground ml-2">{app.application_id}</span>
            <div className="ml-auto flex items-center gap-2">
              <Button
                variant={view === "edit" ? "default" : "outline"}
                size="sm"
                className="h-8 gap-1.5"
                onClick={() => setView("edit")}
              >
                <FileSearch className="h-3.5 w-3.5" />
                Form
              </Button>
              <Button
                variant={view === "access" ? "default" : "outline"}
                size="sm"
                className="h-8 gap-1.5"
                onClick={() => setView("access")}
              >
                <KeyRound className="h-3.5 w-3.5" />
                Edit Access {editRequests.filter(r => r.status === "pending").length > 0 && (
                  <Badge className="ml-1 h-4 px-1 text-[9px] bg-orange-500 text-white border-0">
                    {editRequests.filter(r => r.status === "pending").length}
                  </Badge>
                )}
              </Button>
              <Button
                variant={view === "audit" ? "default" : "outline"}
                size="sm"
                className="h-8 gap-1.5"
                onClick={() => setView("audit")}
              >
                <History className="h-3.5 w-3.5" />
                Audit ({audit.length})
              </Button>
            </div>
          </DialogTitle>
          {/* Candidate summary */}
          <div className="flex items-center justify-between text-xs text-muted-foreground pt-1">
            <span>
              <span className="font-medium text-foreground">{data.full_name || "Applicant"}</span>
              {" · "}
              <span>{app.phone}</span>
              {app.email && <> · <span>{app.email}</span></>}
            </span>
            <Badge className={`text-[10px] border-0 ${
              app.status === "submitted" ? "bg-pastel-green text-foreground/80"
              : app.payment_status === "paid" ? "bg-pastel-blue text-foreground/80"
              : "bg-pastel-yellow text-foreground/80"
            }`}>
              {app.status === "submitted" ? "Submitted"
                : app.payment_status === "paid" ? "Payment Done"
                : app.status}
            </Badge>
          </div>
        </DialogHeader>

        {view === "audit" ? (
          <div className="flex-1 overflow-y-auto px-6 py-4">
            <AuditLogView entries={audit} />
          </div>
        ) : view === "access" ? (
          <div className="flex-1 overflow-y-auto px-6 py-4">
            <EditAccessPanel
              app={currentApp}
              requests={editRequests}
              isAdmin={isAdmin}
              canRequest={canRequest}
              steps={steps}
              onRefresh={async () => {
                await fetchEditRequests();
                await refreshApp();
                onSaved();
              }}
            />
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto px-6 py-4">
            {/* Tab bar */}
            <div className="flex items-center gap-1 mb-5 overflow-x-auto border-b border-border pb-0">
              {stepTabs.map(t => {
                const done = (data.completed_sections as any)[t.key] === true;
                const active = activeTab === t.key;
                const dirty = sectionHasChanges(t.key);
                const Icon = t.icon;
                return (
                  <button
                    key={t.key}
                    onClick={() => setActiveTab(t.key)}
                    className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-b-2 transition-colors ${
                      active ? "border-primary text-primary"
                      : "border-transparent text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {done ? <CheckCircle className="h-3.5 w-3.5" /> : <Icon className="h-3.5 w-3.5" />}
                    <span>{t.label}</span>
                    {dirty && <span className="w-1.5 h-1.5 rounded-full bg-orange-500" title="Unsaved changes" />}
                  </button>
                );
              })}
            </div>

            {/* Active tab content — reuses the actual apply portal step components */}
            <PortalProvider>
              {activeTab === "personal" && (
                <PersonalDetails
                  data={data}
                  onChange={onChange}
                  onNext={onNextSave("personal")}
                  saving={saving}
                />
              )}
              {activeTab === "parents" && (
                <ParentDetails
                  data={data}
                  onChange={onChange}
                  onNext={onNextSave("parents")}
                  saving={saving}
                />
              )}
              {activeTab === "siblings" && (
                <SiblingDetails
                  data={data}
                  onChange={onChange}
                  onNext={onNextSave("siblings")}
                  saving={saving}
                />
              )}
              {activeTab === "questionnaire" && (
                <ParentQuestionnaire
                  data={data}
                  onChange={onChange}
                  onNext={onNextSave("questionnaire")}
                  saving={saving}
                />
              )}
              {activeTab === "academic" && (
                <AcademicDetails
                  data={data}
                  onChange={onChange}
                  onNext={onNextSave("academic")}
                  saving={saving}
                />
              )}
              {activeTab === "extracurricular" && (
                <ExtracurricularDetails
                  data={data}
                  onChange={onChange}
                  onNext={onNextSave("extracurricular")}
                  saving={saving}
                />
              )}
              {activeTab === "documents" && (
                <DocumentUpload
                  data={data}
                  onChange={(partial) => setData(prev => ({ ...prev, ...partial }))}
                  onNext={async () => {
                    toast({ title: "Document uploaded", description: "Document saved on the application." });
                    await fetchAudit();
                    onSaved();
                  }}
                  saving={saving}
                />
              )}
            </PortalProvider>
          </div>
        )}

        <div className="border-t border-border px-6 py-3 flex items-center justify-between bg-muted/20">
          <p className="text-[10px] text-muted-foreground">
            Created: {new Date(app.created_at).toLocaleString("en-IN")}
            {app.submitted_at && ` · Submitted: ${new Date(app.submitted_at).toLocaleString("en-IN")}`}
          </p>
          <Button variant="outline" size="sm" onClick={onClose}>
            <X className="h-3.5 w-3.5 mr-1" /> Close
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// Audit log list
function AuditLogView({ entries }: { entries: AuditEntry[] }) {
  if (entries.length === 0) {
    return (
      <div className="text-center py-8 text-xs text-muted-foreground">
        No edits yet. Any staff changes to this application will be logged here.
      </div>
    );
  }

  const fmt = (v: any): string => {
    if (v === null || v === undefined) return "—";
    if (typeof v === "object") return JSON.stringify(v);
    return String(v);
  };

  return (
    <div className="space-y-3">
      {entries.map(e => (
        <div key={e.id} className="rounded-lg border border-border bg-card p-3">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="text-[9px] uppercase">{e.section}</Badge>
              <span className="text-xs font-mono text-muted-foreground">{e.field_path}</span>
            </div>
            <span className="text-[10px] text-muted-foreground">
              {new Date(e.created_at).toLocaleString("en-IN")}
            </span>
          </div>
          <div className="grid grid-cols-2 gap-3 text-xs">
            <div>
              <p className="text-[10px] text-muted-foreground mb-0.5">OLD</p>
              <div className="rounded bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800/40 p-2 font-mono text-[11px] text-red-900 dark:text-red-200 break-words max-h-24 overflow-y-auto">
                {fmt(e.old_value)}
              </div>
            </div>
            <div>
              <p className="text-[10px] text-muted-foreground mb-0.5">NEW</p>
              <div className="rounded bg-green-50 dark:bg-green-950/20 border border-green-200 dark:border-green-800/40 p-2 font-mono text-[11px] text-green-900 dark:text-green-200 break-words max-h-24 overflow-y-auto">
                {fmt(e.new_value)}
              </div>
            </div>
          </div>
          <p className="text-[10px] text-muted-foreground mt-2">
            by <span className="font-medium text-foreground">{e.changed_by_name || "Unknown"}</span>
            {e.changed_by_role && <span className="ml-1">({e.changed_by_role})</span>}
          </p>
        </div>
      ))}
    </div>
  );
}

// ─── Edit Access Panel ───
// Lets counsellors request frontend-edit access for paid applications,
// and admins approve/reject those requests.
function EditAccessPanel({ app, requests, isAdmin, canRequest, steps, onRefresh }: {
  app: ApplicationRow;
  requests: EditRequest[];
  isAdmin: boolean;
  canRequest: boolean;
  steps: typeof DEFAULT_STEPS;
  onRefresh: () => Promise<void>;
}) {
  const { toast } = useToast();
  const [showRequestForm, setShowRequestForm] = useState(false);
  const [reason, setReason] = useState("");
  const [duration, setDuration] = useState(24);
  const [selectedSections, setSelectedSections] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [reviewNotes, setReviewNotes] = useState<Record<string, string>>({});

  const isPaid = app.payment_status === "paid";
  const now = Date.now();
  const unlockActive = app.edit_unlocked_until && new Date(app.edit_unlocked_until).getTime() > now;
  const unlockExpiry = app.edit_unlocked_until ? new Date(app.edit_unlocked_until) : null;

  const preSubmitTabs = steps.filter(s => s.key !== "review" && s.key !== "documents");

  const toggleSection = (key: string) => {
    setSelectedSections(prev => prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]);
  };

  const submitRequest = async () => {
    if (!reason.trim()) {
      toast({ title: "Reason required", variant: "destructive" });
      return;
    }
    setSubmitting(true);
    const { data, error } = await (supabase as any).rpc("request_application_edit_access", {
      _application_id: app.id,
      _reason: reason.trim(),
      _sections: selectedSections.length > 0 ? selectedSections : null,
      _duration_hours: duration,
    });
    setSubmitting(false);
    if (error) {
      toast({ title: "Request failed", description: error.message, variant: "destructive" });
      return;
    }
    toast({
      title: isAdmin ? "Edit access granted" : "Request submitted",
      description: isAdmin
        ? `Applicant can edit for the next ${duration} hours.`
        : "Admission head / super admin will review and approve.",
    });
    setShowRequestForm(false);
    setReason("");
    setSelectedSections([]);
    await onRefresh();
  };

  const reviewRequest = async (requestId: string, decision: "approved" | "rejected") => {
    const { error } = await (supabase as any).rpc("review_application_edit_request", {
      _request_id: requestId,
      _decision: decision,
      _notes: reviewNotes[requestId] || null,
    });
    if (error) {
      toast({ title: "Review failed", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: `Request ${decision}` });
    await onRefresh();
  };

  const revokeUnlock = async () => {
    const { error } = await (supabase as any).rpc("revoke_application_edit_unlock", {
      _application_id: app.id,
    });
    if (error) {
      toast({ title: "Revoke failed", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Edit access revoked" });
    await onRefresh();
  };

  const pending = requests.filter(r => r.status === "pending");
  const history = requests.filter(r => r.status !== "pending");

  return (
    <div className="space-y-5">
      {!isPaid && (
        <div className="rounded-lg border border-border bg-muted/30 p-3 text-xs text-muted-foreground flex items-center gap-2">
          <AlertCircle className="h-4 w-4" />
          Edit access is only needed for paid applications — the applicant can freely edit pre-payment tabs.
        </div>
      )}

      {/* Current unlock status */}
      {unlockActive && (
        <div className="rounded-lg border border-green-300 dark:border-green-800/40 bg-green-50 dark:bg-green-950/20 p-4">
          <div className="flex items-start gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-green-100 dark:bg-green-900/40">
              <Unlock className="h-4 w-4 text-green-700 dark:text-green-400" />
            </div>
            <div className="flex-1">
              <p className="text-sm font-semibold text-green-900 dark:text-green-200">Edit access active</p>
              <p className="text-xs text-green-700 dark:text-green-400 mt-0.5">
                Applicant can edit pre-payment tabs on the apply portal until{" "}
                <span className="font-medium">{unlockExpiry?.toLocaleString("en-IN")}</span>
              </p>
              {app.edit_unlocked_sections && app.edit_unlocked_sections.length > 0 && (
                <p className="text-[10px] text-green-600 dark:text-green-500 mt-1">
                  Sections: {app.edit_unlocked_sections.join(", ")}
                </p>
              )}
            </div>
            {isAdmin && (
              <Button variant="outline" size="sm" onClick={revokeUnlock}>
                Revoke
              </Button>
            )}
          </div>
        </div>
      )}

      {/* Pending requests */}
      {pending.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Pending Requests</h4>
          {pending.map(r => (
            <div key={r.id} className="rounded-lg border border-orange-300 dark:border-orange-800/40 bg-orange-50 dark:bg-orange-950/20 p-4 space-y-3">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-sm font-semibold text-foreground">{r.requested_by_name || "Staff"}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {r.requested_by_role} · {new Date(r.created_at).toLocaleString("en-IN")} · {r.duration_hours}h duration
                  </p>
                </div>
                <Badge className="bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300 border-0 text-[10px]">
                  Pending
                </Badge>
              </div>
              <div className="rounded bg-white dark:bg-card p-3 text-xs text-foreground">
                <p className="font-medium text-muted-foreground text-[10px] uppercase mb-1">Reason</p>
                <p>{r.reason}</p>
              </div>
              {r.sections && r.sections.length > 0 && (
                <div className="text-[10px] text-muted-foreground">
                  Sections: {r.sections.join(", ")}
                </div>
              )}
              {isAdmin ? (
                <div className="space-y-2 pt-2 border-t border-orange-200 dark:border-orange-800/40">
                  <textarea
                    placeholder="Review notes (optional)"
                    value={reviewNotes[r.id] || ""}
                    onChange={(e) => setReviewNotes(p => ({ ...p, [r.id]: e.target.value }))}
                    className="w-full rounded-lg border border-input bg-background px-3 py-2 text-xs"
                    rows={2}
                  />
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" className="flex-1 text-destructive border-destructive/30 hover:bg-destructive/5"
                      onClick={() => reviewRequest(r.id, "rejected")}>
                      Reject
                    </Button>
                    <Button size="sm" className="flex-1 gap-1.5" onClick={() => reviewRequest(r.id, "approved")}>
                      <ShieldCheck className="h-3.5 w-3.5" />
                      Approve ({r.duration_hours}h)
                    </Button>
                  </div>
                </div>
              ) : (
                <p className="text-[11px] text-muted-foreground italic">
                  Waiting for admission head / super admin review.
                </p>
              )}
            </div>
          ))}
        </div>
      )}

      {/* New request form */}
      {canRequest && isPaid && !unlockActive && (
        <div className="space-y-3">
          {showRequestForm ? (
            <div className="rounded-lg border border-border bg-card p-4 space-y-3">
              <h4 className="text-sm font-semibold text-foreground">Request Edit Access</h4>
              <div>
                <label className="block text-[11px] font-medium text-muted-foreground mb-1">Reason *</label>
                <textarea
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  rows={3}
                  placeholder="e.g. Applicant entered wrong DOB during application — needs to correct"
                  className="w-full rounded-lg border border-input bg-background px-3 py-2 text-xs"
                />
              </div>
              <div>
                <label className="block text-[11px] font-medium text-muted-foreground mb-1">
                  Sections to unlock (leave empty for all pre-payment sections)
                </label>
                <div className="flex flex-wrap gap-1.5">
                  {preSubmitTabs.map(t => {
                    const sel = selectedSections.includes(t.key);
                    return (
                      <button
                        key={t.key}
                        type="button"
                        onClick={() => toggleSection(t.key)}
                        className={`px-2.5 py-1 rounded-lg text-[10px] font-medium border transition-colors ${
                          sel ? "bg-primary text-primary-foreground border-primary"
                          : "bg-background text-muted-foreground border-input hover:bg-muted"
                        }`}
                      >
                        {t.label}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div>
                <label className="block text-[11px] font-medium text-muted-foreground mb-1">Unlock Duration</label>
                <select
                  value={duration}
                  onChange={(e) => setDuration(Number(e.target.value))}
                  className="w-full rounded-lg border border-input bg-background px-3 py-2 text-xs"
                >
                  <option value={6}>6 hours</option>
                  <option value={12}>12 hours</option>
                  <option value={24}>24 hours</option>
                  <option value={48}>48 hours</option>
                  <option value={72}>3 days</option>
                </select>
              </div>
              <div className="flex gap-2 pt-1">
                <Button variant="outline" size="sm" className="flex-1" onClick={() => setShowRequestForm(false)}>
                  Cancel
                </Button>
                <Button size="sm" className="flex-1 gap-1.5" disabled={submitting || !reason.trim()} onClick={submitRequest}>
                  {submitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <KeyRound className="h-3.5 w-3.5" />}
                  {isAdmin ? "Grant Access" : "Submit Request"}
                </Button>
              </div>
              {!isAdmin && (
                <p className="text-[10px] text-muted-foreground">
                  Your request will need approval from admission head / super admin before the applicant can edit.
                </p>
              )}
            </div>
          ) : (
            <Button variant="outline" className="w-full gap-2" onClick={() => setShowRequestForm(true)}>
              <KeyRound className="h-4 w-4" />
              {isAdmin ? "Grant Applicant Edit Access" : "Request Applicant Edit Access"}
            </Button>
          )}
        </div>
      )}

      {/* History */}
      {history.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">History</h4>
          {history.map(r => (
            <div key={r.id} className="rounded-lg border border-border bg-card p-3 text-xs">
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-foreground">{r.requested_by_name}</span>
                  <Badge className={`text-[9px] border-0 ${
                    r.status === "approved" ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                    : r.status === "rejected" ? "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
                    : r.status === "expired" ? "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-400"
                    : "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400"
                  }`}>
                    {r.status}
                  </Badge>
                </div>
                <span className="text-[10px] text-muted-foreground">
                  {new Date(r.created_at).toLocaleString("en-IN")}
                </span>
              </div>
              <p className="text-[11px] text-muted-foreground line-clamp-2">{r.reason}</p>
              {r.reviewed_by_name && (
                <p className="text-[10px] text-muted-foreground mt-1">
                  Reviewed by {r.reviewed_by_name}
                  {r.review_notes && ` — "${r.review_notes}"`}
                </p>
              )}
            </div>
          ))}
        </div>
      )}

      {requests.length === 0 && !showRequestForm && !isPaid && (
        <p className="text-center py-8 text-xs text-muted-foreground">
          No edit access requests.
        </p>
      )}
    </div>
  );
}

// Helpers
function appRowToData(app: ApplicationRow): ApplicationData {
  return {
    id: app.id,
    application_id: app.application_id,
    status: app.status,
    phone: app.phone || "",
    full_name: app.full_name || "",
    email: app.email || "",
    dob: app.dob || "",
    gender: app.gender || "",
    nationality: app.nationality || "",
    category: app.category || "",
    aadhaar: app.aadhaar || "",
    apaar_id: app.apaar_id || "",
    pen_number: app.pen_number || "",
    address: (app.address || {}) as any,
    father: (app.father || {}) as any,
    mother: (app.mother || {}) as any,
    guardian: (app.guardian || {}) as any,
    academic_details: (app.academic_details || {}) as any,
    result_status: (app.result_status || {}) as any,
    extracurricular: (app.extracurricular || {}) as any,
    school_details: (app.school_details || {}) as any,
    completed_sections: (app.completed_sections || {}) as any,
    course_selections: (app.course_selections || []) as any,
    fee_amount: app.fee_amount || 0,
    payment_status: app.payment_status || "pending",
    program_category: app.program_category || "",
    flags: (app.flags || []) as any,
  } as ApplicationData;
}
