// Super-admin finance screen: consultant credit notes. A credit note is money
// owed to a consultant that can be applied against a student's fee receipt
// instead of cash (see OfflinePaymentDialog's "Consultant Credit Note" mode).
// This page issues new notes and shows how much of each has been applied.

import { Fragment, useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { PageLoader } from "@/components/ui/page-loader";
import { ButtonOrb } from "@/components/ui/thinking-orb";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { SelectField, TextField, TextAreaField, FieldShell } from "@/components/ui/state-fields";
import { Plus, Loader2, IndianRupee, ChevronDown, ChevronRight, FileText } from "lucide-react";

interface CreditNote {
  id: string;
  consultant_id: string;
  consultant_name: string;
  credit_note_no: string;
  amount: number;
  issue_date: string;
  reason: string | null;
  status: "open" | "void";
  created_at: string;
  applied: number;
  remaining: number;
}

interface Application {
  id: string;
  amount: number;
  created_at: string;
  lead_id: string;
  leads: { name: string } | null;
}

const money = (n: number) => `₹${(n || 0).toLocaleString("en-IN")}`;

export default function ConsultantCreditNotes() {
  const { toast } = useToast();
  const [notes, setNotes] = useState<CreditNote[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [applications, setApplications] = useState<Application[]>([]);
  const [loadingApplications, setLoadingApplications] = useState(false);

  const [showCreate, setShowCreate] = useState(false);
  const [consultants, setConsultants] = useState<{ id: string; name: string }[]>([]);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    consultant_id: "",
    credit_note_no: "",
    amount: "",
    issue_date: new Date().toISOString().slice(0, 10),
    reason: "",
  });

  const refresh = useCallback(async () => {
    setLoading(true);
    const { data, error } = await (supabase.from("consultant_credit_note_summary" as any) as any)
      .select("*")
      .order("created_at", { ascending: false });
    if (error) toast({ title: "Could not load credit notes", description: error.message, variant: "destructive" });
    setNotes((data || []) as CreditNote[]);
    setLoading(false);
  }, [toast]);

  useEffect(() => { refresh(); }, [refresh]);

  const loadConsultants = async () => {
    const { data } = await (supabase.from("consultants").select("id, name").neq("stage", "inactive").order("name") as any);
    setConsultants(data || []);
  };

  const openCreate = () => {
    setForm({ consultant_id: "", credit_note_no: "", amount: "", issue_date: new Date().toISOString().slice(0, 10), reason: "" });
    setShowCreate(true);
    if (!consultants.length) loadConsultants();
  };

  const toggleApplications = async (noteId: string) => {
    if (expanded === noteId) { setExpanded(null); return; }
    setExpanded(noteId);
    setLoadingApplications(true);
    const { data, error } = await (supabase.from("consultant_credit_note_applications" as any) as any)
      .select("id, amount, created_at, lead_id, leads:lead_id(name)")
      .eq("credit_note_id", noteId)
      .order("created_at", { ascending: false });
    if (error) toast({ title: "Could not load applications", description: error.message, variant: "destructive" });
    setApplications((data || []) as Application[]);
    setLoadingApplications(false);
  };

  const handleCreate = async () => {
    const amt = parseFloat(form.amount);
    if (!form.consultant_id) { toast({ title: "Select a consultant", variant: "destructive" }); return; }
    if (!form.credit_note_no.trim()) { toast({ title: "Credit note number is required", variant: "destructive" }); return; }
    if (!amt || amt <= 0) { toast({ title: "Enter a valid amount", variant: "destructive" }); return; }

    setSaving(true);
    const { data, error } = await (supabase.rpc as any)("create_consultant_credit_note", {
      _consultant_id: form.consultant_id,
      _credit_note_no: form.credit_note_no.trim(),
      _amount: amt,
      _issue_date: form.issue_date || null,
      _reason: form.reason.trim() || null,
    });
    setSaving(false);

    const rpcError = error || (data as { error?: { message: string } } | null)?.error;
    if (rpcError) {
      toast({ title: "Could not create credit note", description: rpcError.message, variant: "destructive" });
      return;
    }
    toast({ title: "Credit note created" });
    setShowCreate(false);
    refresh();
  };

  const totals = notes.reduce(
    (acc, n) => {
      if (n.status === "open") acc.issued += n.amount;
      acc.applied += n.applied || 0;
      acc.remaining += n.remaining || 0;
      return acc;
    },
    { issued: 0, applied: 0, remaining: 0 },
  );

  if (loading) return <PageLoader />;

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Consultant Credit Notes</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Credits owed to a consultant that can be applied against a student's fee receipt instead of cash.
          </p>
        </div>
        <Button onClick={openCreate} className="gap-2"><Plus className="h-4 w-4" />Create Credit Note</Button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card className="border-border/60 shadow-none">
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Total Credit Issued (open)</p>
            <p className="text-2xl font-bold text-foreground mt-1.5">{money(totals.issued)}</p>
          </CardContent>
        </Card>
        <Card className="border-border/60 shadow-none">
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Total Applied</p>
            <p className="text-2xl font-bold text-foreground mt-1.5">{money(totals.applied)}</p>
          </CardContent>
        </Card>
        <Card className="border-border/60 shadow-none">
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Total Remaining</p>
            <p className="text-2xl font-bold text-foreground mt-1.5">{money(totals.remaining)}</p>
          </CardContent>
        </Card>
      </div>

      <Card className="border-border/60 shadow-none">
        <CardContent className="p-0">
          {notes.length === 0 ? (
            <div className="text-center py-12 text-sm text-muted-foreground">No credit notes yet</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border/60 text-left text-xs text-muted-foreground">
                    <th className="px-4 py-3 font-medium">Consultant</th>
                    <th className="px-4 py-3 font-medium">Credit Note No</th>
                    <th className="px-4 py-3 font-medium">Issued</th>
                    <th className="px-4 py-3 font-medium">Amount</th>
                    <th className="px-4 py-3 font-medium">Applied</th>
                    <th className="px-4 py-3 font-medium">Remaining</th>
                    <th className="px-4 py-3 font-medium">Status</th>
                    <th className="px-4 py-3 font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {notes.map((n) => (
                    <Fragment key={n.id}>
                      <tr className="border-b border-border/40 last:border-0">
                        <td className="px-4 py-3 text-foreground">{n.consultant_name}</td>
                        <td className="px-4 py-3 text-foreground">{n.credit_note_no}</td>
                        <td className="px-4 py-3 text-muted-foreground">{new Date(n.issue_date).toLocaleDateString("en-IN")}</td>
                        <td className="px-4 py-3 text-foreground">{money(n.amount)}</td>
                        <td className="px-4 py-3 text-foreground">{money(n.applied)}</td>
                        <td className="px-4 py-3 text-foreground font-medium">{money(n.remaining)}</td>
                        <td className="px-4 py-3">
                          <Badge className={`text-[10px] border-0 ${n.status === "open" ? "bg-success/10 text-success" : "bg-muted text-muted-foreground"}`}>
                            {n.status}
                          </Badge>
                        </td>
                        <td className="px-4 py-3">
                          <Button variant="ghost" size="sm" className="h-7 gap-1 text-xs" onClick={() => toggleApplications(n.id)}>
                            {expanded === n.id ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                            View applications
                          </Button>
                        </td>
                      </tr>
                      {expanded === n.id && (
                        <tr className="border-b border-border/40 last:border-0 bg-muted/20">
                          <td colSpan={8} className="px-4 py-3">
                            {loadingApplications ? (
                              <div className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" />Loading…</div>
                            ) : applications.length === 0 ? (
                              <p className="text-xs text-muted-foreground">No applications yet.</p>
                            ) : (
                              <div className="space-y-1.5">
                                {applications.map((a) => (
                                  <div key={a.id} className="flex items-center justify-between text-xs">
                                    <span className="flex items-center gap-1.5 text-foreground">
                                      <FileText className="h-3 w-3 text-muted-foreground" />
                                      {a.leads?.name || "Unknown lead"}
                                    </span>
                                    <span className="text-muted-foreground">{new Date(a.created_at).toLocaleDateString("en-IN")}</span>
                                    <span className="font-medium text-foreground">{money(a.amount)}</span>
                                  </div>
                                ))}
                              </div>
                            )}
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={showCreate} onOpenChange={(open) => { if (!saving) setShowCreate(open); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <IndianRupee className="h-4 w-4 text-primary" />
              Create Credit Note
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <SelectField
              value={form.consultant_id}
              onValueChange={(v) => setForm((p) => ({ ...p, consultant_id: v }))}
              options={consultants.map((c) => ({ value: c.id, label: c.name }))}
              label="Consultant"
              required
              placeholder="Select consultant"
            />
            <div className="grid grid-cols-2 gap-3">
              <TextField
                value={form.credit_note_no}
                onValueChange={(v) => setForm((p) => ({ ...p, credit_note_no: v }))}
                label="Credit Note No"
                required
                placeholder="e.g. CN-2026-001"
              />
              <FieldShell label="Amount (₹)" required>
                <Input
                  type="number" min="1" step="1" inputMode="numeric"
                  value={form.amount}
                  onChange={(e) => setForm((p) => ({ ...p, amount: e.target.value }))}
                  placeholder="0"
                />
              </FieldShell>
            </div>
            <FieldShell label="Issue Date">
              <Input type="date" value={form.issue_date} onChange={(e) => setForm((p) => ({ ...p, issue_date: e.target.value }))} />
            </FieldShell>
            <TextAreaField
              value={form.reason}
              onValueChange={(v) => setForm((p) => ({ ...p, reason: v }))}
              label="Reason (optional)"
              placeholder="Why this credit note is being issued"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreate(false)} disabled={saving}>Cancel</Button>
            <Button onClick={handleCreate} disabled={saving} className="gap-1.5">
              {saving ? <ButtonOrb state="working" onFilled /> : <Plus className="h-4 w-4" />}
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
