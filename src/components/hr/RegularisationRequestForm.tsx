// Employee-facing attendance regularisation request.
//
// Producer for RegularisationQueue.tsx. A regularisation is "my punch was
// wrong, here is what it should have been". The DB enforces
// UNIQUE(employee_profile_id, date), so the form checks locally for a friendly
// message and still translates the Postgres unique violation if it races.

import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { usePermissions } from "@/contexts/PermissionContext";
import { useToast } from "@/hooks/use-toast";
import { PageLoader } from "@/components/ui/page-loader";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { REGULARISATION_REASONS, validatePunchTimes } from "@/lib/selfService";
import { ClipboardCheck } from "lucide-react";

interface RegularisationRow {
  id: string;
  date: string;
  requested_punch_in: string | null;
  requested_punch_out: string | null;
  reason: string;
  status: string;
  created_at: string;
}

const today = () => new Date().toISOString().slice(0, 10);

const clock = (t: string | null) =>
  t ? new Date(t).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }) : "—";

function StatusBadge({ status }: { status: string }) {
  const variant: "success" | "destructive" | "warning" =
    status === "approved" ? "success" : status === "rejected" ? "destructive" : "warning";
  return (
    <Badge variant={variant} className="capitalize">
      {status}
    </Badge>
  );
}

export function RegularisationRequestForm({ className }: { className?: string }) {
  const { user } = useAuth();
  const { can } = usePermissions();
  const { toast } = useToast();
  const canRaise = can("hr", "self");

  const [profileId, setProfileId] = useState<string | null>(null);
  const [rows, setRows] = useState<RegularisationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [date, setDate] = useState(today());
  const [punchIn, setPunchIn] = useState("");
  const [punchOut, setPunchOut] = useState("");
  const [reason, setReason] = useState<string>(REGULARISATION_REASONS[0]);
  const [otherReason, setOtherReason] = useState("");

  const load = useCallback(async () => {
    if (!user?.id) {
      setLoading(false);
      return;
    }
    setLoading(true);
    const { data: profile } = await supabase
      .from("employee_profiles")
      .select("id")
      .eq("user_id", user.id)
      .maybeSingle();

    const id = (profile as { id: string } | null)?.id ?? null;
    setProfileId(id);

    if (id) {
      const { data, error } = await supabase
        .from("attendance_regularisations")
        .select("id, date, requested_punch_in, requested_punch_out, reason, status, created_at")
        .eq("employee_profile_id", id)
        .order("date", { ascending: false })
        .limit(20);
      if (error) {
        toast({ title: "Could not load your requests", description: error.message, variant: "destructive" });
      }
      setRows((data as unknown as RegularisationRow[]) ?? []);
    } else {
      setRows([]);
    }
    setLoading(false);
  }, [toast, user?.id]);

  useEffect(() => {
    void load();
  }, [load]);

  const existingDates = useMemo(() => new Set(rows.map((r) => r.date)), [rows]);
  const duplicate = Boolean(date) && existingDates.has(date);

  const toIso = (time: string) => (time ? new Date(`${date}T${time}`).toISOString() : null);

  const submit = async () => {
    if (!profileId) {
      toast({
        title: "No employee record linked",
        description: "Ask HR to link your login to an employee profile.",
        variant: "destructive",
      });
      return;
    }
    if (!date) {
      toast({ title: "Pick a date", variant: "destructive" });
      return;
    }
    if (duplicate) {
      toast({
        title: "Request already exists",
        description: `You already have a correction request for ${date}.`,
        variant: "destructive",
      });
      return;
    }
    const validation = validatePunchTimes(punchIn, punchOut);
    if (!validation.ok) {
      toast({ title: validation.error ?? "Invalid times", variant: "destructive" });
      return;
    }

    const finalReason = reason === "Other" && otherReason.trim() ? otherReason.trim() : reason;

    setSaving(true);
    const { data, error } = await supabase
      .from("attendance_regularisations")
      .insert({
        employee_profile_id: profileId,
        user_id: user!.id,
        date,
        requested_punch_in: toIso(punchIn),
        requested_punch_out: toIso(punchOut),
        reason: finalReason,
        status: "pending",
      })
      .select("id, date, requested_punch_in, requested_punch_out, reason, status, created_at")
      .single();
    setSaving(false);

    if (error) {
      const isDuplicate = error.code === "23505" || /duplicate key|unique/i.test(error.message);
      toast({
        title: isDuplicate ? "Request already exists" : "Could not submit request",
        description: isDuplicate
          ? `You already have a correction request for ${date}.`
          : error.message,
        variant: "destructive",
      });
      if (isDuplicate) void load();
      return;
    }

    setRows((prev) => [data as unknown as RegularisationRow, ...prev]);
    setPunchIn("");
    setPunchOut("");
    setReason(REGULARISATION_REASONS[0]);
    setOtherReason("");
    toast({ title: "Correction request submitted", description: "HR will review it shortly." });
  };

  if (loading) {
    return (
      <Card className={className}>
        <PageLoader className="min-h-[180px]" label="Loading your corrections…" />
      </Card>
    );
  }

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle className="text-base">Attendance correction</CardTitle>
        <CardDescription>Raise a request when a punch is missing or wrong.</CardDescription>
      </CardHeader>

      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-end gap-2 rounded-xl border border-border bg-muted/30 p-3">
          <div className="flex flex-col gap-1">
            <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Date</span>
            <Input
              type="date"
              value={date}
              max={today()}
              onChange={(e) => setDate(e.target.value)}
              className="h-8 w-36 text-xs"
            />
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Punch in</span>
            <Input
              type="time"
              value={punchIn}
              onChange={(e) => setPunchIn(e.target.value)}
              className="h-8 w-28 text-xs"
            />
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Punch out</span>
            <Input
              type="time"
              value={punchOut}
              onChange={(e) => setPunchOut(e.target.value)}
              className="h-8 w-28 text-xs"
            />
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Reason</span>
            <select
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="h-8 rounded-md border border-input bg-background px-2 text-xs focus:outline-none focus:ring-1 focus:ring-ring/20"
            >
              {REGULARISATION_REASONS.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </div>
          {reason === "Other" && (
            <div className="flex flex-col gap-1">
              <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Detail</span>
              <Input
                value={otherReason}
                onChange={(e) => setOtherReason(e.target.value)}
                placeholder="What happened?"
                className="h-8 w-52 text-xs"
              />
            </div>
          )}
          <Button
            size="sm"
            className="h-8 text-xs"
            onClick={submit}
            disabled={saving || duplicate || !canRaise || !profileId}
          >
            {saving ? "Submitting…" : "Request correction"}
          </Button>
        </div>

        {duplicate && (
          <p className="text-xs text-destructive">
            You already have a request for {date}. Pick another date.
          </p>
        )}

        {!profileId ? (
          <p className="text-sm text-muted-foreground">
            Your login isn't linked to an employee record yet.
          </p>
        ) : rows.length === 0 ? (
          <div className="py-6 text-center">
            <ClipboardCheck className="mx-auto mb-2 h-6 w-6 text-muted-foreground/40" />
            <p className="text-sm text-muted-foreground">No correction requests yet</p>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-border">
            <table className="w-full min-w-[560px] text-xs">
              <thead className="bg-muted/50">
                <tr className="text-left">
                  <th className="px-3 py-2 font-medium">Date</th>
                  <th className="px-3 py-2 font-medium">In</th>
                  <th className="px-3 py-2 font-medium">Out</th>
                  <th className="px-3 py-2 font-medium">Reason</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map((row) => (
                  <tr key={row.id}>
                    <td className="px-3 py-2 text-muted-foreground">{row.date}</td>
                    <td className="px-3 py-2">{clock(row.requested_punch_in)}</td>
                    <td className="px-3 py-2">{clock(row.requested_punch_out)}</td>
                    <td className="px-3 py-2 text-muted-foreground">{row.reason}</td>
                    <td className="px-3 py-2">
                      <StatusBadge status={row.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default RegularisationRequestForm;
