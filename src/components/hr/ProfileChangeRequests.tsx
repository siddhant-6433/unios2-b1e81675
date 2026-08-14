// HR's queue of employee-raised profile changes.
//
// The diff is shown field by field, old value next to new, because approving a change
// you cannot see is how 41 of these ended up unactioned in Keka. Applying is done by
// apply_profile_change_request(), which re-checks the field allow-list server-side —
// the UI is not the thing keeping an employee from editing their own salary.

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { PageLoader } from "@/components/ui/page-loader";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Check, X, Inbox } from "lucide-react";

interface ChangeRequest {
  id: string;
  employee_profile_id: string;
  changes: Record<string, { from: string | null; to: string | null }>;
  note: string | null;
  created_at: string;
  employee_profiles: { display_name: string | null; employee_number: string | null } | null;
}

const FIELD_LABEL: Record<string, string> = {
  personal_email: "Personal email",
  mobile_number: "Mobile",
  work_number: "Work number",
  residence_number: "Residence number",
  current_address: "Current address",
  permanent_address: "Permanent address",
  marital_status: "Marital status",
  blood_group: "Blood group",
  date_of_birth: "Date of birth",
  gender: "Gender",
  nationality: "Nationality",
  emergency_contact_name: "Emergency contact",
  emergency_contact_phone: "Emergency phone",
};

export function ProfileChangeRequests({ onChange }: { onChange?: () => void }) {
  const { toast } = useToast();
  const [rows, setRows] = useState<ChangeRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  const fetchRows = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("employee_profile_change_requests")
      .select("id, employee_profile_id, changes, note, created_at, employee_profiles(display_name, employee_number)")
      .eq("status", "pending")
      .order("created_at", { ascending: false })
      .limit(500);
    if (error) toast({ title: "Could not load requests", description: error.message, variant: "destructive" });
    setRows((data as unknown as ChangeRequest[]) ?? []);
    setLoading(false);
  }, [toast]);

  useEffect(() => { fetchRows(); }, [fetchRows]);

  const decide = async (id: string, approve: boolean) => {
    setBusy(id);
    const { error } = await supabase.rpc("apply_profile_change_request", {
      _request_id: id, _approve: approve,
    });
    setBusy(null);
    if (error) {
      toast({ title: approve ? "Could not apply" : "Could not reject", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: approve ? "Change applied" : "Request rejected" });
    await fetchRows();
    onChange?.();
  };

  if (loading) return <PageLoader />;

  if (rows.length === 0) {
    return (
      <div className="rounded-xl bg-card card-shadow px-4 py-12 text-center">
        <Inbox className="mx-auto h-8 w-8 text-muted-foreground mb-3" />
        <p className="text-sm text-foreground">No pending change requests</p>
        <p className="text-xs text-muted-foreground mt-1">
          Employees raise these from My HR; approving one writes it to their profile.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <Badge variant="outline">{rows.length} awaiting review</Badge>

      {rows.map((r) => (
        <div key={r.id} className="rounded-xl bg-card card-shadow p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-medium text-foreground">
                {r.employee_profiles?.display_name || "Unknown employee"}
                {r.employee_profiles?.employee_number && (
                  <span className="text-muted-foreground font-normal"> · {r.employee_profiles.employee_number}</span>
                )}
              </p>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                {new Date(r.created_at).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" disabled={busy === r.id} onClick={() => decide(r.id, false)}>
                <X className="h-3.5 w-3.5 mr-1" /> Reject
              </Button>
              <Button size="sm" disabled={busy === r.id} onClick={() => decide(r.id, true)}>
                <Check className="h-3.5 w-3.5 mr-1" /> Approve
              </Button>
            </div>
          </div>

          <div className="mt-3 space-y-1">
            {Object.entries(r.changes || {}).map(([field, v]) => (
              <div key={field} className="flex flex-wrap items-baseline gap-2 text-xs">
                <span className="text-muted-foreground w-40 shrink-0">{FIELD_LABEL[field] || field}</span>
                <span className="line-through text-muted-foreground/70">{v?.from || "—"}</span>
                <span className="text-muted-foreground/40">→</span>
                <span className="font-medium text-foreground">{v?.to || "—"}</span>
              </div>
            ))}
          </div>

          {r.note && <p className="mt-2 text-xs text-muted-foreground italic">“{r.note}”</p>}
        </div>
      ))}
    </div>
  );
}

export default ProfileChangeRequests;
