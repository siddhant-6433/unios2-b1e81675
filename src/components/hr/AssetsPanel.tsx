// HR Assets — the asset register and allocation console.
//
// This is the HR-side view: a table of every asset in the register with filters
// by status and category, a create/edit dialog, and the two allocation flows —
// assign an asset to an employee and take it back on return. Those two actions
// are database RPCs, not table writes, so the assignment, the asset's status
// change and the employee's notification all happen in one transaction.
//
// Active assignments come from the asset_assignments_inbox view (already joined
// with the asset and employee), and the summary cards come from the
// hr_asset_summary() RPC. The register itself is read from the assets table and
// joined to categories client-side, since the register is small and we already
// need the category list for the form and the filter.

import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { usePermissions } from "@/contexts/PermissionContext";
import { PageLoader } from "@/components/ui/page-loader";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { SelectField } from "@/components/ui/state-fields";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Package, Plus, Pencil, UserPlus, Undo2, Loader2 } from "lucide-react";
import {
  ASSET_FILTERS, ASSET_STATUSES,
  assetStatusBadge, assetStatusLabel, formatInr,
  type Asset, type AssetAssignmentInboxRow, type AssetCategory, type AssetFilter,
  type AssetSummaryRow,
} from "@/lib/assets";

interface EmployeeOption {
  id: string;
  display_name: string | null;
  employee_number: string | null;
}

const EMPTY_ASSET = {
  asset_tag: "",
  name: "",
  category_id: "",
  serial_number: "",
  model: "",
  purchase_date: "",
  purchase_cost: "",
  status: "available" as Asset["status"],
  location: "",
  notes: "",
};

const RETURN_CONDITIONS = [
  { value: "good", label: "Good — back to stock" },
  { value: "damaged", label: "Damaged — to maintenance" },
  { value: "needs_repair", label: "Needs repair — to maintenance" },
  { value: "faulty", label: "Faulty" },
  { value: "other", label: "Other" },
];

const fmtDate = (value: string | null | undefined) =>
  value ? new Date(value).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—";

const inputCls =
  "rounded-xl border border-input bg-card px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring/20";

export function AssetsPanel() {
  const { toast } = useToast();
  const { can } = usePermissions();
  const canManage = can("hr", "assets_manage");

  const [assets, setAssets] = useState<Asset[]>([]);
  const [categories, setCategories] = useState<AssetCategory[]>([]);
  const [activeAssignments, setActiveAssignments] = useState<AssetAssignmentInboxRow[]>([]);
  const [summaryRows, setSummaryRows] = useState<AssetSummaryRow[]>([]);
  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  const [loading, setLoading] = useState(true);

  const [statusFilter, setStatusFilter] = useState<AssetFilter>("all");
  const [categoryFilter, setCategoryFilter] = useState("");

  const [busyId, setBusyId] = useState<string | null>(null);

  const [assetDialogOpen, setAssetDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Asset | null>(null);
  const [form, setForm] = useState({ ...EMPTY_ASSET });

  const [assigning, setAssigning] = useState<Asset | null>(null);
  const [assignProfileId, setAssignProfileId] = useState("");
  const [assignNotes, setAssignNotes] = useState("");

  const [returning, setReturning] = useState<AssetAssignmentInboxRow | null>(null);
  const [returnCondition, setReturnCondition] = useState("good");
  const [returnNotes, setReturnNotes] = useState("");

  const fetchAll = useCallback(async () => {
    setLoading(true);
    const [assetRes, categoryRes, inboxRes, summaryRes, employeeRes] = await Promise.all([
      (supabase as any)
        .from("assets")
        .select("id, asset_tag, name, category_id, serial_number, model, purchase_date, purchase_cost, warranty_until, condition, status, location, notes")
        .order("asset_tag"),
      (supabase as any)
        .from("asset_categories")
        .select("id, code, name, is_active, display_order")
        .order("display_order"),
      (supabase as any)
        .from("asset_assignments_inbox")
        .select("id, asset_id, employee_profile_id, assigned_at, returned_at, condition_on_return, notes, asset_tag, asset_name, asset_status, category_name, employee_name, employee_number")
        .is("returned_at", null)
        .order("assigned_at", { ascending: false }),
      supabase.rpc("hr_asset_summary" as any),
      (supabase as any)
        .from("employee_profiles")
        .select("id, display_name, employee_number")
        .order("display_name"),
    ]);

    if (assetRes.error) {
      toast({ title: "Could not load assets", description: assetRes.error.message, variant: "destructive" });
    }
    setAssets((assetRes.data as Asset[]) ?? []);
    setCategories((categoryRes.data as AssetCategory[]) ?? []);
    setActiveAssignments((inboxRes.data as AssetAssignmentInboxRow[]) ?? []);
    setSummaryRows((summaryRes.data as AssetSummaryRow[]) ?? []);
    setEmployees((employeeRes.data as EmployeeOption[]) ?? []);
    setLoading(false);
  }, [toast]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const categoryMap = useMemo(
    () => new Map(categories.map((c) => [c.id, c])),
    [categories],
  );
  const assignmentByAsset = useMemo(
    () => new Map(activeAssignments.map((a) => [a.asset_id, a])),
    [activeAssignments],
  );

  const visible = useMemo(
    () => assets.filter((a) =>
      (statusFilter === "all" || a.status === statusFilter) &&
      (!categoryFilter || a.category_id === categoryFilter),
    ),
    [assets, statusFilter, categoryFilter],
  );

  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = { all: assets.length };
    for (const s of ASSET_STATUSES) counts[s] = 0;
    for (const a of assets) counts[a.status] = (counts[a.status] ?? 0) + 1;
    return counts;
  }, [assets]);

  const cards = useMemo(() => {
    const countBy = (status: string) =>
      summaryRows.filter((r) => r.status === status).reduce((n, r) => n + Number(r.assets || 0), 0);
    const totalAssets = summaryRows.reduce((n, r) => n + Number(r.assets || 0), 0);
    const totalCost = summaryRows.reduce((n, r) => n + Number(r.total_cost || 0), 0);
    return [
      { label: "Total assets", value: String(totalAssets), sub: `₹${formatInr(totalCost)}`, tone: "text-foreground" },
      { label: "Assigned", value: String(countBy("assigned")), sub: "", tone: "text-emerald-600" },
      { label: "Available", value: String(countBy("available")), sub: "", tone: "text-blue-600" },
      { label: "Maintenance", value: String(countBy("maintenance")), sub: "", tone: "text-amber-600" },
    ];
  }, [summaryRows]);

  const openCreate = () => {
    setEditing(null);
    setForm({ ...EMPTY_ASSET });
    setAssetDialogOpen(true);
  };

  const openEdit = (asset: Asset) => {
    setEditing(asset);
    setForm({
      asset_tag: asset.asset_tag,
      name: asset.name,
      category_id: asset.category_id ?? "",
      serial_number: asset.serial_number ?? "",
      model: asset.model ?? "",
      purchase_date: asset.purchase_date ?? "",
      purchase_cost: asset.purchase_cost === null || asset.purchase_cost === undefined ? "" : String(asset.purchase_cost),
      status: asset.status,
      location: asset.location ?? "",
      notes: asset.notes ?? "",
    });
    setAssetDialogOpen(true);
  };

  const saveAsset = async () => {
    if (!form.asset_tag.trim() || !form.name.trim()) {
      toast({ title: "Tag and name are required", variant: "destructive" });
      return;
    }
    setBusyId("save");
    const payload = {
      asset_tag: form.asset_tag.trim().toUpperCase(),
      name: form.name.trim(),
      category_id: form.category_id || null,
      serial_number: form.serial_number.trim() || null,
      model: form.model.trim() || null,
      purchase_date: form.purchase_date || null,
      purchase_cost: form.purchase_cost === "" ? null : Number(form.purchase_cost),
      status: form.status,
      location: form.location.trim() || null,
      notes: form.notes.trim() || null,
    };
    const result = editing
      ? await (supabase as any).from("assets").update(payload).eq("id", editing.id)
      : await (supabase as any).from("assets").insert(payload);
    setBusyId(null);
    if (result.error) {
      toast({ title: "Could not save the asset", description: result.error.message, variant: "destructive" });
      return;
    }
    toast({ title: editing ? "Asset updated" : "Asset added" });
    setAssetDialogOpen(false);
    await fetchAll();
  };

  const submitAssign = async () => {
    if (!assigning || !assignProfileId) {
      toast({ title: "Pick an employee", variant: "destructive" });
      return;
    }
    setBusyId(assigning.id);
    const { error } = await supabase.rpc("assign_asset" as any, {
      _asset_id: assigning.id,
      _employee_profile_id: assignProfileId,
      _notes: assignNotes.trim() || null,
    });
    setBusyId(null);
    if (error) {
      toast({ title: "Could not assign the asset", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Asset assigned" });
    setAssigning(null);
    setAssignProfileId("");
    setAssignNotes("");
    await fetchAll();
  };

  const submitReturn = async () => {
    if (!returning) return;
    setBusyId(returning.id);
    const { error } = await supabase.rpc("return_asset" as any, {
      _assignment_id: returning.id,
      _condition: returnCondition || null,
      _notes: returnNotes.trim() || null,
    });
    setBusyId(null);
    if (error) {
      toast({ title: "Could not return the asset", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Asset returned" });
    setReturning(null);
    setReturnNotes("");
    await fetchAll();
  };

  if (loading) return <PageLoader />;

  const categoryOptions = categories.map((c) => ({ value: c.id, label: c.name }));
  const employeeOptions = employees.map((e) => ({
    value: e.id,
    label: `${e.display_name || "Unnamed"}${e.employee_number ? ` · ${e.employee_number}` : ""}`,
  }));

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {cards.map((c) => (
          <div key={c.label} className="rounded-xl bg-card card-shadow p-4">
            <p className="text-[11px] text-muted-foreground">{c.label}</p>
            <p className={`text-lg font-semibold mt-1 ${c.tone}`}>{c.value}</p>
            {c.sub && <p className="text-[11px] text-muted-foreground mt-0.5">{c.sub}</p>}
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-1 rounded-xl border border-input bg-card p-1">
          {ASSET_FILTERS.map((f) => (
            <button
              key={f}
              onClick={() => setStatusFilter(f)}
              className={`flex items-center gap-2 rounded-lg px-3.5 py-1.5 text-sm font-medium capitalize transition-colors ${
                statusFilter === f ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {f === "all" ? "All" : assetStatusLabel(f)}
              <span className={`text-[10px] ${statusFilter === f ? "text-primary-foreground/80" : "text-muted-foreground/70"}`}>
                {statusCounts[f] ?? 0}
              </span>
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <SelectField
            value={categoryFilter}
            onValueChange={setCategoryFilter}
            options={categoryOptions}
            placeholder="All categories"
            ariaLabel="Filter by category"
            triggerClassName="h-9 w-[180px] text-sm"
          />
          {canManage && (
            <Button size="sm" onClick={openCreate}>
              <Plus className="h-4 w-4 mr-1.5" /> Add asset
            </Button>
          )}
        </div>
      </div>

      {visible.length === 0 ? (
        <div className="rounded-xl bg-card card-shadow p-12 text-center">
          <Package className="h-10 w-10 text-muted-foreground/30 mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">No assets match this filter.</p>
        </div>
      ) : (
        <div className="rounded-xl bg-card card-shadow overflow-x-auto">
          <table className="w-full text-sm min-w-[1000px]">
            <thead>
              <tr className="border-b border-border bg-muted/50">
                <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Tag</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Asset</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Category</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Status</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Location</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Assigned to</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Purchased</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-muted-foreground uppercase tracking-wide">Cost</th>
                {canManage && (
                  <th className="px-4 py-3 text-right text-xs font-semibold text-muted-foreground uppercase tracking-wide">Actions</th>
                )}
              </tr>
            </thead>
            <tbody>
              {visible.map((asset) => {
                const assignment = assignmentByAsset.get(asset.id);
                return (
                  <tr key={asset.id} className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors">
                    <td className="px-4 py-3 font-mono text-xs text-foreground">{asset.asset_tag}</td>
                    <td className="px-4 py-3 max-w-[220px]">
                      <div className="font-medium text-foreground truncate">{asset.name}</div>
                      {(asset.serial_number || asset.model) && (
                        <div className="text-xs text-muted-foreground truncate">
                          {[asset.model, asset.serial_number].filter(Boolean).join(" · ")}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">
                      {asset.category_id ? categoryMap.get(asset.category_id)?.name ?? "—" : "—"}
                    </td>
                    <td className="px-4 py-3">
                      <Badge className={assetStatusBadge(asset.status)}>{assetStatusLabel(asset.status)}</Badge>
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">{asset.location || "—"}</td>
                    <td className="px-4 py-3">
                      {assignment ? (
                        <>
                          <div className="text-xs font-medium text-foreground">{assignment.employee_name || "Unnamed"}</div>
                          {assignment.employee_number && (
                            <div className="text-[11px] text-muted-foreground">{assignment.employee_number}</div>
                          )}
                        </>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">{fmtDate(asset.purchase_date)}</td>
                    <td className="px-4 py-3 text-right text-xs text-foreground">
                      {asset.purchase_cost === null ? "—" : `₹${formatInr(asset.purchase_cost)}`}
                    </td>
                    {canManage && (
                      <td className="px-4 py-3">
                        <div className="flex justify-end gap-1.5">
                          {assignment ? (
                            <button
                              onClick={() => { setReturning(assignment); setReturnCondition("good"); setReturnNotes(""); }}
                              disabled={busyId === assignment.id}
                              className="flex items-center gap-1 rounded-lg border border-input px-2.5 py-1 text-[11px] font-medium text-foreground hover:bg-muted disabled:opacity-50"
                            >
                              {busyId === assignment.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Undo2 className="h-3 w-3" />} Return
                            </button>
                          ) : (
                            <button
                              onClick={() => { setAssigning(asset); setAssignProfileId(""); setAssignNotes(""); }}
                              disabled={asset.status === "retired" || asset.status === "lost"}
                              className="flex items-center gap-1 rounded-lg bg-primary px-2.5 py-1 text-[11px] font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-40"
                            >
                              <UserPlus className="h-3 w-3" /> Assign
                            </button>
                          )}
                          <button
                            onClick={() => openEdit(asset)}
                            className="flex items-center gap-1 rounded-lg border border-input px-2.5 py-1 text-[11px] font-medium text-muted-foreground hover:bg-muted"
                          >
                            <Pencil className="h-3 w-3" />
                          </button>
                        </div>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Create / edit asset */}
      <Dialog open={assetDialogOpen} onOpenChange={setAssetDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit asset" : "Add asset"}</DialogTitle>
            <DialogDescription>
              {editing ? `${editing.asset_tag} · ${editing.name}` : "Register a new item in the asset catalogue."}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <label className="block text-xs text-muted-foreground">
                Asset tag
                <Input value={form.asset_tag} onChange={(e) => setForm({ ...form, asset_tag: e.target.value })}
                  placeholder="e.g. LAP-0042" className="mt-1 h-9 text-sm" />
              </label>
              <label className="block text-xs text-muted-foreground">
                Name
                <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="e.g. Dell Latitude 5440" className="mt-1 h-9 text-sm" />
              </label>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <SelectField
                label="Category"
                value={form.category_id}
                onValueChange={(v) => setForm({ ...form, category_id: v })}
                options={categoryOptions}
                placeholder="Uncategorised"
              />
              <SelectField
                label="Status"
                value={form.status}
                onValueChange={(v) => setForm({ ...form, status: v as Asset["status"] })}
                options={ASSET_STATUSES.map((s) => ({ value: s, label: assetStatusLabel(s) }))}
                allowEmpty={false}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <label className="block text-xs text-muted-foreground">
                Serial number
                <Input value={form.serial_number} onChange={(e) => setForm({ ...form, serial_number: e.target.value })}
                  className="mt-1 h-9 text-sm" />
              </label>
              <label className="block text-xs text-muted-foreground">
                Model
                <Input value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })}
                  className="mt-1 h-9 text-sm" />
              </label>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <label className="block text-xs text-muted-foreground">
                Purchase date
                <Input type="date" value={form.purchase_date}
                  onChange={(e) => setForm({ ...form, purchase_date: e.target.value })} className="mt-1 h-9 text-sm" />
              </label>
              <label className="block text-xs text-muted-foreground">
                Purchase cost (₹)
                <Input type="number" step="0.01" value={form.purchase_cost}
                  onChange={(e) => setForm({ ...form, purchase_cost: e.target.value })} className="mt-1 h-9 text-sm" />
              </label>
              <label className="block text-xs text-muted-foreground">
                Location
                <Input value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })}
                  placeholder="e.g. Main campus" className="mt-1 h-9 text-sm" />
              </label>
            </div>

            <label className="block text-xs text-muted-foreground">
              Notes
              <Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })}
                rows={2} className="mt-1 text-sm" />
            </label>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setAssetDialogOpen(false)} disabled={busyId === "save"}>Cancel</Button>
            <Button onClick={saveAsset} disabled={busyId === "save"}>
              {busyId === "save" && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}
              {editing ? "Save changes" : "Add asset"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Assign */}
      <Dialog open={!!assigning} onOpenChange={(open) => { if (!open) setAssigning(null); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Assign asset</DialogTitle>
            <DialogDescription>
              {assigning ? `${assigning.asset_tag} · ${assigning.name}` : ""}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <SelectField
              label="Employee"
              value={assignProfileId}
              onValueChange={setAssignProfileId}
              options={employeeOptions}
              placeholder="Pick an employee"
            />
            <label className="block text-xs text-muted-foreground">
              Notes
              <Textarea value={assignNotes} onChange={(e) => setAssignNotes(e.target.value)}
                rows={2} placeholder="Optional — e.g. issued during onboarding" className="mt-1 text-sm" />
            </label>
          </div>

          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setAssigning(null)} disabled={busyId === assigning?.id}>
              Cancel
            </Button>
            <Button size="sm" onClick={submitAssign} disabled={busyId === assigning?.id || !assignProfileId}>
              {busyId === assigning?.id && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />} Assign
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Return */}
      <Dialog open={!!returning} onOpenChange={(open) => { if (!open) setReturning(null); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Return asset</DialogTitle>
            <DialogDescription>
              {returning
                ? `${returning.asset_tag} · ${returning.asset_name} from ${returning.employee_name || "employee"}`
                : ""}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <SelectField
              label="Condition on return"
              value={returnCondition}
              onValueChange={setReturnCondition}
              options={RETURN_CONDITIONS}
              allowEmpty={false}
            />
            <label className="block text-xs text-muted-foreground">
              Notes
              <Textarea value={returnNotes} onChange={(e) => setReturnNotes(e.target.value)}
                rows={2} placeholder="Optional — e.g. screen scratched" className="mt-1 text-sm" />
            </label>
          </div>

          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setReturning(null)} disabled={busyId === returning?.id}>
              Cancel
            </Button>
            <Button size="sm" onClick={submitReturn} disabled={busyId === returning?.id}>
              {busyId === returning?.id && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />} Mark returned
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default AssetsPanel;
