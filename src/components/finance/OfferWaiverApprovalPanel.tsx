import { PageLoader } from "@/components/ui/page-loader";
import { ButtonOrb } from "@/components/ui/thinking-orb";
import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { CheckCircle, XCircle, Tag } from "lucide-react";
import { feeTermLabel } from "@/lib/feeTermLabels";

const statusBadge: Record<string, string> = {
  pending:  "bg-warning/10 text-warning-foreground",
  approved: "bg-success/10 text-success",
  rejected: "bg-destructive/10 text-destructive",
};

interface Waiver {
  id: string;
  offer_letter_id: string;
  term: string;
  term_label: string;
  amount: number;
  reason: string | null;
  status: string;
  requested_by_name: string | null;
  requested_by_role: string | null;
  approved_by_name: string | null;
  rejection_reason: string | null;
  created_at: string;
  lead_name: string;
  lead_id: string;
  course_name: string | null;
  // Gross year fee for this waiver's term, sourced from the active fee
  // structure on the offer's (course, session). Null when the structure
  // can't be resolved (legacy offers, missing structure).
  year_amount: number | null;
}

export function OfferWaiverApprovalPanel() {
  const { role } = useAuth();
  const { toast } = useToast();
  const [waivers, setWaivers] = useState<Waiver[]>([]);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<"all" | "pending" | "approved" | "rejected">("pending");

  const isSuperAdmin = role === "super_admin";

  useEffect(() => { fetchWaivers(); }, []);

  const fetchWaivers = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("offer_waivers")
      .select(`
        id, offer_letter_id, term, amount, reason, status,
        requested_by_name, requested_by_role, approved_by_name,
        rejection_reason, created_at,
        offer_letters!offer_letter_id (
          lead_id, course_id, session_id,
          leads!lead_id ( name ),
          courses!course_id ( name )
        )
      `)
      .order("created_at", { ascending: false });

    if (error) {
      toast({ title: "Failed to load waivers", description: error.message, variant: "destructive" });
      setLoading(false);
      return;
    }

    // Resolve the gross year fee for each waiver's (course, session, term) by
    // pulling the active fee_structures in one round-trip and summing items
    // per term. Lets us render Amount + Applicable Fee inline without an
    // extra fetch per row.
    const offerKeys = new Set<string>();
    for (const w of (data || []) as any[]) {
      const c = w.offer_letters?.course_id;
      const s = w.offer_letters?.session_id;
      if (c && s) offerKeys.add(`${c}::${s}`);
    }
    const yearAmountByKey = new Map<string, number>(); // `${courseId}::${sessionId}::${term}` -> total
    const yearLabelByKey = new Map<string, string>();

    if (offerKeys.size > 0) {
      const pairs = Array.from(offerKeys).map(k => k.split("::"));
      const courseIds = Array.from(new Set(pairs.map(p => p[0])));
      const sessionIds = Array.from(new Set(pairs.map(p => p[1])));
      const { data: fsRows } = await supabase
        .from("fee_structures")
        .select("course_id, session_id, is_active, metadata, fee_structure_items ( term, amount )")
        .in("course_id", courseIds)
        .in("session_id", sessionIds)
        .eq("is_active", true);

      for (const fs of (fsRows || []) as any[]) {
        const key = `${fs.course_id}::${fs.session_id}`;
        if (!offerKeys.has(key)) continue;
        const metadata = fs.metadata as Record<string, unknown> | null;
        const byTerm = new Map<string, number>();
        for (const it of (fs.fee_structure_items || []) as any[]) {
          const t = String(it.term || "");
          if (!/^year_\d+$/.test(t)) continue;
          byTerm.set(t, (byTerm.get(t) || 0) + Number(it.amount || 0));
        }
        for (const [t, total] of byTerm) {
          yearAmountByKey.set(`${key}::${t}`, total);
          yearLabelByKey.set(`${key}::${t}`, feeTermLabel(t, metadata));
        }
      }
    }

    setWaivers((data || []).map((w: any) => {
      const courseId = w.offer_letters?.course_id;
      const sessionId = w.offer_letters?.session_id;
      const yearAmount = (courseId && sessionId)
        ? yearAmountByKey.get(`${courseId}::${sessionId}::${w.term}`) ?? null
        : null;
      const termLabel = (courseId && sessionId)
        ? yearLabelByKey.get(`${courseId}::${sessionId}::${w.term}`) ?? feeTermLabel(w.term)
        : feeTermLabel(w.term);
      return {
        id: w.id,
        offer_letter_id: w.offer_letter_id,
        term: w.term,
        term_label: termLabel,
        amount: Number(w.amount),
        reason: w.reason,
        status: w.status,
        requested_by_name: w.requested_by_name,
        requested_by_role: w.requested_by_role,
        approved_by_name: w.approved_by_name,
        rejection_reason: w.rejection_reason,
        created_at: w.created_at,
        lead_name: w.offer_letters?.leads?.name || "—",
        lead_id: w.offer_letters?.lead_id || "",
        // offer_letters.course_id already points at courses. The old path went
        // offer_letters → applications → courses, but nothing joins those two
        // tables, so PostgREST rejected the whole query and the panel showed
        // "no pending waiver requests" while 49 sat waiting.
        course_name: w.offer_letters?.courses?.name || null,
        year_amount: yearAmount,
      };
    }));
    setLoading(false);
  };

  const handleDecide = async (waiver: Waiver, decision: "approved" | "rejected") => {
    if (!isSuperAdmin) return;
    let rejection_reason: string | undefined;
    if (decision === "rejected") {
      const r = window.prompt("Reason for rejection (optional):");
      if (r === null) return; // user cancelled
      rejection_reason = r || undefined;
    }
    setProcessing(waiver.id);
    try {
      const { data, error } = await supabase.functions.invoke("decide-offer-waiver", {
        body: { waiver_id: waiver.id, decision, rejection_reason },
      });
      if (error) {
        let msg = error.message;
        try {
          const t = await (error as any)?.context?.text?.();
          if (t) { try { const b = JSON.parse(t); if (b?.error) msg = b.error; } catch { msg = t.slice(0, 200); } }
        } catch {}
        throw new Error(msg);
      }
      if (data?.error) throw new Error(data.error);
      toast({ title: decision === "approved" ? "Waiver approved" : "Waiver rejected" });
      fetchWaivers();
    } catch (e: any) {
      toast({ title: "Action failed", description: e.message, variant: "destructive" });
    } finally {
      setProcessing(null);
    }
  };

  const filtered = statusFilter === "all" ? waivers : waivers.filter(w => w.status === statusFilter);
  const pendingCount = waivers.filter(w => w.status === "pending").length;

  if (loading) {
    return <PageLoader />;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Tag className="h-5 w-5 text-muted-foreground" />
          <h3 className="text-base font-semibold text-foreground">Offer Waivers</h3>
          {pendingCount > 0 && (
            <Badge className="bg-warning/10 text-warning-foreground border-warning/20">{pendingCount} pending</Badge>
          )}
        </div>
        <div className="flex items-center gap-1 rounded-lg border border-input bg-card p-1">
          {(["pending", "approved", "rejected", "all"] as const).map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={`rounded-md px-3 py-1 text-xs font-medium transition-colors capitalize ${
                statusFilter === s
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      {!isSuperAdmin && (
        <div className="rounded-lg border border-warning/20 bg-warning/5 px-4 py-3 text-sm text-warning-foreground">
          Only super admins can approve or reject waivers. You can view all requests here.
        </div>
      )}

      {filtered.length === 0 ? (
        <Card className="border-border/60 shadow-none">
          <CardContent className="py-12 text-center text-muted-foreground">
            No {statusFilter === "all" ? "" : statusFilter} waiver requests
          </CardContent>
        </Card>
      ) : (
        // 11 columns: scroll rather than clip, and pin Actions to the right so a
        // super admin can always approve without hunting for the buttons.
        <Card className="border-border/60 shadow-none">
          <CardContent className="overflow-x-auto p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/50">
                  <th className="px-3 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Applicant</th>
                  <th className="px-3 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Course</th>
                  <th className="px-3 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Term</th>
                  <th className="px-3 py-3 text-right text-xs font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap">Amount</th>
                  <th className="px-3 py-3 text-right text-xs font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap">Waiver</th>
                  <th className="px-3 py-3 text-right text-xs font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap">Payable</th>
                  <th className="px-3 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Reason</th>
                  <th className="px-3 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Requested</th>
                  <th className="px-3 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Status</th>
                  <th className="px-3 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap">Date</th>
                  {isSuperAdmin && (
                    <th className="sticky right-0 z-10 border-l border-border bg-muted px-3 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Actions</th>
                  )}
                </tr>
              </thead>
              <tbody>
                {filtered.map((w) => {
                  const applicable = w.year_amount != null
                    ? Math.max(0, w.year_amount - w.amount)
                    : null;
                  return (
                  <tr key={w.id} className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors">
                    <td className="px-3 py-3 font-medium text-foreground">{w.lead_name}</td>
                    <td className="px-3 py-3 text-xs text-muted-foreground max-w-[140px] truncate" title={w.course_name || undefined}>
                      {w.course_name || "—"}
                    </td>
                    <td className="px-3 py-3">
                      <Badge className="bg-pastel-blue text-foreground/70 border-0 text-[10px] whitespace-nowrap">
                        {w.term_label}
                      </Badge>
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums text-foreground whitespace-nowrap">
                      {w.year_amount != null ? `₹${w.year_amount.toLocaleString("en-IN")}` : "—"}
                    </td>
                    <td className="px-3 py-3 text-right font-semibold text-foreground tabular-nums whitespace-nowrap">
                      −₹{w.amount.toLocaleString("en-IN")}
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums font-semibold text-success whitespace-nowrap">
                      {applicable != null ? `₹${applicable.toLocaleString("en-IN")}` : "—"}
                    </td>
                    {/* Wraps instead of truncating — the reason is the whole basis
                        for approving, so it has to be readable without a hover. */}
                    <td className="px-3 py-3 text-xs text-muted-foreground min-w-[220px] max-w-[320px] whitespace-pre-wrap break-words">
                      {w.reason || "—"}
                      {w.status === "rejected" && w.rejection_reason && (
                        <span className="block text-destructive/80 mt-0.5">
                          Rejected: {w.rejection_reason}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-3 text-xs text-muted-foreground">
                      <span>{w.requested_by_name || "—"}</span>
                      {w.requested_by_role && (
                        <span className="block capitalize text-[10px] text-muted-foreground/60">
                          {w.requested_by_role.replace("_", " ")}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-3">
                      <Badge className={`text-[10px] font-medium border-0 capitalize ${statusBadge[w.status] || "bg-muted"}`}>
                        {w.status}
                      </Badge>
                      {w.status !== "pending" && w.approved_by_name && (
                        <div className="text-[10px] text-muted-foreground/60 mt-0.5">
                          by {w.approved_by_name}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-3 text-xs text-muted-foreground whitespace-nowrap">
                      {new Date(w.created_at).toLocaleDateString("en-IN", { day: "2-digit", month: "short" })}
                    </td>
                    {isSuperAdmin && (
                      <td className="sticky right-0 z-10 border-l border-border bg-card px-3 py-3">
                        {w.status === "pending" ? (
                          <div className="flex items-center gap-1">
                            <Button
                              size="sm" variant="ghost"
                              className="h-7 px-2 text-success hover:text-success hover:bg-success/10"
                              disabled={processing === w.id}
                              onClick={() => handleDecide(w, "approved")}
                            >
                              {processing === w.id
                                ? <ButtonOrb state="solving" />
                                : <CheckCircle className="h-3.5 w-3.5" />}
                            </Button>
                            <Button
                              size="sm" variant="ghost"
                              className="h-7 px-2 text-destructive hover:text-destructive hover:bg-destructive/10"
                              disabled={processing === w.id}
                              onClick={() => handleDecide(w, "rejected")}
                            >
                              <XCircle className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </td>
                    )}
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
