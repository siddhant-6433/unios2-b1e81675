// My Advances — employee self-service, meant to be embedded in My HR.
//
// A signed-in employee sees only their own advances and their remaining balance.
// The employee_profiles row is resolved from the auth user id; if the account has
// no linked employee record there is nothing to show against, so we say so plainly.
//
// Reads go through the expense_advances_inbox view (security_invoker) so the
// employee name/number join is consistent with the HR ledger. RLS already scopes
// rows to the signed-in user, but we still filter by profile id so the query is
// explicit about what it wants.

import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { PageLoader } from "@/components/ui/page-loader";
import { Badge } from "@/components/ui/badge";
import { Wallet } from "lucide-react";
import {
  advanceStatusBadge,
  formatInr,
  outstandingOf,
  summarizeAdvances,
  type AdvanceRow,
} from "@/lib/advances";

const ADVANCE_COLUMNS =
  "id, employee_profile_id, amount, recovered_amount, outstanding, issued_on, purpose, status, payroll_cycle_id, settled_at, notes, employee_name, employee_number";

export function MyAdvancesPanel() {
  const { user } = useAuth();
  const { toast } = useToast();

  const [loading, setLoading] = useState(true);
  const [profileId, setProfileId] = useState<string | null>(null);
  const [advances, setAdvances] = useState<AdvanceRow[]>([]);

  const load = useCallback(async () => {
    if (!user?.id) return;
    setLoading(true);

    const profileRes = await (supabase.from("employee_profiles" as never) as never)
      .select("id")
      .eq("user_id", user.id)
      .maybeSingle();
    const resolvedProfileId = (profileRes.data as { id: string } | null)?.id ?? null;
    setProfileId(resolvedProfileId);

    if (!resolvedProfileId) {
      setAdvances([]);
      setLoading(false);
      return;
    }

    const { data, error } = await (supabase.from("expense_advances_inbox" as never) as never)
      .select(ADVANCE_COLUMNS)
      .eq("employee_profile_id", resolvedProfileId)
      .order("issued_on", { ascending: false });

    if (error) {
      toast({ title: "Could not load your advances", description: error.message, variant: "destructive" });
    }
    setAdvances((data as AdvanceRow[]) ?? []);
    setLoading(false);
  }, [user?.id, toast]);

  useEffect(() => { load(); }, [load]);

  const summary = useMemo(() => summarizeAdvances(advances), [advances]);

  if (loading) return <PageLoader />;

  if (!profileId) {
    return (
      <div className="rounded-xl bg-card card-shadow p-12 text-center">
        <Wallet className="h-10 w-10 text-muted-foreground/30 mx-auto mb-3" />
        <p className="text-sm text-foreground">No employee record linked to your account</p>
        <p className="text-xs text-muted-foreground mt-1">
          Ask HR to link your login to your employee profile to see your advances.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {[
          { label: "Outstanding", value: summary.outstanding, tone: "text-amber-600" },
          { label: "Recovered", value: summary.recovered, tone: "text-emerald-600" },
          { label: "Total advanced", value: summary.total, tone: "text-foreground" },
        ].map((s) => (
          <div key={s.label} className="rounded-xl bg-card card-shadow p-3.5">
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{s.label}</p>
            <p className={`text-lg font-bold mt-0.5 ${s.tone}`}>₹{formatInr(s.value)}</p>
          </div>
        ))}
      </div>

      {advances.length === 0 ? (
        <div className="rounded-xl bg-card card-shadow p-12 text-center">
          <Wallet className="h-10 w-10 text-muted-foreground/30 mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">No advances issued to you</p>
        </div>
      ) : (
        <div className="rounded-xl bg-card card-shadow overflow-x-auto">
          <table className="w-full text-sm min-w-[720px]">
            <thead>
              <tr className="border-b border-border bg-muted/50">
                <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Purpose</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Issued on</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-muted-foreground uppercase tracking-wide">Amount</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-muted-foreground uppercase tracking-wide">Outstanding</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Status</th>
              </tr>
            </thead>
            <tbody>
              {advances.map((a) => (
                <tr key={a.id} className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors">
                  <td className="px-4 py-3 max-w-[300px]">
                    <div className="text-foreground truncate">{a.purpose || "—"}</div>
                    {a.notes && <div className="text-xs text-muted-foreground truncate">{a.notes}</div>}
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">{a.issued_on}</td>
                  <td className="px-4 py-3 text-right font-medium text-foreground">₹{formatInr(a.amount)}</td>
                  <td className="px-4 py-3 text-right font-medium text-foreground">₹{formatInr(outstandingOf(a))}</td>
                  <td className="px-4 py-3">
                    <Badge className={`capitalize ${advanceStatusBadge(a.status)}`}>
                      {a.status === "open" ? "Open" : a.status === "recovered" ? "Recovered" : "Cancelled"}
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
