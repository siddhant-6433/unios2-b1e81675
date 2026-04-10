import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2, Edit, Save, X, Clock } from "lucide-react";

interface Commission {
  id: string;
  course_id: string;
  commission_type: string;
  commission_value: number;
  course_name?: string;
  course_code?: string;
  first_year_fee?: number;
}

interface Request {
  id: string;
  course_id: string;
  current_amount: number;
  requested_amount: number;
  reason: string | null;
  status: string;
  created_at: string;
}

interface Props {
  consultantId: string;
}

export function CourseCommissions({ consultantId }: Props) {
  const { role } = useAuth();
  const { toast } = useToast();
  const [commissions, setCommissions] = useState<Commission[]>([]);
  const [requests, setRequests] = useState<Request[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [editReason, setEditReason] = useState("");
  const [saving, setSaving] = useState(false);

  const isSuperAdmin = role === "super_admin";
  const canRequestEdit = ["counsellor", "principal", "admission_head", "campus_admin"].includes(role || "");

  const fetchCommissions = async () => {
    // Fetch commissions
    const { data: commData } = await supabase
      .from("consultant_commissions" as any)
      .select("*")
      .eq("consultant_id", consultantId)
      .order("created_at");

    if (!commData || commData.length === 0) {
      setCommissions([]);
    } else {
      // Fetch real first-year fees from the view
      const courseIds = (commData as any[]).map(c => c.course_id);
      const { data: feeData } = await supabase
        .from("course_first_year_fee" as any)
        .select("course_id, code, name, first_year_fee")
        .in("course_id", courseIds);

      const feeMap = new Map<string, any>((feeData || []).map((f: any) => [f.course_id, f]));

      const mapped = (commData as any[]).map(c => {
        const fee = feeMap.get(c.course_id);
        return {
          ...c,
          course_name: fee?.name,
          course_code: fee?.code,
          first_year_fee: Number(fee?.first_year_fee || 0),
        };
      }).sort((a, b) => (a.course_name || "").localeCompare(b.course_name || ""));
      setCommissions(mapped);
    }

    // Fetch pending requests for this consultant
    const { data: reqData } = await supabase
      .from("commission_edit_requests" as any)
      .select("*")
      .eq("consultant_id", consultantId)
      .eq("status", "pending");
    if (reqData) setRequests(reqData as any);

    setLoading(false);
  };

  useEffect(() => { fetchCommissions(); }, [consultantId]);

  const startEdit = (c: Commission) => {
    setEditingId(c.id);
    setEditValue(String(c.commission_value));
    setEditReason("");
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditValue("");
    setEditReason("");
  };

  const handleSave = async (c: Commission) => {
    const newAmount = parseFloat(editValue);
    if (isNaN(newAmount) || newAmount < 0) return;
    setSaving(true);

    if (isSuperAdmin) {
      // Direct update
      const { error } = await supabase
        .from("consultant_commissions" as any)
        .update({ commission_type: "fixed_annual", commission_value: newAmount } as any)
        .eq("id", c.id);
      if (error) {
        toast({ title: "Update failed", description: error.message, variant: "destructive" });
      } else {
        toast({ title: "Commission updated" });
        fetchCommissions();
      }
    } else if (canRequestEdit) {
      // Submit edit request
      const { data: profile } = await supabase.from("profiles").select("id").eq("user_id", (await supabase.auth.getUser()).data.user?.id).single();
      const { error } = await supabase.from("commission_edit_requests" as any).insert({
        consultant_id: consultantId,
        course_id: c.course_id,
        current_amount: c.commission_value,
        requested_amount: newAmount,
        reason: editReason.trim() || null,
        requested_by: profile?.id,
      } as any);
      if (error) {
        toast({ title: "Request failed", description: error.message, variant: "destructive" });
      } else {
        toast({ title: "Edit request submitted", description: "Awaiting super admin approval" });
        fetchCommissions();
      }
    }

    setSaving(false);
    cancelEdit();
  };

  const pendingReqMap = new Map(requests.map(r => [r.course_id, r]));

  if (loading) return <div className="flex h-10 items-center justify-center"><Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" /></div>;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">Course-wise Commissions</h4>
        {!isSuperAdmin && canRequestEdit && (
          <Badge variant="outline" className="text-[9px]">Edit requests go to super admin</Badge>
        )}
      </div>

      {commissions.length === 0 ? (
        <p className="text-[10px] text-muted-foreground">No commissions set for this consultant yet.</p>
      ) : (
        <div className="rounded-lg border border-border overflow-hidden">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-muted/40 border-b border-border">
                <th className="px-3 py-2 text-left font-medium text-muted-foreground">Course</th>
                <th className="px-3 py-2 text-right font-medium text-muted-foreground">Annual Fee</th>
                <th className="px-3 py-2 text-right font-medium text-muted-foreground">Commission ₹</th>
                <th className="px-3 py-2 text-right font-medium text-muted-foreground">%</th>
                <th className="px-3 py-2 text-right font-medium text-muted-foreground w-24">Action</th>
              </tr>
            </thead>
            <tbody>
              {commissions.map((c) => {
                const annualFee = Number(c.first_year_fee || 0);
                const pct = annualFee > 0 ? ((Number(c.commission_value) / annualFee) * 100).toFixed(1) : "—";
                const isEditing = editingId === c.id;
                const pendingReq = pendingReqMap.get(c.course_id);

                return (
                  <tr key={c.id} className="border-b border-border/40 last:border-0">
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-1.5">
                        <span className="font-medium text-foreground text-xs">{c.course_name}</span>
                        {c.course_code && <span className="text-[10px] text-muted-foreground">({c.course_code})</span>}
                      </div>
                      {pendingReq && (
                        <div className="mt-1 flex items-center gap-1 text-[10px] text-amber-600 dark:text-amber-400">
                          <Clock className="h-2.5 w-2.5" />
                          Pending: ₹{pendingReq.requested_amount}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right text-muted-foreground">
                      ₹{annualFee.toLocaleString("en-IN")}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {isEditing ? (
                        <div className="space-y-1">
                          <input
                            type="number"
                            value={editValue}
                            onChange={(e) => setEditValue(e.target.value)}
                            className="w-24 rounded border border-input bg-background px-2 py-1 text-xs text-right"
                            autoFocus
                          />
                          {!isSuperAdmin && (
                            <input
                              type="text"
                              value={editReason}
                              onChange={(e) => setEditReason(e.target.value)}
                              placeholder="Reason (optional)"
                              className="w-32 rounded border border-input bg-background px-2 py-1 text-[10px]"
                            />
                          )}
                        </div>
                      ) : (
                        <span className="font-semibold text-foreground">₹{Number(c.commission_value).toLocaleString("en-IN")}</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <Badge variant="outline" className="text-[9px]">{pct}%</Badge>
                    </td>
                    <td className="px-3 py-2 text-right">
                      {isEditing ? (
                        <div className="flex items-center gap-1 justify-end">
                          <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={() => handleSave(c)} disabled={saving}>
                            {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3 text-emerald-600" />}
                          </Button>
                          <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={cancelEdit}>
                            <X className="h-3 w-3 text-muted-foreground" />
                          </Button>
                        </div>
                      ) : (
                        (isSuperAdmin || canRequestEdit) && !pendingReq && (
                          <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={() => startEdit(c)}>
                            <Edit className="h-3 w-3 text-muted-foreground" />
                          </Button>
                        )
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
