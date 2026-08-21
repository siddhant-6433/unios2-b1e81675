// Fee Notifications — bulk-send personalised WhatsApp fee-payment links to a
// batch of students. Preview first (dry_run) so staff see exactly who gets
// messaged and what they currently owe, then confirm and send for real.

import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ButtonOrb, OrbLoader } from "@/components/ui/thinking-orb";
import { SelectField, FieldShell } from "@/components/ui/state-fields";
import {
  DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent,
  DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Send, Info, AlertTriangle, Filter } from "lucide-react";

interface CourseOption { id: string; name: string; code: string }
interface SessionOption { id: string; name: string }
interface CampusOption { id: string; name: string; city: string | null }

const FEE_TERM_OPTIONS = [
  { value: "year_1", label: "Year 1" },
  { value: "year_2", label: "Year 2" },
  { value: "year_3", label: "Year 3" },
  { value: "year_4", label: "Year 4" },
];

interface MatchedStudent { student_id: string; name: string; phone: string; due: number }
interface PreviewResponse {
  matched: MatchedStudent[];
  total: number;
  skipped_no_due: number;
  skipped_no_phone: number;
  error?: string;
}
interface SendResult { student_id: string; ok: boolean; error?: string }
interface SendResponse {
  campaign_id: string;
  total: number;
  sent: number;
  failed: number;
  results: SendResult[];
  error?: string;
}

const defaultExpiryDate = () => {
  const d = new Date();
  d.setDate(d.getDate() + 14);
  return d.toISOString().slice(0, 10);
};

const FeeNotifications = () => {
  const { toast } = useToast();

  const [courses, setCourses] = useState<CourseOption[]>([]);
  const [sessions, setSessions] = useState<SessionOption[]>([]);
  const [campuses, setCampuses] = useState<CampusOption[]>([]);
  const [loadingOptions, setLoadingOptions] = useState(true);

  const [courseIds, setCourseIds] = useState<string[]>([]);
  const [sessionId, setSessionId] = useState<string>("");
  const [campusId, setCampusId] = useState<string>("");
  const [feeTerm, setFeeTerm] = useState<string>("year_2");
  const [expiryDate, setExpiryDate] = useState<string>(defaultExpiryDate());
  const [purposeLabel, setPurposeLabel] = useState<string>("Fee due");

  const [previewing, setPreviewing] = useState(false);
  const [sending, setSending] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [sendResult, setSendResult] = useState<SendResponse | null>(null);

  useEffect(() => {
    (async () => {
      const [c, s, cam] = await Promise.all([
        supabase.from("courses").select("id, name, code").order("name"),
        supabase.from("admission_sessions").select("id, name").order("name"),
        supabase.from("campuses").select("id, name, city").order("name"),
      ]);
      setCourses(c.data || []);
      setSessions(s.data || []);
      setCampuses(cam.data || []);
      setLoadingOptions(false);
    })();
  }, []);

  const expiresDays = () => {
    const ms = new Date(expiryDate).getTime() - Date.now();
    return Math.max(1, Math.ceil(ms / 86400000));
  };

  const buildBody = (dryRun: boolean) => ({
    course_ids: courseIds,
    ...(sessionId ? { session_id: sessionId } : {}),
    ...(campusId ? { campus_id: campusId } : {}),
    fee_term: feeTerm,
    expires_days: expiresDays(),
    purpose_label: purposeLabel.trim() || "Fee due",
    dry_run: dryRun,
  });

  const extractError = async (error: unknown, data: any) => {
    if (data?.error) return data.error as string;
    const ctx = (error as { context?: { text?: () => Promise<string> } })?.context;
    const text = await ctx?.text?.().catch(() => "");
    try { return JSON.parse(text || "{}").error || (error as Error)?.message || "Request failed"; }
    catch { return (error as Error)?.message || "Request failed"; }
  };

  const handlePreview = async () => {
    if (courseIds.length === 0) {
      toast({ title: "Pick at least one course", variant: "destructive" });
      return;
    }
    setPreviewing(true);
    setPreview(null);
    setSendResult(null);
    const { data, error } = await supabase.functions.invoke("fee-notify-bulk", { body: buildBody(true) });
    setPreviewing(false);
    if (error || data?.error) {
      toast({ title: "Preview failed", description: await extractError(error, data), variant: "destructive" });
      return;
    }
    setPreview(data as PreviewResponse);
  };

  const handleSend = async () => {
    setConfirmOpen(false);
    setSending(true);
    const { data, error } = await supabase.functions.invoke("fee-notify-bulk", { body: buildBody(false) });
    setSending(false);
    if (error || data?.error) {
      toast({ title: "Send failed", description: await extractError(error, data), variant: "destructive" });
      return;
    }
    const res = data as SendResponse;
    setSendResult(res);
    toast({
      title: `Sent ${res.sent}, failed ${res.failed}`,
      variant: res.failed > 0 ? "destructive" : "default",
    });
  };

  const toggleCourse = (id: string) => {
    setCourseIds((current) => current.includes(id) ? current.filter((c) => c !== id) : [...current, id]);
    setPreview(null);
  };

  const courseLabel = courseIds.length === 0
    ? "Select courses"
    : courseIds.length === 1
      ? courses.find((c) => c.id === courseIds[0])?.name || "1 course"
      : `${courseIds.length} courses`;

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Fee Notifications</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Bulk-send personalised WhatsApp fee-payment links to students in a batch
        </p>
      </div>

      <div className="rounded-lg border border-blue-200 bg-blue-50/60 dark:border-blue-900/40 dark:bg-blue-950/20 px-3 py-2 text-xs text-blue-800 dark:text-blue-300 flex gap-2">
        <Info className="h-4 w-4 shrink-0 mt-0.5" />
        <p>
          The payment link is live — each student pays exactly what they owe on the day they open it,
          including any ₹/day late fine. Late fine accrues only for fee terms that have a late fine
          configured (e.g. B.Ed Kotputli Year 2: ₹100/day after 31 Aug).
        </p>
      </div>

      <div className="rounded-xl bg-card card-shadow p-4 space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <FieldShell label="Course(s)" required>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button type="button" variant="outline" className="h-10 w-full justify-start rounded-xl font-normal" disabled={loadingOptions}>
                  <Filter className="h-4 w-4 text-muted-foreground" />
                  <span className="ml-2 truncate">{courseLabel}</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="max-h-72 w-64 overflow-y-auto">
                <DropdownMenuLabel className="text-xs text-muted-foreground">Select one or more</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {courses.length === 0 ? (
                  <div className="px-2 py-4 text-center text-xs text-muted-foreground">No courses found</div>
                ) : courses.map((c) => (
                  <DropdownMenuCheckboxItem
                    key={c.id}
                    checked={courseIds.includes(c.id)}
                    onCheckedChange={() => toggleCourse(c.id)}
                    onSelect={(e) => e.preventDefault()}
                  >
                    {c.name} <span className="ml-1 text-muted-foreground">({c.code})</span>
                  </DropdownMenuCheckboxItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </FieldShell>

          <SelectField
            label="Session"
            value={sessionId}
            onValueChange={(v) => { setSessionId(v); setPreview(null); }}
            options={sessions.map((s) => ({ value: s.id, label: s.name }))}
            placeholder="All sessions"
          />

          <SelectField
            label="Campus"
            value={campusId}
            onValueChange={(v) => { setCampusId(v); setPreview(null); }}
            options={campuses.map((c) => ({ value: c.id, label: c.city ? `${c.name} (${c.city})` : c.name }))}
            placeholder="All campuses"
          />

          <SelectField
            label="Fee term"
            required
            value={feeTerm}
            onValueChange={(v) => { setFeeTerm(v); setPreview(null); }}
            options={FEE_TERM_OPTIONS}
            allowEmpty={false}
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <FieldShell label="Link valid until">
            <Input
              type="date"
              value={expiryDate}
              onChange={(e) => { setExpiryDate(e.target.value); setPreview(null); }}
              min={new Date().toISOString().slice(0, 10)}
            />
          </FieldShell>

          <div className="sm:col-span-2 lg:col-span-2">
            <FieldShell label="Message label">
              <Input
                value={purposeLabel}
                maxLength={60}
                placeholder="Fee due"
                onChange={(e) => { setPurposeLabel(e.target.value); setPreview(null); }}
              />
            </FieldShell>
          </div>
        </div>

        <div className="flex items-center gap-2 pt-2">
          <Button type="button" variant="outline" onClick={handlePreview} disabled={previewing || sending}>
            {previewing ? <ButtonOrb state="connecting" onFilled /> : null}
            {previewing ? "Previewing…" : "Preview"}
          </Button>
          <Button
            type="button"
            onClick={() => setConfirmOpen(true)}
            disabled={!preview || preview.total === 0 || previewing || sending}
          >
            <Send className="h-4 w-4" />
            {sending ? "Sending…" : "Send WhatsApp fee links"}
          </Button>
        </div>
      </div>

      {previewing && (
        <div className="flex h-40 items-center justify-center">
          <OrbLoader state="searching" />
        </div>
      )}

      {preview && !previewing && (
        <div className="rounded-xl bg-card card-shadow p-4 space-y-3">
          <p className="text-sm text-muted-foreground">
            <span className="font-semibold text-foreground">{preview.total}</span> student{preview.total === 1 ? "" : "s"} will be messaged
            {" · "}{preview.skipped_no_due} skipped (already paid)
            {" · "}{preview.skipped_no_phone} skipped (no phone)
          </p>
          {preview.matched.length > 0 && (
            <div className="rounded-lg border border-border overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Student</TableHead>
                    <TableHead>Phone</TableHead>
                    <TableHead className="text-right">Current due</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {preview.matched.map((m) => (
                    <TableRow key={m.student_id}>
                      <TableCell>{m.name}</TableCell>
                      <TableCell>{m.phone}</TableCell>
                      <TableCell className="text-right">₹{Number(m.due).toLocaleString("en-IN")}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </div>
      )}

      {sendResult && (
        <div className="rounded-xl bg-card card-shadow p-4 space-y-3">
          <p className="text-sm font-medium text-foreground">
            Sent {sendResult.sent} of {sendResult.total} · {sendResult.failed} failed
          </p>
          {sendResult.failed > 0 && (
            <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 space-y-1">
              <p className="flex items-center gap-1.5 text-xs font-semibold text-destructive">
                <AlertTriangle className="h-3.5 w-3.5" /> Failures
              </p>
              {sendResult.results.filter((r) => !r.ok).map((r) => (
                <p key={r.student_id} className="text-xs text-muted-foreground">
                  {r.student_id}: {r.error || "Unknown error"}
                </p>
              ))}
            </div>
          )}
        </div>
      )}

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Send to {preview?.total ?? 0} students?</AlertDialogTitle>
            <AlertDialogDescription>
              Each student will receive a WhatsApp message with a personalised payment link for
              their current due amount. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleSend}>Send</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default FeeNotifications;
