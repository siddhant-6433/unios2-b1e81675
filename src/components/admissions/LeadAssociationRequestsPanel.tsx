import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Check, Clock, ExternalLink, Loader2, X } from "lucide-react";

type AssociationRequest = {
  id: string;
  requester_type: "consultant" | "academic_partner";
  requested_phone: string;
  proposed_name: string;
  proposed_email: string | null;
  proposed_notes: string | null;
  status: string;
  created_at: string;
  leads?: { id: string; name: string; phone: string; stage: string } | null;
  consultants?: { name: string } | null;
  academic_partners?: { name: string; organization: string | null } | null;
  courses?: { name: string } | null;
};

const statusClass: Record<string, string> = {
  pending: "bg-warning/10 text-warning-foreground",
  approved: "bg-success/10 text-success",
  rejected: "bg-destructive/10 text-destructive",
};

interface Props {
  requesterType?: "consultant" | "academic_partner";
}

export function LeadAssociationRequestsPanel({ requesterType }: Props) {
  const { role } = useAuth();
  const { toast } = useToast();
  const [requests, setRequests] = useState<AssociationRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState<string | null>(null);
  const [filter, setFilter] = useState<"pending" | "approved" | "rejected" | "all">("pending");
  const isSuperAdmin = role === "super_admin";

  const fetchRequests = useCallback(async () => {
    setLoading(true);
    let query = supabase
      .from("lead_association_requests")
      .select(`
        *,
        leads:lead_id(id, name, phone, stage),
        consultants:consultant_id(name),
        academic_partners:academic_partner_id(name, organization),
        courses:proposed_course_id(name)
      `)
      .order("created_at", { ascending: false });

    if (requesterType) query = query.eq("requester_type", requesterType);
    if (filter !== "all") query = query.eq("status", filter);

    const { data, error } = await query;
    if (error) {
      toast({ title: "Could not load requests", description: error.message, variant: "destructive" });
    } else {
      setRequests((data || []) as AssociationRequest[]);
    }
    setLoading(false);
  }, [filter, requesterType, toast]);

  useEffect(() => { fetchRequests(); }, [fetchRequests]);

  const review = async (request: AssociationRequest, approved: boolean) => {
    if (!isSuperAdmin) return;
    setProcessing(request.id);
    const { error } = await supabase.rpc("review_lead_association_request", {
      _request_id: request.id,
      _approved: approved,
      _review_notes: null,
    });
    if (error) {
      toast({ title: "Review failed", description: error.message, variant: "destructive" });
    } else {
      toast({ title: approved ? "Association approved" : "Association rejected" });
      await fetchRequests();
    }
    setProcessing(null);
  };

  if (loading) return <div className="flex h-32 items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-primary" /></div>;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-foreground">Lead Association Requests</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">Duplicate CRM leads need superadmin approval before association.</p>
        </div>
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
        <div className="py-12 text-center text-muted-foreground">
          <Clock className="mx-auto mb-2 h-6 w-6 opacity-30" />
          <p className="text-sm">No {filter === "all" ? "" : filter} association requests</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/40">
                <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground">Requester</th>
                <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground">Proposed Lead</th>
                <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground">Existing CRM Lead</th>
                <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground">Course</th>
                <th className="px-4 py-2 text-center text-xs font-medium text-muted-foreground">Status</th>
                {isSuperAdmin && filter === "pending" && (
                  <th className="px-4 py-2 text-right text-xs font-medium text-muted-foreground">Actions</th>
                )}
              </tr>
            </thead>
            <tbody>
              {requests.map((request) => {
                const requesterName = request.requester_type === "consultant"
                  ? request.consultants?.name
                  : request.academic_partners?.name;
                return (
                  <tr key={request.id} className="border-b border-border/40 last:border-0">
                    <td className="px-4 py-2">
                      <div className="text-xs font-medium">{requesterName || "-"}</div>
                      <div className="text-[10px] capitalize text-muted-foreground">{request.requester_type.replace("_", " ")}</div>
                    </td>
                    <td className="px-4 py-2">
                      <div className="text-xs font-medium">{request.proposed_name}</div>
                      <div className="text-[10px] text-muted-foreground">{request.requested_phone}</div>
                    </td>
                    <td className="px-4 py-2">
                      {request.leads ? (
                        <a href={`/admissions/${request.leads.id}`} target="_blank" rel="noreferrer" className="group inline-flex items-center gap-1 text-xs text-primary hover:underline">
                          {request.leads.name}
                          <ExternalLink className="h-3 w-3 opacity-70" />
                        </a>
                      ) : (
                        <span className="text-xs text-muted-foreground">-</span>
                      )}
                      {request.leads?.phone && <div className="text-[10px] text-muted-foreground">{request.leads.phone}</div>}
                    </td>
                    <td className="px-4 py-2 text-xs text-muted-foreground">{request.courses?.name || "-"}</td>
                    <td className="px-4 py-2 text-center">
                      <Badge className={`border-0 text-[9px] ${statusClass[request.status] || "bg-muted text-muted-foreground"}`}>
                        {request.status}
                      </Badge>
                    </td>
                    {isSuperAdmin && filter === "pending" && (
                      <td className="px-4 py-2 text-right">
                        <div className="flex justify-end gap-1">
                          <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-success hover:bg-success/5" onClick={() => review(request, true)} disabled={processing === request.id}>
                            {processing === request.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                          </Button>
                          <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-destructive hover:bg-destructive/5" onClick={() => review(request, false)} disabled={processing === request.id}>
                            <X className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </td>
                    )}
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
