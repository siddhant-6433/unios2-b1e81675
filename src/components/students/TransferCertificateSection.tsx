import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { invokeEdge } from "@/integrations/supabase/edge";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { ButtonOrb } from "@/components/ui/thinking-orb";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { FileText, Download, Check, X, AlertCircle, Clock } from "lucide-react";

// Roles allowed to draft/submit a TC vs approve one. Mirrors the RPC guards.
const CAN_ISSUE = new Set(["office_assistant", "school_coordinator", "principal", "super_admin", "campus_admin"]);
const CAN_APPROVE = new Set(["principal", "super_admin"]);

type TcRequest = {
  id: string;
  status: "draft" | "pending_approval" | "approved" | "rejected";
  tc_number: string | null;
  issue_date: string | null;
  tc_pdf_path: string | null;
  decision_notes: string | null;
  requested_at: string;
};

// tc_details keys — MUST match the keys read by the generate-transfer-certificate edge fn.
type TcForm = {
  name: string; motherName: string; fatherName: string; nationality: string; category: string;
  firstAdmissionDateClass: string; dob: string; classLastStudied: string; lastExamResult: string;
  whetherFailed: string; subjects: string; promotion: string; duesPaidUpto: string; feeConcession: string;
  workingDays: string; daysPresent: string; nccScoutGuide: string; gamesActivities: string; conduct: string;
  reasonForLeaving: string; remarks: string;
};

const FIELD_LABELS: Array<[keyof TcForm, string, "text" | "date" | "area"]> = [
  ["name", "Name of the Pupil", "text"],
  ["motherName", "Mother's Name", "text"],
  ["fatherName", "Father's / Guardian's Name", "text"],
  ["nationality", "Nationality", "text"],
  ["category", "SC / ST / OBC / General", "text"],
  ["firstAdmissionDateClass", "Date of first admission with class", "text"],
  ["dob", "Date of Birth", "date"],
  ["classLastStudied", "Class last studied (figures & words)", "text"],
  ["lastExamResult", "Last exam taken with result", "text"],
  ["whetherFailed", "Whether failed (once/twice in same class)", "text"],
  ["subjects", "Subjects studied", "text"],
  ["promotion", "Qualified for promotion; to which class", "text"],
  ["duesPaidUpto", "School dues paid up to (month)", "text"],
  ["feeConcession", "Fee concession availed", "text"],
  ["workingDays", "Total working days", "text"],
  ["daysPresent", "Total working days present", "text"],
  ["nccScoutGuide", "NCC Cadet / Boy Scout / Girl Guide", "text"],
  ["gamesActivities", "Games / extra-curricular activities", "text"],
  ["conduct", "General Conduct", "text"],
  ["reasonForLeaving", "Reason for leaving the school", "text"],
  ["remarks", "Any other remarks", "area"],
];

const fmtDate = (d?: string | null) => {
  if (!d) return "";
  const dt = new Date(d);
  return isNaN(dt.getTime()) ? String(d) : dt.toLocaleDateString("en-IN", { day: "2-digit", month: "long", year: "numeric" });
};

const emptyForm = (): TcForm => ({
  name: "", motherName: "", fatherName: "", nationality: "Indian", category: "General",
  firstAdmissionDateClass: "", dob: "", classLastStudied: "", lastExamResult: "", whetherFailed: "No",
  subjects: "", promotion: "", duesPaidUpto: "", feeConcession: "None", workingDays: "", daysPresent: "",
  nccScoutGuide: "No", gamesActivities: "", conduct: "Good", reasonForLeaving: "", remarks: "",
});

export function TransferCertificateSection({
  studentId,
  leadId,
  archived,
}: {
  studentId: string;
  leadId: string | null;
  archived: boolean;
}) {
  const { role } = useAuth();
  const { toast } = useToast();
  const [request, setRequest] = useState<TcRequest | null>(null);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState<TcForm>(emptyForm());
  const [dues, setDues] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  const canIssue = CAN_ISSUE.has(String(role));
  const canApprove = CAN_APPROVE.has(String(role));

  const loadRequest = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from("student_tc_requests" as never)
      .select("id, status, tc_number, issue_date, tc_pdf_path, decision_notes, requested_at")
      .eq("student_id", studentId)
      .order("requested_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    setRequest((data as TcRequest | null) ?? null);
    setLoading(false);
  }, [studentId]);

  useEffect(() => { loadRequest(); }, [loadRequest]);

  const openIssueDialog = async () => {
    setBusy(true);
    try {
      // Full student row (defensive cast: several columns aren't in generated types).
      const { data: sRaw } = await supabase.from("students").select("*").eq("id", studentId).maybeSingle();
      const s = (sRaw ?? {}) as Record<string, unknown>;
      const str = (k: string) => (s[k] == null ? "" : String(s[k]));

      // Attendance-derived working days / days present.
      const { data: att } = await supabase
        .from("daily_attendance").select("date, status").eq("student_id", studentId);
      const rows = (att ?? []) as Array<{ date: string; status: string }>;
      const workingDays = rows.length ? String(rows.length) : "";
      const present = rows.filter((r) => String(r.status).toLowerCase() === "present").length;
      const daysPresent = rows.length ? String(present) : "";

      // Fee clearance for the gate + "dues paid upto".
      let due: number | null = null;
      if (leadId) {
        const { data: fee } = await supabase.rpc("lead_fee_status" as never, { _lead_id: leadId } as never);
        const f = (fee ?? {}) as Record<string, unknown>;
        due = Number(f["full_course_amount_due"] ?? 0);
      }
      setDues(due);

      const admDate = str("admission_date") || str("date_of_admission");
      const joiningClass = str("joining_class");
      const now = new Date();
      setForm({
        ...emptyForm(),
        name: str("name"),
        motherName: str("mother_name"),
        fatherName: str("father_name") || str("guardian_name"),
        nationality: str("nationality") || "Indian",
        category: str("caste_category") || "General",
        firstAdmissionDateClass: [fmtDate(admDate), joiningClass ? `Class ${joiningClass}` : ""].filter(Boolean).join(", "),
        dob: str("dob"),
        feeConcession: str("concession_category") || str("fee_remarks") || "None",
        workingDays,
        daysPresent,
        gamesActivities: str("sports"),
        duesPaidUpto: due === 0 ? now.toLocaleDateString("en-IN", { month: "long", year: "numeric" }) : "",
      });
      setDialogOpen(true);
    } finally {
      setBusy(false);
    }
  };

  const submit = async () => {
    if (dues !== null && dues !== 0) {
      toast({ variant: "destructive", title: "Fees not cleared", description: `Outstanding dues of ${dues}. Clear dues before issuing a TC.` });
      return;
    }
    setBusy(true);
    const { error } = await supabase.rpc("submit_tc_request" as never, { _student_id: studentId, _details: form } as never);
    setBusy(false);
    if (error) {
      toast({ variant: "destructive", title: "Could not submit TC", description: error.message });
      return;
    }
    toast({ title: "Transfer certificate submitted for approval" });
    setDialogOpen(false);
    loadRequest();
  };

  const generatePdf = useCallback(async (requestId: string) => {
    const { error } = await invokeEdge("generate-transfer-certificate", { body: { tc_request_id: requestId } });
    if (error) {
      toast({ variant: "destructive", title: "PDF generation failed", description: error.message });
      return;
    }
    loadRequest();
  }, [toast, loadRequest]);

  const approve = async () => {
    if (!request) return;
    setBusy(true);
    const { error } = await supabase.rpc("approve_tc_request" as never, { _request_id: request.id, _notes: null } as never);
    if (error) {
      setBusy(false);
      toast({ variant: "destructive", title: "Approval failed", description: error.message });
      return;
    }
    toast({ title: "Transfer certificate approved" });
    await generatePdf(request.id);
    setBusy(false);
  };

  const reject = async () => {
    if (!request) return;
    const notes = window.prompt("Reason for rejecting this transfer certificate?") ?? null;
    setBusy(true);
    const { error } = await supabase.rpc("reject_tc_request" as never, { _request_id: request.id, _notes: notes } as never);
    setBusy(false);
    if (error) {
      toast({ variant: "destructive", title: "Rejection failed", description: error.message });
      return;
    }
    toast({ title: "Transfer certificate rejected" });
    loadRequest();
  };

  const setField = (k: keyof TcForm, val: string) => setForm((f) => ({ ...f, [k]: val }));
  const feeBlocked = dues !== null && dues !== 0;
  const statusPill = useMemo(() => {
    if (!request) return null;
    const map: Record<TcRequest["status"], { label: string; cls: string; icon: JSX.Element }> = {
      draft: { label: "Draft", cls: "bg-muted text-muted-foreground", icon: <Clock className="h-3.5 w-3.5" /> },
      pending_approval: { label: "Pending approval", cls: "bg-warning/10 text-warning-foreground", icon: <Clock className="h-3.5 w-3.5" /> },
      approved: { label: "Approved", cls: "bg-success/10 text-success-foreground", icon: <Check className="h-3.5 w-3.5" /> },
      rejected: { label: "Rejected", cls: "bg-destructive/10 text-destructive", icon: <X className="h-3.5 w-3.5" /> },
    };
    const m = map[request.status];
    return <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${m.cls}`}>{m.icon}{m.label}</span>;
  }, [request]);

  if (!canIssue && !canApprove) return null;

  const showIssueButton = canIssue && archived && (!request || request.status === "rejected");

  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <FileText className="h-4 w-4 text-muted-foreground" />
          <h3 className="text-sm font-semibold">Transfer Certificate</h3>
          {statusPill}
        </div>
        {showIssueButton && (
          <Button size="sm" className="gap-2" onClick={openIssueDialog} disabled={busy}>
            {busy ? <ButtonOrb state="composing" onFilled /> : <FileText className="h-4 w-4" />}
            Issue TC
          </Button>
        )}
      </div>

      {loading ? (
        <p className="mt-3 text-sm text-muted-foreground">Loading…</p>
      ) : request ? (
        <div className="mt-3 space-y-2 text-sm">
          {request.tc_number && <p><span className="text-muted-foreground">TC No.:</span> <span className="font-medium">{request.tc_number}</span></p>}
          {request.issue_date && <p><span className="text-muted-foreground">Issued:</span> {fmtDate(request.issue_date)}</p>}
          {request.status === "rejected" && request.decision_notes && (
            <p className="text-destructive"><AlertCircle className="mr-1 inline h-3.5 w-3.5" />{request.decision_notes}</p>
          )}

          {request.status === "pending_approval" && canApprove && (
            <div className="flex gap-2 pt-1">
              <Button size="sm" className="gap-2" onClick={approve} disabled={busy}>
                {busy ? <ButtonOrb state="composing" onFilled /> : <Check className="h-4 w-4" />} Approve & generate
              </Button>
              <Button size="sm" variant="outline" className="gap-2" onClick={reject} disabled={busy}>
                <X className="h-4 w-4" /> Reject
              </Button>
            </div>
          )}

          {request.status === "approved" && (
            <div className="flex gap-2 pt-1">
              {request.tc_pdf_path ? (
                <Button size="sm" variant="outline" className="gap-2" asChild>
                  <a href={request.tc_pdf_path} target="_blank" rel="noreferrer"><Download className="h-4 w-4" /> Download PDF</a>
                </Button>
              ) : (
                <Button size="sm" className="gap-2" onClick={() => generatePdf(request.id)} disabled={busy}>
                  {busy ? <ButtonOrb state="composing" onFilled /> : <FileText className="h-4 w-4" />} Generate PDF
                </Button>
              )}
            </div>
          )}
        </div>
      ) : (
        <p className="mt-3 text-sm text-muted-foreground">
          {canIssue && !archived
            ? "Archive the student first — a transfer certificate can only be issued for an archived student."
            : "No transfer certificate issued yet."}
        </p>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-h-[85vh] max-w-3xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Issue Transfer Certificate (CBSE)</DialogTitle>
            <DialogDescription>
              Fields are pre-filled from the student record. Review every field — the TC is an official CBSE document.
            </DialogDescription>
          </DialogHeader>

          {feeBlocked && (
            <div className="flex items-center gap-2 rounded-lg border border-destructive/20 bg-destructive/5 p-3 text-sm text-destructive">
              <AlertCircle className="h-4 w-4" />
              Outstanding dues of {dues}. A TC cannot be issued until fees are fully cleared.
            </div>
          )}

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {FIELD_LABELS.map(([key, label, type]) => (
              <div key={key} className={type === "area" ? "sm:col-span-2" : ""}>
                <Label className="text-xs">{label}</Label>
                {type === "area" ? (
                  <Textarea value={form[key]} onChange={(e) => setField(key, e.target.value)} rows={2} />
                ) : (
                  <Input type={type === "date" ? "date" : "text"} value={form[key]} onChange={(e) => setField(key, e.target.value)} />
                )}
              </div>
            ))}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={busy}>Cancel</Button>
            <Button onClick={submit} disabled={busy || feeBlocked}>
              {busy ? <ButtonOrb state="composing" onFilled /> : null}
              Submit for approval
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
