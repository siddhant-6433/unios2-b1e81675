// My Expenses — employee self-service, meant to be embedded in My HR.
//
// A signed-in employee sees only their own claims and can raise a new one. The
// employee_profiles row is resolved from the auth user id; if the account has no
// linked employee record there is nothing to claim against, so we say so plainly
// rather than showing an empty form that can only fail at the database.
//
// Writes use .select("id") and treat an empty result as a permission failure.
// RLS silently filters rows, so "no rows returned" is the honest signal that the
// write was refused — the UI must not claim success on a no-op.

import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { PageLoader } from "@/components/ui/page-loader";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Receipt, Plus, X, Wallet } from "lucide-react";
import {
  canEditClaim, formatInr, statusBadge, statusLabel, summarizeClaims,
  type ExpenseCategory, type ExpenseClaim,
} from "@/lib/expenses";

type ClaimWithCategory = ExpenseClaim & { category_name: string | null };

const EMPTY_DRAFT = {
  category_id: "",
  title: "",
  amount: "",
  expense_date: "",
  description: "",
  receipt_url: "",
};

const inputCls = "rounded-xl border border-input bg-card px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring/20";

export function MyExpensesPanel() {
  const { user } = useAuth();
  const { toast } = useToast();

  const [loading, setLoading] = useState(true);
  const [profileId, setProfileId] = useState<string | null>(null);
  const [claims, setClaims] = useState<ExpenseClaim[]>([]);
  const [categories, setCategories] = useState<ExpenseCategory[]>([]);
  const [draft, setDraft] = useState({ ...EMPTY_DRAFT });
  const [submitting, setSubmitting] = useState(false);
  const [cancellingId, setCancellingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!user?.id) return;
    setLoading(true);

    // Only active categories are offered in the form, but every category is kept
    // for the display map so an old claim against a since-retired category still
    // shows its name.
    const [profileRes, categoryRes] = await Promise.all([
      (supabase.from("employee_profiles" as any) as any).select("id").eq("user_id", user.id).maybeSingle(),
      (supabase.from("expense_categories" as any) as any)
        .select("id, code, name, kind, requires_receipt, max_amount, is_active, display_order")
        .order("display_order"),
    ]);

    const resolvedProfileId = (profileRes.data as { id: string } | null)?.id ?? null;
    setProfileId(resolvedProfileId);
    setCategories((categoryRes.data as ExpenseCategory[]) ?? []);

    if (!resolvedProfileId) {
      setClaims([]);
      setLoading(false);
      return;
    }

    const { data, error } = await (supabase.from("expense_claims" as any) as any)
      .select("id, employee_profile_id, submitted_by, category_id, title, amount, currency, expense_date, description, receipt_url, status, decided_by, decided_at, decision_note, reimbursed_at, payroll_cycle_id, created_at, updated_at")
      .eq("employee_profile_id", resolvedProfileId)
      .order("expense_date", { ascending: false });

    if (error) {
      toast({ title: "Could not load your claims", description: error.message, variant: "destructive" });
    }
    setClaims((data as ExpenseClaim[]) ?? []);
    setLoading(false);
  }, [user?.id, toast]);

  useEffect(() => { load(); }, [load]);

  const categoryMap = useMemo(
    () => new Map(categories.map((c) => [c.id, c])),
    [categories],
  );
  const activeCategories = useMemo(() => categories.filter((c) => c.is_active), [categories]);
  const selectedCategory = draft.category_id ? categoryMap.get(draft.category_id) ?? null : null;

  const rows: ClaimWithCategory[] = useMemo(
    () => claims.map((c) => ({ ...c, category_name: c.category_id ? categoryMap.get(c.category_id)?.name ?? null : null })),
    [claims, categoryMap],
  );
  const summary = useMemo(() => summarizeClaims(claims), [claims]);

  const submit = async () => {
    if (!user?.id || !profileId) return;

    const title = draft.title.trim();
    const amount = Number(draft.amount);
    if (!draft.category_id) {
      toast({ title: "Pick a category", variant: "destructive" });
      return;
    }
    if (!title) {
      toast({ title: "Add a short title", variant: "destructive" });
      return;
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      toast({ title: "Enter an amount greater than zero", variant: "destructive" });
      return;
    }
    if (!draft.expense_date) {
      toast({ title: "Pick the expense date", variant: "destructive" });
      return;
    }
    if (selectedCategory?.requires_receipt && !draft.receipt_url.trim()) {
      toast({ title: "A receipt link is required", description: `${selectedCategory.name} claims need a receipt.`, variant: "destructive" });
      return;
    }

    setSubmitting(true);
    const { data, error } = await (supabase.from("expense_claims" as any) as any)
      .insert({
        employee_profile_id: profileId,
        submitted_by: user.id,
        category_id: draft.category_id,
        title,
        amount,
        currency: "INR",
        expense_date: draft.expense_date,
        description: draft.description.trim() || null,
        receipt_url: draft.receipt_url.trim() || null,
        status: "submitted",
      })
      .select("id");
    setSubmitting(false);

    if (error) {
      toast({ title: "Could not submit the claim", description: error.message, variant: "destructive" });
      return;
    }
    if (!data?.length) {
      toast({ title: "No permission", description: "Your account cannot create expense claims.", variant: "destructive" });
      return;
    }
    setDraft({ ...EMPTY_DRAFT });
    toast({ title: "Claim submitted", description: "HR will review it shortly." });
    await load();
  };

  const cancel = async (row: ClaimWithCategory) => {
    setCancellingId(row.id);
    const { data, error } = await (supabase.from("expense_claims" as any) as any)
      .update({ status: "cancelled" })
      .eq("id", row.id)
      .select("id");
    setCancellingId(null);

    if (error || !data?.length) {
      toast({
        title: "Could not cancel",
        description: error?.message || "No permission — only in-flight claims can be cancelled.",
        variant: "destructive",
      });
      return;
    }
    setClaims((prev) => prev.map((c) => (c.id === row.id ? { ...c, status: "cancelled" } : c)));
    toast({ title: "Claim cancelled" });
  };

  if (loading) return <PageLoader />;

  if (!profileId) {
    return (
      <div className="rounded-xl bg-card card-shadow p-12 text-center">
        <Wallet className="h-10 w-10 text-muted-foreground/30 mx-auto mb-3" />
        <p className="text-sm text-foreground">No employee record linked to your account</p>
        <p className="text-xs text-muted-foreground mt-1">
          Ask HR to link your login to your employee profile before claiming expenses.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: "Submitted", value: summary.pending },
          { label: "Approved", value: summary.approved },
          { label: "Reimbursed", value: summary.reimbursed },
          { label: "Total claimed", value: summary.total },
        ].map((s) => (
          <div key={s.label} className="rounded-xl bg-card card-shadow p-3.5">
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{s.label}</p>
            <p className="text-lg font-bold text-foreground mt-0.5">₹{formatInr(s.value)}</p>
          </div>
        ))}
      </div>

      <div className="rounded-xl border border-border bg-muted/30 p-4 space-y-3">
        <div className="flex items-center gap-2">
          <Plus className="h-4 w-4 text-muted-foreground" />
          <p className="text-sm font-semibold text-foreground">New claim</p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <div className="flex flex-col gap-1">
            <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Category</span>
            <select
              value={draft.category_id}
              onChange={(e) => setDraft({ ...draft, category_id: e.target.value })}
              className={`${inputCls} min-w-[160px]`}
            >
              <option value="">Select…</option>
              {activeCategories.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Title</span>
            <input
              value={draft.title}
              onChange={(e) => setDraft({ ...draft, title: e.target.value })}
              placeholder="e.g. Client visit — cab"
              className={`${inputCls} w-56`}
            />
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Amount (₹)</span>
            <input
              type="number"
              min="0"
              step="0.01"
              value={draft.amount}
              onChange={(e) => setDraft({ ...draft, amount: e.target.value })}
              placeholder="0"
              className={`${inputCls} w-28`}
            />
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Date</span>
            <input
              type="date"
              value={draft.expense_date}
              onChange={(e) => setDraft({ ...draft, expense_date: e.target.value })}
              className={inputCls}
            />
          </div>
          <div className="flex flex-col gap-1 flex-1 min-w-[200px]">
            <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
              Receipt link{selectedCategory?.requires_receipt ? " (required)" : " (optional)"}
            </span>
            <input
              value={draft.receipt_url}
              onChange={(e) => setDraft({ ...draft, receipt_url: e.target.value })}
              placeholder="https://…"
              className={`${inputCls} w-full`}
            />
          </div>
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Description</span>
          <textarea
            value={draft.description}
            onChange={(e) => setDraft({ ...draft, description: e.target.value })}
            placeholder="What was this for?"
            rows={2}
            className={`${inputCls} w-full resize-y`}
          />
        </div>
        <div className="flex justify-end">
          <Button size="sm" onClick={submit} disabled={submitting}>
            <Plus className="h-4 w-4 mr-1.5" /> Submit claim
          </Button>
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-xl bg-card card-shadow p-12 text-center">
          <Receipt className="h-10 w-10 text-muted-foreground/30 mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">No expense claims yet</p>
        </div>
      ) : (
        <div className="rounded-xl bg-card card-shadow overflow-x-auto">
          <table className="w-full text-sm min-w-[720px]">
            <thead>
              <tr className="border-b border-border bg-muted/50">
                <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Claim</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Category</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Date</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-muted-foreground uppercase tracking-wide">Amount</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Status</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-muted-foreground uppercase tracking-wide"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors">
                  <td className="px-4 py-3 max-w-[260px]">
                    <div className="font-medium text-foreground truncate">{r.title}</div>
                    {r.decision_note && (
                      <div className="text-xs text-muted-foreground truncate">Note: {r.decision_note}</div>
                    )}
                    {r.receipt_url && (
                      <a
                        href={r.receipt_url}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-0.5 inline-flex items-center gap-1 text-[11px] text-primary hover:underline"
                      >
                        <Receipt className="h-3 w-3" /> Receipt
                      </a>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">{r.category_name || "—"}</td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">{r.expense_date}</td>
                  <td className="px-4 py-3 text-right font-medium text-foreground">₹{formatInr(r.amount)}</td>
                  <td className="px-4 py-3">
                    <Badge className={`capitalize ${statusBadge(r.status)}`}>{statusLabel(r.status)}</Badge>
                  </td>
                  <td className="px-4 py-3 text-right">
                    {canEditClaim(r, user?.id) && (
                      <button
                        onClick={() => cancel(r)}
                        disabled={cancellingId === r.id}
                        className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-destructive disabled:opacity-50"
                      >
                        <X className="h-3 w-3" /> Cancel
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
