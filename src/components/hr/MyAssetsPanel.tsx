// My Assets — employee self-service, meant to be embedded in My HR.
//
// A signed-in employee sees only their own assignments: the gear currently with
// them and the history of what they have returned. Rows come from the
// asset_assignments_inbox view, which already joins the asset and category
// names, filtered to the employee's own profile. If the account has no linked
// employee record there is nothing to show, so we say so plainly.
//
// The view is security_invoker, so RLS on the underlying tables decides what is
// visible — a non-HR employee only ever sees their own rows.

import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { PageLoader } from "@/components/ui/page-loader";
import { Badge } from "@/components/ui/badge";
import { Package, Laptop } from "lucide-react";
import {
  assetStatusBadge, assetStatusLabel, isActiveAssignment,
  type AssetAssignmentInboxRow,
} from "@/lib/assets";

const fmtDate = (value: string | null | undefined) =>
  value ? new Date(value).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—";

export function MyAssetsPanel() {
  const { user } = useAuth();
  const { toast } = useToast();

  const [loading, setLoading] = useState(true);
  const [profileId, setProfileId] = useState<string | null>(null);
  const [rows, setRows] = useState<AssetAssignmentInboxRow[]>([]);

  const load = useCallback(async () => {
    if (!user?.id) return;
    setLoading(true);

    const profileRes = await (supabase as any)
      .from("employee_profiles")
      .select("id")
      .eq("user_id", user.id)
      .maybeSingle();

    const resolvedProfileId = (profileRes.data as { id: string } | null)?.id ?? null;
    setProfileId(resolvedProfileId);

    if (!resolvedProfileId) {
      setRows([]);
      setLoading(false);
      return;
    }

    const { data, error } = await (supabase as any)
      .from("asset_assignments_inbox")
      .select("id, asset_id, employee_profile_id, assigned_at, returned_at, condition_on_return, notes, asset_tag, asset_name, asset_status, category_name, employee_name, employee_number")
      .eq("employee_profile_id", resolvedProfileId)
      .order("assigned_at", { ascending: false });

    if (error) {
      toast({ title: "Could not load your assets", description: error.message, variant: "destructive" });
    }
    setRows((data as AssetAssignmentInboxRow[]) ?? []);
    setLoading(false);
  }, [user?.id, toast]);

  useEffect(() => { load(); }, [load]);

  const current = useMemo(() => rows.filter((r) => isActiveAssignment(r)), [rows]);
  const past = useMemo(() => rows.filter((r) => !isActiveAssignment(r)), [rows]);

  if (loading) return <PageLoader />;

  if (!profileId) {
    return (
      <div className="rounded-xl bg-card card-shadow p-12 text-center">
        <Package className="h-10 w-10 text-muted-foreground/30 mx-auto mb-3" />
        <p className="text-sm text-foreground">No employee record linked to your account</p>
        <p className="text-xs text-muted-foreground mt-1">
          Ask HR to link your login to your employee profile before viewing assigned assets.
        </p>
      </div>
    );
  }

  const cards = [
    { label: "Currently assigned", value: current.length, tone: "text-emerald-600" },
    { label: "Returned", value: past.length, tone: "text-muted-foreground" },
  ];

  const renderTable = (list: AssetAssignmentInboxRow[], showReturned: boolean) => (
    <div className="rounded-xl bg-card card-shadow overflow-x-auto">
      <table className="w-full text-sm min-w-[760px]">
        <thead>
          <tr className="border-b border-border bg-muted/50">
            <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Asset</th>
            <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Tag</th>
            <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Category</th>
            <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Assigned on</th>
            {showReturned && (
              <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Returned on</th>
            )}
            <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Status</th>
          </tr>
        </thead>
        <tbody>
          {list.map((r) => (
            <tr key={r.id} className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors">
              <td className="px-4 py-3 font-medium text-foreground">{r.asset_name}</td>
              <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{r.asset_tag}</td>
              <td className="px-4 py-3 text-xs text-muted-foreground">{r.category_name || "—"}</td>
              <td className="px-4 py-3 text-xs text-muted-foreground">{fmtDate(r.assigned_at)}</td>
              {showReturned && (
                <td className="px-4 py-3 text-xs text-muted-foreground">{fmtDate(r.returned_at)}</td>
              )}
              <td className="px-4 py-3">
                <Badge className={assetStatusBadge(r.asset_status)}>{assetStatusLabel(r.asset_status)}</Badge>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {cards.map((c) => (
          <div key={c.label} className="rounded-xl bg-card card-shadow p-3.5">
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{c.label}</p>
            <p className={`text-lg font-bold mt-0.5 ${c.tone}`}>{c.value}</p>
          </div>
        ))}
      </div>

      {rows.length === 0 ? (
        <div className="rounded-xl bg-card card-shadow p-12 text-center">
          <Laptop className="h-10 w-10 text-muted-foreground/30 mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">No assets assigned to you yet</p>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="space-y-2">
            <p className="text-sm font-semibold text-foreground">Currently assigned</p>
            {current.length === 0 ? (
              <p className="text-xs text-muted-foreground">Nothing is assigned to you right now.</p>
            ) : (
              renderTable(current, false)
            )}
          </div>

          {past.length > 0 && (
            <div className="space-y-2">
              <p className="text-sm font-semibold text-foreground">Past assignments</p>
              {renderTable(past, true)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default MyAssetsPanel;
