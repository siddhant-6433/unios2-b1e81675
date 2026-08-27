import { PageLoader } from "@/components/ui/page-loader";
import { ButtonOrb } from "@/components/ui/thinking-orb";
import { useState, useEffect, useMemo, Fragment } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Receipt, CheckCircle, IndianRupee, Building2, ChevronRight, ChevronDown, Download, Trash2, RefreshCw } from "lucide-react";
import {
  VIDEO_BRAND_LABEL, CONTENT_TYPE_LABEL, type VideoBrand, type VideoContentType,
} from "@/lib/videoBrands";
import { videoBillSlipBase64 } from "@/components/video/videoBillSlip";
import { VendorMatchDialog, type VendorCandidate } from "@/components/video/VendorMatchDialog";
import { exportRowsXlsx, formatExportDateTime, type ExportRow } from "@/lib/xlsxExport";

type EditorRow = {
  id: string; name: string; per_video_rate: number; active: boolean;
  bank_account_name?: string | null; bank_account_number?: string | null;
  bank_ifsc?: string | null; bank_name?: string | null; bank_upi?: string | null;
  bank_verified_name?: string | null; bank_verification_status?: string | null;
};

type VideoRow = {
  id: string; editor_id: string; brand: VideoBrand;
  is_billable: boolean; posted_month: string | null; video_bill_id: string | null;
  title: string; content_type: VideoContentType; status: string;
  instagram_url: string | null; instagram_posted_on: string | null;
  linkedin_url: string | null; linkedin_posted_on: string | null;
  youtube_url: string | null; youtube_posted_on: string | null;
};

type BillRow = {
  id: string;
  editor_id: string;
  brand: VideoBrand;
  bill_month: string;
  video_count: number;
  per_video_rate: number;
  total_amount: number;
  status: "draft" | "approved" | "paid";
  generated_at: string;
  approved_at: string | null;
  paid_at: string | null;
  zoho_bill_id: string | null;
  zoho_bill_number: string | null;
  zoho_synced_at: string | null;
  zoho_sync_error: string | null;
};

// A display row is either an existing bill or the pool of not-yet-billed videos
// for an (editor × brand).
type Disp =
  | { kind: "bill"; id: string; editor: EditorRow; brand: VideoBrand; bill: BillRow; videos: VideoRow[] }
  | { kind: "unbilled"; id: string; editor: EditorRow; brand: VideoBrand; videos: VideoRow[] };

function monthOptions(): { value: string; label: string }[] {
  const now = new Date();
  const out: { value: string; label: string }[] = [];
  for (let i = 0; i < 12; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
    const label = d.toLocaleDateString("en-IN", { month: "long", year: "numeric" });
    out.push({ value, label });
  }
  return out;
}

const BILL_STATUS: Record<string, { label: string; color: string }> = {
  draft:    { label: "Draft",    color: "bg-gray-100 text-gray-700" },
  approved: { label: "Approved", color: "bg-info/10 text-info-foreground" },
  paid:     { label: "Paid",     color: "bg-success/10 text-success" },
};

// One platform's cell in the drill-down: linked posting date (or "Posted" when
// the URL exists but no date was recorded), else a muted dash.
function platformCell(url: string | null, posted: string | null) {
  if (!url) return <span className="text-muted-foreground">—</span>;
  // IG/YouTube carry auto-fetched dates; LinkedIn has no public API so it shows
  // just "Posted" (the link is proof of posting; its date doesn't drive billing).
  const label = posted ? new Date(posted).toLocaleDateString("en-IN") : "Posted";
  return <a href={url} target="_blank" rel="noreferrer" className="text-primary hover:underline">{label}</a>;
}

export default function VideoBills() {
  const { role } = useAuth();
  const { toast } = useToast();
  const isSuperAdmin = role === "super_admin";

  const months = useMemo(() => monthOptions(), []);
  const [month, setMonth] = useState(months[1]?.value || months[0].value); // default to last month

  const [editors, setEditors] = useState<EditorRow[]>([]);
  const [videos, setVideos] = useState<VideoRow[]>([]);
  const [bills, setBills] = useState<BillRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState<string | null>(null);
  const [marking, setMarking] = useState<string | null>(null);
  const [syncing, setSyncing] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [vendorPrompt, setVendorPrompt] = useState<
    { editorName: string; billId: string; pdfBase64?: string; candidates: VendorCandidate[] } | null
  >(null);
  const [exporting, setExporting] = useState(false);
  const [fetchingDates, setFetchingDates] = useState(false);

  const fetchAll = async () => {
    setLoading(true);
    const [eRes, vRes, bRes] = await Promise.all([
      supabase.from("video_editors" as any).select("id, name, per_video_rate, active, bank_account_name, bank_account_number, bank_ifsc, bank_name, bank_upi, bank_verified_name, bank_verification_status"),
      supabase.from("videos" as any)
        .select("id, editor_id, brand, is_billable, posted_month, video_bill_id, title, content_type, status, instagram_url, instagram_posted_on, linkedin_url, linkedin_posted_on, youtube_url, youtube_posted_on")
        .eq("is_billable", true).eq("posted_month", month),
      supabase.from("video_bills" as any).select("*").eq("bill_month", month),
    ]);
    setEditors((eRes.data as any) || []);
    setVideos((vRes.data as any) || []);
    setBills((bRes.data as any) || []);
    setLoading(false);
  };

  useEffect(() => { fetchAll(); }, [month]);

  // Build display rows: one per existing bill (with its claimed videos), plus an
  // "unbilled" pool row per (editor × brand) that still has unclaimed videos.
  const dispRows = useMemo<Disp[]>(() => {
    const byBill = new Map<string, VideoRow[]>();
    const unbilled = new Map<string, VideoRow[]>(); // key: editor|brand
    for (const v of videos) {
      if (v.video_bill_id) {
        byBill.set(v.video_bill_id, [...(byBill.get(v.video_bill_id) || []), v]);
      } else {
        const k = `${v.editor_id}|${v.brand}`;
        unbilled.set(k, [...(unbilled.get(k) || []), v]);
      }
    }
    const out: Disp[] = [];
    for (const b of bills) {
      const editor = editors.find(e => e.id === b.editor_id);
      if (!editor) continue;
      out.push({ kind: "bill", id: b.id, editor, brand: b.brand, bill: b, videos: byBill.get(b.id) || [] });
    }
    for (const [k, vids] of unbilled) {
      if (vids.length === 0) continue;
      const [editorId, brand] = k.split("|") as [string, VideoBrand];
      const editor = editors.find(e => e.id === editorId);
      if (!editor) continue;
      out.push({ kind: "unbilled", id: `unbilled|${k}`, editor, brand, videos: vids });
    }
    return out.sort((a, b) =>
      a.editor.name.localeCompare(b.editor.name)
      || VIDEO_BRAND_LABEL[a.brand].localeCompare(VIDEO_BRAND_LABEL[b.brand])
      || (a.kind === b.kind ? 0 : a.kind === "bill" ? -1 : 1),
    );
  }, [videos, bills, editors]);

  const handleGenerate = async (editor: EditorRow, brand: VideoBrand) => {
    setGenerating(`${editor.id}|${brand}`);
    const { error } = await supabase.rpc("generate_video_bill" as any, {
      _editor: editor.id, _brand: brand, _month: month,
    });
    if (error) toast({ title: "Generate failed", description: error.message, variant: "destructive" });
    else { toast({ title: "Bill generated" }); fetchAll(); }
    setGenerating(null);
  };

  const handleMark = async (bill: BillRow, status: "approved" | "paid") => {
    setMarking(bill.id);
    const patch: any = { status };
    if (status === "approved") patch.approved_at = new Date().toISOString();
    if (status === "paid")     patch.paid_at     = new Date().toISOString();
    const { error } = await supabase.from("video_bills" as any).update(patch).eq("id", bill.id);
    if (error) { toast({ title: "Update failed", description: error.message, variant: "destructive" }); setMarking(null); return; }
    // Best-effort: record the payment in Zoho if the bill was synced.
    if (status === "paid" && bill.zoho_bill_id) {
      const { data: zData, error: zErr } = await supabase.functions.invoke("zoho-video-bill-sync", {
        body: { bill_id: bill.id, action: "record_payment" },
      });
      const zMsg = zErr?.message || (zData as { error?: string } | null)?.error;
      if (zMsg) toast({ title: "Marked paid, but Zoho payment sync failed", description: zMsg, variant: "destructive" });
    }
    toast({ title: `Bill marked ${status}` }); fetchAll();
    setMarking(null);
  };

  const handleDelete = async (bill: BillRow) => {
    if (!window.confirm("Delete this draft bill? Its videos return to the unbilled pool and can be billed again.")) return;
    setDeleting(bill.id);
    const { error } = await supabase.rpc("delete_video_bill" as any, { _bill: bill.id });
    if (error) toast({ title: "Delete failed", description: error.message, variant: "destructive" });
    else { toast({ title: "Draft bill deleted" }); fetchAll(); }
    setDeleting(null);
  };

  const handleZohoSync = async (bill: BillRow, opts?: { relink?: boolean }) => {
    setSyncing(bill.id);
    const editor = editors.find(e => e.id === bill.editor_id);
    const pdf_base64 = editor
      ? videoBillSlipBase64(editor, {
          brand: bill.brand, bill_month: bill.bill_month, video_count: bill.video_count,
          per_video_rate: bill.per_video_rate, total_amount: bill.total_amount, status: bill.status,
        })
      : undefined;
    const { data, error } = await supabase.functions.invoke("zoho-video-bill-sync", {
      body: { bill_id: bill.id, action: "create_bill", pdf_base64, relink: opts?.relink },
    });
    setSyncing(null);
    const res = data as { error?: string; needs_vendor_choice?: boolean; candidates?: VendorCandidate[] } | null;
    // Editor not yet linked to a Zoho vendor — let staff pick a match (or create new).
    if (res?.needs_vendor_choice) {
      setVendorPrompt({ editorName: editor?.name || "editor", billId: bill.id, pdfBase64: pdf_base64, candidates: res.candidates || [] });
      return;
    }
    const errMsg = error?.message || res?.error;
    if (errMsg) { toast({ title: "Zoho sync failed", description: errMsg, variant: "destructive" }); return; }
    toast({ title: "Sent to Zoho Books" });
    fetchAll();
  };

  // Re-push a bill after fixing a bad Zoho mapping: clear the stored Zoho refs and
  // re-open the vendor picker so the correct existing vendor can be chosen. Delete the
  // duplicate bill (and vendor) in Zoho first — a leftover bill with the same reference
  // number would be reused instead of recreated.
  const handleResync = async (bill: BillRow) => {
    if (!window.confirm("Re-sync to Zoho? Delete the duplicate bill in Zoho Books first — you'll then pick the correct vendor and a fresh bill is created.")) return;
    setSyncing(bill.id);
    const { error } = await supabase.from("video_bills" as any).update({
      zoho_bill_id: null, zoho_bill_number: null, zoho_payment_id: null,
      zoho_synced_at: null, zoho_sync_error: null,
    }).eq("id", bill.id);
    if (error) { toast({ title: "Re-sync failed", description: error.message, variant: "destructive" }); setSyncing(null); return; }
    await handleZohoSync({ ...bill, zoho_bill_id: null }, { relink: true });
  };

  // Pull real posting dates from Instagram/YouTube for this month's billable
  // videos (fraud-proof; recomputes each video's bill month via the DB trigger).
  const handleFetchDates = async () => {
    setFetchingDates(true);
    const { data, error } = await supabase.functions.invoke("video-fetch-post-dates", { body: { month } });
    setFetchingDates(false);
    const res = data as any;
    const errMsg = error?.message || res?.error;
    if (errMsg) { toast({ title: "Fetch failed", description: errMsg, variant: "destructive" }); return; }
    const ig = res?.instagram?.set ?? 0, yt = res?.youtube?.set ?? 0;
    toast({ title: `Updated ${res?.updated ?? 0} videos`, description: `Instagram ${ig}, YouTube ${yt}. Videos may move to their real posting month.` });
    fetchAll();
  };

  const handleExport = async () => {
    if (videos.length === 0) { toast({ title: "Nothing to export for this month" }); return; }
    setExporting(true);
    const billById = new Map(bills.map(b => [b.id, b]));
    const editorById = new Map(editors.map(e => [e.id, e]));
    const rows: ExportRow[] = videos.map(v => {
      const b = v.video_bill_id ? billById.get(v.video_bill_id) : undefined;
      return {
        Editor: editorById.get(v.editor_id)?.name || v.editor_id,
        Brand: VIDEO_BRAND_LABEL[v.brand],
        Bill: b ? (b.zoho_bill_number || `#${b.id.slice(0, 8)}`) : "Unbilled",
        "Bill Status": b ? BILL_STATUS[b.status].label : "—",
        Title: v.title,
        "Content Type": CONTENT_TYPE_LABEL[v.content_type],
        "Instagram URL": v.instagram_url || "",
        "Instagram Posted": formatExportDateTime(v.instagram_posted_on),
        "LinkedIn URL": v.linkedin_url || "",
        "LinkedIn Posted": formatExportDateTime(v.linkedin_posted_on),
        "YouTube URL": v.youtube_url || "",
        "YouTube Posted": formatExportDateTime(v.youtube_posted_on),
        "Video Status": v.status,
        "Bill Month": month,
      };
    });
    await exportRowsXlsx(rows, "Video Bills", `video-bills-${month}`);
    setExporting(false);
    toast({ title: `Exported ${rows.length} videos` });
  };

  const totalForMonth = bills.reduce((s, b) => s + Number(b.total_amount), 0);

  if (loading) return <PageLoader />;

  const detailTable = (vids: VideoRow[]) => (
    <table className="w-full text-xs">
      <thead>
        <tr className="text-left text-muted-foreground">
          <th className="px-2 py-1.5 font-medium">Title</th>
          <th className="px-2 py-1.5 font-medium">Type</th>
          <th className="px-2 py-1.5 font-medium">Instagram</th>
          <th className="px-2 py-1.5 font-medium">LinkedIn</th>
          <th className="px-2 py-1.5 font-medium">YouTube</th>
          <th className="px-2 py-1.5 font-medium text-center">Published</th>
        </tr>
      </thead>
      <tbody>
        {vids.length === 0 ? (
          <tr><td colSpan={6} className="px-2 py-3 text-center text-muted-foreground">No videos.</td></tr>
        ) : vids.map(v => (
          <tr key={v.id} className="border-t border-border/40">
            <td className="px-2 py-1.5 font-medium text-foreground">{v.title}</td>
            <td className="px-2 py-1.5 text-muted-foreground">{CONTENT_TYPE_LABEL[v.content_type]}</td>
            <td className="px-2 py-1.5">{platformCell(v.instagram_url, v.instagram_posted_on)}</td>
            <td className="px-2 py-1.5">{platformCell(v.linkedin_url, v.linkedin_posted_on)}</td>
            <td className="px-2 py-1.5">{platformCell(v.youtube_url, v.youtube_posted_on)}</td>
            <td className="px-2 py-1.5 text-center">
              <Badge className={`border-0 text-[9px] font-semibold ${v.status === "published" ? "bg-success/10 text-success" : "bg-gray-100 text-gray-700"}`}>
                {v.status === "published" ? "Published" : v.status}
              </Badge>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Video Bills</h1>
          <p className="text-sm text-muted-foreground mt-1">Generate monthly bills for video editors</p>
        </div>
        <div className="flex items-center gap-2">
          {isSuperAdmin && (
            <Button size="sm" variant="outline" className="gap-1.5 h-9 text-xs" disabled={fetchingDates || videos.length === 0} onClick={handleFetchDates}
              title="Pull real Instagram/YouTube posting dates from the links">
              {fetchingDates ? <ButtonOrb state="composing" /> : <RefreshCw className="h-3.5 w-3.5" />} Fetch dates
            </Button>
          )}
          <Button size="sm" variant="outline" className="gap-1.5 h-9 text-xs" disabled={exporting || videos.length === 0} onClick={handleExport}>
            {exporting ? <ButtonOrb state="composing" /> : <Download className="h-3.5 w-3.5" />} Export to Excel
          </Button>
          <span className="text-xs text-muted-foreground">Month:</span>
          <select value={month} onChange={e => setMonth(e.target.value)}
            className="rounded-xl border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20">
            {months.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
          </select>
        </div>
      </div>

      <Card className="border-border/60 shadow-none">
        <CardContent className="p-4 flex items-center gap-6">
          <div>
            <p className="text-[10px] text-muted-foreground uppercase font-semibold">Total Billed</p>
            <p className="text-2xl font-bold flex items-center gap-1"><IndianRupee className="h-5 w-5" />{totalForMonth.toLocaleString("en-IN")}</p>
          </div>
          <div>
            <p className="text-[10px] text-muted-foreground uppercase font-semibold">Bills</p>
            <p className="text-2xl font-bold">{bills.length}</p>
          </div>
          <div>
            <p className="text-[10px] text-muted-foreground uppercase font-semibold">Billable Videos</p>
            <p className="text-2xl font-bold">{videos.length}</p>
          </div>
          <p className="text-[10px] text-muted-foreground ml-auto max-w-[300px]">
            A video counts toward the bill only when it has been posted on Instagram, LinkedIn AND YouTube. Videos posted later in the month can be billed separately — each video is billed once.
          </p>
        </CardContent>
      </Card>

      <Card className="border-border/60 shadow-none overflow-hidden">
        <CardContent className="p-0">
          {dispRows.length === 0 ? (
            <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">
              No billable videos or existing bills for this month.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/50">
                    <th className="w-8 px-2 py-3" />
                    <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase">Editor</th>
                    <th className="px-3 py-3 text-left text-xs font-semibold text-muted-foreground uppercase">Brand</th>
                    <th className="px-3 py-3 text-right text-xs font-semibold text-muted-foreground uppercase">Videos</th>
                    <th className="px-3 py-3 text-right text-xs font-semibold text-muted-foreground uppercase">Rate</th>
                    <th className="px-3 py-3 text-right text-xs font-semibold text-muted-foreground uppercase">Amount</th>
                    <th className="px-3 py-3 text-center text-xs font-semibold text-muted-foreground uppercase">Status</th>
                    <th className="px-3 py-3 text-center text-xs font-semibold text-muted-foreground uppercase">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {dispRows.map((d) => {
                    const isBill = d.kind === "bill";
                    const bill = isBill ? d.bill : undefined;
                    const count = isBill ? bill!.video_count : d.videos.length;
                    const rate = isBill ? Number(bill!.per_video_rate) : Number(d.editor.per_video_rate);
                    const amount = isBill ? Number(bill!.total_amount) : count * rate;
                    const open = expanded === d.id;
                    return (
                      <Fragment key={d.id}>
                        <tr className="border-b border-border/40 hover:bg-muted/20">
                          <td className="px-2 py-3 text-center">
                            <button onClick={() => setExpanded(open ? null : d.id)} className="text-muted-foreground hover:text-foreground" title="Show videos">
                              {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                            </button>
                          </td>
                          <td className="px-4 py-3 font-medium">{d.editor.name}</td>
                          <td className="px-3 py-3 text-xs text-muted-foreground">{VIDEO_BRAND_LABEL[d.brand]}</td>
                          <td className="px-3 py-3 text-right font-medium">{count}</td>
                          <td className="px-3 py-3 text-right">₹{rate.toLocaleString("en-IN")}</td>
                          <td className="px-3 py-3 text-right font-semibold">₹{amount.toLocaleString("en-IN")}</td>
                          <td className="px-3 py-3 text-center">
                            <div className="flex flex-col items-center gap-0.5">
                              {isBill
                                ? <Badge className={`border-0 text-[10px] font-semibold ${BILL_STATUS[bill!.status].color}`}>{BILL_STATUS[bill!.status].label}</Badge>
                                : <Badge className="border-0 text-[10px] font-semibold bg-warning/10 text-warning-foreground">New · unbilled</Badge>}
                              {bill?.zoho_bill_id && (
                                <Badge className="border-0 bg-primary/10 text-primary text-[9px] gap-0.5" title={bill.zoho_synced_at ? `Synced ${new Date(bill.zoho_synced_at).toLocaleString("en-IN")}` : ""}>
                                  <Building2 className="h-2.5 w-2.5" />Zoho {bill.zoho_bill_number || "✓"}
                                </Badge>
                              )}
                              {bill?.zoho_sync_error && (
                                <span className="text-[9px] text-destructive" title={bill.zoho_sync_error}>Zoho error</span>
                              )}
                            </div>
                          </td>
                          <td className="px-3 py-3 text-center">
                            {isSuperAdmin && (
                              <div className="flex items-center gap-1 justify-center">
                                {!isBill && (
                                  <Button size="sm" variant="outline" className="gap-1 h-7 text-xs" disabled={generating === `${d.editor.id}|${d.brand}`}
                                    onClick={() => handleGenerate(d.editor, d.brand)}>
                                    {generating === `${d.editor.id}|${d.brand}` ? <ButtonOrb state="composing" /> : <Receipt className="h-3 w-3" />} Generate
                                  </Button>
                                )}
                                {bill?.status === "draft" && (
                                  <>
                                    <Button size="sm" className="gap-1 h-7 text-xs bg-info hover:bg-info/60" disabled={marking === bill.id}
                                      onClick={() => handleMark(bill, "approved")}>
                                      {marking === bill.id ? <ButtonOrb state="composing" onFilled /> : <CheckCircle className="h-3 w-3" />} Approve
                                    </Button>
                                    <Button size="sm" variant="ghost" className="h-7 px-2 text-destructive hover:text-destructive" disabled={deleting === bill.id}
                                      onClick={() => handleDelete(bill)} title="Delete draft bill (unclaims its videos)">
                                      {deleting === bill.id ? <ButtonOrb state="composing" /> : <Trash2 className="h-3 w-3" />}
                                    </Button>
                                  </>
                                )}
                                {bill?.status === "approved" && !bill.zoho_bill_id && (
                                  <Button size="sm" variant="ghost" className="gap-1 h-7 text-xs" disabled={syncing === bill.id}
                                    onClick={() => handleZohoSync(bill)} title={bill.zoho_sync_error || "Create a bill in Zoho Books"}>
                                    {syncing === bill.id ? <ButtonOrb state="composing" /> : <Building2 className="h-3 w-3" />} Send to Zoho
                                  </Button>
                                )}
                                {bill?.zoho_bill_id && (
                                  <Button size="sm" variant="ghost" className="gap-1 h-7 text-xs" disabled={syncing === bill.id}
                                    onClick={() => handleResync(bill)} title="Fix a wrong vendor mapping: delete the duplicate in Zoho, then re-push and pick the correct vendor">
                                    {syncing === bill.id ? <ButtonOrb state="composing" /> : <RefreshCw className="h-3 w-3" />} Re-sync
                                  </Button>
                                )}
                                {bill?.status === "approved" && (
                                  <Button size="sm" className="gap-1 h-7 text-xs bg-success hover:bg-success/90" disabled={marking === bill.id}
                                    onClick={() => handleMark(bill, "paid")}>
                                    {marking === bill.id ? <ButtonOrb state="composing" onFilled /> : <CheckCircle className="h-3 w-3" />} Mark Paid
                                  </Button>
                                )}
                              </div>
                            )}
                          </td>
                        </tr>
                        {open && (
                          <tr className="bg-muted/20">
                            <td colSpan={8} className="px-4 py-3">
                              {detailTable(d.videos)}
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {vendorPrompt && (
        <VendorMatchDialog
          editorName={vendorPrompt.editorName}
          billId={vendorPrompt.billId}
          pdfBase64={vendorPrompt.pdfBase64}
          candidates={vendorPrompt.candidates}
          onDone={fetchAll}
          onClose={() => setVendorPrompt(null)}
        />
      )}
    </div>
  );
}
