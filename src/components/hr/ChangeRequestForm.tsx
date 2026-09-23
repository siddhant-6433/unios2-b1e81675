// Employee-facing profile change request form.
//
// This is the producer for ProfileChangeRequests.tsx. The employee picks from
// the fields the server says they may edit (employee_self_editable_fields),
// the diff is built client-side, and approve_profile_change_request re-checks
// the same allow-list on the way in — the UI is a convenience, not the guard.

import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { usePermissions } from "@/contexts/PermissionContext";
import { useToast } from "@/hooks/use-toast";
import { PageLoader } from "@/components/ui/page-loader";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  buildChangeDiff,
  formatDiff,
  FIELD_LABEL,
  normalizeFieldValue,
  type ChangeDiff,
} from "@/lib/selfService";
import { Plus, ScrollText } from "lucide-react";

interface EmployeeProfile {
  id: string;
  [key: string]: unknown;
}

interface ChangeRequestRow {
  id: string;
  changes: ChangeDiff | null;
  note: string | null;
  status: string;
  created_at: string;
}

// Multi-line columns: addresses are strings and education/experience are Json,
// but all read badly in a single-line input.
const LONG_FIELDS = new Set(["current_address", "permanent_address", "education", "experience"]);
const DATE_FIELDS = new Set(["date_of_birth"]);

function StatusBadge({ status }: { status: string }) {
  const variant: "success" | "destructive" | "warning" =
    status === "approved" ? "success" : status === "rejected" ? "destructive" : "warning";
  return (
    <Badge variant={variant} className="capitalize">
      {status}
    </Badge>
  );
}

export function ChangeRequestForm({ className }: { className?: string }) {
  const { user } = useAuth();
  const { can } = usePermissions();
  const { toast } = useToast();
  const canRaise = can("hr", "self");

  const [fields, setFields] = useState<string[]>([]);
  const [profile, setProfile] = useState<EmployeeProfile | null>(null);
  const [rows, setRows] = useState<ChangeRequestRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [note, setNote] = useState("");

  const load = useCallback(async () => {
    if (!user?.id) {
      setLoading(false);
      return;
    }
    setLoading(true);
    const [fieldsRes, profileRes] = await Promise.all([
      supabase.rpc("employee_self_editable_fields"),
      supabase.from("employee_profiles").select("*").eq("user_id", user.id).maybeSingle(),
    ]);

    if (fieldsRes.error) {
      toast({
        title: "Could not load editable fields",
        description: fieldsRes.error.message,
        variant: "destructive",
      });
    }
    const allowed = Array.isArray(fieldsRes.data) ? fieldsRes.data : [];
    const employee = (profileRes.data as EmployeeProfile | null) ?? null;

    setFields(allowed);
    setProfile(employee);

    if (employee?.id) {
      const { data, error } = await supabase
        .from("employee_profile_change_requests")
        .select("id, changes, note, status, created_at")
        .eq("employee_profile_id", employee.id)
        .order("created_at", { ascending: false })
        .limit(20);
      if (error) {
        toast({ title: "Could not load your requests", description: error.message, variant: "destructive" });
      }
      setRows((data as unknown as ChangeRequestRow[]) ?? []);
    } else {
      setRows([]);
    }
    setLoading(false);
  }, [toast, user?.id]);

  useEffect(() => {
    void load();
  }, [load]);

  // Live diff of only the fields the employee ticked, so the preview in the
  // dialog is exactly what will be stored in `changes`.
  const proposed = useMemo<ChangeDiff>(() => {
    if (!profile) return {};
    const after: Record<string, unknown> = { ...profile };
    for (const field of selected) {
      if (draft[field] !== undefined) after[field] = draft[field];
    }
    return buildChangeDiff(profile, after, [...selected]);
  }, [draft, profile, selected]);

  const toggleField = (field: string) => {
    if (selected.has(field)) {
      setSelected((prev) => {
        const next = new Set(prev);
        next.delete(field);
        return next;
      });
      return;
    }
    setSelected((prev) => new Set(prev).add(field));
    setDraft((prev) => ({
      ...prev,
      [field]: normalizeFieldValue(profile?.[field]) ?? "",
    }));
  };

  const resetDraft = () => {
    setSelected(new Set());
    setDraft({});
    setNote("");
  };

  const submit = async () => {
    if (!profile?.id) {
      toast({
        title: "No employee record linked",
        description: "Ask HR to link your login to an employee profile.",
        variant: "destructive",
      });
      return;
    }
    if (Object.keys(proposed).length === 0) {
      toast({
        title: "No changes to submit",
        description: "Edit at least one field before submitting.",
        variant: "destructive",
      });
      return;
    }

    setSaving(true);
    const { data, error } = await supabase
      .from("employee_profile_change_requests")
      .insert({
        employee_profile_id: profile.id,
        requested_by: user!.id,
        changes: proposed as never,
        note: note.trim() || null,
        status: "pending",
      })
      .select("id, changes, note, status, created_at")
      .single();
    setSaving(false);

    if (error) {
      toast({ title: "Could not submit request", description: error.message, variant: "destructive" });
      return;
    }

    setRows((prev) => [data as unknown as ChangeRequestRow, ...prev]);
    setOpen(false);
    resetDraft();
    toast({ title: "Change request submitted", description: "HR will review it shortly." });
  };

  if (loading) {
    return (
      <Card className={className}>
        <PageLoader className="min-h-[180px]" label="Loading your requests…" />
      </Card>
    );
  }

  return (
    <Card className={className}>
      <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
        <div>
          <CardTitle className="text-base">Profile change requests</CardTitle>
          <CardDescription>Ask HR to correct your personal details.</CardDescription>
        </div>
        <Dialog
          open={open}
          onOpenChange={(next) => {
            setOpen(next);
            if (!next) resetDraft();
          }}
        >
          <DialogTrigger asChild>
            <Button size="sm" disabled={!profile || !canRaise}>
              <Plus className="h-3.5 w-3.5 mr-1" /> Raise request
            </Button>
          </DialogTrigger>

          <DialogContent>
            <DialogHeader>
              <DialogTitle>Raise a profile change</DialogTitle>
              <DialogDescription>
                Tick the fields you want changed. HR reviews before anything is written to your record.
              </DialogDescription>
            </DialogHeader>

            {fields.length === 0 ? (
              <p className="text-sm text-muted-foreground">No self-editable fields are configured.</p>
            ) : (
              <div className="max-h-[50vh] space-y-2 overflow-y-auto pr-1">
                {fields.map((field) => (
                  <div key={field} className="rounded-lg border border-border p-3">
                    <label className="flex cursor-pointer items-center gap-2">
                      <input
                        type="checkbox"
                        checked={selected.has(field)}
                        onChange={() => toggleField(field)}
                      />
                      <span className="text-sm font-medium text-foreground">
                        {FIELD_LABEL[field] || field}
                      </span>
                      <span className="ml-auto max-w-[45%] truncate text-xs text-muted-foreground">
                        {normalizeFieldValue(profile?.[field]) ?? "—"}
                      </span>
                    </label>

                    {selected.has(field) && (
                      <div className="mt-2">
                        {LONG_FIELDS.has(field) ? (
                          <Textarea
                            rows={2}
                            value={draft[field] ?? ""}
                            onChange={(e) => setDraft((d) => ({ ...d, [field]: e.target.value }))}
                            placeholder="New value"
                          />
                        ) : (
                          <Input
                            type={DATE_FIELDS.has(field) ? "date" : "text"}
                            value={draft[field] ?? ""}
                            onChange={(e) => setDraft((d) => ({ ...d, [field]: e.target.value }))}
                            placeholder="New value"
                          />
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            <div className="space-y-1">
              <span className="text-xs font-medium text-foreground">Note for HR (optional)</span>
              <Textarea
                rows={2}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Anything the reviewer should know"
              />
            </div>

            {Object.keys(proposed).length > 0 && (
              <div className="space-y-1 rounded-lg bg-muted/40 p-3 text-xs">
                <p className="font-medium text-foreground">Proposed changes</p>
                {Object.entries(proposed).map(([field, change]) => (
                  <p key={field} className="text-muted-foreground">
                    <span className="text-foreground">{FIELD_LABEL[field] || field}</span>:{" "}
                    <span className="line-through">{change.from ?? "—"}</span> →{" "}
                    <span className="font-medium text-foreground">{change.to ?? "—"}</span>
                  </p>
                ))}
              </div>
            )}

            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)} disabled={saving}>
                Cancel
              </Button>
              <Button onClick={submit} disabled={saving || Object.keys(proposed).length === 0}>
                {saving ? "Submitting…" : "Submit request"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardHeader>

      <CardContent className="space-y-2">
        {!profile ? (
          <p className="text-sm text-muted-foreground">
            Your login isn't linked to an employee record yet.
          </p>
        ) : rows.length === 0 ? (
          <div className="py-6 text-center">
            <ScrollText className="mx-auto mb-2 h-6 w-6 text-muted-foreground/40" />
            <p className="text-sm text-muted-foreground">No change requests yet</p>
          </div>
        ) : (
          rows.map((row) => (
            <div key={row.id} className="rounded-lg border border-border p-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs text-muted-foreground">
                  {new Date(row.created_at).toLocaleDateString("en-IN", {
                    day: "numeric",
                    month: "short",
                    year: "numeric",
                  })}
                </p>
                <StatusBadge status={row.status} />
              </div>
              <p className="mt-1 text-xs text-foreground">{formatDiff(row.changes) || "—"}</p>
              {row.note && (
                <p className="mt-1 text-xs italic text-muted-foreground">“{row.note}”</p>
              )}
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}

export default ChangeRequestForm;
