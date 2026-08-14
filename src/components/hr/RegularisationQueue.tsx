// Attendance regularisation approvals.
//
// Bulk-first by design. Keka has 1,554 of these stranded because the only way to
// clear one was individually; a queue that can only be worked one row at a time
// stops being worked at all. Select-all and approve is the primary action here, and
// approve_attendance_regularisation takes an array for exactly that reason.

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { PageLoader } from "@/components/ui/page-loader";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Check, X, ClipboardCheck } from "lucide-react";

interface Regularisation {
  id: string;
  date: string;
  requested_punch_in: string | null;
  requested_punch_out: string | null;
  reason: string;
  employee_profiles: { display_name: string | null; employee_number: string | null } | null;
}

const time = (t: string | null) =>
  t ? new Date(t).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }) : "—";

export function RegularisationQueue() {
  const { toast } = useToast();
  const [rows, setRows] = useState<Regularisation[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const fetchRows = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("attendance_regularisations")
      .select("id, date, requested_punch_in, requested_punch_out, reason, employee_profiles(display_name, employee_number)")
      .eq("status", "pending")
      .order("date", { ascending: false })
      .limit(1000);
    if (error) toast({ title: "Could not load requests", description: error.message, variant: "destructive" });
    setRows((data as unknown as Regularisation[]) ?? []);
    setSelected(new Set());
    setLoading(false);
  }, [toast]);

  useEffect(() => { fetchRows(); }, [fetchRows]);

  const decide = async (ids: string[], approve: boolean) => {
    if (!ids.length) return;
    setBusy(true);
    const { data, error } = await supabase.rpc("approve_attendance_regularisation", {
      _ids: ids, _approve: approve,
    });
    setBusy(false);
    if (error) {
      toast({ title: "Could not update", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: `${data ?? 0} ${approve ? "approved" : "rejected"}` });
    await fetchRows();
  };

  if (loading) return <PageLoader />;

  if (rows.length === 0) {
    return (
      <div className="rounded-xl bg-card card-shadow px-4 py-12 text-center">
        <ClipboardCheck className="mx-auto h-8 w-8 text-emerald-600 mb-3" />
        <p className="text-sm text-foreground">No attendance corrections pending</p>
        <p className="text-xs text-muted-foreground mt-1">
          Employees raise these when a punch is missed; approving writes the corrected time.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline">{rows.length} pending</Badge>
        <div className="flex-1" />
        <Button size="sm" variant="outline" disabled={busy || selected.size === 0}
          onClick={() => decide([...selected], false)}>
          <X className="h-3.5 w-3.5 mr-1" /> Reject {selected.size || ""}
        </Button>
        <Button size="sm" disabled={busy || selected.size === 0}
          onClick={() => decide([...selected], true)}>
          <Check className="h-3.5 w-3.5 mr-1" /> Approve {selected.size || ""}
        </Button>
      </div>

      <div className="rounded-xl bg-card card-shadow overflow-x-auto">
        <table className="w-full text-xs min-w-[700px]">
          <thead className="bg-muted/50">
            <tr className="text-left">
              <th className="px-3 py-2 w-8">
                <input type="checkbox"
                  checked={selected.size === rows.length && rows.length > 0}
                  onChange={(e) => setSelected(e.target.checked ? new Set(rows.map((r) => r.id)) : new Set())} />
              </th>
              <th className="px-3 py-2 font-medium">Employee</th>
              <th className="px-3 py-2 font-medium">Date</th>
              <th className="px-3 py-2 font-medium">In</th>
              <th className="px-3 py-2 font-medium">Out</th>
              <th className="px-3 py-2 font-medium">Reason</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((r) => (
              <tr key={r.id} className={selected.has(r.id) ? "bg-muted/20" : ""}>
                <td className="px-3 py-2">
                  <input type="checkbox" checked={selected.has(r.id)}
                    onChange={() => setSelected((s) => {
                      const n = new Set(s);
                      if (n.has(r.id)) n.delete(r.id); else n.add(r.id);
                      return n;
                    })} />
                </td>
                <td className="px-3 py-2">
                  {r.employee_profiles?.display_name || "Unknown"}
                  {r.employee_profiles?.employee_number && (
                    <span className="text-muted-foreground"> · {r.employee_profiles.employee_number}</span>
                  )}
                </td>
                <td className="px-3 py-2 text-muted-foreground">{r.date}</td>
                <td className="px-3 py-2">{time(r.requested_punch_in)}</td>
                <td className="px-3 py-2">{time(r.requested_punch_out)}</td>
                <td className="px-3 py-2 text-muted-foreground">{r.reason}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default RegularisationQueue;
