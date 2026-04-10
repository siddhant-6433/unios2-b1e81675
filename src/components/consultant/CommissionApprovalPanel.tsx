import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2, Check, X, Clock } from "lucide-react";

interface Request {
  id: string;
  consultant_id: string;
  course_id: string;
  current_amount: number;
  requested_amount: number;
  reason: string | null;
  status: string;
  created_at: string;
  consultants?: { name: string };
  courses?: { name: string; code: string };
  requester?: { display_name: string | null };
}

export function CommissionApprovalPanel() {
  const { role } = useAuth();
  const { toast } = useToast();
  const [requests, setRequests] = useState<Request[]>([]);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState<string | null>(null);
  const [filter, setFilter] = useState<"pending" | "approved" | "rejected" | "all">("pending");

  const isSuperAdmin = role === "super_admin";

  const fetchRequests = async () => {
    setLoading(true);
    let query = supabase
      .from("commission_edit_requests" as any)
      .select(`
        *,
        consultants:consultant_id(name),
        courses:course_id(name, code),
        requester:requested_by(display_name)
      `)
      .order("created_at", { ascending: false });
    if (filter !== "all") query = query.eq("status", filter);
    const { data } = await query;
    if (data) setRequests(data as any);
    setLoading(false);
  };

  useEffect(() => { fetchRequests(); }, [filter]);

  const handleApprove = async (req: Request) => {
    if (!isSuperAdmin) return;
    setProcessing(req.id);

    // Update the commission
    const { error: updateErr } = await supabase
      .from("consultant_commissions" as any)
      .update({ commission_value: req.requested_amount, commission_type: "fixed_annual" } as any)
      .eq("consultant_id", req.consultant_id)
      .eq("course_id", req.course_id);

    if (updateErr) {
      toast({ title: "Approval failed", description: updateErr.message, variant: "destructive" });
      setProcessing(null);
      return;
    }

    // Get approver profile id
    const { data: userData } = await supabase.auth.getUser();
    const { data: profile } = await supabase.from("profiles").select("id").eq("user_id", userData.user?.id).single();

    // Mark request as approved
    await supabase.from("commission_edit_requests" as any).update({
      status: "approved",
      reviewed_by: profile?.id,
      reviewed_at: new Date().toISOString(),
    } as any).eq("id", req.id);

    toast({ title: "Request approved", description: `Commission updated to ₹${req.requested_amount}` });
    fetchRequests();
    setProcessing(null);
  };

  const handleReject = async (req: Request) => {
    if (!isSuperAdmin) return;
    setProcessing(req.id);

    const { data: userData } = await supabase.auth.getUser();
    const { data: profile } = await supabase.from("profiles").select("id").eq("user_id", userData.user?.id).single();

    await supabase.from("commission_edit_requests" as any).update({
      status: "rejected",
      reviewed_by: profile?.id,
      reviewed_at: new Date().toISOString(),
    } as any).eq("id", req.id);

    toast({ title: "Request rejected" });
    fetchRequests();
    setProcessing(null);
  };

  if (loading) return <div className="flex h-32 items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-foreground">Commission Edit Requests</h3>
        <div className="flex rounded-lg border border-input bg-card p-0.5">
          {(["pending", "approved", "rejected", "all"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`rounded-md px-3 py-1 text-xs font-medium capitalize transition-colors ${
                filter === f ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      {requests.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <Clock className="h-6 w-6 mx-auto mb-2 opacity-30" />
          <p className="text-sm">No {filter === "all" ? "" : filter} requests</p>
        </div>
      ) : (
        <div className="rounded-xl border border-border overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-muted/40 border-b border-border">
                <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground">Consultant</th>
                <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground">Course</th>
                <th className="px-4 py-2 text-right text-xs font-medium text-muted-foreground">Current</th>
                <th className="px-4 py-2 text-right text-xs font-medium text-muted-foreground">Requested</th>
                <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground">Reason</th>
                <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground">Requested By</th>
                <th className="px-4 py-2 text-center text-xs font-medium text-muted-foreground">Status</th>
                {isSuperAdmin && filter === "pending" && (
                  <th className="px-4 py-2 text-right text-xs font-medium text-muted-foreground">Actions</th>
                )}
              </tr>
            </thead>
            <tbody>
              {requests.map((req) => (
                <tr key={req.id} className="border-b border-border/40 last:border-0">
                  <td className="px-4 py-2 font-medium text-xs">{req.consultants?.name || "—"}</td>
                  <td className="px-4 py-2 text-xs">
                    {req.courses?.name}
                    {req.courses?.code && <span className="text-muted-foreground ml-1">({req.courses.code})</span>}
                  </td>
                  <td className="px-4 py-2 text-right text-xs text-muted-foreground">₹{Number(req.current_amount).toLocaleString("en-IN")}</td>
                  <td className="px-4 py-2 text-right text-xs font-semibold">₹{Number(req.requested_amount).toLocaleString("en-IN")}</td>
                  <td className="px-4 py-2 text-xs text-muted-foreground max-w-[200px] truncate">{req.reason || "—"}</td>
                  <td className="px-4 py-2 text-xs text-muted-foreground">{req.requester?.display_name || "—"}</td>
                  <td className="px-4 py-2 text-center">
                    <Badge className={`text-[9px] border-0 ${
                      req.status === "approved" ? "bg-emerald-100 text-emerald-700" :
                      req.status === "rejected" ? "bg-red-100 text-red-700" :
                      "bg-amber-100 text-amber-700"
                    }`}>
                      {req.status}
                    </Badge>
                  </td>
                  {isSuperAdmin && filter === "pending" && (
                    <td className="px-4 py-2 text-right">
                      <div className="flex justify-end gap-1">
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 w-7 p-0 text-emerald-600 hover:bg-emerald-50"
                          onClick={() => handleApprove(req)}
                          disabled={processing === req.id}
                        >
                          {processing === req.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 w-7 p-0 text-red-600 hover:bg-red-50"
                          onClick={() => handleReject(req)}
                          disabled={processing === req.id}
                        >
                          <X className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
