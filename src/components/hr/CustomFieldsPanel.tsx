// Custom employee fields — the HR settings screen.
//
// Two halves:
//   • Field definitions — the extra columns HR invents on top of the core
//     employee schema. Each is a key/label/type plus, for a select, a fixed
//     option list. Deactivating hides a field from the value editor without
//     deleting the answers already recorded against it.
//   • Employee values — pick an employee, answer each active field, and save.
//     Writes go through set_employee_field_value, which upserts a single
//     (employee, field) row and clears it when handed an empty value. The RPC
//     is the only writer; this panel never touches employee_field_values
//     directly, so validation and the audit-visible updated_at stay in one place.
//
// Reads are open to anyone who can see HR; both the definition dialog and the
// value saves are gated on hr:employees_edit, mirroring the RPC's own check.

import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { usePermissions } from "@/contexts/PermissionContext";
import { useToast } from "@/hooks/use-toast";
import { PageLoader } from "@/components/ui/page-loader";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { SelectField } from "@/components/ui/state-fields";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ListPlus, Pencil, Plus, Power, Save } from "lucide-react";
import {
  FIELD_TYPES,
  fieldTypeLabel,
  normalizeOptions,
  parseBoolean,
  sortDefs,
  validateFieldValue,
  type FieldDef,
  type FieldType,
} from "@/lib/customFields";

interface EmployeeOption {
  id: string;
  display_name: string | null;
  employee_number: string | null;
}

interface ValuesByField {
  [fieldId: string]: string;
}

const FIELD_TYPE_OPTIONS = FIELD_TYPES.map((t) => ({ value: t, label: fieldTypeLabel(t) }));

const EMPTY_FORM = {
  key: "",
  label: "",
  field_type: "text" as FieldType,
  options: "",
  is_required: false,
  display_order: "0",
  is_active: true,
};

const parseOptionsInput = (raw: string) =>
  raw.split(",").map((o) => o.trim()).filter(Boolean);

export function CustomFieldsPanel() {
  const { toast } = useToast();
  const { can } = usePermissions();
  const canEdit = can("hr", "employees_edit");

  const [defs, setDefs] = useState<FieldDef[]>([]);
  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<FieldDef | null>(null);
  const [form, setForm] = useState({ ...EMPTY_FORM });

  const [selectedEmployeeId, setSelectedEmployeeId] = useState("");
  const [values, setValues] = useState<ValuesByField>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loadingValues, setLoadingValues] = useState(false);
  const [savingId, setSavingId] = useState<string | null>(null);

  const fetchDefs = useCallback(async (): Promise<FieldDef[]> => {
    const res = await (supabase.from("employee_field_defs" as never) as never)
      .select("id, key, label, field_type, options, is_required, display_order, is_active")
      .order("display_order");
    return sortDefs((res.data as FieldDef[] | null) ?? []);
  }, []);

  const fetchEmployees = useCallback(async (): Promise<EmployeeOption[]> => {
    const res = await (supabase.from("employee_profiles" as never) as never)
      .select("id, display_name, employee_number")
      .order("display_name");
    return (res.data as EmployeeOption[] | null) ?? [];
  }, []);

  const loadValues = useCallback(async (employeeId: string): Promise<ValuesByField> => {
    const res = await (supabase.from("employee_field_values" as never) as never)
      .select("field_id, value")
      .eq("employee_profile_id", employeeId);
    const map: ValuesByField = {};
    for (const row of (res.data as { field_id: string; value: string | null }[] | null) ?? []) {
      map[row.field_id] = row.value ?? "";
    }
    return map;
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const [nextDefs, nextEmployees] = await Promise.all([fetchDefs(), fetchEmployees()]);
      if (cancelled) return;
      setDefs(nextDefs);
      setEmployees(nextEmployees);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [fetchDefs, fetchEmployees]);

  useEffect(() => {
    if (!selectedEmployeeId) {
      setValues({});
      setErrors({});
      return;
    }
    let cancelled = false;
    (async () => {
      setLoadingValues(true);
      const stored = await loadValues(selectedEmployeeId);
      if (cancelled) return;
      // Seed every def so each input stays controlled even when it has no row yet.
      const seeded: ValuesByField = {};
      for (const d of defs) seeded[d.id] = stored[d.id] ?? "";
      setValues(seeded);
      setErrors({});
      setLoadingValues(false);
    })();
    return () => { cancelled = true; };
  }, [selectedEmployeeId, defs, loadValues]);

  const activeDefs = useMemo(() => defs.filter((d) => d.is_active), [defs]);

  const employeeOptions = useMemo(
    () => employees.map((e) => ({
      value: e.id,
      label: `${e.display_name || "Unnamed"}${e.employee_number ? ` · ${e.employee_number}` : ""}`,
    })),
    [employees],
  );

  const reloadDefs = async () => setDefs(await fetchDefs());

  const openCreate = () => {
    setEditing(null);
    setForm({ ...EMPTY_FORM });
    setOpen(true);
  };

  const openEdit = (def: FieldDef) => {
    setEditing(def);
    setForm({
      key: def.key,
      label: def.label,
      field_type: def.field_type,
      options: normalizeOptions(def.options).join(", "),
      is_required: def.is_required,
      display_order: String(def.display_order),
      is_active: def.is_active,
    });
    setOpen(true);
  };

  const saveDef = async () => {
    const key = form.key.trim().toLowerCase().replace(/\s+/g, "_");
    const label = form.label.trim();
    if (!key || !label) {
      toast({ title: "Key and label are required", variant: "destructive" });
      return;
    }
    const options = form.field_type === "select" ? parseOptionsInput(form.options) : null;
    if (form.field_type === "select" && (options?.length ?? 0) === 0) {
      toast({ title: "Add at least one option for a select field", variant: "destructive" });
      return;
    }
    setBusy(true);
    const payload = {
      key,
      label,
      field_type: form.field_type,
      options,
      is_required: form.is_required,
      display_order: Number(form.display_order) || 0,
      is_active: form.is_active,
    };
    const res = editing
      ? await (supabase.from("employee_field_defs" as never) as never).update(payload).eq("id", editing.id)
      : await (supabase.from("employee_field_defs" as never) as never).insert(payload);
    setBusy(false);
    if (res.error) {
      toast({ title: "Could not save the field", description: res.error.message, variant: "destructive" });
      return;
    }
    toast({ title: editing ? "Field updated" : "Field added" });
    setOpen(false);
    await reloadDefs();
  };

  const toggleActive = async (def: FieldDef) => {
    const res = await (supabase.from("employee_field_defs" as never) as never)
      .update({ is_active: !def.is_active })
      .eq("id", def.id);
    if (res.error) {
      toast({ title: "Could not update the field", description: res.error.message, variant: "destructive" });
      return;
    }
    toast({ title: def.is_active ? `${def.label} deactivated` : `${def.label} activated` });
    await reloadDefs();
  };

  const saveValue = async (def: FieldDef) => {
    if (!selectedEmployeeId) {
      toast({ title: "Pick an employee first", variant: "destructive" });
      return;
    }
    const raw = values[def.id] ?? "";
    const check = validateFieldValue(def, raw);
    if (!check.ok) {
      setErrors((prev) => ({ ...prev, [def.id]: check.error ?? "Invalid value" }));
      return;
    }
    setErrors((prev) => {
      const next = { ...prev };
      delete next[def.id];
      return next;
    });
    setSavingId(def.id);
    const { error } = await supabase.rpc("set_employee_field_value" as never, {
      _employee_profile_id: selectedEmployeeId,
      _field_id: def.id,
      _value: raw.trim() === "" ? null : raw.trim(),
    } as never);
    setSavingId(null);
    if (error) {
      toast({ title: `Could not save ${def.label}`, description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: `${def.label} saved` });
  };

  if (loading) return <PageLoader />;

  const renderValueInput = (def: FieldDef) => {
    const value = values[def.id] ?? "";
    const disabled = !canEdit || !selectedEmployeeId;

    if (def.field_type === "boolean") {
      const parsed = parseBoolean(value);
      return (
        <div className="flex items-center gap-3">
          <Switch
            checked={parsed === true}
            disabled={disabled}
            onCheckedChange={(checked) => setValues((prev) => ({ ...prev, [def.id]: checked ? "true" : "false" }))}
          />
          <span className="text-xs text-muted-foreground">
            {parsed === null ? "Not set" : parsed ? "Yes" : "No"}
          </span>
        </div>
      );
    }

    if (def.field_type === "select") {
      return (
        <SelectField
          value={value}
          disabled={disabled}
          allowEmpty={!def.is_required}
          placeholder="Select"
          ariaLabel={def.label}
          onValueChange={(next) => setValues((prev) => ({ ...prev, [def.id]: next }))}
          options={normalizeOptions(def.options).map((option) => ({ value: option, label: option }))}
        />
      );
    }

    const inputType = def.field_type === "number" ? "number" : def.field_type === "date" ? "date" : "text";
    return (
      <Input
        type={inputType}
        value={value}
        disabled={disabled}
        aria-label={def.label}
        onChange={(e) => setValues((prev) => ({ ...prev, [def.id]: e.target.value }))}
        className="h-9 text-sm"
      />
    );
  };

  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <ListPlus className="h-4 w-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold text-foreground">Field definitions</h2>
            <Badge variant="outline" className="text-[11px]">{defs.length}</Badge>
          </div>
          {canEdit && (
            <Button size="sm" onClick={openCreate}>
              <Plus className="h-4 w-4 mr-1.5" /> Add field
            </Button>
          )}
        </div>

        <div className="rounded-xl bg-card card-shadow overflow-x-auto">
          <table className="w-full text-xs min-w-[760px]">
            <thead className="bg-muted/50">
              <tr className="text-left">
                <th className="px-3 py-2 font-medium">Order</th>
                <th className="px-3 py-2 font-medium">Key</th>
                <th className="px-3 py-2 font-medium">Label</th>
                <th className="px-3 py-2 font-medium">Type</th>
                <th className="px-3 py-2 font-medium">Options</th>
                <th className="px-3 py-2 font-medium">Required</th>
                <th className="px-3 py-2 font-medium">Status</th>
                {canEdit && <th className="px-3 py-2 font-medium text-right">Actions</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {defs.length === 0 ? (
                <tr>
                  <td colSpan={canEdit ? 8 : 7} className="px-3 py-10 text-center text-muted-foreground">
                    No custom fields defined yet.
                  </td>
                </tr>
              ) : defs.map((def) => (
                <tr key={def.id} className="hover:bg-muted/30 transition-colors">
                  <td className="px-3 py-2 tabular-nums text-muted-foreground">{def.display_order}</td>
                  <td className="px-3 py-2 font-mono text-[11px] text-foreground">{def.key}</td>
                  <td className="px-3 py-2 text-foreground">{def.label}</td>
                  <td className="px-3 py-2 text-muted-foreground">{fieldTypeLabel(def.field_type)}</td>
                  <td className="px-3 py-2 text-muted-foreground max-w-[220px] truncate" title={normalizeOptions(def.options).join(", ")}>
                    {def.field_type === "select" ? (normalizeOptions(def.options).join(", ") || "—") : "—"}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">{def.is_required ? "Yes" : "No"}</td>
                  <td className="px-3 py-2">{def.is_active
                    ? <Badge variant="outline" className="text-[10px]">Active</Badge>
                    : <Badge variant="outline" className="text-[10px] text-muted-foreground">Inactive</Badge>}</td>
                  {canEdit && (
                    <td className="px-3 py-2">
                      <div className="flex items-center justify-end gap-1">
                        <Button size="sm" variant="outline" className="h-7 px-2" onClick={() => openEdit(def)}>
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button size="sm" variant="ghost" className="h-7 px-2 text-[11px]" onClick={() => toggleActive(def)}>
                          <Power className="h-3.5 w-3.5 mr-1" />
                          {def.is_active ? "Deactivate" : "Activate"}
                        </Button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-sm font-semibold text-foreground">Employee values</h2>
          <Badge variant="outline" className="text-[11px]">{activeDefs.length}</Badge>
          <span className="text-[11px] text-muted-foreground">
            Pick an employee, answer the active fields, and save each one.
          </span>
        </div>

        <div className="max-w-sm">
          <SelectField
            label="Employee"
            value={selectedEmployeeId}
            placeholder="Select an employee…"
            allowEmpty
            onValueChange={setSelectedEmployeeId}
            options={employeeOptions}
          />
        </div>

        {!selectedEmployeeId ? (
          <div className="rounded-xl bg-card card-shadow p-10 text-center text-sm text-muted-foreground">
            Pick an employee to view and record their custom field values.
          </div>
        ) : activeDefs.length === 0 ? (
          <div className="rounded-xl bg-card card-shadow p-10 text-center text-sm text-muted-foreground">
            No active custom fields. Add one above to start recording values.
          </div>
        ) : loadingValues ? (
          <PageLoader className="min-h-[24vh]" label="Loading values…" />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {activeDefs.map((def) => (
              <div key={def.id} className="rounded-xl border border-border bg-card p-3.5 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <label className="text-xs font-medium text-muted-foreground">
                    {def.label}
                    {def.is_required && <span className="text-destructive"> *</span>}
                  </label>
                  <span className="text-[10px] uppercase tracking-wide text-muted-foreground/70">
                    {fieldTypeLabel(def.field_type)}
                  </span>
                </div>
                {renderValueInput(def)}
                {errors[def.id] && <p className="text-xs text-destructive">{errors[def.id]}</p>}
                {canEdit && (
                  <div className="flex justify-end">
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs"
                      disabled={savingId === def.id}
                      onClick={() => saveValue(def)}
                    >
                      <Save className="h-3.5 w-3.5 mr-1.5" />
                      {savingId === def.id ? "Saving…" : "Save"}
                    </Button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit custom field" : "Add custom field"}</DialogTitle>
          </DialogHeader>

          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <label className="block text-xs text-muted-foreground">
                Key
                <Input
                  value={form.key}
                  onChange={(e) => setForm({ ...form, key: e.target.value })}
                  placeholder="e.g. uniform_size"
                  className="mt-1 h-9 text-sm"
                />
              </label>
              <label className="block text-xs text-muted-foreground">
                Display order
                <Input
                  type="number"
                  value={form.display_order}
                  onChange={(e) => setForm({ ...form, display_order: e.target.value })}
                  className="mt-1 h-9 text-sm"
                />
              </label>
            </div>
            <label className="block text-xs text-muted-foreground">
              Label
              <Input
                value={form.label}
                onChange={(e) => setForm({ ...form, label: e.target.value })}
                placeholder="e.g. Uniform size"
                className="mt-1 h-9 text-sm"
              />
            </label>
            <SelectField
              label="Type"
              value={form.field_type}
              allowEmpty={false}
              onValueChange={(value) => setForm({ ...form, field_type: value as FieldType })}
              options={FIELD_TYPE_OPTIONS}
            />
            {form.field_type === "select" && (
              <label className="block text-xs text-muted-foreground">
                Options
                <Input
                  value={form.options}
                  onChange={(e) => setForm({ ...form, options: e.target.value })}
                  placeholder="Comma separated, e.g. S, M, L, XL"
                  className="mt-1 h-9 text-sm"
                />
              </label>
            )}
            <div className="flex flex-wrap gap-5">
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                <input
                  type="checkbox"
                  checked={form.is_required}
                  onChange={(e) => setForm({ ...form, is_required: e.target.checked })}
                />
                Required
              </label>
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                <input
                  type="checkbox"
                  checked={form.is_active}
                  onChange={(e) => setForm({ ...form, is_active: e.target.checked })}
                />
                Active
              </label>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={busy}>Cancel</Button>
            <Button onClick={saveDef} disabled={busy}>{editing ? "Save changes" : "Add field"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default CustomFieldsPanel;
