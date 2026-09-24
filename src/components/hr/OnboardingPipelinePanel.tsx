// Onboarding pipeline — a light kanban of everyone who is not yet an employee.
//
// The hiring funnel used to disappear the moment an offer was generated: the
// `job_applicants` worklist stops at "hired", and there was no screen for the
// gap between an accepted offer and a real employee record. This panel reads
// `employee_profiles` rows with `onboarding_stage <> 'employee'`, groups them by
// stage, and lets HR walk each one forward one stage at a time.
//
// Writes are the one direct update allowed for `hr:employees_edit` under the
// table's RLS policy; the Advance button is hidden entirely when the viewer
// cannot edit, so the read-only view never teases an action it can't take.

import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { usePermissions } from "@/contexts/PermissionContext";
import { PageLoader } from "@/components/ui/page-loader";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Search, ArrowRight, ExternalLink, ShieldCheck, Users } from "lucide-react";
import {
  ONBOARDING_STAGES,
  nextStage,
  stageBadge,
  stageLabel,
  progressPct,
  isCandidate,
  type OnboardingStage,
} from "@/lib/onboarding";

interface NamedRef {
  name: string | null;
}

interface OnboardingRow {
  id: string;
  display_name: string | null;
  first_name: string | null;
  last_name: string | null;
  job_title: string | null;
  department_id: string | null;
  campus_id: string | null;
  onboarding_stage: string;
  offer_role: string | null;
  offer_ctc_annual: number | null;
  offer_joining_date: string | null;
  offer_generated_at: string | null;
  offer_accepted_at: string | null;
  job_applicant_id: string | null;
  verification_status: string | null;
  user_id: string | null;
  departments: NamedRef | NamedRef[] | null;
  campuses: NamedRef | NamedRef[] | null;
}

// The columns the pipeline needs, including the two reference-table labels.
const SELECT_COLUMNS =
  "id, display_name, first_name, last_name, job_title, department_id, campus_id, " +
  "onboarding_stage, offer_role, offer_ctc_annual, offer_joining_date, " +
  "offer_generated_at, offer_accepted_at, job_applicant_id, verification_status, user_id, " +
  "departments(name), campuses(name)";

// Pipeline columns: every stage except the terminal `employee`, which this
// panel filters out at the query level.
const PIPELINE_STAGES = ONBOARDING_STAGES.filter((s) => s !== "employee");

function embedName(ref: NamedRef | NamedRef[] | null): string | null {
  const row = Array.isArray(ref) ? ref[0] : ref;
  return row?.name ?? null;
}

function personName(row: OnboardingRow): string {
  const joined = [row.first_name, row.last_name].filter(Boolean).join(" ").trim();
  return row.display_name || joined || "Unnamed";
}

function formatDate(value: string | null): string {
  if (!value) return "—";
  return new Date(`${value}T00:00:00`).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function OnboardingPipelinePanel() {
  const { toast } = useToast();
  const { can } = usePermissions();
  const canEdit = can("hr", "employees_edit");

  const [rows, setRows] = useState<OnboardingRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const fetchAll = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("employee_profiles")
      .select(SELECT_COLUMNS)
      .neq("onboarding_stage", "employee")
      .order("offer_joining_date", { ascending: true, nullsFirst: false })
      .limit(500);
    if (error) {
      console.error("[OnboardingPipelinePanel] fetch failed:", error);
      setRows([]);
    } else {
      setRows((data as OnboardingRow[]) ?? []);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((row) =>
      [
        personName(row),
        row.offer_role,
        row.job_title,
        row.department_id,
        row.campus_id,
        embedName(row.departments),
        embedName(row.campuses),
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(q)),
    );
  }, [rows, search]);

  const grouped = useMemo(() => {
    const map = new Map<OnboardingStage, OnboardingRow[]>();
    for (const stage of PIPELINE_STAGES) map.set(stage, []);
    for (const row of filtered) {
      const bucket = map.get(row.onboarding_stage as OnboardingStage);
      // Unknown stages are impossible under the CHECK; if one appears anyway,
      // show it at the top of the funnel rather than dropping it.
      (bucket ?? map.get("candidate"))?.push(row);
    }
    return map;
  }, [filtered]);

  const advance = async (row: OnboardingRow) => {
    const next = nextStage(row.onboarding_stage);
    if (!next) return;
    setBusy(row.id);
    const { data, error } = await supabase
      .from("employee_profiles")
      .update({ onboarding_stage: next })
      .eq("id", row.id)
      .select("id");
    setBusy(null);
    if (error || !data?.length) {
      toast({
        title: "Could not advance",
        description: error?.message ?? "No permission",
        variant: "destructive",
      });
      return;
    }
    toast({ title: "Advanced", description: `${personName(row)} → ${stageLabel(next)}` });
    await fetchAll();
  };

  if (loading) return <PageLoader />;

  const candidateCount = rows.filter(isCandidate).length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <Users className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold text-foreground">Pipeline</h2>
          <Badge variant="outline" className="text-[11px]">{rows.length}</Badge>
          {candidateCount > 0 && (
            <Badge variant="outline" className="text-[11px] border-primary/30 text-primary">
              {candidateCount} new
            </Badge>
          )}
        </div>
        <div className="relative ml-auto w-full sm:w-72">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name, role, department, campus…"
            className="h-9 pl-8 text-[13px]"
          />
        </div>
      </div>

      {rows.length === 0 ? (
        <p className="rounded-xl bg-card card-shadow px-4 py-10 text-center text-xs text-muted-foreground">
          Nobody is in onboarding. Candidates appear here once a profile is created from a hired applicant.
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-5">
          {PIPELINE_STAGES.map((stage) => {
            const column = grouped.get(stage) ?? [];
            return (
              <div key={stage} className="space-y-2">
                <div className="flex items-center gap-2">
                  <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${stageBadge(stage)}`}>
                    {stageLabel(stage)}
                  </span>
                  <Badge variant="outline" className="text-[10px]">{column.length}</Badge>
                  <span className="ml-auto text-[10px] text-muted-foreground">{progressPct(stage)}%</span>
                </div>

                {column.length === 0 ? (
                  <p className="rounded-xl border border-dashed border-border px-3 py-6 text-center text-[11px] text-muted-foreground">
                    Empty
                  </p>
                ) : (
                  column.map((row) => {
                    const next = nextStage(row.onboarding_stage);
                    const department = embedName(row.departments);
                    const campus = embedName(row.campuses);
                    return (
                      <Card key={row.id} className="border-border/60 shadow-none">
                        <CardContent className="space-y-2 p-3">
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex min-w-0 flex-col">
                              <span className="truncate text-[13px] font-medium text-foreground">
                                {personName(row)}
                              </span>
                              <span className="truncate text-[11px] text-muted-foreground">
                                {row.offer_role || row.job_title || "No role set"}
                              </span>
                            </div>
                            {row.verification_status === "verified" && (
                              <ShieldCheck
                                className="h-3.5 w-3.5 shrink-0 text-emerald-600"
                                title="Documents verified"
                              />
                            )}
                          </div>

                          {(department || campus) && (
                            <p className="truncate text-[11px] text-muted-foreground">
                              {[department, campus].filter(Boolean).join(" · ")}
                            </p>
                          )}

                          <div className="flex items-center justify-between gap-2 text-[11px]">
                            <span className="text-muted-foreground">Joining</span>
                            <span className="font-medium text-foreground/80">
                              {formatDate(row.offer_joining_date)}
                            </span>
                          </div>

                          <div className="h-1 w-full overflow-hidden rounded-full bg-muted">
                            <div
                              className="h-1 rounded-full bg-primary/60"
                              style={{ width: `${progressPct(row.onboarding_stage)}%` }}
                            />
                          </div>

                          <div className="flex items-center gap-1 pt-0.5">
                            {canEdit && next && (
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 flex-1 px-2 text-[11px]"
                                disabled={busy === row.id}
                                onClick={() => advance(row)}
                              >
                                <ArrowRight className="mr-1 h-3 w-3" />
                                Advance
                              </Button>
                            )}
                            {row.job_applicant_id && (
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 px-2 text-[11px]"
                                asChild
                              >
                                <Link to="/hr-job-applicants" title="Open the job applicant">
                                  Applicant
                                  <ExternalLink className="ml-1 h-3 w-3" />
                                </Link>
                              </Button>
                            )}
                          </div>
                        </CardContent>
                      </Card>
                    );
                  })
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default OnboardingPipelinePanel;
