import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, Phone, Mail, MapPin, FileText, Link2, Search, Pencil, IndianRupee, Check, X } from "lucide-react";

type ConsultantLite = {
  id: string; name: string; organization: string | null; phone: string | null;
  email: string | null; city: string | null; stage: string; payout_model: string | null;
  bank_account_number: string | null; bank_account_name: string | null; bank_ifsc: string | null;
  bank_name: string | null; bank_upi: string | null;
};
type DocLite = { id: string; document_type: string; title: string; file_name: string; file_path: string };

type LeadRow = { id: string; name: string; phone: string | null; stage: string; admission_no: string | null; pre_admission_no: string | null; created_at: string; courses: { name: string } | null; consultant_commission_type: string | null; consultant_commission_value: number | null };
type ApplicationRow = { id: string; application_id: string | null; status: string | null; lead_id: string; full_name: string | null; submitted_at: string | null };
type PayoutRow = { payout_id: string; candidate_name: string; admission_no: string | null; course_name: string | null; payout_amount: number; fee_paid_pct: number; status: string };
type SearchLead = { id: string; name: string; phone: string | null; stage: string; admission_no: string | null; pre_admission_no: string | null; consultant_id: string | null };

const inr = (n: number) => `₹${Number(n || 0).toLocaleString("en-IN")}`;
const stageColor = (s: string) => s === "admitted" ? "bg-pastel-green" : s === "rejected" ? "bg-muted" : "bg-pastel-blue";
const docTypeLabel: Record<string, string> = { agreement: "Agreement", pan: "PAN", gst: "GST", tan: "TAN", bank_details: "Bank Details", fee_structure: "Fee Structure", brochure: "Brochure", additional: "Additional" };

type Tab = "overview" | "leads" | "applicants" | "payouts" | "documents";

export function ConsultantDetailDialog({
  consultant, documents, canLink, onEdit, onChanged, onClose,
}: {
  consultant: ConsultantLite | null;
  documents: DocLite[];
  canLink: boolean;
  onEdit: () => void;
  onChanged: () => void;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const [tab, setTab] = useState<Tab>("overview");
  const [loading, setLoading] = useState(true);
  const [leads, setLeads] = useState<LeadRow[]>([]);
  const [applications, setApplications] = useState<ApplicationRow[]>([]);
  const [payouts, setPayouts] = useState<PayoutRow[]>([]);
  const [showLink, setShowLink] = useState(false);
  const [linkSearch, setLinkSearch] = useState("");
  const [linkResults, setLinkResults] = useState<SearchLead[]>([]);
  const [searching, setSearching] = useState(false);
  const [linkingId, setLinkingId] = useState<string | null>(null);
  const [editCommId, setEditCommId] = useState<string | null>(null);
  const [commType, setCommType] = useState("percentage");
  const [commValue, setCommValue] = useState("");
  const [commSaving, setCommSaving] = useState(false);
  const [previewDoc, setPreviewDoc] = useState<DocLite | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  const cId = consultant?.id;

  const selectDoc = async (doc: DocLite) => {
    setPreviewDoc(doc);
    setPreviewUrl(null);
    setPreviewLoading(true);
    const { data, error } = await supabase.storage.from("consultant-documents").createSignedUrl(doc.file_path, 60 * 30);
    setPreviewLoading(false);
    if (error || !data?.signedUrl) { toast({ title: "Document unavailable", description: error?.message, variant: "destructive" }); return; }
    setPreviewUrl(data.signedUrl);
  };

  const load = async () => {
    if (!cId) return;
    setLoading(true);
    const { data: leadRows } = await supabase.from("leads")
      .select("id, name, phone, stage, admission_no, pre_admission_no, created_at, consultant_commission_type, consultant_commission_value, courses:course_id(name)")
      .eq("consultant_id", cId).order("created_at", { ascending: false });
    const ls = (leadRows || []) as unknown as LeadRow[];
    setLeads(ls);

    const leadIds = ls.map(l => l.id);
    if (leadIds.length > 0) {
      const { data: appRows } = await supabase.from("applications")
        .select("id, application_id, status, lead_id, full_name, submitted_at")
        .in("lead_id", leadIds);
      setApplications((appRows || []) as ApplicationRow[]);
    } else {
      setApplications([]);
    }

    const { data: payoutRows } = await (supabase.from("consultant_payout_sheet" as any) as any)
      .select("payout_id, candidate_name, admission_no, course_name, payout_amount, fee_paid_pct, status")
      .eq("consultant_id", cId).order("created_at", { ascending: false });
    setPayouts((payoutRows || []) as PayoutRow[]);
    setLoading(false);
  };

  useEffect(() => { if (cId) { setTab("overview"); setPreviewDoc(null); setPreviewUrl(null); load(); } /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [cId]);

  // Auto-open the first document when the Documents tab is first shown.
  useEffect(() => {
    if (tab === "documents" && !previewDoc && documents.length > 0) void selectDoc(documents[0]);
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [tab, documents]);

  const runSearch = async () => {
    const q = linkSearch.trim();
    if (q.length < 2) { setLinkResults([]); return; }
    setSearching(true);
    const like = `%${q.replace(/[%,]/g, "")}%`;
    const { data } = await supabase.from("leads")
      .select("id, name, phone, stage, admission_no, pre_admission_no, consultant_id")
      .or(`name.ilike.${like},phone.ilike.${like},admission_no.ilike.${like},pre_admission_no.ilike.${like}`)
      .limit(20);
    setLinkResults((data || []) as SearchLead[]);
    setSearching(false);
  };

  const linkLead = async (leadId: string) => {
    if (!cId) return;
    setLinkingId(leadId);
    const { error } = await (supabase.rpc as any)("assign_lead_external_owner", {
      _lead_id: leadId, _owner_type: "consultant", _consultant_id: cId, _academic_partner_id: null,
    });
    setLinkingId(null);
    if (error) { toast({ title: "Link failed", description: error.message, variant: "destructive" }); return; }
    toast({ title: "Linked to consultant" });
    setLinkResults(rs => rs.map(r => r.id === leadId ? { ...r, consultant_id: cId } : r));
    load();
    onChanged();
  };

  const startEditComm = (l: LeadRow) => {
    setEditCommId(l.id);
    setCommType(l.consultant_commission_type || "percentage");
    setCommValue(l.consultant_commission_value != null ? String(l.consultant_commission_value) : "");
  };

  const saveComm = async (leadId: string, clear = false) => {
    setCommSaving(true);
    const { error } = await (supabase.rpc as any)("set_lead_consultant_commission", {
      _lead_id: leadId,
      _commission_type: clear ? null : commType,
      _commission_value: clear ? null : (commValue.trim() === "" ? null : Number(commValue)),
    });
    setCommSaving(false);
    if (error) { toast({ title: "Couldn't set commission", description: error.message, variant: "destructive" }); return; }
    toast({ title: clear ? "Custom commission removed" : "Commission set for this lead" });
    setEditCommId(null);
    load();
    onChanged();
  };

  if (!consultant) return null;

  const applicants = leads.filter(l => applications.some(a => a.lead_id === l.id) || ["application_submitted", "offer_sent", "token_paid", "pre_admitted", "admitted"].includes(l.stage));
  const payoutTotal = payouts.reduce((t, p) => t + Number(p.payout_amount), 0);
  const payablePending = payouts.filter(p => p.status !== "paid" && p.status !== "cancelled").reduce((t, p) => t + Number(p.payout_amount), 0);

  const tabs: { key: Tab; label: string; count?: number }[] = [
    { key: "overview", label: "Overview" },
    { key: "leads", label: "Leads", count: leads.length },
    { key: "applicants", label: "Applicants", count: applicants.length },
    { key: "payouts", label: "Payouts", count: payouts.length },
    { key: "documents", label: "Documents", count: documents.length },
  ];

  return (
    <Dialog open={!!consultant} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {consultant.name}
            <Badge className={`text-[10px] border-0 ${stageColor(consultant.stage)}`}>{consultant.stage}</Badge>
          </DialogTitle>
        </DialogHeader>

        <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
          {consultant.organization && <span className="text-primary font-medium">{consultant.organization}</span>}
          {consultant.city && <span className="flex items-center gap-1"><MapPin className="h-3 w-3" />{consultant.city}</span>}
          {consultant.phone && <span className="flex items-center gap-1"><Phone className="h-3 w-3" />{consultant.phone}</span>}
          {consultant.email && <span className="flex items-center gap-1"><Mail className="h-3 w-3" />{consultant.email}</span>}
          <div className="ml-auto flex gap-2">
            {canLink && <Button size="sm" variant="outline" className="h-7 gap-1.5 text-xs" onClick={() => setShowLink(v => !v)}><Link2 className="h-3.5 w-3.5" />Link lead / applicant / student</Button>}
            <Button size="sm" variant="outline" className="h-7 gap-1.5 text-xs" onClick={onEdit}><Pencil className="h-3.5 w-3.5" />Edit</Button>
          </div>
        </div>

        {showLink && canLink && (
          <div className="rounded-xl border border-border/60 bg-muted/20 p-3 space-y-2">
            <p className="text-[11px] text-muted-foreground">Search an existing lead, applicant, or student by name, phone, or admission no. Linking sets that person's consultant to <span className="font-medium text-foreground">{consultant.name}</span>.</p>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <input value={linkSearch} onChange={e => setLinkSearch(e.target.value)} onKeyDown={e => e.key === "Enter" && runSearch()}
                  placeholder="Name, phone, or admission no…" className="w-full rounded-lg border border-input bg-background py-2 pl-8 pr-3 text-xs focus:outline-none focus:ring-2 focus:ring-ring/20" />
              </div>
              <Button size="sm" onClick={runSearch} disabled={searching} className="h-8">{searching ? <Loader2 className="h-4 w-4 animate-spin" /> : "Search"}</Button>
            </div>
            {linkResults.length > 0 && (
              <div className="max-h-52 space-y-1 overflow-y-auto">
                {linkResults.map(r => {
                  const already = r.consultant_id === cId;
                  return (
                    <div key={r.id} className="flex items-center justify-between gap-2 rounded-lg border border-border/40 bg-background px-3 py-1.5 text-xs">
                      <div className="min-w-0">
                        <span className="font-medium text-foreground">{r.name}</span>
                        <span className="ml-2 text-muted-foreground">{r.phone || "—"}{(r.admission_no || r.pre_admission_no) ? ` · ${r.admission_no || r.pre_admission_no}` : ""} · {r.stage}</span>
                      </div>
                      {already ? (
                        <Badge className="text-[9px] border-0 bg-success/10 text-success">Linked</Badge>
                      ) : r.consultant_id ? (
                        <Button size="sm" variant="outline" className="h-6 px-2 text-[10px]" disabled={linkingId === r.id} onClick={() => linkLead(r.id)}>
                          {linkingId === r.id ? <Loader2 className="h-3 w-3 animate-spin" /> : "Reassign"}
                        </Button>
                      ) : (
                        <Button size="sm" className="h-6 px-2 text-[10px]" disabled={linkingId === r.id} onClick={() => linkLead(r.id)}>
                          {linkingId === r.id ? <Loader2 className="h-3 w-3 animate-spin" /> : "Link"}
                        </Button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
            {linkSearch.trim().length >= 2 && !searching && linkResults.length === 0 && <p className="text-[11px] text-muted-foreground">No matches.</p>}
          </div>
        )}

        <div className="flex flex-wrap gap-1 border-b border-border/60">
          {tabs.map(t => (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={`rounded-t-lg px-3 py-2 text-xs font-medium transition-colors ${tab === t.key ? "border-b-2 border-primary text-foreground" : "text-muted-foreground hover:text-foreground"}`}>
              {t.label}{t.count != null ? <span className="ml-1 text-muted-foreground">({t.count})</span> : ""}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
        ) : (
          <div className="pt-1">
            {tab === "overview" && (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {[
                  { label: "Leads", value: leads.length },
                  { label: "Applicants", value: applicants.length },
                  { label: "Admissions", value: leads.filter(l => l.admission_no).length },
                  { label: "Payout Pending", value: inr(payablePending) },
                ].map(s => (
                  <div key={s.label} className="rounded-xl border border-border/60 p-3">
                    <p className="text-[11px] text-muted-foreground">{s.label}</p>
                    <p className="mt-1 text-lg font-bold text-foreground tabular-nums">{s.value}</p>
                  </div>
                ))}
                <div className="col-span-2 sm:col-span-4 rounded-xl border border-border/60 p-3 text-xs">
                  <p className="text-[11px] font-semibold uppercase text-muted-foreground mb-1">Payout account</p>
                  {consultant.bank_account_number ? (
                    <p className="text-foreground">{consultant.bank_account_name} · A/C {consultant.bank_account_number} · {consultant.bank_ifsc} · {consultant.bank_name}{consultant.bank_upi ? ` · UPI ${consultant.bank_upi}` : ""}</p>
                  ) : (
                    <p className="text-warning">No bank details on file — add them via Edit.</p>
                  )}
                </div>
              </div>
            )}

            {tab === "leads" && (
              leads.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">No leads linked to this consultant yet.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-border/40 text-left text-muted-foreground">
                        <th className="py-2 pr-3 font-medium">Name</th>
                        <th className="py-2 pr-3 font-medium">Course</th>
                        <th className="py-2 pr-3 font-medium">Stage</th>
                        <th className="py-2 pr-3 font-medium">Admission No.</th>
                        <th className="py-2 pr-3 font-medium">Commission</th>
                        {canLink && <th className="py-2 font-medium" />}
                      </tr>
                    </thead>
                    <tbody>
                      {leads.map(l => {
                        const hasOverride = l.consultant_commission_value != null;
                        const editing = editCommId === l.id;
                        return (
                          <tr key={l.id} className="border-b border-border/20 last:border-0 align-middle">
                            <td className="py-2 pr-3 font-medium text-foreground">{l.name}</td>
                            <td className="py-2 pr-3 text-muted-foreground">{l.courses?.name || "—"}</td>
                            <td className="py-2 pr-3 text-muted-foreground">{l.stage}</td>
                            <td className="py-2 pr-3 text-muted-foreground">{l.admission_no || l.pre_admission_no || "—"}</td>
                            <td className="py-2 pr-3">
                              {editing ? (
                                <div className="flex items-center gap-1">
                                  <select value={commType} onChange={e => setCommType(e.target.value)} className="rounded-md border border-input bg-background px-1.5 py-1 text-[11px]">
                                    <option value="percentage">%</option>
                                    <option value="fixed">₹ flat</option>
                                  </select>
                                  <input type="number" value={commValue} onChange={e => setCommValue(e.target.value)} placeholder="0"
                                    className="w-20 rounded-md border border-input bg-background px-1.5 py-1 text-[11px]" />
                                </div>
                              ) : hasOverride ? (
                                <Badge className="border-0 bg-pastel-purple text-[10px] font-medium text-foreground">
                                  {l.consultant_commission_type === "fixed" ? "₹" : ""}{l.consultant_commission_value}{l.consultant_commission_type === "fixed" ? " flat" : "%"} · custom
                                </Badge>
                              ) : (
                                <span className="text-muted-foreground">Default</span>
                              )}
                            </td>
                            {canLink && (
                              <td className="py-2 text-right whitespace-nowrap">
                                {editing ? (
                                  <span className="inline-flex gap-1">
                                    <Button size="sm" variant="ghost" className="h-6 w-6 p-0" disabled={commSaving} onClick={() => saveComm(l.id)}>
                                      {commSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5 text-success" />}
                                    </Button>
                                    <Button size="sm" variant="ghost" className="h-6 w-6 p-0" disabled={commSaving} onClick={() => setEditCommId(null)}>
                                      <X className="h-3.5 w-3.5" />
                                    </Button>
                                  </span>
                                ) : (
                                  <span className="inline-flex gap-1">
                                    <Button size="sm" variant="ghost" className="h-6 px-2 text-[10px]" onClick={() => startEditComm(l)}>
                                      {hasOverride ? "Edit" : "Set"}
                                    </Button>
                                    {hasOverride && (
                                      <Button size="sm" variant="ghost" className="h-6 px-2 text-[10px] text-muted-foreground" disabled={commSaving} onClick={() => saveComm(l.id, true)}>
                                        Clear
                                      </Button>
                                    )}
                                  </span>
                                )}
                              </td>
                            )}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  {canLink && <p className="mt-2 text-[10px] text-muted-foreground">Setting a custom commission overrides the consultant's default / per-course rate for that lead only, and recalculates its payout.</p>}
                </div>
              )
            )}

            {tab === "applicants" && (
              <SimpleTable
                empty="No applicants yet."
                head={["Name", "Application", "Status", "Submitted"]}
                rows={applicants.map(l => {
                  const app = applications.find(a => a.lead_id === l.id);
                  return [l.name, app?.application_id || "—", app?.status || l.stage, app?.submitted_at ? new Date(app.submitted_at).toLocaleDateString() : "—"];
                })}
              />
            )}

            {tab === "payouts" && (
              <>
                <div className="mb-2 flex items-center gap-4 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1"><IndianRupee className="h-3 w-3" />Total {inr(payoutTotal)}</span>
                  <span>Pending {inr(payablePending)}</span>
                </div>
                <SimpleTable
                  empty="No payouts. Payouts appear once a linked lead pays fees."
                  head={["Candidate", "Admission No.", "Course", "Fee Paid", "Amount", "Status"]}
                  rows={payouts.map(p => [p.candidate_name, p.admission_no || "—", p.course_name || "—", `${Number(p.fee_paid_pct)}%`, inr(Number(p.payout_amount)), p.status])}
                />
              </>
            )}

            {tab === "documents" && (
              documents.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">No documents uploaded.</p>
              ) : (
                <div className="flex gap-4">
                  {/* Left: document list */}
                  <div className="w-44 shrink-0 space-y-1 overflow-y-auto max-h-[60vh]">
                    {documents.map(d => (
                      <button key={d.id} onClick={() => selectDoc(d)}
                        className={`flex w-full items-start gap-1.5 rounded-lg border px-2 py-1.5 text-left text-[11px] transition-colors ${previewDoc?.id === d.id ? "border-primary bg-primary/5 text-foreground" : "border-border/50 text-muted-foreground hover:bg-muted/30"}`}>
                        <FileText className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                        <span className="min-w-0">
                          <span className="block font-medium text-foreground">{docTypeLabel[d.document_type] || d.title}</span>
                          <span className="block truncate">{d.file_name}</span>
                        </span>
                      </button>
                    ))}
                  </div>
                  {/* Right: inline preview */}
                  <div className="min-w-0 flex-1 rounded-xl border border-border/60 bg-muted/10">
                    {previewLoading ? (
                      <div className="flex h-[60vh] items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
                    ) : previewUrl && previewDoc ? (
                      <div className="flex h-[60vh] flex-col">
                        <div className="flex items-center justify-between border-b border-border/60 px-3 py-1.5">
                          <span className="truncate text-[11px] font-medium text-foreground">{previewDoc.file_name}</span>
                          <a href={previewUrl} target="_blank" rel="noopener noreferrer" className="shrink-0 text-[11px] text-primary hover:underline">Open ↗</a>
                        </div>
                        {/\.(png|jpe?g|gif|webp|svg)$/i.test(previewDoc.file_name) ? (
                          <div className="flex flex-1 items-center justify-center overflow-auto p-2">
                            <img src={previewUrl} alt={previewDoc.file_name} className="max-h-full max-w-full object-contain" />
                          </div>
                        ) : (
                          <iframe title={previewDoc.file_name} src={previewUrl} className="flex-1 w-full" />
                        )}
                      </div>
                    ) : (
                      <div className="flex h-[60vh] items-center justify-center text-xs text-muted-foreground">Select a document to preview</div>
                    )}
                  </div>
                </div>
              )
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function SimpleTable({ head, rows, empty }: { head: string[]; rows: (string | number)[][]; empty: string }) {
  if (rows.length === 0) return <p className="py-8 text-center text-sm text-muted-foreground">{empty}</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-border/40 text-left text-muted-foreground">
            {head.map(h => <th key={h} className="py-2 pr-3 font-medium">{h}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-b border-border/20 last:border-0">
              {r.map((c, j) => <td key={j} className={`py-2 pr-3 ${j === 0 ? "font-medium text-foreground" : "text-muted-foreground"}`}>{c}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
