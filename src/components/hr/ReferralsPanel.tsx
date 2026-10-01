import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { usePermissions } from "@/contexts/PermissionContext";
import { useToast } from "@/hooks/use-toast";
import { PageLoader } from "@/components/ui/page-loader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Gift, Plus } from "lucide-react";
import {
  referralStatusBadge,
  referralStatusLabel,
  summarizeReferrals,
  type ReferralRow,
  type ReferralSummaryRow,
} from "@/lib/referrals";

interface Opening { id: string; title: string }

export function ReferralsPanel() {
  const { user } = useAuth();
  const { can } = usePermissions();
  const { toast } = useToast();
  const canManage = can("hr", "recruitment_edit");
  const canViewAll = can("hr", "view");

  const [rows, setRows] = useState<ReferralRow[]>([]);
  const [summary, setSummary] = useState<ReferralSummaryRow[]>([]);
  const [openings, setOpenings] = useState<Opening[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ candidate_name: "", candidate_phone: "", candidate_email: "", job_opening_id: "", note: "" });

  async function fetchAll() {
    setLoading(true);
    const [r, s, o] = await Promise.all([
      (supabase as any).from("job_referrals").select("*").order("created_at", { ascending: false }).limit(300),
      (supabase as any).rpc("job_referral_summary"),
      supabase.from("job_openings").select("id, title").in("status", ["open", "draft"]).order("title"),
    ]);
    setRows((r.data as ReferralRow[]) ?? []);
    setSummary((s.data as ReferralSummaryRow[]) ?? []);
    setOpenings((o.data as Opening[]) ?? []);
    setLoading(false);
  }

  useEffect(() => { fetchAll(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const stats = useMemo(() => summarizeReferrals(rows), [rows]);

  async function submit() {
    if (!form.candidate_name.trim()) {
      toast({ title: "Candidate name is required", variant: "destructive" });
      return;
    }
    setSaving(true);
    const { error } = await supabase.from("job_referrals" as any).insert({
      referrer_user_id: user?.id,
      candidate_name: form.candidate_name.trim(),
      candidate_phone: form.candidate_phone.trim() || null,
      candidate_email: form.candidate_email.trim() || null,
      job_opening_id: form.job_opening_id || null,
      note: form.note.trim() || null,
      status: "invited",
    });
    setSaving(false);
    if (error) {
      toast({ title: "Could not save referral", description: error.message, variant: "destructive" });
      return;
    }
    setForm({ candidate_name: "", candidate_phone: "", candidate_email: "", job_opening_id: "", note: "" });
    toast({ title: "Referral recorded" });
    fetchAll();
  }

  async function setStatus(id: string, status: string) {
    const { error } = await supabase.from("job_referrals" as any).update({ status }).eq("id", id);
    if (error) { toast({ title: "Update failed", description: error.message, variant: "destructive" }); return; }
    fetchAll();
  }

  if (loading) return <PageLoader />;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: "Total", value: stats.total },
          { label: "Invited", value: stats.invited },
          { label: "Applied", value: stats.applied },
          { label: "Hired", value: stats.hired },
        ].map((s) => (
          <div key={s.label} className="rounded-xl bg-card card-shadow p-3.5">
            <p className="text-[11px] text-muted-foreground">{s.label}</p>
            <p className="mt-1 text-xl font-bold text-foreground">{s.value}</p>
          </div>
        ))}
      </div>

      <Card className="border-border/60 shadow-none">
        <CardHeader className="pb-2">
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <Gift className="h-4 w-4" /> Refer a candidate
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Input placeholder="Candidate name *" value={form.candidate_name} onChange={(e) => setForm({ ...form, candidate_name: e.target.value })} />
            <Input placeholder="Phone" value={form.candidate_phone} onChange={(e) => setForm({ ...form, candidate_phone: e.target.value })} />
            <Input placeholder="Email" value={form.candidate_email} onChange={(e) => setForm({ ...form, candidate_email: e.target.value })} />
            <Select value={form.job_opening_id} onValueChange={(v) => setForm({ ...form, job_opening_id: v })}>
              <SelectTrigger><SelectValue placeholder="Role (optional)" /></SelectTrigger>
              <SelectContent>
                {openings.map((o) => <SelectItem key={o.id} value={o.id}>{o.title}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <Textarea placeholder="Why are they a good fit? (optional)" rows={2} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
          <div className="flex justify-end">
            <Button size="sm" className="gap-1.5" disabled={saving} onClick={submit}>
              <Plus className="h-3.5 w-3.5" /> Add referral
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card className="border-border/60 shadow-none overflow-hidden">
        <CardHeader className="pb-2">
          <CardTitle className="text-base font-semibold">{canViewAll ? "All referrals" : "Your referrals"}</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[720px]">
              <thead>
                <tr className="border-b border-border bg-muted/50">
                  <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Candidate</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Role</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Referred by</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Status</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Added</th>
                  {canManage && <th className="px-4 py-3" />}
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr><td colSpan={canManage ? 6 : 5} className="px-4 py-10 text-center text-muted-foreground">No referrals yet</td></tr>
                ) : rows.map((r) => (
                  <tr key={r.id} className="border-b border-border last:border-0 hover:bg-muted/30">
                    <td className="px-4 py-2.5">
                      <span className="font-medium text-foreground">{r.candidate_name}</span>
                      <span className="text-xs text-muted-foreground"> · {r.candidate_phone || r.candidate_email || "—"}</span>
                    </td>
                    <td className="px-4 py-2.5 text-xs text-muted-foreground">{r.job_opening_title || "—"}</td>
                    <td className="px-4 py-2.5 text-xs text-muted-foreground">{r.referrer_name || "—"}</td>
                    <td className="px-4 py-2.5">
                      <Badge className={`border-0 text-[10px] ${referralStatusBadge(r.status)}`}>{referralStatusLabel(r.status)}</Badge>
                    </td>
                    <td className="px-4 py-2.5 text-xs text-muted-foreground">{new Date(r.created_at).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}</td>
                    {canManage && (
                      <td className="px-4 py-2.5 text-right">
                        <Select value={r.status} onValueChange={(v) => setStatus(r.id, v)}>
                          <SelectTrigger className="h-7 w-[120px] text-xs"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {["invited", "applied", "hired", "expired"].map((s) => (
                              <SelectItem key={s} value={s} className="text-xs capitalize">{s}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default ReferralsPanel;
