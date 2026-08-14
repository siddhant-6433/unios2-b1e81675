// The queue an import drops into: every employee still marked
// verification_status='pending', with the fields a spreadsheet most often gets
// wrong or omits editable inline.
//
// Campus and institution are the reason this screen exists. A staff register
// almost never names them in a way that resolves to an id, so nothing else in
// the app can place these people until a human says which campus they belong to.
// Verification is blocked until campus + institution are set for that reason.

import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useOrgUnits } from "@/hooks/useOrgUnits";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PageLoader } from "@/components/ui/page-loader";
import { CheckCircle, Trash2, AlertTriangle } from "lucide-react";

interface PendingEmployee {
  id: string;
  employee_number: string | null;
  display_name: string | null;
  job_title: string | null;
  mobile_number: string | null;
  work_email: string | null;
  date_of_joining: string | null;
  campus_id: string | null;
  institution_id: string | null;
  department_id: string | null;
  import_batch_id: string | null;
  hr_location_id: string | null;
  work_location: string | null;
  hr_department: string | null;
}

const EDITABLE_TEXT = ["display_name", "employee_number", "job_title"] as const;

export function EmployeeVerificationTable({ onChange }: { onChange?: () => void }) {
  const { toast } = useToast();
  const org = useOrgUnits();
  const [rows, setRows] = useState<PendingEmployee[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  // Rows whose local edits haven't been written yet.
  const [dirty, setDirty] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [locationFilter, setLocationFilter] = useState("all");
  const [bulkCampus, setBulkCampus] = useState("");
  const [bulkInstitution, setBulkInstitution] = useState("");

  const fetchRows = useCallback(async () => {
    setLoading(true);
    // Paginated: PostgREST caps responses at 1000 rows and a big import would
    // otherwise silently lose its tail.
    const all: PendingEmployee[] = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await supabase
        .from("employee_profiles")
        .select("id, employee_number, display_name, job_title, mobile_number, work_email, date_of_joining, campus_id, institution_id, department_id, import_batch_id, hr_location_id, work_location, hr_department")
        .eq("verification_status", "pending")
        .order("created_at", { ascending: false })
        .range(from, from + 999);
      if (error) {
        toast({ title: "Could not load the queue", description: error.message, variant: "destructive" });
        break;
      }
      all.push(...((data as PendingEmployee[]) || []));
      if (!data || data.length < 1000) break;
    }
    setRows(all);
    setSelected(new Set());
    setDirty(new Set());
    setLoading(false);
  }, [toast]);

  useEffect(() => { fetchRows(); }, [fetchRows]);

  const edit = (id: string, patch: Partial<PendingEmployee>) => {
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)));
    setDirty((d) => new Set(d).add(id));
  };

  // Gate on WORK LOCATION, not campus. Two of NIMT's locations — Preet Vihar Center
  // and Seralis Lab — are offices with no campus at all, so requiring a campus would
  // strand those 14 people here forever. Same mistake as requiring an institution,
  // which had to be undone for drivers and maids.
  const isReady = (r: PendingEmployee) =>
    Boolean(r.display_name?.trim() && (r.hr_location_id || r.campus_id));

  // The imported work location is the whole reason this screen is tractable: it is
  // the hint that says which campus someone belongs to. Filtering by it turns 90
  // one-at-a-time dropdowns into a handful of bulk assignments.
  const locations = useMemo(
    () => [...new Set(rows.map((r) => r.work_location).filter(Boolean))].sort() as string[],
    [rows],
  );

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (locationFilter !== "all" && (r.work_location ?? "") !== locationFilter) return false;
      if (!q) return true;
      return [r.display_name, r.employee_number, r.job_title, r.work_email, r.hr_department]
        .some((v) => v?.toLowerCase().includes(q));
    });
  }, [rows, search, locationFilter]);

  const selectedRows = useMemo(() => rows.filter((r) => selected.has(r.id)), [rows, selected]);
  const readyCount = rows.filter(isReady).length;

  const toggle = (id: string) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });

  const applyBulk = () => {
    if (!bulkCampus || selected.size === 0) return;
    setRows((rs) =>
      rs.map((r) =>
        selected.has(r.id)
          ? {
              ...r,
              campus_id: bulkCampus,
              institution_id: bulkInstitution || null,
              // A department under the old institution would now be orphaned.
              department_id: bulkInstitution && r.department_id
                && org.departmentsFor(bulkInstitution).some((d) => d.id === r.department_id)
                ? r.department_id
                : null,
            }
          : r,
      ),
    );
    setDirty((d) => new Set([...d, ...selected]));
  };

  /** Write pending edits for `ids`, then optionally mark them verified. */
  const save = async (ids: string[], verify: boolean) => {
    if (ids.length === 0) return;
    setBusy(true);
    const { data: userData } = await supabase.auth.getUser();
    const uid = userData.user?.id ?? null;

    let failed = 0;
    for (const id of ids) {
      const r = rows.find((x) => x.id === id);
      if (!r) continue;
      if (verify && !isReady(r)) { failed++; continue; }

      const patch: Record<string, unknown> = {
        display_name: r.display_name?.trim() || null,
        employee_number: r.employee_number?.trim() || null,
        job_title: r.job_title?.trim() || null,
        campus_id: r.campus_id,
        institution_id: r.institution_id,
        department_id: r.department_id,
      };
      if (verify) {
        patch.verification_status = "verified";
        patch.verified_by = uid;
        patch.verified_at = new Date().toISOString();
      }

      // .select() so an RLS-filtered no-op surfaces as 0 rows instead of a
      // silent success — updates that "worked" but changed nothing have bitten
      // this codebase before.
      const { data, error } = await supabase
        .from("employee_profiles")
        .update(patch as never)
        .eq("id", id)
        .select("id");
      if (error || !data?.length) failed++;
    }

    setBusy(false);
    if (failed > 0) {
      toast({
        title: `${failed} of ${ids.length} could not be saved`,
        description: "Check that campus and institution are set, and that you have permission to edit employees.",
        variant: "destructive",
      });
    } else {
      toast({ title: verify ? `${ids.length} employees verified` : "Changes saved" });
    }
    await fetchRows();
    onChange?.();
  };

  const remove = async (id: string) => {
    const r = rows.find((x) => x.id === id);
    // Destructive and unrecoverable — the row sits next to the verify tick, so a
    // misclick would otherwise silently drop an imported employee.
    if (!window.confirm(
      `Discard ${r?.display_name || "this employee"}?\n\nThis permanently deletes the imported record. It cannot be undone.`
    )) return;
    setBusy(true);
    const { error } = await supabase.from("employee_profiles").delete().eq("id", id);
    setBusy(false);
    if (error) toast({ title: "Could not discard the row", description: error.message, variant: "destructive" });
    else { await fetchRows(); onChange?.(); }
  };

  if (loading) return <PageLoader />;

  if (rows.length === 0) {
    return (
      <div className="rounded-xl bg-card card-shadow px-4 py-12 text-center">
        <CheckCircle className="mx-auto h-8 w-8 text-emerald-600 mb-3" />
        <p className="text-sm text-foreground">Nothing to verify</p>
        <p className="text-xs text-muted-foreground mt-1">Imported employees appear here until a campus is assigned.</p>
      </div>
    );
  }

  const selectCls = "w-full rounded-lg border border-input bg-background px-2 py-1 text-xs";
  const inputCls = "w-full rounded-lg border border-input bg-background px-2 py-1 text-xs";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <Badge variant="outline" className="gap-1">
          <AlertTriangle className="h-3 w-3" /> {rows.length} awaiting verification
        </Badge>
        <span className="text-muted-foreground">{readyCount} ready</span>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search name, employee no., designation…"
          className="flex-1 min-w-[220px] max-w-sm rounded-lg border border-input bg-background px-3 py-1.5 text-xs"
        />
        <select
          value={locationFilter}
          onChange={(e) => setLocationFilter(e.target.value)}
          aria-label="Filter by the location imported from the staff register"
          className="rounded-lg border border-input bg-background px-2 py-1.5 text-xs"
        >
          <option value="all">All locations ({rows.length})</option>
          {locations.map((l) => (
            <option key={l} value={l}>
              {l} ({rows.filter((r) => r.work_location === l).length})
            </option>
          ))}
        </select>
        <Button
          size="sm"
          variant="outline"
          disabled={visible.length === 0}
          onClick={() => setSelected(new Set(visible.map((r) => r.id)))}
        >
          Select these {visible.length}
        </Button>
      </div>

      {/* Bulk assign — the usual case is one sheet, one campus. */}
      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-border p-3">
        <div className="min-w-[160px]">
          <label className="block text-[11px] font-medium text-muted-foreground mb-1">Campus</label>
          <select
            value={bulkCampus}
            onChange={(e) => { setBulkCampus(e.target.value); setBulkInstitution(""); }}
            className={selectCls}
          >
            <option value="">Select…</option>
            {org.campuses.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div className="min-w-[160px]">
          <label className="block text-[11px] font-medium text-muted-foreground mb-1">Institution</label>
          <select
            value={bulkInstitution}
            onChange={(e) => setBulkInstitution(e.target.value)}
            className={selectCls}
            disabled={!bulkCampus}
          >
            <option value="">Select…</option>
            {org.institutionsFor(bulkCampus).map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
          </select>
        </div>
        <Button size="sm" variant="outline" disabled={!bulkCampus || selected.size === 0} onClick={applyBulk}>
          Apply to {selected.size} selected
        </Button>
        <div className="flex-1" />
        <Button
          size="sm"
          variant="outline"
          disabled={busy || dirty.size === 0}
          onClick={() => save([...dirty], false)}
        >
          Save changes
        </Button>
        <Button
          size="sm"
          disabled={busy || selectedRows.filter(isReady).length === 0}
          onClick={() => save(selectedRows.filter(isReady).map((r) => r.id), true)}
        >
          Verify {selectedRows.filter(isReady).length} selected
        </Button>
      </div>

      <div className="rounded-xl bg-card card-shadow overflow-x-auto">
        <table className="w-full text-xs min-w-[1040px]">
          <thead className="bg-muted/50">
            <tr className="text-left">
              <th className="px-3 py-2 w-8">
                <input
                  type="checkbox"
                  checked={visible.length > 0 && visible.every((r) => selected.has(r.id))}
                  onChange={(e) => setSelected(e.target.checked ? new Set(visible.map((r) => r.id)) : new Set())}
                />
              </th>
              <th className="px-3 py-2 font-medium">Name</th>
              <th className="px-3 py-2 font-medium">Emp no.</th>
              <th className="px-3 py-2 font-medium">Designation</th>
              <th className="px-3 py-2 font-medium">From register</th>
              <th className="px-3 py-2 font-medium">Campus</th>
              <th className="px-3 py-2 font-medium">Institution</th>
              <th className="px-3 py-2 font-medium">Department</th>
              <th className="px-3 py-2 w-20"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {visible.map((r) => (
              <tr key={r.id} className={selected.has(r.id) ? "bg-muted/20" : ""}>
                <td className="px-3 py-2">
                  <input type="checkbox" checked={selected.has(r.id)} onChange={() => toggle(r.id)} />
                </td>
                {EDITABLE_TEXT.map((f) => (
                  <td key={f} className="px-3 py-2">
                    <input
                      className={inputCls}
                      value={r[f] ?? ""}
                      onChange={(e) => edit(r.id, { [f]: e.target.value } as Partial<PendingEmployee>)}
                    />
                  </td>
                ))}
                <td className="px-3 py-2 text-muted-foreground whitespace-nowrap">
                  {r.work_location || "—"}
                  {r.hr_department && <span className="block text-[10px]">{r.hr_department}</span>}
                </td>
                <td className="px-3 py-2">
                  <select
                    className={selectCls}
                    value={r.campus_id ?? ""}
                    onChange={(e) => edit(r.id, { campus_id: e.target.value || null, institution_id: null, department_id: null })}
                  >
                    <option value="">—</option>
                    {org.campuses.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </td>
                <td className="px-3 py-2">
                  <select
                    className={selectCls}
                    value={r.institution_id ?? ""}
                    onChange={(e) => edit(r.id, { institution_id: e.target.value || null, department_id: null })}
                    disabled={!r.campus_id}
                  >
                    <option value="">—</option>
                    {org.institutionsFor(r.campus_id).map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
                  </select>
                </td>
                <td className="px-3 py-2">
                  <select
                    className={selectCls}
                    value={r.department_id ?? ""}
                    onChange={(e) => edit(r.id, { department_id: e.target.value || null })}
                    disabled={!r.institution_id}
                  >
                    <option value="">—</option>
                    {org.departmentsFor(r.institution_id).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                  </select>
                </td>
                <td className="px-3 py-2">
                  <div className="flex items-center gap-1">
                    <button
                      title={isReady(r) ? "Verify" : "Set a work location first"}
                      disabled={busy || !isReady(r)}
                      onClick={() => save([r.id], true)}
                      className="p-1 text-muted-foreground hover:text-emerald-600 disabled:opacity-30"
                    >
                      <CheckCircle className="h-4 w-4" />
                    </button>
                    <button
                      title="Discard this imported row"
                      disabled={busy}
                      onClick={() => remove(r.id)}
                      className="p-1 text-muted-foreground hover:text-destructive disabled:opacity-30"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default EmployeeVerificationTable;
