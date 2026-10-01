// My Comp-off — employee self-service, meant to be embedded in My HR.
//
// The balance cards come from my_comp_off(), which mirrors the FIFO consumption
// rules the leave trigger uses, so what an employee sees is what they can spend.
// The rows below are their own comp_off_credits, read directly (RLS already scopes
// them) but filtered by profile id so the query is explicit about what it wants.
//
// The employee_profiles row is resolved from the auth user id; if the account has
// no linked employee record there is nothing to show against, so we say so plainly.

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { PageLoader } from "@/components/ui/page-loader";
import { Badge } from "@/components/ui/badge";
import { CalendarOff } from "lucide-react";
import {
  compOffSourceLabel,
  compOffStatusBadge,
  compOffStatusLabel,
  formatDays,
  type CompOffCredit,
} from "@/lib/compOff";

interface MyCompOffSummary {
  approved_days: number | string;
  used_days: number | string;
  available_days: number | string;
  next_expiry: string | null;
}

const CREDIT_COLUMNS =
  "id, employee_profile_id, earned_on, days, used_days, remaining, reason, source, status, approved_at, expires_on";

export function MyCompOffPanel() {
  const { user } = useAuth();
  const { toast } = useToast();

  const [loading, setLoading] = useState(true);
  const [profileId, setProfileId] = useState<string | null>(null);
  const [summary, setSummary] = useState<MyCompOffSummary | null>(null);
  const [credits, setCredits] = useState<CompOffCredit[]>([]);

  const load = useCallback(async () => {
    if (!user?.id) return;
    setLoading(true);

    const profileRes = await (supabase.from("employee_profiles" as never) as never)
      .select("id")
      .eq("user_id", user.id)
      .maybeSingle();
    const resolvedProfileId = (profileRes.data as { id: string } | null)?.id ?? null;
    setProfileId(resolvedProfileId);

    const summaryRes = await supabase.rpc("my_comp_off" as never);
    if (summaryRes.error) {
      toast({ title: "Could not load your comp-off balance", description: summaryRes.error.message, variant: "destructive" });
    } else {
      const raw = summaryRes.data as unknown;
      const row = Array.isArray(raw) ? (raw[0] ?? null) : (raw ?? null);
      setSummary((row as MyCompOffSummary | null) ?? null);
    }

    if (!resolvedProfileId) {
      setCredits([]);
      setLoading(false);
      return;
    }

    const creditsRes = await (supabase.from("comp_off_credits" as never) as never)
      .select(CREDIT_COLUMNS)
      .eq("employee_profile_id", resolvedProfileId)
      .order("earned_on", { ascending: false });

    if (creditsRes.error) {
      toast({ title: "Could not load your comp-off credits", description: creditsRes.error.message, variant: "destructive" });
    }
    setCredits((creditsRes.data as CompOffCredit[]) ?? []);
    setLoading(false);
  }, [user?.id, toast]);

  useEffect(() => { load(); }, [load]);

  if (loading) return <PageLoader />;

  if (!profileId) {
    return (
      <div className="rounded-xl bg-card card-shadow p-12 text-center">
        <CalendarOff className="h-10 w-10 text-muted-foreground/30 mx-auto mb-3" />
        <p className="text-sm text-foreground">No employee record linked to your account</p>
        <p className="text-xs text-muted-foreground mt-1">
          Ask HR to link your login to your employee profile to see your comp-off.
        </p>
      </div>
    );
  }

  const cards = [
    { label: "Approved days", value: formatDays(summary?.approved_days), tone: "text-foreground" },
    { label: "Used days", value: formatDays(summary?.used_days), tone: "text-foreground" },
    { label: "Available days", value: formatDays(summary?.available_days), tone: "text-emerald-600" },
    { label: "Next expiry", value: summary?.next_expiry || "—", tone: "text-amber-600" },
  ];

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {cards.map((s) => (
          <div key={s.label} className="rounded-xl bg-card card-shadow p-3.5">
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{s.label}</p>
            <p className={`text-lg font-bold mt-0.5 ${s.tone}`}>{s.value}</p>
          </div>
        ))}
      </div>

      {credits.length === 0 ? (
        <div className="rounded-xl bg-card card-shadow p-12 text-center">
          <CalendarOff className="h-10 w-10 text-muted-foreground/30 mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">No comp-off credits earned yet</p>
        </div>
      ) : (
        <div className="rounded-xl bg-card card-shadow overflow-x-auto">
          <table className="w-full text-sm min-w-[720px]">
            <thead>
              <tr className="border-b border-border bg-muted/50">
                <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Earned on</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-muted-foreground uppercase tracking-wide">Days</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-muted-foreground uppercase tracking-wide">Remaining</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Source</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Expires</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Status</th>
              </tr>
            </thead>
            <tbody>
              {credits.map((c) => (
                <tr key={c.id} className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors">
                  <td className="px-4 py-3 text-xs text-muted-foreground">
                    <div>{c.earned_on}</div>
                    {c.reason && <div className="text-muted-foreground/80 truncate max-w-[220px]">{c.reason}</div>}
                  </td>
                  <td className="px-4 py-3 text-right font-medium text-foreground">{formatDays(c.days)}</td>
                  <td className="px-4 py-3 text-right font-medium text-foreground">{formatDays(c.remaining)}</td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">{compOffSourceLabel(c.source)}</td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">{c.expires_on || "—"}</td>
                  <td className="px-4 py-3">
                    <Badge className={compOffStatusBadge(c.status)}>{compOffStatusLabel(c.status)}</Badge>
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
