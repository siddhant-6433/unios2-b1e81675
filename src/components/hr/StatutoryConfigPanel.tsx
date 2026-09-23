// Statutory settings.
//
// Two halves, deliberately different:
//   • salary_components — the catalogue the payroll engine reads. Read-only
//     here because a component is referenced by structures and released
//     payslips; edits belong in a payroll-aware migration, not a settings
//     screen that cannot see those references.
//   • payroll_statutory_config — the effective-dated rupees and percentages
//     (PF/ESI/PT/LWF). New rates are added with a later effective_from rather
//     than editing history, so a released payslip never changes underneath you.

import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { usePermissions } from "@/contexts/PermissionContext";
import { useToast } from "@/hooks/use-toast";
import { PageLoader } from "@/components/ui/page-loader";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { SelectField } from "@/components/ui/state-fields";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { IndianRupee, Pencil, Plus } from "lucide-react";

interface SalaryComponent {
  id: string;
  code: string;
  name: string;
  kind: string;
  calculation: string;
  basis_code: string | null;
  prorates: boolean;
  taxable: boolean;
  display_order: number;
  is_active: boolean;
}

interface StatutoryRow {
  id: string;
  legal_entity_id: string | null;
  key: string;
  numeric_value: number;
  effective_from: string;
  note: string | null;
}

interface LegalEntity {
  id: string;
  name: string;
}

const EMPTY_FORM = {
  legal_entity_id: "",
  key: "",
  numeric_value: "",
  effective_from: new Date().toISOString().slice(0, 10),
  note: "",
};

const KIND_STYLE: Record<string, string> = {
  earning: "bg-emerald-600/15 text-emerald-700",
  deduction: "bg-destructive/15 text-destructive",
  employer_contribution: "bg-primary/15 text-primary",
};

const fmtDate = (value: string | null) =>
  value ? new Date(`${value}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "—";

export function StatutoryConfigPanel() {
  const { toast } = useToast();
  const { can } = usePermissions();
  const canEdit = can("hr", "payroll_run");

  const [components, setComponents] = useState<SalaryComponent[]>([]);
  const [rates, setRates] = useState<StatutoryRow[]>([]);
  const [entities, setEntities] = useState<LegalEntity[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<StatutoryRow | null>(null);
  const [form, setForm] = useState({ ...EMPTY_FORM });

  const fetchAll = useCallback(async () => {
    setLoading(true);
    const [c, r, e] = await Promise.all([
      (supabase as any).from("salary_components")
        .select("id, code, name, kind, calculation, basis_code, prorates, taxable, display_order, is_active")
        .order("display_order"),
      (supabase as any).from("payroll_statutory_config")
        .select("id, legal_entity_id, key, numeric_value, effective_from, note")
        .order("key").order("effective_from", { ascending: false }),
      supabase.from("legal_entities").select("id, name").order("name"),
    ]);
    setComponents((c.data as SalaryComponent[]) ?? []);
    setRates((r.data as StatutoryRow[]) ?? []);
    setEntities((e.data as LegalEntity[]) ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const entityName = useMemo(() => {
    const map = new Map(entities.map((e) => [e.id, e.name]));
    return (id: string | null) => (id ? map.get(id) ?? "—" : "Global default");
  }, [entities]);

  const openCreate = () => {
    setEditing(null);
    setForm({ ...EMPTY_FORM });
    setOpen(true);
  };

  const openEdit = (row: StatutoryRow) => {
    setEditing(row);
    setForm({
      legal_entity_id: row.legal_entity_id ?? "",
      key: row.key,
      numeric_value: String(row.numeric_value),
      effective_from: row.effective_from,
      note: row.note ?? "",
    });
    setOpen(true);
  };

  const save = async () => {
    if (!form.key.trim() || form.numeric_value === "" || !form.effective_from) {
      toast({ title: "Key, value and effective date are required", variant: "destructive" });
      return;
    }
    setBusy(true);
    const payload = {
      legal_entity_id: form.legal_entity_id || null,
      key: form.key.trim(),
      numeric_value: Number(form.numeric_value),
      effective_from: form.effective_from,
      note: form.note.trim() || null,
    };

    const result = editing
      ? await (supabase as any).from("payroll_statutory_config").update(payload).eq("id", editing.id)
      : await (supabase as any).from("payroll_statutory_config").insert(payload);
    setBusy(false);

    if (result.error) {
      toast({ title: "Could not save the rate", description: result.error.message, variant: "destructive" });
      return;
    }
    toast({ title: editing ? "Rate updated" : "Rate added" });
    setOpen(false);
    await fetchAll();
  };

  if (loading) return <PageLoader />;

  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <IndianRupee className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold text-foreground">Salary components</h2>
          <Badge variant="outline" className="text-[11px]">{components.length}</Badge>
          <span className="text-[11px] text-muted-foreground">Read-only — the payroll engine reads these.</span>
        </div>

        <div className="rounded-xl bg-card card-shadow overflow-x-auto">
          <table className="w-full text-xs min-w-[760px]">
            <thead className="bg-muted/50">
              <tr className="text-left">
                <th className="px-3 py-2 font-medium">Code</th>
                <th className="px-3 py-2 font-medium">Name</th>
                <th className="px-3 py-2 font-medium">Kind</th>
                <th className="px-3 py-2 font-medium">Calculation</th>
                <th className="px-3 py-2 font-medium">Basis</th>
                <th className="px-3 py-2 font-medium">Prorates</th>
                <th className="px-3 py-2 font-medium">Taxable</th>
                <th className="px-3 py-2 font-medium text-right">Order</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {components.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-3 py-10 text-center text-muted-foreground">No salary components configured.</td>
                </tr>
              ) : components.map((component) => (
                <tr key={component.id} className="hover:bg-muted/30 transition-colors">
                  <td className="px-3 py-2 font-medium text-foreground">{component.code}</td>
                  <td className="px-3 py-2 text-foreground">
                    {component.name}
                    {!component.is_active && <span className="ml-2 text-[10px] text-muted-foreground">(inactive)</span>}
                  </td>
                  <td className="px-3 py-2">
                    <span className={`rounded-full px-2 py-0.5 text-[10px] ${KIND_STYLE[component.kind] ?? "bg-muted text-muted-foreground"}`}>
                      {component.kind.replace(/_/g, " ")}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">{component.calculation.replace(/_/g, " ")}</td>
                  <td className="px-3 py-2 text-muted-foreground">{component.basis_code || "—"}</td>
                  <td className="px-3 py-2 text-muted-foreground">{component.prorates ? "Yes" : "No"}</td>
                  <td className="px-3 py-2 text-muted-foreground">{component.taxable ? "Yes" : "No"}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{component.display_order}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold text-foreground">Statutory rates</h2>
            <Badge variant="outline" className="text-[11px]">{rates.length}</Badge>
            <span className="text-[11px] text-muted-foreground">Effective-dated — add a new row, don't rewrite history.</span>
          </div>
          {canEdit && (
            <Button size="sm" onClick={openCreate}>
              <Plus className="h-4 w-4 mr-1.5" /> Add rate
            </Button>
          )}
        </div>

        <div className="rounded-xl bg-card card-shadow overflow-x-auto">
          <table className="w-full text-xs min-w-[720px]">
            <thead className="bg-muted/50">
              <tr className="text-left">
                <th className="px-3 py-2 font-medium">Legal entity</th>
                <th className="px-3 py-2 font-medium">Key</th>
                <th className="px-3 py-2 font-medium text-right">Value</th>
                <th className="px-3 py-2 font-medium">Effective from</th>
                <th className="px-3 py-2 font-medium">Note</th>
                {canEdit && <th className="px-3 py-2 font-medium text-right">Actions</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rates.length === 0 ? (
                <tr>
                  <td colSpan={canEdit ? 6 : 5} className="px-3 py-10 text-center text-muted-foreground">No statutory rates configured.</td>
                </tr>
              ) : rates.map((row) => (
                <tr key={row.id} className="hover:bg-muted/30 transition-colors">
                  <td className="px-3 py-2 text-muted-foreground">{entityName(row.legal_entity_id)}</td>
                  <td className="px-3 py-2 font-medium text-foreground">{row.key}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-foreground">{Number(row.numeric_value)}</td>
                  <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">{fmtDate(row.effective_from)}</td>
                  <td className="px-3 py-2 text-muted-foreground max-w-[240px] truncate" title={row.note ?? ""}>{row.note || "—"}</td>
                  {canEdit && (
                    <td className="px-3 py-2 text-right">
                      <Button size="sm" variant="outline" className="h-7 px-2" onClick={() => openEdit(row)}>
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit statutory rate" : "Add statutory rate"}</DialogTitle>
          </DialogHeader>

          <div className="space-y-3">
            <SelectField
              label="Legal entity"
              value={form.legal_entity_id}
              onValueChange={(value) => setForm({ ...form, legal_entity_id: value })}
              options={entities.map((e) => ({ value: e.id, label: e.name }))}
              placeholder="Global default (all entities)"
            />
            <label className="block text-xs text-muted-foreground">
              Key
              <Input value={form.key} onChange={(e) => setForm({ ...form, key: e.target.value })}
                placeholder="e.g. pf_employee_rate" className="mt-1 h-9 text-sm" />
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="block text-xs text-muted-foreground">
                Value
                <Input type="number" step="0.0001" value={form.numeric_value}
                  onChange={(e) => setForm({ ...form, numeric_value: e.target.value })} className="mt-1 h-9 text-sm" />
              </label>
              <label className="block text-xs text-muted-foreground">
                Effective from
                <Input type="date" value={form.effective_from}
                  onChange={(e) => setForm({ ...form, effective_from: e.target.value })} className="mt-1 h-9 text-sm" />
              </label>
            </div>
            <label className="block text-xs text-muted-foreground">
              Note
              <Input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })}
                placeholder="Optional" className="mt-1 h-9 text-sm" />
            </label>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={busy}>Cancel</Button>
            <Button onClick={save} disabled={busy}>{editing ? "Save changes" : "Add rate"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default StatutoryConfigPanel;
