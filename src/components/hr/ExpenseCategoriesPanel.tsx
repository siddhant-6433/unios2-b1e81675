// Expense categories settings.
//
// The category list drives the claim form and the expense report. `max_amount`
// is an optional per-claim ceiling; leaving it blank means no cap. `kind`
// separates reimbursements (paid back to the employee) from advances (paid up
// front, later settled).

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { usePermissions } from "@/contexts/PermissionContext";
import { useToast } from "@/hooks/use-toast";
import { PageLoader } from "@/components/ui/page-loader";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { SelectField } from "@/components/ui/state-fields";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Pencil, Plus, Receipt } from "lucide-react";

interface ExpenseCategory {
  id: string;
  code: string;
  name: string;
  kind: string;
  requires_receipt: boolean;
  max_amount: number | null;
  is_active: boolean;
  display_order: number;
}

const KIND_OPTIONS = [
  { value: "reimbursement", label: "Reimbursement" },
  { value: "advance", label: "Advance" },
];

const EMPTY_FORM = {
  code: "",
  name: "",
  kind: "reimbursement",
  requires_receipt: true,
  max_amount: "",
  is_active: true,
  display_order: "0",
};

export function ExpenseCategoriesPanel() {
  const { toast } = useToast();
  const { can } = usePermissions();
  const canEdit = can("hr", "expenses_manage");

  const [categories, setCategories] = useState<ExpenseCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<ExpenseCategory | null>(null);
  const [form, setForm] = useState({ ...EMPTY_FORM });

  const fetchAll = useCallback(async () => {
    setLoading(true);
    const { data } = await (supabase as any).from("expense_categories")
      .select("id, code, name, kind, requires_receipt, max_amount, is_active, display_order")
      .order("display_order");
    setCategories((data as ExpenseCategory[]) ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const openCreate = () => {
    setEditing(null);
    setForm({ ...EMPTY_FORM });
    setOpen(true);
  };

  const openEdit = (category: ExpenseCategory) => {
    setEditing(category);
    setForm({
      code: category.code,
      name: category.name,
      kind: category.kind,
      requires_receipt: category.requires_receipt,
      max_amount: category.max_amount === null ? "" : String(category.max_amount),
      is_active: category.is_active,
      display_order: String(category.display_order),
    });
    setOpen(true);
  };

  const save = async () => {
    if (!form.code.trim() || !form.name.trim()) {
      toast({ title: "Code and name are required", variant: "destructive" });
      return;
    }
    setBusy(true);
    const payload = {
      code: form.code.trim().toUpperCase(),
      name: form.name.trim(),
      kind: form.kind,
      requires_receipt: form.requires_receipt,
      max_amount: form.max_amount === "" ? null : Number(form.max_amount),
      is_active: form.is_active,
      display_order: Number(form.display_order) || 0,
    };
    const result = editing
      ? await (supabase as any).from("expense_categories").update(payload).eq("id", editing.id)
      : await (supabase as any).from("expense_categories").insert(payload);
    setBusy(false);
    if (result.error) {
      toast({ title: "Could not save the category", description: result.error.message, variant: "destructive" });
      return;
    }
    toast({ title: editing ? "Category updated" : "Category added" });
    setOpen(false);
    await fetchAll();
  };

  if (loading) return <PageLoader />;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Receipt className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold text-foreground">Expense categories</h2>
          <Badge variant="outline" className="text-[11px]">{categories.length}</Badge>
        </div>
        {canEdit && (
          <Button size="sm" onClick={openCreate}>
            <Plus className="h-4 w-4 mr-1.5" /> Add category
          </Button>
        )}
      </div>

      <div className="rounded-xl bg-card card-shadow overflow-x-auto">
        <table className="w-full text-xs min-w-[720px]">
          <thead className="bg-muted/50">
            <tr className="text-left">
              <th className="px-3 py-2 font-medium">Order</th>
              <th className="px-3 py-2 font-medium">Code</th>
              <th className="px-3 py-2 font-medium">Name</th>
              <th className="px-3 py-2 font-medium">Kind</th>
              <th className="px-3 py-2 font-medium">Receipt</th>
              <th className="px-3 py-2 font-medium text-right">Max amount</th>
              <th className="px-3 py-2 font-medium">Status</th>
              {canEdit && <th className="px-3 py-2 font-medium text-right">Actions</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {categories.length === 0 ? (
              <tr>
                <td colSpan={canEdit ? 8 : 7} className="px-3 py-10 text-center text-muted-foreground">
                  No expense categories configured.
                </td>
              </tr>
            ) : categories.map((category) => (
              <tr key={category.id} className="hover:bg-muted/30 transition-colors">
                <td className="px-3 py-2 tabular-nums text-muted-foreground">{category.display_order}</td>
                <td className="px-3 py-2 font-medium text-foreground">{category.code}</td>
                <td className="px-3 py-2 text-foreground">{category.name}</td>
                <td className="px-3 py-2 capitalize text-muted-foreground">{category.kind}</td>
                <td className="px-3 py-2 text-muted-foreground">{category.requires_receipt ? "Required" : "Not required"}</td>
                <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                  {category.max_amount === null ? "No cap" : Number(category.max_amount)}
                </td>
                <td className="px-3 py-2">{category.is_active
                  ? <Badge variant="outline" className="text-[10px]">Active</Badge>
                  : <Badge variant="outline" className="text-[10px] text-muted-foreground">Inactive</Badge>}</td>
                {canEdit && (
                  <td className="px-3 py-2 text-right">
                    <Button size="sm" variant="outline" className="h-7 px-2" onClick={() => openEdit(category)}>
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit expense category" : "Add expense category"}</DialogTitle>
          </DialogHeader>

          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <label className="block text-xs text-muted-foreground">
                Code
                <Input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })}
                  placeholder="e.g. TRAVEL" className="mt-1 h-9 text-sm" />
              </label>
              <label className="block text-xs text-muted-foreground">
                Display order
                <Input type="number" value={form.display_order}
                  onChange={(e) => setForm({ ...form, display_order: e.target.value })} className="mt-1 h-9 text-sm" />
              </label>
            </div>
            <label className="block text-xs text-muted-foreground">
              Name
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="mt-1 h-9 text-sm" />
            </label>
            <SelectField
              label="Kind"
              value={form.kind}
              allowEmpty={false}
              onValueChange={(value) => setForm({ ...form, kind: value })}
              options={KIND_OPTIONS}
            />
            <label className="block text-xs text-muted-foreground">
              Max amount (optional)
              <Input type="number" step="0.01" value={form.max_amount}
                onChange={(e) => setForm({ ...form, max_amount: e.target.value })}
                placeholder="Leave blank for no cap" className="mt-1 h-9 text-sm" />
            </label>
            <div className="flex flex-wrap gap-5">
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                <input type="checkbox" checked={form.requires_receipt}
                  onChange={(e) => setForm({ ...form, requires_receipt: e.target.checked })} />
                Requires receipt
              </label>
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                <input type="checkbox" checked={form.is_active}
                  onChange={(e) => setForm({ ...form, is_active: e.target.checked })} />
                Active
              </label>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={busy}>Cancel</Button>
            <Button onClick={save} disabled={busy}>{editing ? "Save changes" : "Add category"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default ExpenseCategoriesPanel;
