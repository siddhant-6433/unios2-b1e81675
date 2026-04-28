import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import {
  Search, Loader2, Check, X, Clock, CalendarOff,
  CheckCircle, AlertTriangle, Filter, Users,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

interface LeaveRequest {
  id: string;
  user_id: string;
  leave_type: string;
  start_date: string;
  end_date: string;
  days: number;
  reason: string | null;
  status: string;
  created_at: string;
  display_name: string;
  phone: string;
}

const statusStyles: Record<string, string> = {
  pending: "bg-pastel-yellow text-foreground/80",
  approved: "bg-pastel-green text-foreground/80",
  rejected: "bg-pastel-red text-foreground/80",
};

const HrLeaveManagement = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const [tab, setTab] = useState<"pending" | "all">("pending");
  const [requests, setRequests] = useState<LeaveRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [processing, setProcessing] = useState<string | null>(null);

  useEffect(() => { fetchRequests(); }, [tab]);

  const fetchRequests = async () => {
    setLoading(true);
    let query = supabase.from("employee_leave_requests")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(200);

    if (tab === "pending") query = query.eq("status", "pending");

    const { data } = await query;
    if (!data) { setLoading(false); return; }

    // Fetch profiles
    const userIds = [...new Set(data.map((r: any) => r.user_id))];
    const { data: profiles } = await supabase
      .from("profiles")
      .select("user_id, display_name, phone")
      .in("user_id", userIds);
    const pMap = new Map((profiles || []).map((p: any) => [p.user_id, p]));

    setRequests(data.map((r: any) => ({
      ...r,
      display_name: pMap.get(r.user_id)?.display_name || "Unknown",
      phone: pMap.get(r.user_id)?.phone || "",
    })));
    setLoading(false);
  };

  const handleAction = async (id: string, action: "approved" | "rejected") => {
    setProcessing(id);
    const { error } = await supabase.from("employee_leave_requests").update({
      status: action,
      approved_by: user?.id,
      approved_at: new Date().toISOString(),
    }).eq("id", id);

    if (error) toast({ title: "Error", description: error.message, variant: "destructive" });
    else toast({ title: action === "approved" ? "Approved" : "Rejected" });
    setProcessing(null);
    fetchRequests();
  };

  const filtered = search
    ? requests.filter(r => r.display_name.toLowerCase().includes(search.toLowerCase()))
    : requests;

  const pendingCount = requests.filter(r => r.status === "pending").length;

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Leave Management</h1>
        <p className="text-sm text-muted-foreground mt-1">Review and manage employee leave requests</p>
      </div>

      {/* Tabs + Search */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1 rounded-xl border border-input bg-card p-1">
          <button onClick={() => setTab("pending")}
            className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors ${tab === "pending" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}>
            <Clock className="h-4 w-4" /> Pending {pendingCount > 0 && <span className="bg-destructive text-destructive-foreground rounded-full px-1.5 py-0.5 text-[10px] font-bold">{pendingCount}</span>}
          </button>
          <button onClick={() => setTab("all")}
            className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors ${tab === "all" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}>
            <CalendarOff className="h-4 w-4" /> All Requests
          </button>
        </div>

        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input type="text" placeholder="Search employee..." value={search} onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-xl border border-input bg-card py-2.5 pl-10 pr-4 text-sm focus:outline-none focus:ring-2 focus:ring-ring/20" />
        </div>
      </div>

      {loading ? (
        <div className="flex h-48 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
      ) : (
        <Card className="border-border/60 shadow-none overflow-hidden">
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/50">
                  <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Employee</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Type</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Dates</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Days</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Reason</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Status</th>
                  {tab === "pending" && <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Action</th>}
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr><td colSpan={7} className="px-4 py-12 text-center text-muted-foreground">
                    {tab === "pending" ? "No pending leave requests" : "No leave requests found"}
                  </td></tr>
                ) : filtered.map((r) => (
                  <tr key={r.id} className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors">
                    <td className="px-4 py-3">
                      <div className="font-medium text-foreground">{r.display_name}</div>
                      <div className="text-xs text-muted-foreground">{r.phone}</div>
                    </td>
                    <td className="px-4 py-3">
                      <Badge className="text-[10px] border-0 bg-pastel-purple text-foreground/80 capitalize">{r.leave_type}</Badge>
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">
                      {new Date(r.start_date).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}
                      {r.start_date !== r.end_date && ` — ${new Date(r.end_date).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}`}
                    </td>
                    <td className="px-4 py-3 font-medium">{r.days}</td>
                    <td className="px-4 py-3 text-xs text-muted-foreground max-w-[200px] truncate">{r.reason || "—"}</td>
                    <td className="px-4 py-3">
                      <Badge className={`text-[10px] border-0 capitalize ${statusStyles[r.status] || "bg-muted"}`}>{r.status}</Badge>
                    </td>
                    {tab === "pending" && (
                      <td className="px-4 py-3">
                        <div className="flex gap-1.5">
                          <button
                            onClick={() => handleAction(r.id, "approved")}
                            disabled={processing === r.id}
                            className="flex items-center gap-1 rounded-lg bg-primary px-2.5 py-1 text-[11px] font-medium text-primary-foreground hover:bg-primary/90"
                          >
                            <Check className="h-3 w-3" /> Approve
                          </button>
                          <button
                            onClick={() => handleAction(r.id, "rejected")}
                            disabled={processing === r.id}
                            className="flex items-center gap-1 rounded-lg border border-input px-2.5 py-1 text-[11px] font-medium text-muted-foreground hover:bg-muted"
                          >
                            <X className="h-3 w-3" /> Reject
                          </button>
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
    </div>
  );
};

export default HrLeaveManagement;
