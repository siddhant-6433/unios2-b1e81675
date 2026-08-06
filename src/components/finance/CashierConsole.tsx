// CashierConsole — the accountant's counter. Search a student, applicant or
// lead, see their fee ledger, take the money, levy an ad-hoc charge, or send a
// payment link if the payer isn't standing at the desk.
//
// Deliberately thin: everything below the header strip is an existing panel
// (StudentFeePanel post-admission, LeadFeeLedger pre-admission) so there is
// exactly one implementation of "what does this person owe".

import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { StudentFeePanel } from "./StudentFeePanel";
import { LeadFeeLedger } from "./LeadFeeLedger";
import { SendPaymentLinkDialog } from "./SendPaymentLinkDialog";
import { StudentAvatar } from "@/components/ui/student-avatar";
import {
  Search, Loader2, IndianRupee, Link as LinkIcon, X, User, GraduationCap, Copy,
} from "lucide-react";

type Hit = {
  kind: "student" | "lead";
  id: string;
  name: string;
  phone: string | null;
  identifier: string | null;
  identifierLabel: string | null;
  stage?: string | null;
  course: string | null;
  campus: string | null;
};

type Target = {
  kind: "student" | "lead";
  leadId: string | null;
  student: any | null;
  lead: any | null;
};

export function CashierConsole() {
  const { role } = useAuth();
  const { toast } = useToast();
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [searching, setSearching] = useState(false);
  // At a fee counter you are nearly always looking for an enrolled student, so
  // enquiries stay out until asked for — otherwise half the list is leads of
  // the same name. "Active" excludes status='inactive' only: a pre_admitted
  // candidate is exactly who pays here.
  const [includeLeads, setIncludeLeads] = useState(false);
  const [activeOnly, setActiveOnly] = useState(true);
  const [target, setTarget] = useState<Target | null>(null);
  const [loadingTarget, setLoadingTarget] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  const [linkOpen, setLinkOpen] = useState(false);
  const [payLink, setPayLink] = useState<string | null>(null);

  const canCollect = ["super_admin", "accountant", "office_admin"].includes(role || "");
  const debounce = useRef<number | null>(null);

  useEffect(() => {
    if (debounce.current) window.clearTimeout(debounce.current);
    const q = query.trim();
    if (q.length < 2) { setHits([]); return; }
    debounce.current = window.setTimeout(() => runSearch(q), 250);
    return () => { if (debounce.current) window.clearTimeout(debounce.current); };
    // Re-run on toggle too, so flipping a switch updates the open list instead
    // of waiting for the next keystroke.
  }, [query, includeLeads, activeOnly]);

  // One SECURITY DEFINER RPC rather than two RLS-filtered client queries.
  // Measured on prod: the client-side version took ~12s for an accountant,
  // because the leads RLS policy only matches that role through a per-row
  // can_view_lead() call. See 20260801175219_cashier_search_rpc.sql.
  const runSearch = async (q: string) => {
    setSearching(true);
    const { data, error } = await (supabase.rpc as any)("cashier_search", {
      _q: q, _include_leads: includeLeads, _active_only: activeOnly,
    });
    setSearching(false);
    if (error) {
      // Silence here used to look like "no such student", which is the worst
      // possible failure mode at a cash counter.
      toast({ title: "Search failed", description: error.message, variant: "destructive" });
      setHits([]);
      return;
    }
    setHits((data || []).map((r: any) => ({
      kind: r.kind as "student" | "lead",
      id: r.id,
      name: r.name,
      phone: r.phone,
      identifier: r.identifier,
      identifierLabel: r.identifier_label,
      stage: r.stage,
      course: r.course,
      campus: r.campus,
    })));
  };

  const select = async (hit: Hit) => {
    setLoadingTarget(true);
    setHits([]);
    setQuery("");

    if (hit.kind === "student") {
      const { data, error } = await supabase
        .from("students")
        .select("*, courses:course_id(name, code), campuses:campus_id(name)")
        .eq("id", hit.id)
        .maybeSingle();
      setLoadingTarget(false);
      if (error || !data) {
        toast({ title: "Could not open the student", description: error?.message, variant: "destructive" });
        return;
      }
      setTarget({ kind: "student", leadId: (data as any).lead_id || null, student: data, lead: null });
      return;
    }

    // A lead may already have a student row (admitted) — prefer it.
    const { data: student } = await supabase
      .from("students")
      .select("*, courses:course_id(name, code), campuses:campus_id(name)")
      .eq("lead_id", hit.id)
      .maybeSingle();
    if (student) {
      setLoadingTarget(false);
      setTarget({ kind: "student", leadId: hit.id, student, lead: null });
      return;
    }

    const { data: lead, error } = await supabase
      .from("leads")
      .select("*, courses:course_id(name, code), campuses:campus_id(name)")
      .eq("id", hit.id)
      .maybeSingle();
    setLoadingTarget(false);
    if (error || !lead) {
      toast({ title: "Could not open the lead", description: error?.message, variant: "destructive" });
      return;
    }
    setTarget({ kind: "lead", leadId: hit.id, student: null, lead });
  };

  const person = target?.student || target?.lead;
  const leadId = target?.leadId || null;
  const refresh = () => setRefreshKey(k => k + 1);

  return (
    <div className="space-y-4">
      {/* Search */}
      <div className="relative max-w-2xl">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
          type="text"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder={includeLeads
            ? "Search students, leads and applications — name, mobile, email, admission no., PAN or application ID"
            : "Search students by name, mobile no., email, admission no. or PAN"}
          className="w-full rounded-xl border border-input bg-card py-3 pl-10 pr-10 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/20"
          autoFocus
        />
          {searching && <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" />}
        </div>

        {/* Search scope */}
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2">
          <div className="flex overflow-hidden rounded-lg border border-input">
            <button
              type="button"
              onClick={() => setIncludeLeads(false)}
              className={`px-2.5 py-1 text-[11px] font-medium transition-colors ${
                !includeLeads ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"}`}
            >
              Students
            </button>
            <button
              type="button"
              onClick={() => setIncludeLeads(true)}
              className={`px-2.5 py-1 text-[11px] font-medium transition-colors ${
                includeLeads ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"}`}
            >
              + Leads &amp; Applications
            </button>
          </div>

          <label className="flex cursor-pointer items-center gap-1.5 text-[11px] text-muted-foreground">
            <input
              type="checkbox"
              checked={activeOnly}
              onChange={(e) => setActiveOnly(e.target.checked)}
              className="h-3.5 w-3.5 accent-primary"
            />
            Active students only
            {!activeOnly && (
              <span className="text-warning">· including inactive</span>
            )}
          </label>
        </div>

        {hits.length > 0 && (
          <div className="absolute z-20 mt-1 w-full rounded-xl border border-input bg-card shadow-lg divide-y divide-border overflow-hidden">
            {hits.map(h => (
              <button
                key={`${h.kind}-${h.id}`}
                onClick={() => select(h)}
                className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-muted/40 transition-colors"
              >
                {h.kind === "student"
                  ? <GraduationCap className="h-4 w-4 text-muted-foreground shrink-0" />
                  : <User className="h-4 w-4 text-muted-foreground shrink-0" />}
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-foreground">{h.name}</div>
                  {/* Course first: at a busy counter seven "Anjali Kumari" rows are
                      told apart by the course the candidate names, not by a phone
                      number the cashier cannot check at a glance. */}
                  {h.course && (
                    <div className="truncate text-[11px] text-foreground/70">
                      {h.course}
                      {h.campus ? ` · ${h.campus}` : ""}
                    </div>
                  )}
                  <div className="truncate text-[11px] text-muted-foreground">
                    {h.phone || "—"}
                    {h.identifier ? ` · ${h.identifierLabel} ${h.identifier}` : ""}
                  </div>
                </div>
                {/* An inactive student can now surface, so say so rather than
                    labelling every student row identically. */}
                <Badge className={`border-0 text-[10px] capitalize ${
                  h.kind === "student" && h.stage && h.stage !== "active"
                    ? "bg-warning/10 text-warning"
                    : "bg-muted text-muted-foreground"
                }`}>
                  {h.kind === "student"
                    ? (h.stage && h.stage !== "active" ? h.stage.replace(/_/g, " ") : "Student")
                    : (h.stage || "Lead").replace(/_/g, " ")}
                </Badge>
              </button>
            ))}
          </div>
        )}
      </div>

      {loadingTarget && (
        <div className="flex h-32 items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      )}

      {!target && !loadingTarget && (
        <Card className="border-border/60 shadow-none">
          <CardContent className="py-16 text-center">
            <IndianRupee className="mx-auto h-8 w-8 text-muted-foreground/50" />
            <p className="mt-3 text-sm text-muted-foreground">
              Search a student, applicant or lead to open their fee ledger.
            </p>
          </CardContent>
        </Card>
      )}

      {target && person && (
        <>
          {/* Header strip */}
          <Card className="border-border/60 shadow-none">
            <CardContent className="flex flex-wrap items-center gap-x-8 gap-y-3 p-4">
              {/* The face, so the cashier can confirm they have the right
                  candidate before taking money. Leads carry no photo — they
                  fall back to initials. */}
              <StudentAvatar
                src={person.photo_url}
                name={person.name}
                className="h-12 w-12 rounded-xl"
              />
              <Field label="Name" value={person.name} strong />
              {/* Both parents, not just the father. mother_name is in fact the
                  better-filled column (300 of 328 students against 294), and a
                  counter that only ever names the father is telling half the
                  family they are not on the record.
                  Leads have no father/mother columns at all — only
                  guardian_name — so the old Father's Name field rendered a dash
                  for every one of them. */}
              {target.kind === "student" ? (
                <>
                  <Field label="Father's Name" value={person.father_name} />
                  <Field label="Mother's Name" value={person.mother_name} />
                </>
              ) : (
                <Field label="Guardian" value={person.guardian_name} />
              )}
              <Field
                label={target.kind === "student" ? "Admission No." : "Application / PAN"}
                value={person.admission_no || person.pre_admission_no || person.application_id}
                mono
              />
              <Field label="Course" value={person.courses?.name} />
              <Field label="Campus" value={person.campuses?.name} />
              <div className="ml-auto flex items-center gap-2">
                <Badge className="border-0 bg-success/10 text-success capitalize">
                  {(target.kind === "student" ? person.status : person.stage)?.replace(/_/g, " ") || "—"}
                </Badge>
                <button
                  onClick={() => setTarget(null)}
                  className="text-muted-foreground hover:text-foreground transition-colors"
                  title="New search"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </CardContent>
          </Card>

          {/* Counter actions.
              Deliberately thin: StudentFeePanel already renders Collect Payment,
              Add Charge and Send Payment Link, and LeadFeeLedger renders Record
              Offline Payment. Repeating them here just gave the cashier two
              identical button rows stacked on top of each other. Leads are the
              only gap — LeadFeeLedger has no payment-link trigger. */}
          {target.kind === "lead" && (
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setLinkOpen(true)}>
                <LinkIcon className="h-3.5 w-3.5" /> Send Payment Link
              </Button>
              {canCollect && (
                <span className="text-xs text-muted-foreground">
                  Use “Record Offline Payment” in the ledger below to take money at the counter.
                </span>
              )}
            </div>
          )}

          {/* The created link, kept on screen so it can be pasted anywhere. */}
          {payLink && (
            <div className="flex flex-wrap items-center gap-2 rounded-xl border border-primary/30 bg-primary/5 px-3 py-2">
              <LinkIcon className="h-3.5 w-3.5 shrink-0 text-primary" />
              <span className="shrink-0 text-[11px] font-medium text-muted-foreground">Payment link</span>
              <code className="min-w-0 flex-1 truncate text-[11px] text-foreground">{payLink}</code>
              <button
                onClick={() => { navigator.clipboard?.writeText(payLink); toast({ title: "Payment link copied" }); }}
                className="shrink-0 text-muted-foreground transition-colors hover:text-foreground"
                title="Copy link"
              >
                <Copy className="h-3.5 w-3.5" />
              </button>
              <button onClick={() => setPayLink(null)} className="shrink-0 text-muted-foreground hover:text-foreground" title="Dismiss">
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          )}

          {/* Ledger */}
          {target.kind === "student"
            ? <StudentFeePanel key={refreshKey} student={target.student} onRefresh={refresh} />
            : <LeadFeeLedger leadId={target.lead.id} refreshKey={refreshKey} />}

          <SendPaymentLinkDialog
            open={linkOpen}
            onOpenChange={setLinkOpen}
            leadId={leadId || undefined}
            studentId={target.student?.id || undefined}
            defaultPurpose={target.kind === "student" ? "fee_due" : "pre_admission_token"}
            onCreated={(payUrl) => { if (payUrl) setPayLink(payUrl); refresh(); }}
          />
        </>
      )}
    </div>
  );
}

function Field({ label, value, mono, strong }: { label: string; value?: string | null; mono?: boolean; strong?: boolean }) {
  return (
    <div className="min-w-0">
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={`truncate text-sm ${strong ? "font-semibold" : ""} ${mono ? "font-mono text-xs" : ""} text-foreground`}>
        {value || "—"}
      </p>
    </div>
  );
}
