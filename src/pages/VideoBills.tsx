import { useState, useEffect, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2, Receipt, CheckCircle, IndianRupee } from "lucide-react";
import {
  VIDEO_BRANDS, VIDEO_BRAND_LABEL, type VideoBrand,
} from "@/lib/videoBrands";

type EditorRow = { id: string; name: string; per_video_rate: number; active: boolean };

type VideoRow = {
  id: string; editor_id: string; brand: VideoBrand;
  is_billable: boolean; posted_month: string | null;
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
};

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

  const fetchAll = async () => {
    setLoading(true);
    const [eRes, vRes, bRes] = await Promise.all([
      supabase.from("video_editors" as any).select("id, name, per_video_rate, active"),
      supabase.from("videos" as any).select("id, editor_id, brand, is_billable, posted_month").eq("is_billable", true).eq("posted_month", month),
      supabase.from("video_bills" as any).select("*").eq("bill_month", month),
    ]);
    setEditors((eRes.data as any) || []);
    setVideos((vRes.data as any) || []);
    setBills((bRes.data as any) || []);
    setLoading(false);
  };

  useEffect(() => { fetchAll(); }, [month]);

  // (editorId, brand) → live count of billable videos for the selected month
  const liveCount = useMemo(() => {
    const map = new Map<string, number>();
    for (const v of videos) {
      const key = `${v.editor_id}|${v.brand}`;
      map.set(key, (map.get(key) || 0) + 1);
    }
    return map;
  }, [videos]);

  const billByKey = useMemo(() => {
    const map = new Map<string, BillRow>();
    for (const b of bills) map.set(`${b.editor_id}|${b.brand}`, b);
    return map;
  }, [bills]);

  // Rows: every (active editor × brand) where at least one billable video
  // exists for the month, OR a bill already exists. We don't show empty cells.
  const rows = useMemo(() => {
    const keys = new Set<string>([...liveCount.keys(), ...billByKey.keys()]);
    const out: { editor: EditorRow; brand: VideoBrand; key: string }[] = [];
    for (const key of keys) {
      const [editorId, brand] = key.split("|") as [string, VideoBrand];
      const editor = editors.find(e => e.id === editorId);
      if (!editor) continue;
      out.push({ editor, brand, key });
    }
    return out.sort((a, b) => a.editor.name.localeCompare(b.editor.name));
  }, [editors, liveCount, billByKey]);

  const handleGenerate = async (editor: EditorRow, brand: VideoBrand) => {
    setGenerating(`${editor.id}|${brand}`);
    const { error } = await supabase.rpc("generate_video_bill" as any, {
      _editor: editor.id, _brand: brand, _month: month,
    });
    if (error) {
      toast({ title: "Generate failed", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Bill generated" });
      fetchAll();
    }
    setGenerating(null);
  };

  const handleMark = async (bill: BillRow, status: "approved" | "paid") => {
    setMarking(bill.id);
    const patch: any = { status };
    if (status === "approved") patch.approved_at = new Date().toISOString();
    if (status === "paid")     patch.paid_at     = new Date().toISOString();
    const { error } = await supabase.from("video_bills" as any).update(patch).eq("id", bill.id);
    if (error) toast({ title: "Update failed", description: error.message, variant: "destructive" });
    else { toast({ title: `Bill marked ${status}` }); fetchAll(); }
    setMarking(null);
  };

  const totalForMonth = bills.reduce((s, b) => s + Number(b.total_amount), 0);

  if (loading) {
    return <div className="flex h-64 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>;
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Video Bills</h1>
          <p className="text-sm text-muted-foreground mt-1">Generate monthly bills for video editors</p>
        </div>
        <div className="flex items-center gap-2">
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
          <p className="text-[10px] text-muted-foreground ml-auto max-w-[280px]">
            A video counts toward the bill only when it has been posted on Instagram, LinkedIn AND YouTube. The bill month is the month of the latest of the three.
          </p>
        </CardContent>
      </Card>

      <Card className="border-border/60 shadow-none overflow-hidden">
        <CardContent className="p-0">
          {rows.length === 0 ? (
            <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">
              No billable videos or existing bills for this month.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/50">
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
                  {rows.map(({ editor, brand, key }) => {
                    const bill = billByKey.get(key);
                    const live = liveCount.get(key) || 0;
                    const count = bill?.video_count ?? live;
                    const rate = bill ? Number(bill.per_video_rate) : Number(editor.per_video_rate);
                    const amount = bill ? Number(bill.total_amount) : count * rate;
                    const stale = bill && bill.video_count !== live;
                    return (
                      <tr key={key} className="border-b border-border/40 hover:bg-muted/20">
                        <td className="px-4 py-3 font-medium">{editor.name}</td>
                        <td className="px-3 py-3 text-xs text-muted-foreground">{VIDEO_BRAND_LABEL[brand]}</td>
                        <td className="px-3 py-3 text-right font-medium">
                          {count}
                          {stale && <div className="text-[9px] text-warning-foreground">live: {live}</div>}
                        </td>
                        <td className="px-3 py-3 text-right">₹{rate.toLocaleString("en-IN")}</td>
                        <td className="px-3 py-3 text-right font-semibold">₹{amount.toLocaleString("en-IN")}</td>
                        <td className="px-3 py-3 text-center">
                          {bill
                            ? <Badge className={`border-0 text-[10px] font-semibold ${BILL_STATUS[bill.status].color}`}>{BILL_STATUS[bill.status].label}</Badge>
                            : <span className="text-[10px] text-muted-foreground">Not generated</span>}
                        </td>
                        <td className="px-3 py-3 text-center">
                          {isSuperAdmin && (
                            <div className="flex items-center gap-1 justify-center">
                              {(!bill || stale) && (
                                <Button size="sm" variant="outline" className="gap-1 h-7 text-xs" disabled={generating === key}
                                  onClick={() => handleGenerate(editor, brand)}>
                                  {generating === key ? <Loader2 className="h-3 w-3 animate-spin" /> : <Receipt className="h-3 w-3" />}
                                  {bill ? "Regenerate" : "Generate"}
                                </Button>
                              )}
                              {bill?.status === "draft" && (
                                <Button size="sm" className="gap-1 h-7 text-xs bg-info hover:bg-info/60" disabled={marking === bill.id}
                                  onClick={() => handleMark(bill, "approved")}>
                                  {marking === bill.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle className="h-3 w-3" />} Approve
                                </Button>
                              )}
                              {bill?.status === "approved" && (
                                <Button size="sm" className="gap-1 h-7 text-xs bg-success hover:bg-success/90" disabled={marking === bill.id}
                                  onClick={() => handleMark(bill, "paid")}>
                                  {marking === bill.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle className="h-3 w-3" />} Mark Paid
                                </Button>
                              )}
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
