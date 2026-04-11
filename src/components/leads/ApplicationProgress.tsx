import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  User, Users, BookOpen, Trophy, CreditCard, Upload, FileSearch, Baby,
  MessageSquare, CheckCircle, Lock, Eye, Loader2,
} from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";

interface ApplicationRow {
  id: string;
  application_id: string;
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

// Same step definitions as the apply portal
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
}

export function ApplicationProgress({ leadId, leadPhone, applicationId, canImpersonate }: Props) {
  const [app, setApp] = useState<ApplicationRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [showPreview, setShowPreview] = useState(false);

  useEffect(() => {
    (async () => {
      setLoading(true);
      // Try to find application by lead_id first, then by application_id, then by phone
      let query = supabase.from("applications").select("*").limit(1);
      if (leadId) {
        const { data: byLead } = await supabase
          .from("applications")
          .select("*")
          .eq("lead_id", leadId)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (byLead) { setApp(byLead as any); setLoading(false); return; }
      }
      if (applicationId) {
        const { data: byAppId } = await supabase
          .from("applications")
          .select("*")
          .eq("application_id", applicationId)
          .maybeSingle();
        if (byAppId) { setApp(byAppId as any); setLoading(false); return; }
      }
      if (leadPhone) {
        const { data: byPhone } = await query
          .eq("phone", leadPhone)
          .order("created_at", { ascending: false })
          .maybeSingle();
        if (byPhone) { setApp(byPhone as any); setLoading(false); return; }
      }
      setApp(null);
      setLoading(false);
    })();
  }, [leadId, leadPhone, applicationId]);

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

  // Determine steps based on program_category (school vs other)
  const isSchool = app.program_category === "school";
  const steps = isSchool ? SCHOOL_STEPS : DEFAULT_STEPS;
  const cs = (app.completed_sections || {}) as Record<string, boolean>;
  const isPaid = app.payment_status === "paid";
  const isSubmitted = app.status === "submitted";
  const paymentIdx = steps.findIndex(s => s.key === "payment");

  const completedCount = steps.filter(s => cs[s.key] === true).length;

  return (
    <>
      <Card className="border-border/60">
        <CardContent className="p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Application Progress</h3>
              <p className="text-[10px] text-muted-foreground mt-0.5 font-mono">{app.application_id}</p>
            </div>
            <div className="flex items-center gap-2">
              <Badge className={`text-[10px] border-0 ${
                isSubmitted ? "bg-pastel-green text-foreground/80"
                : isPaid ? "bg-pastel-blue text-foreground/80"
                : "bg-pastel-yellow text-foreground/80"
              }`}>
                {isSubmitted ? "Submitted" : isPaid ? "Paid" : app.status}
              </Badge>
              <span className="text-[10px] text-muted-foreground">{completedCount}/{steps.length}</span>
            </div>
          </div>

          {/* Stepper */}
          <div className="flex items-center gap-1 overflow-x-auto pb-1">
            {steps.map((s, i) => {
              const done = cs[s.key] === true;
              const locked = isPaid && i < paymentIdx;
              const Icon = s.icon;
              return (
                <div
                  key={s.key}
                  title={locked ? "Locked after payment" : done ? "Completed" : "Not started"}
                  className={`flex-1 min-w-[32px] flex flex-col items-center gap-1 px-1 py-1.5 rounded-lg text-[9px] font-medium transition-all ${
                    done ? "bg-primary/10 text-primary"
                    : locked ? "text-muted-foreground/40"
                    : "text-muted-foreground"
                  }`}
                >
                  {done ? <CheckCircle className="h-3.5 w-3.5" /> : locked ? <Lock className="h-3.5 w-3.5" /> : <Icon className="h-3.5 w-3.5" />}
                  <span className="hidden sm:inline truncate w-full text-center">{s.label}</span>
                </div>
              );
            })}
          </div>

          {canImpersonate && (
            <Button
              variant="outline"
              size="sm"
              className="w-full gap-2"
              onClick={() => setShowPreview(true)}
            >
              <Eye className="h-3.5 w-3.5" />
              View Application
            </Button>
          )}
        </CardContent>
      </Card>

      {/* Preview dialog */}
      <Dialog open={showPreview} onOpenChange={setShowPreview}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileSearch className="h-5 w-5" />
              Application Preview
              <span className="text-xs font-mono text-muted-foreground ml-auto">{app.application_id}</span>
            </DialogTitle>
          </DialogHeader>
          <ApplicationPreview app={app} steps={steps} />
        </DialogContent>
      </Dialog>
    </>
  );
}

// ─── Read-only preview of the application ───
function ApplicationPreview({ app, steps }: { app: ApplicationRow; steps: typeof DEFAULT_STEPS }) {
  const cs = (app.completed_sections || {}) as Record<string, boolean>;
  const selections = (app.course_selections || []) as Array<{ course_name?: string; campus_name?: string; program_category?: string }>;

  const Row = ({ label, value }: { label: string; value: any }) => {
    if (value === null || value === undefined || value === "") return null;
    return (
      <div className="flex items-start gap-2 text-xs">
        <span className="text-muted-foreground min-w-[140px]">{label}:</span>
        <span className="text-foreground font-medium">{String(value)}</span>
      </div>
    );
  };

  const Section = ({ title, children, complete }: { title: string; children: React.ReactNode; complete: boolean }) => (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <h4 className="text-xs font-semibold text-foreground uppercase tracking-wide">{title}</h4>
        {complete && <CheckCircle className="h-3.5 w-3.5 text-primary" />}
      </div>
      <div className="bg-muted/30 rounded-lg p-3 space-y-1">{children}</div>
    </div>
  );

  return (
    <div className="space-y-4">
      {/* Status banner */}
      <div className="flex items-center justify-between rounded-lg border border-border bg-muted/20 p-3">
        <div>
          <p className="text-sm font-semibold text-foreground">{app.full_name || "Applicant"}</p>
          <p className="text-xs text-muted-foreground">{app.phone} · {app.email || "no email"}</p>
        </div>
        <div className="text-right">
          <Badge className={`text-[10px] border-0 ${
            app.status === "submitted" ? "bg-pastel-green text-foreground/80"
            : app.payment_status === "paid" ? "bg-pastel-blue text-foreground/80"
            : "bg-pastel-yellow text-foreground/80"
          }`}>
            {app.status === "submitted" ? "Submitted" : app.payment_status === "paid" ? "Payment Done" : app.status}
          </Badge>
          {app.fee_amount && (
            <p className="text-[10px] text-muted-foreground mt-1">Fee: ₹{Number(app.fee_amount).toLocaleString("en-IN")}</p>
          )}
        </div>
      </div>

      {/* Stepper (read-only) */}
      <div className="flex items-center gap-1 border-b border-border pb-3">
        {steps.map((s) => {
          const done = cs[s.key] === true;
          const Icon = s.icon;
          return (
            <div
              key={s.key}
              className={`flex-1 flex flex-col items-center gap-1 px-2 py-2 rounded-lg text-[10px] font-medium ${
                done ? "bg-primary/10 text-primary" : "text-muted-foreground"
              }`}
            >
              {done ? <CheckCircle className="h-4 w-4" /> : <Icon className="h-4 w-4" />}
              <span>{s.label}</span>
            </div>
          );
        })}
      </div>

      {/* Course selections */}
      {selections.length > 0 && (
        <Section title="Course Selections" complete={selections.length > 0}>
          {selections.map((sel, i) => (
            <div key={i} className="flex items-center justify-between text-xs">
              <span className="text-foreground">{i + 1}. {sel.course_name || "—"}</span>
              <span className="text-muted-foreground">{sel.campus_name || ""}</span>
            </div>
          ))}
        </Section>
      )}

      {/* Personal */}
      <Section title="Personal Details" complete={!!cs.personal}>
        <Row label="Full Name" value={app.full_name} />
        <Row label="DOB" value={app.dob} />
        <Row label="Gender" value={app.gender} />
        <Row label="Nationality" value={app.nationality} />
        <Row label="Category" value={app.category} />
        <Row label="Aadhaar" value={app.aadhaar} />
        <Row label="APAAR ID" value={app.apaar_id} />
        <Row label="PEN Number" value={app.pen_number} />
        {app.address && (
          <>
            <Row label="Address" value={(app.address as any).line1 || (app.address as any).street} />
            <Row label="City" value={(app.address as any).city} />
            <Row label="State" value={(app.address as any).state} />
            <Row label="Pincode" value={(app.address as any).pincode} />
          </>
        )}
      </Section>

      {/* Parents */}
      <Section title="Parent / Guardian" complete={!!cs.parents}>
        {app.father && (app.father.name || app.father.phone) && (
          <>
            <Row label="Father's Name" value={app.father.name} />
            <Row label="Father's Phone" value={app.father.phone} />
            <Row label="Father's Occupation" value={app.father.occupation} />
          </>
        )}
        {app.mother && (app.mother.name || app.mother.phone) && (
          <>
            <Row label="Mother's Name" value={app.mother.name} />
            <Row label="Mother's Phone" value={app.mother.phone} />
            <Row label="Mother's Occupation" value={app.mother.occupation} />
          </>
        )}
        {app.guardian && (app.guardian.name || app.guardian.phone) && (
          <>
            <Row label="Guardian's Name" value={app.guardian.name} />
            <Row label="Guardian's Phone" value={app.guardian.phone} />
          </>
        )}
      </Section>

      {/* Academic */}
      <Section title="Academic Details" complete={!!cs.academic}>
        {app.academic_details && Object.entries(app.academic_details as Record<string, any>).map(([key, val]) => (
          typeof val === "object" && val !== null ? null : <Row key={key} label={key.replace(/_/g, " ")} value={val} />
        ))}
        {app.school_details && Object.entries(app.school_details as Record<string, any>).map(([key, val]) => (
          typeof val === "object" && val !== null ? null : <Row key={`s-${key}`} label={key.replace(/_/g, " ")} value={val} />
        ))}
      </Section>

      {/* Extracurricular */}
      {app.extracurricular && Object.keys(app.extracurricular).length > 0 && (
        <Section title="Extracurricular" complete={!!cs.extracurricular}>
          {Object.entries(app.extracurricular as Record<string, any>).map(([key, val]) => (
            typeof val === "object" && val !== null ? null : <Row key={key} label={key.replace(/_/g, " ")} value={val} />
          ))}
        </Section>
      )}

      {/* Payment */}
      <Section title="Payment" complete={!!cs.payment}>
        <Row label="Status" value={app.payment_status || "pending"} />
        <Row label="Amount" value={app.fee_amount ? `₹${Number(app.fee_amount).toLocaleString("en-IN")}` : null} />
      </Section>

      {/* Meta */}
      <div className="text-[10px] text-muted-foreground pt-2 border-t border-border">
        Created: {new Date(app.created_at).toLocaleString("en-IN")}
        {app.submitted_at && ` · Submitted: ${new Date(app.submitted_at).toLocaleString("en-IN")}`}
      </div>
    </div>
  );
}
