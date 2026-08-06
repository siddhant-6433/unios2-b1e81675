import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { ButtonOrb } from "@/components/ui/thinking-orb";
import { Loader2, ArrowRightLeft, BookOpen, Users } from "lucide-react";

interface StaffOption {
  profile_id: string;
  user_id: string;
  name: string;
  role: string | null;
}

interface Props {
  source: { profileId: string; userId: string; name: string } | null;
  allUsers: StaffOption[];
  onClose: () => void;
  onDone: () => void;
}

type TransferMode = "round_robin" | "coursewise";

interface CourseSummary {
  id: string;
  name: string;
  code: string | null;
  leadCount: number;
}

interface LeadCourseRow {
  id: string;
  course_id: string | null;
  courses: { id: string; name: string | null; code: string | null } | { id: string; name: string | null; code: string | null }[] | null;
}

interface TransferResult {
  leads_transferred?: number;
}

/** Hard ceiling so the UI never spins forever if PostgREST/network stalls. */
const TRANSFER_TIMEOUT_MS = 15_000;

type RpcResult = { data: TransferResult | string | null; error: { message: string } | null };

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      reject(new Error(`${label} timed out after ${Math.round(ms / 1000)}s. Try again.`));
    }, ms);
    promise.then(
      (value) => {
        window.clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        window.clearTimeout(timer);
        reject(err);
      },
    );
  });
}

function parseTransferResult(data: TransferResult | string | null | undefined): TransferResult {
  if (data == null) return {};
  if (typeof data === "string") {
    try {
      return JSON.parse(data) as TransferResult;
    } catch {
      return {};
    }
  }
  return data;
}

export function TransferAccountDialog({ source, allUsers, onClose, onDone }: Props) {
  const { toast } = useToast();
  const sourceProfileId = source?.profileId;
  const [selectedTargetIds, setSelectedTargetIds] = useState<string[]>([]);
  const [transferMode, setTransferMode] = useState<TransferMode>("round_robin");
  const [courseTargetIds, setCourseTargetIds] = useState<Record<string, string[]>>({});
  const [disableSource, setDisableSource] = useState(true);
  const [leadCount, setLeadCount] = useState<number | null>(null);
  const [courseSummaries, setCourseSummaries] = useState<CourseSummary[]>([]);
  const [uncategorizedLeadCount, setUncategorizedLeadCount] = useState(0);
  const [loadingCount, setLoadingCount] = useState(false);
  const [saving, setSaving] = useState(false);

  const targets = allUsers.filter(
    (u) => u.profile_id !== source?.profileId && !u.name.startsWith("Guardian of")
  );
  const selectedTargets = useMemo(
    () => targets.filter((target) => selectedTargetIds.includes(target.profile_id)),
    [selectedTargetIds, targets]
  );
  const selectedTargetNames = selectedTargets.map((target) => target.name).join(", ");
  const activeCourseRuleCount = Object.values(courseTargetIds).filter((ids) => ids.length > 0).length;

  useEffect(() => {
    if (!sourceProfileId) return;
    let cancelled = false;
    setSelectedTargetIds([]);
    setTransferMode("round_robin");
    setCourseTargetIds({});
    setLeadCount(null);
    setCourseSummaries([]);
    setUncategorizedLeadCount(0);
    setSaving(false);
    setLoadingCount(true);

    (async () => {
      try {
        const { data, count, error } = await supabase
          .from("leads")
          .select("id, course_id, courses:course_id(id, name, code)", { count: "exact" })
          .eq("counsellor_id", sourceProfileId)
          .range(0, 9999);

        if (cancelled) return;

        if (error) {
          toast({ title: "Could not load lead count", description: error.message, variant: "destructive" });
          setLeadCount(0);
          setCourseSummaries([]);
          setUncategorizedLeadCount(0);
          return;
        }

        const summaries = new Map<string, CourseSummary>();
        let uncategorized = 0;
        for (const row of ((data || []) as LeadCourseRow[])) {
          if (!row.course_id) {
            uncategorized += 1;
            continue;
          }
          const course = Array.isArray(row.courses) ? row.courses[0] : row.courses;
          const existing = summaries.get(row.course_id);
          if (existing) {
            existing.leadCount += 1;
          } else {
            summaries.set(row.course_id, {
              id: row.course_id,
              name: course?.name || "Unknown course",
              code: course?.code || null,
              leadCount: 1,
            });
          }
        }

        setLeadCount(count ?? data?.length ?? 0);
        setCourseSummaries(Array.from(summaries.values()).sort((a, b) => a.name.localeCompare(b.name)));
        setUncategorizedLeadCount(uncategorized);
      } catch (e: unknown) {
        if (cancelled) return;
        const message = e instanceof Error ? e.message : "Failed to load lead count";
        toast({ title: "Could not load lead count", description: message, variant: "destructive" });
        setLeadCount(0);
        setCourseSummaries([]);
        setUncategorizedLeadCount(0);
      } finally {
        if (!cancelled) setLoadingCount(false);
      }
    })();

    return () => {
      cancelled = true;
    };
    // Intentionally only re-run when the source account changes — not when toast identity changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceProfileId]);

  const toggleTarget = (targetId: string, checked: boolean) => {
    setSelectedTargetIds((current) =>
      checked ? [...current, targetId] : current.filter((id) => id !== targetId)
    );
    if (!checked) {
      setCourseTargetIds((current) => {
        const next: Record<string, string[]> = {};
        for (const [courseId, ids] of Object.entries(current)) {
          const remaining = ids.filter((id) => id !== targetId);
          if (remaining.length > 0) next[courseId] = remaining;
        }
        return next;
      });
    }
  };

  const toggleCourseTarget = (courseId: string, targetId: string, checked: boolean) => {
    setCourseTargetIds((current) => {
      const existing = current[courseId] || [];
      const nextIds = checked
        ? Array.from(new Set([...existing, targetId]))
        : existing.filter((id) => id !== targetId);
      const next = { ...current };
      if (nextIds.length > 0) next[courseId] = nextIds;
      else delete next[courseId];
      return next;
    });
  };

  const handleTransfer = async () => {
    if (!source || selectedTargetIds.length === 0 || saving || loadingCount) return;

    const courseTargetMap = transferMode === "coursewise"
      ? Object.entries(courseTargetIds)
          .filter(([, ids]) => ids.length > 0)
          .map(([courseId, targetIds]) => ({ course_id: courseId, target_profile_ids: targetIds }))
      : [];

    setSaving(true);
    try {
      // Single-target + no course overrides: use the simpler battle-tested RPC
      // (avoids uuid[]/jsonb edge cases on empty multi payloads). Multi for the rest.
      const useSimple = selectedTargetIds.length === 1 && courseTargetMap.length === 0;

      let result: RpcResult;
      if (useSimple) {
        result = await withTimeout(
          supabase.rpc("transfer_counsellor_account" as never, {
            source_profile_id: source.profileId,
            target_profile_id: selectedTargetIds[0],
            disable_source: disableSource,
          } as never) as Promise<RpcResult>,
          TRANSFER_TIMEOUT_MS,
          "Account transfer",
        );
      } else {
        result = await withTimeout(
          supabase.rpc("transfer_counsellor_account_multi" as never, {
            source_profile_id: source.profileId,
            target_profile_ids: selectedTargetIds,
            disable_source: disableSource,
            // Always send a real JSON array — never null/undefined (RPC rejects null shape).
            course_target_map: courseTargetMap,
          } as never) as Promise<RpcResult>,
          TRANSFER_TIMEOUT_MS,
          "Account transfer",
        );
      }

      const { data, error } = result;
      if (error) {
        toast({ title: "Transfer failed", description: error.message, variant: "destructive" });
        return;
      }

      const payload = parseTransferResult(data);
      const transferred = Number(payload.leads_transferred ?? 0);

      toast({
        title: "Transfer complete",
        description: transferred === 0
          ? `No leads were assigned to ${source.name}.${disableSource ? " Login disabled." : ""} WhatsApp inbox ownership (if any) was reassigned.`
          : `${transferred} lead${transferred !== 1 ? "s" : ""} distributed to ${selectedTargetIds.length} staff member${selectedTargetIds.length !== 1 ? "s" : ""}.${disableSource ? " Source login disabled." : ""}`,
      });
      onDone();
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : "Unexpected error during account transfer.";
      toast({
        title: "Transfer failed",
        description: message,
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={!!source} onOpenChange={(o) => !o && !saving && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ArrowRightLeft className="h-4 w-4 text-primary" />
            Transfer Account
          </DialogTitle>
          <DialogDescription className="sr-only">
            Distribute the source user's assigned leads and inbox work to selected staff members.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="rounded-lg border border-border bg-muted/40 px-4 py-3 text-sm">
            <p className="text-muted-foreground">Transferring all data from</p>
            <p className="font-semibold text-foreground mt-0.5">{source?.name}</p>
            {loadingCount ? (
              <p className="text-xs text-primary mt-1 flex items-center gap-1"><Loader2 className="h-3 w-3 animate-spin" /> Counting leads…</p>
            ) : leadCount !== null ? (
              <p className="text-xs text-muted-foreground mt-1">
                {leadCount === 0 ? (
                  <>
                    <span className="font-medium text-foreground">0 leads</span> on this account.
                    {disableSource
                      ? " Transfer will still disable their login and reassign any leftover WhatsApp inbox ownership."
                      : " You can still run transfer to reassign leftover WhatsApp inbox ownership."}
                  </>
                ) : (
                  <>
                    <span className="font-medium text-foreground">{leadCount}</span> lead{leadCount !== 1 ? "s" : ""} will be transferred
                    {uncategorizedLeadCount > 0 ? `, including ${uncategorizedLeadCount} without a course` : ""}
                  </>
                )}
              </p>
            ) : null}
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">Transfer mode</label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setTransferMode("round_robin")}
                className={`rounded-lg border px-3 py-2 text-left text-sm transition-colors ${transferMode === "round_robin" ? "border-primary bg-primary/10 text-primary" : "border-input bg-card text-foreground hover:bg-muted"}`}
              >
                <span className="flex items-center gap-2 font-medium"><Users className="h-4 w-4" /> Round robin</span>
              </button>
              <button
                type="button"
                onClick={() => setTransferMode("coursewise")}
                className={`rounded-lg border px-3 py-2 text-left text-sm transition-colors ${transferMode === "coursewise" ? "border-primary bg-primary/10 text-primary" : "border-input bg-card text-foreground hover:bg-muted"}`}
              >
                <span className="flex items-center gap-2 font-medium"><BookOpen className="h-4 w-4" /> Course-wise</span>
              </button>
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between gap-3">
              <label className="text-sm font-medium text-foreground">Counsellors / staff</label>
              {selectedTargetIds.length > 0 && (
                <span className="text-xs text-muted-foreground">{selectedTargetIds.length} selected</span>
              )}
            </div>
            <div className="max-h-44 overflow-y-auto rounded-lg border border-input bg-card">
              {targets.map((target) => {
                const checked = selectedTargetIds.includes(target.profile_id);
                return (
                  <label
                    key={target.profile_id}
                    className="flex cursor-pointer items-center gap-3 border-b border-border/60 px-3 py-2 text-sm last:border-b-0 hover:bg-muted/60"
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(e) => toggleTarget(target.profile_id, e.target.checked)}
                      className="h-4 w-4 rounded border-input accent-primary"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium text-foreground">{target.name}</span>
                      {target.role && <span className="block text-xs text-muted-foreground">{target.role.replace(/_/g, " ")}</span>}
                    </span>
                  </label>
                );
              })}
              {targets.length === 0 && (
                <div className="px-3 py-4 text-sm text-muted-foreground">No eligible staff members found.</div>
              )}
            </div>
            {selectedTargetIds.length > 0 && (
              <p className="text-xs text-muted-foreground">Default pool: {selectedTargetNames}</p>
            )}
          </div>

          {transferMode === "coursewise" && (
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-3">
                <label className="text-sm font-medium text-foreground">Course routing</label>
                {activeCourseRuleCount > 0 && (
                  <span className="text-xs text-muted-foreground">{activeCourseRuleCount} override{activeCourseRuleCount !== 1 ? "s" : ""}</span>
                )}
              </div>
              <div className="max-h-64 space-y-2 overflow-y-auto rounded-lg border border-input bg-card p-2">
                {courseSummaries.map((course) => {
                  const assignedIds = courseTargetIds[course.id] || [];
                  const inherited = assignedIds.length === 0;
                  return (
                    <div key={course.id} data-testid={`course-routing-${course.id}`} className="rounded-md border border-border/70 px-3 py-2">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-foreground">
                            {course.name}{course.code ? ` (${course.code})` : ""}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {course.leadCount} lead{course.leadCount !== 1 ? "s" : ""} · {inherited ? "default pool" : `${assignedIds.length} selected`}
                          </p>
                        </div>
                      </div>
                      <div className="mt-2 grid gap-1.5 sm:grid-cols-2">
                        {selectedTargets.map((target) => (
                          <label key={target.profile_id} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-xs hover:bg-muted">
                            <input
                              type="checkbox"
                              checked={assignedIds.includes(target.profile_id)}
                              onChange={(e) => toggleCourseTarget(course.id, target.profile_id, e.target.checked)}
                              className="h-3.5 w-3.5 rounded border-input accent-primary"
                            />
                            <span className="truncate">{target.name}</span>
                          </label>
                        ))}
                        {selectedTargets.length === 0 && (
                          <p className="text-xs text-muted-foreground">Select counsellors above.</p>
                        )}
                      </div>
                    </div>
                  );
                })}
                {courseSummaries.length === 0 && (
                  <div className="px-3 py-4 text-sm text-muted-foreground">No course-linked leads found.</div>
                )}
              </div>
            </div>
          )}

          <label className="flex items-center gap-2.5 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={disableSource}
              onChange={(e) => setDisableSource(e.target.checked)}
              className="h-4 w-4 rounded border-input accent-primary"
            />
            <span className="text-sm text-foreground">
              Disable <span className="font-medium">{source?.name}</span>'s login after transfer
            </span>
          </label>
        </div>

        <DialogFooter className="gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="rounded-lg border border-input px-4 py-2 text-sm font-medium text-foreground hover:bg-muted transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleTransfer}
            disabled={saving || selectedTargetIds.length === 0 || loadingCount}
            className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
          >
            {saving && <ButtonOrb state="working" onFilled />}
            {saving ? "Transferring…" : leadCount === 0 ? "Finish transfer" : "Transfer"}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
