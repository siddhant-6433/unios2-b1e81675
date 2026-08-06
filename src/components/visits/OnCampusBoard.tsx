import { PageLoader } from "@/components/ui/page-loader";
import { ButtonOrb } from "@/components/ui/thinking-orb";
// OnCampusBoard — everyone currently checked in (today, not yet checked out).
// Check-out goes through the visit_check_out RPC. While the visitor is at the
// desk, staff can send a payment link, build a fee proposal, or record a
// token payment without leaving the board.

import { useState, useEffect, useCallback, lazy, Suspense } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { MapPin, Footprints, LogOut, IndianRupee, FileText, Banknote, ChevronRight, RefreshCw, DoorOpen } from "lucide-react";

const SendPaymentLinkDialog = lazy(() =>
  import("@/components/finance/SendPaymentLinkDialog").then(m => ({ default: m.SendPaymentLinkDialog })));
const SchoolFeeProposalDialog = lazy(() =>
  import("@/components/admissions/SchoolFeeProposalDialog").then(m => ({ default: m.SchoolFeeProposalDialog })));
const RecordPaymentDialog = lazy(() =>
  import("@/components/admissions/RecordPaymentDialog").then(m => ({ default: m.RecordPaymentDialog })));

interface OnCampusRow {
  id: string;
  lead_id: string;
  checked_in_at: string;
  visit_type: string | null;
  purpose: string | null;
  lead_name: string;
  lead_phone: string;
  campus_name: string;
}

function elapsed(iso: string): string {
  const mins = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 60) return `${mins}m`;
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

function fmtClock(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true });
}

interface Props {
  campusId?: string;
  refreshKey?: number;
  onChanged?: () => void;
}

export function OnCampusBoard({ campusId, refreshKey, onChanged }: Props) {
  const { toast } = useToast();
  const [rows, setRows] = useState<OnCampusRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [payLinkLead, setPayLinkLead] = useState<OnCampusRow | null>(null);
  const [proposalLead, setProposalLead] = useState<OnCampusRow | null>(null);
  const [paymentLead, setPaymentLead] = useState<OnCampusRow | null>(null);

  const fetchRows = useCallback(async () => {
    setLoading(true);
    const start = new Date(); start.setHours(0, 0, 0, 0);
    let q = supabase
      .from("campus_visits")
      .select(`
        id, lead_id, checked_in_at, visit_type, purpose,
        leads!inner(name, phone),
        campuses(name)
      `)
      .gte("checked_in_at", start.toISOString())
      .is("checked_out_at" as any, null)
      .order("checked_in_at", { ascending: true });
    if (campusId) q = q.eq("campus_id", campusId);

    const { data, error } = await q;
    setLoading(false);
    if (error) return;
    setRows((data ?? []).map((r: any) => ({
      id: r.id,
      lead_id: r.lead_id,
      checked_in_at: r.checked_in_at,
      visit_type: r.visit_type,
      purpose: r.purpose,
      lead_name: r.leads?.name ?? "—",
      lead_phone: r.leads?.phone ?? "",
      campus_name: r.campuses?.name ?? "—",
    })));
  }, [campusId]);

  useEffect(() => { fetchRows(); }, [fetchRows, refreshKey]);

  const checkOut = async (v: OnCampusRow) => {
    setBusyId(v.id);
    const { error } = await supabase.rpc("visit_check_out" as any, { _visit_id: v.id });
    setBusyId(null);
    if (error) { toast({ title: "Check-out failed", description: error.message, variant: "destructive" }); return; }
    toast({ title: "Checked out", description: v.lead_name });
    fetchRows(); onChanged?.();
  };

  if (loading) return <PageLoader />;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-foreground flex items-center gap-1.5">
          <DoorOpen className="h-4 w-4 text-primary" /> On campus now ({rows.length})
        </h2>
        <button onClick={fetchRows} className="text-muted-foreground hover:text-foreground" title="Refresh">
          <RefreshCw className="h-3.5 w-3.5" />
        </button>
      </div>

      {rows.length === 0 ? (
        <p className="rounded-xl border border-dashed py-10 text-center text-sm text-muted-foreground">
          No visitors currently checked in.
        </p>
      ) : (
        <div className="space-y-2">
          {rows.map((v) => (
            <div key={v.id} className="rounded-xl border bg-card p-3">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <Link to={`/admissions/${v.lead_id}`} className="font-medium text-foreground hover:underline truncate">
                      {v.lead_name}
                    </Link>
                    {v.visit_type === "walk_in" && (
                      <Badge className="border-0 bg-primary/10 text-primary text-[10px] gap-1"><Footprints className="h-2.5 w-2.5" /> Walk-in</Badge>
                    )}
                    <Badge className="border-0 bg-success/10 text-success text-[10px]">
                      In since {fmtClock(v.checked_in_at)} · {elapsed(v.checked_in_at)}
                    </Badge>
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1"><MapPin className="h-3 w-3" />{v.campus_name}</span>
                    {v.lead_phone && <span>{v.lead_phone}</span>}
                    {v.purpose && <span className="italic">{v.purpose}</span>}
                  </div>
                </div>
                <div className="flex items-center gap-1.5 flex-wrap">
                  <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setPayLinkLead(v)}>
                    <IndianRupee className="h-3.5 w-3.5" /> Payment link
                  </Button>
                  <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setProposalLead(v)}>
                    <FileText className="h-3.5 w-3.5" /> Fee proposal
                  </Button>
                  <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setPaymentLead(v)}>
                    <Banknote className="h-3.5 w-3.5" /> Record payment
                  </Button>
                  <Button size="sm" className="gap-1.5" onClick={() => checkOut(v)} disabled={busyId === v.id}>
                    {busyId === v.id ? <ButtonOrb state="working" onFilled /> : <LogOut className="h-3.5 w-3.5" />}
                    Check out
                  </Button>
                  <Link to={`/admissions/${v.lead_id}`} className="text-muted-foreground hover:text-foreground">
                    <ChevronRight className="h-4 w-4" />
                  </Link>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <Suspense fallback={null}>
        {payLinkLead && (
          <SendPaymentLinkDialog
            open={!!payLinkLead}
            onOpenChange={(open: boolean) => !open && setPayLinkLead(null)}
            leadId={payLinkLead.lead_id}
            defaultPurpose="pre_admission_token"
          />
        )}
        {proposalLead && (
          <SchoolFeeProposalDialog
            open={!!proposalLead}
            onOpenChange={(open: boolean) => !open && setProposalLead(null)}
            lead={{ id: proposalLead.lead_id, name: proposalLead.lead_name, phone: proposalLead.lead_phone }}
          />
        )}
        {paymentLead && (
          <RecordPaymentDialog
            open={!!paymentLead}
            onOpenChange={(open: boolean) => !open && setPaymentLead(null)}
            leadId={paymentLead.lead_id}
            leadName={paymentLead.lead_name}
            defaultType="token_fee"
            onSuccess={() => { setPaymentLead(null); onChanged?.(); }}
          />
        )}
      </Suspense>
    </div>
  );
}
