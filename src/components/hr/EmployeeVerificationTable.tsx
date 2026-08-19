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
  // Null for imported staff who have no login yet — the reason we can provision one on verify.
  user_id: string | null;
}

const EDITABLE_TEXT = ["display_name", "employee_number", "job_title"] as const;

// Roles the verify screen may provision a login for. Deliberately excludes
// super_admin / campus_admin so an HR editor can't mint an admin — invite-user
// enforces the same allow-list server-side for non-super-admin callers.
const PROVISIONABLE_ROLES: { value: string; label: string }[] = [
  { value: "principal", label: "Principal" },
  { value: "admission_head", label: "Admission Head" },
  { value: "counsellor", label: "Counsellor" },
  { value: "accountant", label: "Accountant" },
  { value: "faculty", label: "Faculty" },
  { value: "teacher", label: "Teacher" },
  { value: "data_entry", label: "Data Entry" },
  { value: "office_admin", label: "Office Administrator" },
  { value: "office_assistant", label: "Office Assistant" },
  { value: "school_coordinator", label: "School Coordinator" },
  { value: "hostel_warden", label: "Hostel Warden" },
  { value: "librarian", label: "Librarian" },
];

export function EmployeeVerificationTable({ onChange }: { onChange?: () => void }) {
  const { toast } = useToast();
  const org = useOrgUnits();
  const [rows, setRows] = useState<PendingEmployee[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  // Rows whose local edits haven't been written yet.
  const [dirty, setDirty] = useState<Set<string>>(new Set());
  const [bulkCampus, setBulkCampus] = useState("");
  const [bulkInstitution, setBulkInstitution] = useState("");
  // Role chosen per row for login provisioning on verify. Not a DB column on
  // employee_profiles — kept client-side and passed to invite-user.
  const [roleById, setRoleById] = useState<Record<string, string>>({});
  const [bulkRole, setBulkRole] = useState("");

  const fetchRows = useCallback(async () => {
    setLoading(true);
    // Paginated: PostgREST caps responses at 1000 rows and a big import would
    // otherwise silently lose its tail.
    const all: PendingEmployee[] = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await supabase
        .from("employee_profiles")
        .select("id, employee_number, display_name, job_title, mobile_number, work_email, date_of_joining, campus_id, institution_id, department_id, import_batch_id, user_id")
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

  // Institution is deliberately NOT required: non-academic staff — drivers, maids,
  // accountants, HR — belong to a campus but to no institution, and demanding one
  // would strand them in this queue permanently.
  const isReady = (r: PendingEmployee) => Boolean(r.display_name?.trim() && r.campus_id);

  const selectedRows = useMemo(() => rows.filter((r) => selected.has(r.id)), [rows, selected]);
  const readyCount = rows.filter(isReady).length;

  const toggle = (id: string) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });

  const campusName = useCallback(
    (id: string | null) => (id ? org.campuses.find((c) => c.id === id)?.name ?? null : null),
    [org.campuses],
  );

  const applyBulk = () => {
    if ((!bulkCampus && !bulkRole) || selected.size === 0) return;
    if (bulkRole) {
      setRoleById((m) => {
        const next = { ...m };
        selected.forEach((id) => { next[id] = bulkRole; });
        return next;
      });
    }
    if (!bulkCampus) return;
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
    let provisioned = 0;
    let provisionFailed = 0;
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
      if (error || !data?.length) { failed++; continue; }

      // Provision a login on verify: only when this row has an email, a role was
      // chosen, and it isn't already linked to an auth user. No email → no login
      // (flagged "no login — add email" in the table); no role → verified only.
      const role = roleById[id];
      if (verify && r.work_email && role && !r.user_id) {
        try {
          const { data: inv, error: invErr } = await supabase.functions.invoke("invite-user", {
            body: {
              email: r.work_email,
              role,
              display_name: r.display_name?.trim() || undefined,
              phone: r.mobile_number || undefined,
              campus: campusName(r.campus_id) || undefined,
            },
          });
          const newUserId = (inv as { user_id?: string } | null)?.user_id;
          if (invErr || !newUserId) { provisionFailed++; continue; }
          // Back-fill the link so the employee now appears in the admin panel.
          const { data: linked, error: linkErr } = await supabase
            .from("employee_profiles")
            .update({ user_id: newUserId } as never)
            .eq("id", id)
            .select("id");
          if (linkErr || !linked?.length) provisionFailed++;
          else provisioned++;
        } catch {
          provisionFailed++;
        }
      }
    }

    setBusy(false);
    if (failed > 0) {
      toast({
        title: `${failed} of ${ids.length} could not be saved`,
        description: "Check that campus and institution are set, and that you have permission to edit employees.",
        variant: "destructive",
      });
    } else {
      toast({
        title: verify ? `${ids.length} employees verified` : "Changes saved",
        description: verify && provisioned > 0 ? `${provisioned} login${provisioned === 1 ? "" : "s"} created` : undefined,
      });
    }
    if (provisionFailed > 0) {
      toast({
        title: `${provisionFailed} login${provisionFailed === 1 ? "" : "s"} could not be created`,
        description: "The employee is verified but has no account yet. Check the email and your permission to invite users.",
        variant: "destructive",
      });
    }
    await fetchRows();
    onChange?.();
  };

  const remove = async (id: string) => {
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
        <div className="min-w-[160px]">
          <label className="block text-[11px] font-medium text-muted-foreground mb-1">Login role</label>
          <select value={bulkRole} onChange={(e) => setBulkRole(e.target.value)} className={selectCls}>
            <option value="">No login</option>
            {PROVISIONABLE_ROLES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
          </select>
        </div>
        <Button size="sm" variant="outline" disabled={(!bulkCampus && !bulkRole) || selected.size === 0} onClick={applyBulk}>
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
        <table className="w-full text-xs min-w-[900px]">
          <thead className="bg-muted/50">
            <tr className="text-left">
              <th className="px-3 py-2 w-8">
                <input
                  type="checkbox"
                  checked={selected.size === rows.length && rows.length > 0}
                  onChange={(e) => setSelected(e.target.checked ? new Set(rows.map((r) => r.id)) : new Set())}
                />
              </th>
              <th className="px-3 py-2 font-medium">Name</th>
              <th className="px-3 py-2 font-medium">Emp no.</th>
              <th className="px-3 py-2 font-medium">Designation</th>
              <th className="px-3 py-2 font-medium">Campus</th>
              <th className="px-3 py-2 font-medium">Institution</th>
              <th className="px-3 py-2 font-medium">Department</th>
              <th className="px-3 py-2 font-medium">Login role</th>
              <th className="px-3 py-2 w-20"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((r) => (
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
                  {r.user_id ? (
                    <span className="text-muted-foreground">Has login</span>
                  ) : r.work_email ? (
                    <select
                      className={selectCls}
                      value={roleById[r.id] ?? ""}
                      onChange={(e) => setRoleById((m) => ({ ...m, [r.id]: e.target.value }))}
                    >
                      <option value="">No login</option>
                      {PROVISIONABLE_ROLES.map((role) => <option key={role.value} value={role.value}>{role.label}</option>)}
                    </select>
                  ) : (
                    <span className="text-amber-600 whitespace-nowrap">No login — add email</span>
                  )}
                </td>
                <td className="px-3 py-2">
                  <div className="flex items-center gap-1">
                    <button
                      title={isReady(r) ? "Verify" : "Set a campus first"}
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
