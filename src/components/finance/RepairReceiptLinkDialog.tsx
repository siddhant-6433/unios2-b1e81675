import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FieldShell } from "@/components/ui/state-fields";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertTriangle, CheckCircle, Search, ShieldCheck } from "lucide-react";
import { classifyReceiptRepairError, type ReceiptRepairRetryAction } from "@/lib/financeReceiptRepairErrors";

type StudentOption = {
  id: string;
  name: string;
  admission_no: string | null;
  pre_admission_no: string | null;
  lead_id: string | null;
  course_id: string | null;
  campus_id: string | null;
  dob: string | null;
  father_name: string | null;
  mother_name: string | null;
  courses?: { name?: string } | null;
  campuses?: { name?: string } | null;
};

type RepairIdentity = {
  payment: {
    id: string;
    status: string;
    amount: number;
    receipt_no: string | null;
    transaction_ref: string | null;
    student_id: string | null;
    lead_id: string;
    application_id: string | null;
  };
  lead: {
    id: string;
    name: string;
    campus_id: string | null;
    course_id: string | null;
    application_id: string | null;
    courses?: { name?: string } | null;
    campuses?: { name?: string } | null;
  };
  application: {
    application_id: string;
    full_name: string;
    lead_id: string | null;
    dob: string | null;
    father_name: string | null;
    father_first_name: string | null;
    father_last_name: string | null;
    mother_name: string | null;
    mother_first_name: string | null;
    mother_last_name: string | null;
    course_selections?: { course_id?: string | null; course_name?: string | null }[] | null;
  } | null;
  applicationId: string | null;
  currentStudent: StudentOption | null;
};

type DbResult<T> = { data: T; error: { message?: string; code?: string } | null };
type LooseQuery = PromiseLike<DbResult<unknown>> & {
  select(columns: string): LooseQuery;
  eq(column: string, value: unknown): LooseQuery;
  or(filter: string): LooseQuery;
  order(column: string, options?: { ascending?: boolean }): LooseQuery;
  limit(count: number): LooseQuery;
  maybeSingle(): Promise<DbResult<unknown>>;
};

const receiptDb = supabase as unknown as {
  from(table: string): LooseQuery;
  rpc(name: string, args: Record<string, unknown>): Promise<DbResult<unknown>>;
};

function normalizeName(value: string | null | undefined) {
  return (value || "").trim().replace(/\s+/g, " ").toLocaleLowerCase();
}

function joinedName(first: string | null | undefined, last: string | null | undefined) {
  return normalizeName([first, last].filter(Boolean).join(" "));
}

function applicationParentName(name: string | null | undefined, first: string | null | undefined, last: string | null | undefined) {
  return normalizeName(name) || joinedName(first, last);
}

function messageFromError(error: unknown) {
  return error && typeof error === "object" && "message" in error
    ? String((error as { message?: unknown }).message || "Please try again.")
    : "Please try again.";
}

export function RepairReceiptLinkDialog({
  payment: paymentSummary,
  open,
  onOpenChange,
  onDone,
}: {
  payment: Record<string, unknown> | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDone: () => void;
}) {
  const { toast } = useToast();
  const [identity, setIdentity] = useState<RepairIdentity | null>(null);
  const [identityLoading, setIdentityLoading] = useState(false);
  const [identityError, setIdentityError] = useState<string | null>(null);
  const [studentSearch, setStudentSearch] = useState("");
  const [studentResults, setStudentResults] = useState<StudentOption[]>([]);
  const [studentLoading, setStudentLoading] = useState(false);
  const [studentError, setStudentError] = useState<string | null>(null);
  const [studentSearchRetryKey, setStudentSearchRetryKey] = useState(0);
  const [selectedStudent, setSelectedStudent] = useState<StudentOption | null>(null);
  const [reason, setReason] = useState("");
  const [verified, setVerified] = useState(false);
  const [saving, setSaving] = useState(false);
  const [repairError, setRepairError] = useState<string | null>(null);
  const [repairRetryAction, setRepairRetryAction] = useState<ReceiptRepairRetryAction>(null);
  const identityRequest = useRef(0);
  const searchRequest = useRef(0);

  const loadIdentity = useCallback(async () => {
    if (typeof paymentSummary?.id !== "string") return;
    const request = ++identityRequest.current;
    setIdentityLoading(true);
    setIdentityError(null);
    setRepairError(null);
    setRepairRetryAction(null);
    setVerified(false);
    setIdentity(null);
    try {
    const { data: paymentData, error: paymentError } = await receiptDb
      .from("lead_payments")
      .select("id, status, amount, receipt_no, transaction_ref, student_id, lead_id, application_id")
      .eq("id", paymentSummary.id)
      .maybeSingle();
    if (request !== identityRequest.current) return;
    const payment = paymentData as RepairIdentity["payment"] | null;
    if (paymentError || !payment) {
      setIdentityError(paymentError?.message || "This receipt could not be loaded. Retry to review it again.");
      return;
    }
    if (!payment.lead_id) {
      setIdentityError("This receipt has no lead identity to verify.");
      return;
    }
    const { data: leadData, error: leadError } = await receiptDb
      .from("leads")
      .select("id, name, campus_id, course_id, application_id, courses:course_id(name), campuses:campus_id(name)")
      .eq("id", payment.lead_id)
      .maybeSingle();
    if (request !== identityRequest.current) return;
    const lead = leadData as RepairIdentity["lead"] | null;
    if (leadError || !lead) {
      setIdentityError(leadError?.message || "The receipt lead could not be loaded. Retry to review it again.");
      return;
    }
    const applicationId = payment.application_id || lead.application_id || null;
    let application: RepairIdentity["application"] = null;
    if (applicationId) {
      const appResult = await receiptDb
        .from("applications")
        .select("application_id, full_name, lead_id, course_selections, dob, father_name:father->>name, father_first_name:father->>first_name, father_last_name:father->>last_name, mother_name:mother->>name, mother_first_name:mother->>first_name, mother_last_name:mother->>last_name")
        .eq("application_id", applicationId)
        .maybeSingle();
      if (request !== identityRequest.current) return;
      if (appResult.error) {
        setIdentityError(appResult.error.message || "The application identity could not be loaded. Retry to review it again.");
        return;
      }
      application = appResult.data as RepairIdentity["application"];
    }
    let currentStudent: StudentOption | null = null;
    if (payment.student_id) {
      const studentResult = await receiptDb
        .from("students")
        .select("id, name, admission_no, pre_admission_no, lead_id, course_id, campus_id, dob, father_name, mother_name, courses:course_id(name), campuses:campus_id(name)")
        .eq("id", payment.student_id)
        .maybeSingle();
      if (request !== identityRequest.current) return;
      if (studentResult.error || !studentResult.data) {
        setIdentityError(studentResult.error?.message || "The current student link could not be loaded. Retry to review it again.");
        return;
      }
      currentStudent = studentResult.data as StudentOption;
    }
    setIdentity({ payment, lead, application, applicationId, currentStudent });
    setSelectedStudent(currentStudent);
    const summaryName = typeof paymentSummary.person_name === "string" ? paymentSummary.person_name : "";
    setStudentSearch((current) => current || summaryName || lead.name || "");
    } catch (caught) {
      if (request === identityRequest.current) {
        setIdentityError(messageFromError(caught));
      }
    } finally {
      if (request === identityRequest.current) setIdentityLoading(false);
    }
  }, [paymentSummary]);

  useEffect(() => {
    if (!open) {
      identityRequest.current += 1;
      searchRequest.current += 1;
      setIdentityLoading(false);
      setStudentLoading(false);
      return;
    }
    setIdentity(null);
    setSelectedStudent(null);
    setStudentResults([]);
    setStudentSearch(typeof paymentSummary?.person_name === "string" ? paymentSummary.person_name : "");
    setReason("");
    setVerified(false);
    setRepairError(null);
    setRepairRetryAction(null);
    void loadIdentity();
  }, [open, paymentSummary?.id, paymentSummary?.person_name, loadIdentity]);

  useEffect(() => {
    const request = ++searchRequest.current;
    if (!open || !identity || studentSearch.trim().length < 2) {
      setStudentResults([]);
      setStudentError(null);
      setStudentLoading(false);
      return;
    }
    const timer = window.setTimeout(async () => {
      setStudentLoading(true);
      setStudentError(null);
      const value = studentSearch.trim().replace(/\\/g, "\\\\").replace(/"/g, '\\"');
      try {
        const { data, error } = await receiptDb
          .from("students")
          .select("id, name, admission_no, pre_admission_no, lead_id, course_id, campus_id, dob, father_name, mother_name, courses:course_id(name), campuses:campus_id(name)")
          .or(`name.ilike."%${value}%",admission_no.ilike."%${value}%",pre_admission_no.ilike."%${value}%"`)
          .order("name")
          .limit(10);
        if (request !== searchRequest.current) return;
        if (error) {
          setStudentResults([]);
          setStudentError(error.message || "Student search failed. Retry the search.");
        } else {
          setStudentResults((data || []) as StudentOption[]);
        }
      } catch (caught) {
        if (request === searchRequest.current) {
          setStudentResults([]);
          setStudentError(messageFromError(caught));
        }
      } finally {
        if (request === searchRequest.current) setStudentLoading(false);
      }
    }, 250);
    return () => {
      window.clearTimeout(timer);
      if (request === searchRequest.current) searchRequest.current += 1;
    };
  }, [open, identity, studentSearch, studentSearchRetryKey]);

  const identityEvidence = useMemo(() => {
    if (!identity || !selectedStudent) return null;
    const applicationName = normalizeName(identity.application?.full_name);
    const studentName = normalizeName(selectedStudent.name);
    const directLeadMatch = selectedStudent.lead_id === identity.lead.id;
    const applicationNamePrefixMatch = !!applicationName && studentName.startsWith(`${applicationName} `);
    const applicationFatherName = applicationParentName(identity.application?.father_name, identity.application?.father_first_name, identity.application?.father_last_name);
    const applicationMotherName = applicationParentName(identity.application?.mother_name, identity.application?.mother_first_name, identity.application?.mother_last_name);
    const studentFatherName = normalizeName(selectedStudent.father_name);
    const studentMotherName = normalizeName(selectedStudent.mother_name);
    const dateOfBirthMatch = !!identity.application?.dob && !!selectedStudent.dob && identity.application.dob === selectedStudent.dob;
    const fatherNameMatch = !!applicationFatherName && applicationFatherName === studentFatherName;
    const motherNameMatch = !!applicationMotherName && applicationMotherName === studentMotherName;
    const parentNameMatch = fatherNameMatch || motherNameMatch;
    const conflictingIdentityDetails = (!!applicationName && studentName !== applicationName && !applicationNamePrefixMatch)
      || (!!identity.application?.dob && !!selectedStudent.dob && identity.application.dob !== selectedStudent.dob)
      || (!!applicationFatherName && !!studentFatherName && applicationFatherName !== studentFatherName)
      || (!!applicationMotherName && !!studentMotherName && applicationMotherName !== studentMotherName);
    const exactApplicationNameMatch = !!applicationName && studentName === applicationName && !conflictingIdentityDetails;
    const applicationProfileMatch = applicationNamePrefixMatch && dateOfBirthMatch && parentNameMatch && !conflictingIdentityDetails;
    return {
      directLeadMatch,
      exactApplicationNameMatch,
      applicationProfileMatch,
      dateOfBirthMatch,
      fatherNameMatch,
      motherNameMatch,
      conflictingIdentityDetails,
    };
  }, [identity, selectedStudent]);

  const mismatchReasons = useMemo(() => {
    if (!identity || !selectedStudent) return ["Select a student to compare the identities."];
    const reasons: string[] = [];
    const applicationMatchesLead = !identity.applicationId || !!identity.application && (
      identity.application.lead_id === identity.lead.id ||
      identity.application.lead_id === null && identity.lead.application_id === identity.application.application_id
    );
    if (!applicationMatchesLead) reasons.push("The application is not linked to this receipt lead.");
    if (!selectedStudent.campus_id || selectedStudent.campus_id !== identity.lead.campus_id) {
      reasons.push("The target student campus does not match the receipt campus.");
    }
    if (identity.lead.course_id && selectedStudent.course_id !== identity.lead.course_id) {
      reasons.push("The target student course does not match the receipt course.");
    }
    const applicationCourseIds = (identity.application?.course_selections || [])
      .map((selection) => selection.course_id?.toLowerCase())
      .filter((courseId): courseId is string => !!courseId);
    if (!identity.lead.course_id && applicationCourseIds.length > 0 && !applicationCourseIds.includes(selectedStudent.course_id?.toLowerCase() || "")) {
      reasons.push("The target student course does not match a course selected on the application.");
    }
    if (identityEvidence?.conflictingIdentityDetails) {
      reasons.push("Available date of birth or parent details conflict with the application.");
    }
    const identityLinked = !!identityEvidence && (
      identityEvidence.directLeadMatch
      || identityEvidence.exactApplicationNameMatch
      || identityEvidence.applicationProfileMatch
    );
    if (!identityLinked) {
      reasons.push("The student is not linked to the receipt lead and the application name, date of birth, and parent name do not provide a complete identity match.");
    }
    return reasons;
  }, [identity, selectedStudent, identityEvidence]);

  const handleRepair = async () => {
    if (!identity || !selectedStudent || mismatchReasons.length || !verified || reason.trim().length < 8) return;
    setSaving(true);
    setRepairError(null);
    setRepairRetryAction(null);
    try {
      const { error } = await receiptDb.rpc("repair_confirmed_lead_payment_student_link", {
        _payment_id: identity.payment.id,
        _student_id: selectedStudent.id,
        _expected_student_id: identity.payment.student_id,
        _application_id: identity.applicationId,
        _reason: reason.trim(),
        _identity_confirmed: verified,
      });
      if (error) {
        const failure = classifyReceiptRepairError(error);
        setRepairError(failure.message);
        setRepairRetryAction(failure.action);
        return;
      }
      toast({
        title: "Existing receipt linked",
        description: `${identity.payment.receipt_no || "Receipt"} is now visible on ${selectedStudent.name}'s student record. No new payment was created.`,
      });
      onOpenChange(false);
      onDone();
    } catch (caught) {
      const failure = classifyReceiptRepairError(caught);
      setRepairError(failure.message);
      setRepairRetryAction(failure.action);
    } finally {
      setSaving(false);
    }
  };

  const identityMatches = !!identity && !!selectedStudent && mismatchReasons.length === 0;
  const unchangedLink = !!identity && !!selectedStudent && identity.payment.student_id === selectedStudent.id;
  const readyToRepair = identityMatches && !unchangedLink && verified && reason.trim().length >= 8 && !saving;

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => {
      if (!nextOpen && (saving || identityLoading)) return;
      onOpenChange(nextOpen);
    }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-primary" /> Review existing receipt
          </DialogTitle>
        </DialogHeader>

        {identityLoading ? (
          <div className="py-8 text-center text-sm text-muted-foreground">Loading receipt identity…</div>
        ) : identityError ? (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Could not load receipt identity</AlertTitle>
            <AlertDescription className="mt-2 space-y-3">
              <p>{identityError}</p>
              <Button variant="outline" onClick={() => void loadIdentity()}>Retry review</Button>
            </AlertDescription>
          </Alert>
        ) : identity ? (
          <div className="space-y-4">
            <section className="rounded-lg border bg-muted/20 p-3 text-sm">
              <h3 className="mb-2 font-semibold">Existing payment</h3>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-2">
                <div><dt className="text-xs text-muted-foreground">Receipt</dt><dd className="font-mono">{identity.payment.receipt_no || "—"}</dd></div>
                <div><dt className="text-xs text-muted-foreground">Amount</dt><dd>₹{Number(identity.payment.amount).toLocaleString("en-IN")}</dd></div>
                <div><dt className="text-xs text-muted-foreground">Reference</dt><dd className="break-all font-mono text-xs">{identity.payment.transaction_ref || "—"}</dd></div>
                <div><dt className="text-xs text-muted-foreground">Application ID</dt><dd className="font-mono">{identity.applicationId || "Not linked"}</dd></div>
                <div><dt className="text-xs text-muted-foreground">Currently linked student</dt><dd>{identity.currentStudent ? `${identity.currentStudent.name} · ${identity.currentStudent.admission_no || identity.currentStudent.pre_admission_no || "No admission number"}` : "No student link"}</dd></div>
              </dl>
            </section>

            <section className="rounded-lg border bg-muted/20 p-3 text-sm">
              <h3 className="mb-2 font-semibold">Receipt identity</h3>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-2">
                <div><dt className="text-xs text-muted-foreground">Lead</dt><dd>{identity.lead.name} <span className="font-mono text-[10px] text-muted-foreground">{identity.lead.id}</span></dd></div>
                <div><dt className="text-xs text-muted-foreground">Campus</dt><dd>{identity.lead.campuses?.name || "—"}</dd></div>
                <div><dt className="text-xs text-muted-foreground">Lead course</dt><dd>{identity.lead.courses?.name || "—"}</dd></div>
                <div><dt className="text-xs text-muted-foreground">Application name</dt><dd>{identity.application?.full_name || "—"}</dd></div>
                <div><dt className="text-xs text-muted-foreground">Application date of birth</dt><dd>{identity.application?.dob || "—"}</dd></div>
                {(identity.application?.father_name || identity.application?.father_first_name || identity.application?.father_last_name) && <div><dt className="text-xs text-muted-foreground">Application father</dt><dd>{identity.application.father_name || [identity.application.father_first_name, identity.application.father_last_name].filter(Boolean).join(" ")}</dd></div>}
                {(identity.application?.mother_name || identity.application?.mother_first_name || identity.application?.mother_last_name) && <div><dt className="text-xs text-muted-foreground">Application mother</dt><dd>{identity.application.mother_name || [identity.application.mother_first_name, identity.application.mother_last_name].filter(Boolean).join(" ")}</dd></div>}
                <div className="col-span-2"><dt className="text-xs text-muted-foreground">Application course(s)</dt><dd>{identity.application?.course_selections?.map((selection) => selection.course_name || selection.course_id).filter(Boolean).join(", ") || "—"}</dd></div>
              </dl>
            </section>

            <FieldShell label="Find target student">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={studentSearch}
                  onChange={(event) => { setStudentSearch(event.target.value); setSelectedStudent(null); setVerified(false); setRepairError(null); setRepairRetryAction(null); }}
                  placeholder="Search name or admission number"
                  className="pl-9"
                  aria-label="Find target student"
                />
              </div>
            </FieldShell>
            {studentError && (
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle>Student search failed</AlertTitle>
                <AlertDescription className="mt-2 space-y-3">
                  <p>{studentError}</p>
                  <Button variant="outline" onClick={() => setStudentSearchRetryKey((value) => value + 1)}>Retry student search</Button>
                </AlertDescription>
              </Alert>
            )}
            {studentLoading && <p className="text-xs text-muted-foreground">Searching students…</p>}
            {!studentLoading && studentResults.length > 0 && !selectedStudent && (
              <div className="max-h-36 overflow-y-auto rounded-lg border divide-y">
                {studentResults.map((student) => (
                  <button
                    key={student.id}
                    type="button"
                    className="flex w-full items-start justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-muted"
                    onClick={() => { setSelectedStudent(student); setStudentSearch(student.name); setVerified(false); setRepairError(null); setRepairRetryAction(null); }}
                  >
                    <span><span className="block font-medium">{student.name}</span><span className="text-xs text-muted-foreground">{student.admission_no || student.pre_admission_no || "No admission number"}</span></span>
                    <span className="text-right text-xs text-muted-foreground">{student.courses?.name || "No course"}<br />{student.campuses?.name || "No campus"}</span>
                  </button>
                ))}
              </div>
            )}
            {!studentLoading && studentSearch.trim().length >= 2 && studentResults.length === 0 && !studentError && !selectedStudent && (
              <p className="text-xs text-muted-foreground">No students matched this search.</p>
            )}

            {selectedStudent && (
              <section className="rounded-lg border border-primary/30 bg-primary/5 p-3 text-sm">
                <h3 className="mb-2 flex items-center gap-2 font-semibold"><CheckCircle className="h-4 w-4 text-primary" /> Target student</h3>
                <dl className="grid grid-cols-2 gap-x-4 gap-y-2">
                  <div><dt className="text-xs text-muted-foreground">Student</dt><dd>{selectedStudent.name}</dd></div>
                  <div><dt className="text-xs text-muted-foreground">Admission No.</dt><dd>{selectedStudent.admission_no || selectedStudent.pre_admission_no || "—"}</dd></div>
                  <div><dt className="text-xs text-muted-foreground">Course</dt><dd>{selectedStudent.courses?.name || "—"}</dd></div>
                  <div><dt className="text-xs text-muted-foreground">Campus</dt><dd>{selectedStudent.campuses?.name || "—"}</dd></div>
                  <div><dt className="text-xs text-muted-foreground">Date of birth</dt><dd>{selectedStudent.dob || "—"}</dd></div>
                  <div><dt className="text-xs text-muted-foreground">Father</dt><dd>{selectedStudent.father_name || "—"}</dd></div>
                  <div><dt className="text-xs text-muted-foreground">Mother</dt><dd>{selectedStudent.mother_name || "—"}</dd></div>
                </dl>
              </section>
            )}

            {selectedStudent && unchangedLink ? (
              <Alert variant="info">
                <CheckCircle className="h-4 w-4" />
                <AlertTitle>Receipt is already linked</AlertTitle>
                <AlertDescription>Select a different verified student only if this existing link is incorrect.</AlertDescription>
              </Alert>
            ) : selectedStudent && (identityMatches ? (
              <Alert variant="success">
                <CheckCircle className="h-4 w-4" />
                <AlertTitle>{identityEvidence?.applicationProfileMatch ? "Application identity details match" : "Identity matches"}</AlertTitle>
                <AlertDescription>
                  {identityEvidence?.applicationProfileMatch
                    ? `The application name is a prefix of the student name, date of birth matches, and ${identityEvidence.motherNameMatch ? "mother's" : "father's"} name matches. ${identityEvidence.directLeadMatch ? "The target student is also directly linked to this receipt lead." : "The target student is not directly linked to this receipt lead; this match comes from application identity."} The database will check that only one student matches these details before linking.`
                    : "The lead, application, course, and campus support linking this existing receipt to the selected student."}
                </AlertDescription>
              </Alert>
            ) : (
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle>Identity mismatch</AlertTitle>
                <AlertDescription><ul className="list-disc pl-4">{mismatchReasons.map((item) => <li key={item}>{item}</li>)}</ul></AlertDescription>
              </Alert>
            ))}

            <FieldShell label="Reason for correction">
              <Input aria-label="Reason for correction" value={reason} onChange={(event) => { setReason(event.target.value); setRepairError(null); setRepairRetryAction(null); }} placeholder="Explain why this receipt should link to this student" />
            </FieldShell>
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" className="mt-1" checked={verified} onChange={(event) => setVerified(event.target.checked)} disabled={!identityMatches} />
              <span>I verified the receipt reference and the student identity details above.</span>
            </label>
            {repairError && (
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle>Could not link receipt</AlertTitle>
                <AlertDescription className="mt-2 space-y-3">
                  <p>{repairError}</p>
                  {repairRetryAction && (
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => void (repairRetryAction === "reload" ? loadIdentity() : handleRepair())}
                      disabled={repairRetryAction === "reload" ? identityLoading : !readyToRepair}
                    >
                      {repairRetryAction === "reload" ? "Reload receipt" : "Retry link"}
                    </Button>
                  )}
                </AlertDescription>
              </Alert>
            )}
          </div>
        ) : null}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving || identityLoading}>Cancel</Button>
          <Button onClick={handleRepair} disabled={!readyToRepair}>
            {saving ? "Linking existing receipt…" : "Link existing receipt"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
