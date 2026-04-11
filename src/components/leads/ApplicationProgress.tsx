import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  User, Users, BookOpen, Trophy, CreditCard, Upload, FileSearch, Baby,
  MessageSquare, CheckCircle, Lock, Eye, Loader2, History, Save, X,
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
            className={`flex-1 min-w-[44px] flex flex-col items-center gap-1 px-2 py-2 rounded-lg text-[10px] font-medium transition-all ${
              done ? "bg-primary/10 text-primary"
              : locked ? "text-muted-foreground/40"
              : "text-muted-foreground"
            }`}
          >
            {done ? <CheckCircle className="h-4 w-4" /> : locked ? <Lock className="h-4 w-4" /> : <Icon className="h-4 w-4" />}
            <span className="truncate">{s.label}</span>
          </div>
        );
      })}
    </div>
  );

  return (
    <>
      <Card className="border-border/60">
        <CardContent className="p-4 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Application Progress</h3>
                {statusBadge}
              </div>
              <p className="text-[10px] text-muted-foreground mt-0.5 font-mono truncate">{app.application_id}</p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <span className="text-[10px] text-muted-foreground whitespace-nowrap">{completedCount}/{steps.length} complete</span>
              {canImpersonate && (
                <Button variant="outline" size="sm" className="h-7 gap-1.5" onClick={() => setShowPreview(true)}>
                  <Eye className="h-3.5 w-3.5" />
                  View / Edit
                </Button>
              )}
            </div>
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
  const { toast } = useToast();
  const [data, setData] = useState<ApplicationData>(() => appRowToData(app));
  const [initialData, setInitialData] = useState<ApplicationData>(() => appRowToData(app));
  const [activeTab, setActiveTab] = useState<string>("personal");
  const [saving, setSaving] = useState(false);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [showAudit, setShowAudit] = useState(false);

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

  useEffect(() => { fetchAudit(); }, [app.id]);

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
                variant={showAudit ? "default" : "outline"}
                size="sm"
                className="h-8 gap-1.5"
                onClick={() => setShowAudit(v => !v)}
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

        {showAudit ? (
          <div className="flex-1 overflow-y-auto px-6 py-4">
            <AuditLogView entries={audit} />
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
