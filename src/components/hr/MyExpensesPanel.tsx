// My Expenses — employee self-service, meant to be embedded in My HR.
//
// A signed-in employee sees only their own claims and can raise a new one. The
// employee_profiles row is resolved from the auth user id; if the account has no
// linked employee record there is nothing to claim against, so we say so plainly
// rather than showing an empty form that can only fail at the database.
//
// A claim is saved as a draft first, its proofs are uploaded to R2, and only
// then is submit_expense_claim called — the database enforces the proof
// requirement on submit, so the UI must not pretend a proofless submit worked.
// When a reviewer sends a claim back, its correction note shows here with a
// Resubmit action; a rejection shows its reason and is terminal.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { PageLoader } from "@/components/ui/page-loader";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Paperclip, Plus, RefreshCw, Receipt, Trash2, Upload, Wallet, X } from "lucide-react";
import {
  canEditClaim, canSubmit, formatInr, needsCorrection, reimbursementLabel,
  statusBadge, statusLabel, summarizeClaims,
  type ExpenseCategory, type ExpenseClaim,
} from "@/lib/expenses";

type ClaimWithCategory = ExpenseClaim & { category_name: string | null };

const EMPTY_DRAFT = {
  category_id: "",
  title: "",
  amount: "",
  expense_date: "",
  description: "",
};

const inputCls = "rounded-xl border border-input bg-card px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring/20";

interface UploadedProof {
  file_url: string;
  file_path: string | null;
  file_name: string;
  mime_type: string | null;
  file_size: number;
}

export function MyExpensesPanel() {
  const { user } = useAuth();
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const rowFileInputRef = useRef<HTMLInputElement | null>(null);

  const [loading, setLoading] = useState(true);
  const [profileId, setProfileId] = useState<string | null>(null);
  const [claims, setClaims] = useState<ExpenseClaim[]>([]);
  const [categories, setCategories] = useState<ExpenseCategory[]>([]);
  const [proofCounts, setProofCounts] = useState<Record<string, number>>({});
  const [draft, setDraft] = useState({ ...EMPTY_DRAFT });
  const [proofFiles, setProofFiles] = useState<File[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [proofClaimId, setProofClaimId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!user?.id) return;
    setLoading(true);

    // Only active categories are offered in the form, but every category is kept
    // for the display map so an old claim against a since-retired category still
    // shows its name.
    const [profileRes, categoryRes] = await Promise.all([
      supabase.from("employee_profiles").select("id").eq("user_id", user.id).maybeSingle(),
      supabase.from("expense_categories" as never)
        .select("id, code, name, kind, requires_receipt, max_amount, is_active, display_order")
        .order("display_order"),
    ]);

    const resolvedProfileId = (profileRes.data as { id: string } | null)?.id ?? null;
    setProfileId(resolvedProfileId);
    setCategories((categoryRes.data as unknown as ExpenseCategory[]) ?? []);

    if (!resolvedProfileId) {
      setClaims([]);
      setProofCounts({});
      setLoading(false);
      return;
    }

    const { data, error } = await supabase.from("expense_claims" as never)
      .select("id, employee_profile_id, submitted_by, category_id, title, amount, currency, expense_date, description, receipt_url, status, decided_by, decided_at, decision_note, reimbursed_at, payroll_cycle_id, created_at, updated_at, submitted_at, l1_reviewer, l1_status, l1_at, l1_note, l2_reviewer, l2_status, l2_at, l2_note, correction_note, correction_at, rejection_reason, rejected_at, zoho_bill_id, zoho_bill_number, zoho_synced_at, zoho_sync_error, reimbursement_mode")
      .eq("employee_profile_id", resolvedProfileId)
      .order("expense_date", { ascending: false });

    if (error) {
      toast({ title: "Could not load your claims", description: error.message, variant: "destructive" });
    }
    const loaded = (data as unknown as ExpenseClaim[] | null) ?? [];
    setClaims(loaded);

    // One query for every claim's proof count, rather than one per row.
    const ids = loaded.map((c) => c.id);
    if (ids.length) {
      const { data: atts } = await supabase.from("expense_claim_attachments" as never)
        .select("claim_id")
        .in("claim_id", ids);
      const counts: Record<string, number> = {};
      for (const a of (atts as unknown as { claim_id: string }[] | null) ?? []) {
        counts[a.claim_id] = (counts[a.claim_id] ?? 0) + 1;
      }
      setProofCounts(counts);
    } else {
      setProofCounts({});
    }
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

  const proofTotal = (row: ClaimWithCategory): number =>
    (proofCounts[row.id] ?? 0) > 0 ? proofCounts[row.id] : (row.receipt_url ? 1 : 0);

  /** Upload one file through the shared r2-upload edge function. */
  const uploadProof = async (file: File): Promise<UploadedProof> => {
    const fd = new FormData();
    fd.append("file", file);
    fd.append("filename", file.name);
    fd.append("prefix", `expense-proofs/${profileId ?? "unassigned"}`);
    const { data, error } = await supabase.functions.invoke("r2-upload", { body: fd });
    if (error) {
      let detail = error.message || "";
      const ctx = (error as { context?: { json?: () => Promise<{ error?: string }> } }).context;
      if (ctx && typeof ctx.json === "function") {
        try {
          const j = await ctx.json();
          if (j?.error) detail = j.error;
        } catch { /* ignore */ }
      }
      throw new Error(detail || "Upload failed");
    }
    const body = data as { url?: string; key?: string; error?: string } | null;
    if (!body?.url) throw new Error(body?.error || "Upload returned no URL");
    return {
      file_url: body.url,
      file_path: body.key ?? null,
      file_name: file.name,
      mime_type: file.type || null,
      file_size: file.size,
    };
  };

  const clearForm = () => {
    setDraft({ ...EMPTY_DRAFT });
    setProofFiles([]);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  /** Save the form as a draft, optionally uploading proofs and submitting. */
  const saveClaim = async (submitForApproval: boolean) => {
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
    if (submitForApproval && proofFiles.length === 0) {
      toast({
        title: "Attach a proof",
        description: "Add at least one receipt or invoice before submitting for approval.",
        variant: "destructive",
      });
      return;
    }

    setSubmitting(true);
    try {
      // 1. Draft first, so proofs have a claim to attach to.
      const { data, error } = await supabase.from("expense_claims" as never)
        .insert({
          employee_profile_id: profileId,
          submitted_by: user.id,
          category_id: draft.category_id,
          title,
          amount,
          currency: "INR",
          expense_date: draft.expense_date,
          description: draft.description.trim() || null,
          receipt_url: null,
          status: "draft",
        } as never)
        .select("id");
      if (error) throw error;
      const inserted = (data as unknown as { id: string }[] | null) ?? [];
      if (!inserted.length) throw new Error("Your account cannot create expense claims.");
      const claimId = inserted[0].id;

      // 2. Upload proofs and attach them while the claim is still a draft.
      const uploaded: UploadedProof[] = [];
      for (const file of proofFiles) {
        uploaded.push(await uploadProof(file));
      }
      if (uploaded.length) {
        const { error: attError } = await supabase.from("expense_claim_attachments" as never)
          .insert(uploaded.map((p) => ({ claim_id: claimId, uploaded_by: user.id, ...p })) as never);
        if (attError) throw attError;
        // Keep receipt_url as the primary proof for backward compatibility.
        await supabase.from("expense_claims" as never)
          .update({ receipt_url: uploaded[0].file_url } as never)
          .eq("id", claimId);
      }

      // 3. Submit through the RPC, which re-checks the proof server-side.
      if (submitForApproval) {
        const { error: submitError } = await supabase.rpc("submit_expense_claim" as never, {
          _claim_id: claimId,
        } as never);
        if (submitError) throw submitError;
      }

      clearForm();
      toast(
        submitForApproval
          ? { title: "Claim submitted", description: "Your reporting manager will review it." }
          : { title: "Draft saved", description: "Attach proofs and submit when you're ready." },
      );
      await load();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      toast({ title: submitForApproval ? "Could not submit the claim" : "Could not save the draft", description: message, variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  const resubmit = async (row: ClaimWithCategory) => {
    if (!user?.id) return;
    if (proofTotal(row) === 0) {
      toast({ title: "Attach a proof first", description: "A claim needs at least one receipt before it can be resubmitted.", variant: "destructive" });
      return;
    }
    setBusyId(row.id);
    const { error } = await supabase.rpc("submit_expense_claim" as never, { _claim_id: row.id } as never);
    setBusyId(null);
    if (error) {
      toast({ title: "Could not resubmit", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Claim submitted", description: "Your reporting manager will review it." });
    await load();
  };

  const cancel = async (row: ClaimWithCategory) => {
    setBusyId(row.id);
    const { data, error } = await supabase.from("expense_claims" as never)
      .update({ status: "cancelled" } as never)
      .eq("id", row.id)
      .select("id");
    setBusyId(null);

    if (error || !(data as unknown as { id: string }[] | null)?.length) {
      toast({
        title: "Could not cancel",
        description: error?.message || "No permission — only drafts and corrections can be cancelled.",
        variant: "destructive",
      });
      return;
    }
    setClaims((prev) => prev.map((c) => (c.id === row.id ? { ...c, status: "cancelled" } : c)));
    toast({ title: "Claim cancelled" });
  };

  const onPickFiles = (files: FileList | null) => {
    if (!files?.length) return;
    setProofFiles((prev) => [...prev, ...Array.from(files)]);
  };

  /** Add proofs to an existing draft / correction claim straight from its row. */
  const onPickRowFiles = async (files: FileList | null) => {
    const claimId = proofClaimId;
    setProofClaimId(null);
    if (rowFileInputRef.current) rowFileInputRef.current.value = "";
    if (!claimId || !files?.length || !user?.id) return;

    setBusyId(claimId);
    try {
      const uploaded: UploadedProof[] = [];
      for (const file of Array.from(files)) {
        uploaded.push(await uploadProof(file));
      }
      const { error } = await supabase.from("expense_claim_attachments" as never)
        .insert(uploaded.map((p) => ({ claim_id: claimId, uploaded_by: user.id, ...p })) as never);
      if (error) throw error;

      const current = claims.find((c) => c.id === claimId);
      if (current && !current.receipt_url && uploaded[0]) {
        await supabase.from("expense_claims" as never)
          .update({ receipt_url: uploaded[0].file_url } as never)
          .eq("id", claimId);
      }
      setProofCounts((prev) => ({ ...prev, [claimId]: (prev[claimId] ?? 0) + uploaded.length }));
      toast({ title: "Proof attached", description: `${uploaded.length} file${uploaded.length > 1 ? "s" : ""} added.` });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      toast({ title: "Could not attach the proof", description: message, variant: "destructive" });
    } finally {
      setBusyId(null);
    }
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
      <input
        ref={rowFileInputRef}
        type="file"
        multiple
        accept="image/*,application/pdf"
        className="hidden"
        onChange={(e) => onPickRowFiles(e.target.files)}
      />
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: "In review", value: summary.pending },
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
        <div className="flex flex-col gap-1.5">
          <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
            Proof{selectedCategory?.requires_receipt === false ? " (recommended)" : " (required to submit)"}
          </span>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept="image/*,application/pdf"
            className="hidden"
            onChange={(e) => onPickFiles(e.target.files)}
          />
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => fileInputRef.current?.click()}>
              <Upload className="h-3.5 w-3.5 mr-1.5" /> Attach proof
            </Button>
            <span className="text-[11px] text-muted-foreground">
              {proofFiles.length === 0
                ? "Receipt or invoice — images or PDF."
                : `${proofFiles.length} file${proofFiles.length > 1 ? "s" : ""} selected`}
            </span>
          </div>
          {proofFiles.length > 0 && (
            <ul className="flex flex-wrap gap-1.5">
              {proofFiles.map((f, i) => (
                <li key={`${f.name}-${i}`} className="flex items-center gap-1 rounded-lg bg-card border border-border px-2 py-1 text-[11px] text-muted-foreground">
                  <Paperclip className="h-3 w-3" />
                  <span className="max-w-[180px] truncate">{f.name}</span>
                  <button
                    type="button"
                    onClick={() => setProofFiles((prev) => prev.filter((_, idx) => idx !== i))}
                    className="text-muted-foreground hover:text-destructive"
                    aria-label={`Remove ${f.name}`}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={() => saveClaim(false)} disabled={submitting}>
            Save draft
          </Button>
          <Button size="sm" onClick={() => saveClaim(true)} disabled={submitting}>
            <Plus className="h-4 w-4 mr-1.5" /> {submitting ? "Working…" : "Submit for approval"}
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
          <table className="w-full text-sm min-w-[760px]">
            <thead>
              <tr className="border-b border-border bg-muted/50">
                <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Claim</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Category</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Date</th>
                <th className="px-4 py-3 text-center text-xs font-semibold text-muted-foreground uppercase tracking-wide">Proof</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-muted-foreground uppercase tracking-wide">Amount</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Status</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-muted-foreground uppercase tracking-wide"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors">
                  <td className="px-4 py-3 max-w-[300px]">
                    <div className="font-medium text-foreground truncate">{r.title}</div>
                    {r.description && <div className="text-xs text-muted-foreground truncate">{r.description}</div>}
                    {needsCorrection(r) && r.correction_note && (
                      <div className="mt-1 text-xs text-amber-700">
                        <span className="font-medium">Correction:</span> {r.correction_note}
                      </div>
                    )}
                    {r.status === "rejected" && r.rejection_reason && (
                      <div className="mt-1 text-xs text-destructive">
                        <span className="font-medium">Reason:</span> {r.rejection_reason}
                      </div>
                    )}
                    {r.status === "reimbursed" && r.reimbursement_mode && (
                      <div className="text-xs text-muted-foreground">{reimbursementLabel(r.reimbursement_mode)}</div>
                    )}
                    {r.zoho_bill_number && (
                      <div className="mt-1">
                        <Badge className="bg-pastel-green text-foreground/80 border-0 text-[10px]">
                          Zoho {r.zoho_bill_number}
                        </Badge>
                      </div>
                    )}
                    {r.zoho_sync_error && (
                      <div className="text-[11px] text-destructive truncate">Zoho error: {r.zoho_sync_error}</div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">{r.category_name || "—"}</td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">{r.expense_date}</td>
                  <td className="px-4 py-3 text-center">
                    <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                      <Paperclip className="h-3 w-3" /> {proofTotal(r)}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right font-medium text-foreground">₹{formatInr(r.amount)}</td>
                  <td className="px-4 py-3">
                    <Badge className={`capitalize ${statusBadge(r.status)}`}>{statusLabel(r.status)}</Badge>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex flex-wrap justify-end items-center gap-2">
                      {busyId === r.id && <RefreshCw className="h-3 w-3 animate-spin text-muted-foreground" />}
                      {canSubmit(r, user?.id) && r.status === "changes_requested" && (
                        <button
                          onClick={() => resubmit(r)}
                          disabled={busyId === r.id}
                          className="inline-flex items-center gap-1 text-[11px] font-medium text-primary hover:underline disabled:opacity-50"
                        >
                          <RefreshCw className="h-3 w-3" /> Resubmit
                        </button>
                      )}
                      {canSubmit(r, user?.id) && r.status === "draft" && (
                        <button
                          onClick={() => resubmit(r)}
                          disabled={busyId === r.id}
                          className="inline-flex items-center gap-1 text-[11px] font-medium text-primary hover:underline disabled:opacity-50"
                        >
                          <Upload className="h-3 w-3" /> Submit
                        </button>
                      )}
                      {canEditClaim(r, user?.id) && (
                        <button
                          onClick={() => { setProofClaimId(r.id); rowFileInputRef.current?.click(); }}
                          disabled={busyId === r.id}
                          className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-primary disabled:opacity-50"
                        >
                          <Paperclip className="h-3 w-3" /> Add proof
                        </button>
                      )}
                      {canEditClaim(r, user?.id) && (
                        <button
                          onClick={() => cancel(r)}
                          disabled={busyId === r.id}
                          className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-destructive disabled:opacity-50"
                        >
                          <Trash2 className="h-3 w-3" /> Cancel
                        </button>
                      )}
                    </div>
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
