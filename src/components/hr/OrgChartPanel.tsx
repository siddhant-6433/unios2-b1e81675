// Org chart — a read-only view of the reporting structure.
//
// Reads the `hr_org_chart` RPC (verified, non-exited employees only). The RPC
// keys each row on employee_profile_id but stores the manager as `reports_to`,
// which is an auth user id, so we also fetch the profile → user_id mapping and
// resolve direct reports by matching `manager_user_id` against it. Without that
// lookup a manager's reports can never be attached to their own card.
//
// The panel is defensive: a missing manager, an unlinked profile, or a blank
// department all fall back to a readable label rather than hiding the person.

import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageLoader } from "@/components/ui/page-loader";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Building2, ChevronDown, MapPin, Search, UserRound, Users } from "lucide-react";

interface OrgRow {
  employee_profile_id: string;
  display_name: string | null;
  job_title: string | null;
  department: string | null;
  campus: string | null;
  manager_user_id: string | null;
  photo_url: string | null;
  employment_status: string | null;
}

interface ProfileUser {
  id: string;
  user_id: string | null;
}

const STATUS_TONE: Record<string, string> = {
  working: "bg-pastel-green text-foreground/80",
  confirmed: "bg-pastel-green text-foreground/80",
  probation: "bg-pastel-yellow text-foreground/80",
  notice: "bg-pastel-orange text-foreground/80",
  contract: "bg-pastel-blue text-foreground/80",
  intern: "bg-pastel-purple text-foreground/80",
};

const statusTone = (status: string | null): string =>
  (status && STATUS_TONE[status.trim().toLowerCase()]) || "bg-muted text-muted-foreground";

const initialsOf = (name: string): string =>
  (name || "U").split(" ").filter(Boolean).map((part) => part[0]).join("").slice(0, 2).toUpperCase();

// PostgREST caps responses at 1000 rows; page through rather than quietly
// dropping the tail of a large institution.
async function fetchAll<T>(
  build: (from: number, to: number) => PromiseLike<{ data: T[] | null }>,
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data } = await build(from, from + 999);
    if (!data?.length) break;
    out.push(...data);
    if (data.length < 1000) break;
  }
  return out;
}

export function OrgChartPanel() {
  const [rows, setRows] = useState<OrgRow[]>([]);
  const [userIdByProfile, setUserIdByProfile] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [groupBy, setGroupBy] = useState<"department" | "campus">("department");
  const [search, setSearch] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const [orgRes, profiles] = await Promise.all([
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase as any).rpc("hr_org_chart"),
      fetchAll<ProfileUser>((from, to) =>
        supabase.from("employee_profiles").select("id, user_id").order("id").range(from, to)),
    ]);

    if (orgRes.error) {
      setError(orgRes.error.message);
      setRows([]);
    } else {
      setRows((orgRes.data as OrgRow[] | null) ?? []);
    }
    setUserIdByProfile(
      new Map(
        profiles
          .filter((p): p is ProfileUser & { user_id: string } => Boolean(p.user_id))
          .map((p) => [p.id, p.user_id] as const),
      ),
    );
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const rowByUserId = useMemo(() => {
    const map = new Map<string, OrgRow>();
    for (const row of rows) {
      const userId = userIdByProfile.get(row.employee_profile_id);
      if (userId) map.set(userId, row);
    }
    return map;
  }, [rows, userIdByProfile]);

  const reportsByManager = useMemo(() => {
    const map = new Map<string, OrgRow[]>();
    for (const row of rows) {
      if (!row.manager_user_id) continue;
      const list = map.get(row.manager_user_id) ?? [];
      list.push(row);
      map.set(row.manager_user_id, list);
    }
    for (const list of map.values()) {
      list.sort((a, b) => (a.display_name ?? "").localeCompare(b.display_name ?? ""));
    }
    return map;
  }, [rows]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((row) =>
      [row.display_name, row.job_title, row.department, row.campus]
        .some((value) => value?.toLowerCase().includes(q)));
  }, [rows, search]);

  const groups = useMemo(() => {
    const map = new Map<string, OrgRow[]>();
    for (const row of filtered) {
      const key = (groupBy === "department" ? row.department : row.campus) || "Unassigned";
      const list = map.get(key) ?? [];
      list.push(row);
      map.set(key, list);
    }
    return [...map.entries()]
      .map(([name, people]) => ({
        name,
        people: people.sort((a, b) => (a.display_name ?? "").localeCompare(b.display_name ?? "")),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [filtered, groupBy]);

  const directReportsOf = (row: OrgRow): OrgRow[] => {
    const userId = userIdByProfile.get(row.employee_profile_id);
    return userId ? reportsByManager.get(userId) ?? [] : [];
  };

  if (loading) return <PageLoader />;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search name, designation, department..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-xl border border-input bg-card py-2.5 pl-10 pr-4 text-sm focus:outline-none focus:ring-2 focus:ring-ring/20"
          />
        </div>

        <div className="flex items-center gap-1 rounded-xl border border-input bg-card p-1">
          {(["department", "campus"] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => setGroupBy(mode)}
              className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium capitalize transition-colors ${
                groupBy === mode
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {mode === "department" ? <Building2 className="h-4 w-4" /> : <MapPin className="h-4 w-4" />}
              {mode}
            </button>
          ))}
        </div>

        <Badge variant="outline" className="text-xs gap-1 cursor-default">
          <Users className="h-3 w-3" /> {rows.length} people
        </Badge>
      </div>

      {error && (
        <p className="rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</p>
      )}

      {groups.length === 0 ? (
        <div className="rounded-xl bg-card card-shadow px-4 py-12 text-center">
          <Users className="h-10 w-10 text-muted-foreground/30 mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">
            {rows.length === 0 ? "No org chart data available." : "No people match your search."}
          </p>
        </div>
      ) : (
        groups.map((group) => (
          <div key={group.name} className="space-y-3">
            <div className="flex items-center gap-2">
              {groupBy === "department" ? (
                <Building2 className="h-4 w-4 text-muted-foreground" />
              ) : (
                <MapPin className="h-4 w-4 text-muted-foreground" />
              )}
              <h2 className="text-sm font-semibold text-foreground">{group.name}</h2>
              <Badge variant="outline" className="text-[11px]">{group.people.length}</Badge>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {group.people.map((person) => {
                const reports = directReportsOf(person);
                const managerName = person.manager_user_id
                  ? rowByUserId.get(person.manager_user_id)?.display_name
                  : null;
                return (
                  <Card key={person.employee_profile_id} className="border-border/60 shadow-none">
                    <CardContent className="p-4 space-y-3">
                      <div className="flex items-start gap-3">
                        {person.photo_url ? (
                          <img
                            src={person.photo_url}
                            alt={person.display_name ?? "Employee"}
                            className="h-11 w-11 rounded-xl border border-border object-cover"
                          />
                        ) : (
                          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/15 text-xs font-bold text-primary">
                            {initialsOf(person.display_name ?? "")}
                          </div>
                        )}
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-semibold text-foreground">
                            {person.display_name || "Unnamed"}
                          </p>
                          <p className="truncate text-xs text-muted-foreground">
                            {person.job_title || "No designation"}
                          </p>
                          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                            <Badge className={`border-0 text-[10px] capitalize ${statusTone(person.employment_status)}`}>
                              {person.employment_status || "Working"}
                            </Badge>
                            {person.campus && (
                              <span className="text-[10px] text-muted-foreground">{person.campus}</span>
                            )}
                          </div>
                        </div>
                      </div>

                      {managerName && (
                        <p className="text-[11px] text-muted-foreground">
                          Reports to <span className="text-foreground">{managerName}</span>
                        </p>
                      )}

                      <div className="border-t border-border pt-2">
                        <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                          <Users className="h-3 w-3" />
                          {reports.length > 0 ? `${reports.length} direct report${reports.length === 1 ? "" : "s"}` : "No direct reports"}
                        </div>
                        {reports.length > 0 && (
                          <ul className="mt-2 space-y-1.5">
                            {reports.slice(0, 5).map((report) => (
                              <li key={report.employee_profile_id} className="flex items-center gap-2 text-xs">
                                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-muted text-[9px] font-semibold text-muted-foreground">
                                  {initialsOf(report.display_name ?? "")}
                                </span>
                                <span className="min-w-0 flex-1 truncate text-foreground">
                                  {report.display_name || "Unnamed"}
                                </span>
                                <span className="hidden max-w-[45%] truncate text-[10px] text-muted-foreground sm:block">
                                  {report.job_title || ""}
                                </span>
                              </li>
                            ))}
                            {reports.length > 5 && (
                              <li className="flex items-center gap-1 text-[10px] text-muted-foreground">
                                <ChevronDown className="h-3 w-3" /> +{reports.length - 5} more
                              </li>
                            )}
                          </ul>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </div>
        ))
      )}

      {!error && rows.length > 0 && filtered.length > 0 && (
        <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <UserRound className="h-3 w-3" /> Showing {filtered.length} of {rows.length} people.
        </p>
      )}
    </div>
  );
}

export default OrgChartPanel;
