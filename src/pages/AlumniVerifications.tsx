import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Loader2, Shield, FileText, ExternalLink, CheckCircle, XCircle, Clock, Eye, Download,
} from "lucide-react";

const STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  pending_payment: { label: "Pending Payment", color: "bg-gray-100 text-gray-700" },
  paid: { label: "Paid", color: "bg-blue-100 text-blue-700" },
  under_review: { label: "Under Review", color: "bg-amber-100 text-amber-700" },
  verified: { label: "Verified", color: "bg-emerald-100 text-emerald-700" },
  rejected: { label: "Rejected", color: "bg-red-100 text-red-700" },
};

const RESULT_OPTIONS = [
  { value: "confirmed", label: "Confirmed — Alumni record verified" },
  { value: "not_found", label: "Not Found — No matching record" },
  { value: "discrepancy", label: "Discrepancy — Details don't match records" },
];

export default function AlumniVerifications() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [requests, setRequests] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [selectedReq, setSelectedReq] = useState<any | null>(null);
  const [reviewNotes, setReviewNotes] = useState("");
  const [verificationResult, setVerificationResult] = useState("");
  const [newStatus, setNewStatus] = useState("");
  const [saving, setSaving] = useState(false);

  const fetchRequests = async () => {
    const { data } = await supabase
      .from("alumni_verification_requests" as any)
      .select("*")
      .order("created_at", { ascending: false });
    setRequests(data || []);
    setLoading(false);
  };

  useEffect(() => { fetchRequests(); }, []);

  const filtered = statusFilter === "all"
    ? requests
    : requests.filter(r => r.status === statusFilter);

  const statusCounts = requests.reduce((acc: Record<string, number>, r: any) => {
    acc[r.status] = (acc[r.status] || 0) + 1;
    return acc;
  }, {});

  const openDetail = (req: any) => {
    setSelectedReq(req);
    setReviewNotes(req.review_notes || "");
    setVerificationResult(req.verification_result || "");
    setNewStatus(req.status);
  };

  const handleUpdate = async () => {
    if (!selectedReq) return;
    setSaving(true);
    const update: any = {
      status: newStatus,
      review_notes: reviewNotes,
    };
    if (["verified", "rejected"].includes(newStatus)) {
      update.verification_result = verificationResult;
      update.reviewed_by = user?.id;
      update.reviewed_at = new Date().toISOString();
    }
    const { error } = await supabase
      .from("alumni_verification_requests" as any)
      .update(update)
      .eq("id", selectedReq.id);

    if (error) {
      toast({ title: "Update failed", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Request updated" });
      setSelectedReq(null);
      fetchRequests();
    }
    setSaving(false);
  };

  const getDocUrl = async (path: string) => {
    const { data } = await supabase.storage
      .from("alumni-verification-docs")
      .createSignedUrl(path, 3600);
    if (data?.signedUrl) window.open(data.signedUrl, "_blank");
  };

  if (loading) {
    return <div className="flex h-64 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Alumni Verification</h1>
          <p className="text-sm text-muted-foreground mt-1">Review and manage verification requests from employers</p>
        </div>
        <Badge className="bg-primary/10 text-primary border-0 text-sm font-bold">{requests.length} total</Badge>
      </div>

      {/* Status filter tabs */}
      <div className="flex rounded-xl border border-input bg-card p-0.5 w-fit">
        <button
          onClick={() => setStatusFilter("all")}
          className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${statusFilter === "all" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
        >
          All ({requests.length})
        </button>
        {Object.entries(STATUS_CONFIG).map(([key, cfg]) => (
          <button
            key={key}
            onClick={() => setStatusFilter(key)}
            className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${statusFilter === key ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
          >
            {cfg.label} ({statusCounts[key] || 0})
          </button>
        ))}
      </div>

      {/* Requests table */}
      <Card className="border-border/60 shadow-none overflow-hidden">
        <CardContent className="p-0">
          {filtered.length === 0 ? (
            <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">No requests found</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/50">
                    <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase">Request #</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase">Employer</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase">Alumni Name</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase">Course</th>
                    <th className="px-4 py-3 text-center text-xs font-semibold text-muted-foreground uppercase">Year</th>
                    <th className="px-4 py-3 text-center text-xs font-semibold text-muted-foreground uppercase">Status</th>
                    <th className="px-4 py-3 text-center text-xs font-semibold text-muted-foreground uppercase">Result</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase">Submitted</th>
                    <th className="px-4 py-3 text-center text-xs font-semibold text-muted-foreground uppercase">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((req: any) => {
                    const cfg = STATUS_CONFIG[req.status] || STATUS_CONFIG.pending_payment;
                    return (
                      <tr key={req.id} className="border-b border-border/40 hover:bg-muted/20 cursor-pointer" onClick={() => openDetail(req)}>
                        <td className="px-4 py-3 font-mono font-bold text-primary text-xs">{req.request_number}</td>
                        <td className="px-4 py-3 font-medium text-foreground">{req.employer_name}</td>
                        <td className="px-4 py-3">{req.alumni_name}</td>
                        <td className="px-4 py-3 text-muted-foreground">{req.course}</td>
                        <td className="px-4 py-3 text-center">{req.year_of_passing}</td>
                        <td className="px-4 py-3 text-center">
                          <Badge className={`border-0 text-[10px] font-semibold ${cfg.color}`}>{cfg.label}</Badge>
                        </td>
                        <td className="px-4 py-3 text-center">
                          {req.verification_result ? (
                            <Badge className={`border-0 text-[10px] font-semibold ${
                              req.verification_result === "confirmed" ? "bg-emerald-100 text-emerald-700" :
                              req.verification_result === "not_found" ? "bg-red-100 text-red-700" :
                              "bg-amber-100 text-amber-700"
                            }`}>
                              {req.verification_result}
                            </Badge>
                          ) : <span className="text-[10px] text-muted-foreground">—</span>}
                        </td>
                        <td className="px-4 py-3 text-xs text-muted-foreground">
                          {new Date(req.created_at).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}
                        </td>
                        <td className="px-4 py-3 text-center">
                          <Button variant="ghost" size="sm" className="gap-1 text-xs">
                            <Eye className="h-3 w-3" /> View
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Detail / Review Dialog */}
      <Dialog open={!!selectedReq} onOpenChange={(o) => { if (!o) setSelectedReq(null); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Shield className="h-5 w-5 text-primary" />
              {selectedReq?.request_number} — Verification Review
            </DialogTitle>
          </DialogHeader>

          {selectedReq && (
            <div className="space-y-4 max-h-[70vh] overflow-y-auto">
              {/* Requestor Info */}
              <div className="rounded-xl border border-border p-3 space-y-2">
                <p className="text-[10px] font-semibold text-muted-foreground uppercase">Requestor</p>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div><span className="text-muted-foreground">Contact:</span> <span className="font-medium">{selectedReq.contact_name}</span></div>
                  <div><span className="text-muted-foreground">Phone:</span> <span className="font-medium">{selectedReq.contact_phone_spoc}</span></div>
                  <div className="col-span-2"><span className="text-muted-foreground">Employer:</span> <span className="font-medium">{selectedReq.employer_name}</span></div>
                  <div className="col-span-2"><span className="text-muted-foreground">Requestor Phone:</span> <span className="font-medium">{selectedReq.requestor_phone}</span></div>
                </div>
              </div>

              {/* Alumni Info */}
              <div className="rounded-xl border border-border p-3 space-y-2">
                <p className="text-[10px] font-semibold text-muted-foreground uppercase">Alumni Details</p>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div className="col-span-2"><span className="text-muted-foreground">Name:</span> <span className="font-bold">{selectedReq.alumni_name}</span></div>
                  <div><span className="text-muted-foreground">Course:</span> <span className="font-medium">{selectedReq.course}</span></div>
                  <div><span className="text-muted-foreground">Year:</span> <span className="font-medium">{selectedReq.year_of_passing}</span></div>
                </div>
              </div>

              {/* Documents */}
              <div className="rounded-xl border border-border p-3 space-y-2">
                <p className="text-[10px] font-semibold text-muted-foreground uppercase">Documents</p>
                <div className="space-y-1.5">
                  {selectedReq.diploma_certificate_url && (
                    <button onClick={() => getDocUrl(selectedReq.diploma_certificate_url)} className="flex items-center gap-2 text-sm text-primary hover:underline">
                      <FileText className="h-3.5 w-3.5" /> Diploma Certificate <ExternalLink className="h-3 w-3" />
                    </button>
                  )}
                  {(selectedReq.marksheet_urls || []).map((url: string, i: number) => (
                    <button key={i} onClick={() => getDocUrl(url)} className="flex items-center gap-2 text-sm text-primary hover:underline">
                      <FileText className="h-3.5 w-3.5" /> Marksheet {i + 1} <ExternalLink className="h-3 w-3" />
                    </button>
                  ))}
                  {!selectedReq.diploma_certificate_url && !(selectedReq.marksheet_urls || []).length && (
                    <p className="text-xs text-muted-foreground">No documents uploaded</p>
                  )}
                </div>
              </div>

              {/* Payment Info */}
              <div className="rounded-xl border border-border p-3 space-y-1">
                <p className="text-[10px] font-semibold text-muted-foreground uppercase">Payment</p>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Amount: <span className="font-medium text-foreground">&#8377;{selectedReq.fee_amount}</span></span>
                  {selectedReq.paid_at ? (
                    <Badge className="bg-emerald-100 text-emerald-700 border-0 text-[10px]">Paid {new Date(selectedReq.paid_at).toLocaleDateString("en-IN")}</Badge>
                  ) : (
                    <Badge className="bg-gray-100 text-gray-600 border-0 text-[10px]">Unpaid</Badge>
                  )}
                </div>
              </div>

              {/* Review Section */}
              <div className="space-y-3 pt-2 border-t border-border">
                <p className="text-xs font-semibold text-foreground">Review & Decision</p>
                <div>
                  <label className="text-xs font-medium text-foreground mb-1 block">Status</label>
                  <select
                    value={newStatus}
                    onChange={e => setNewStatus(e.target.value)}
                    className="w-full rounded-xl border border-input bg-background px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
                  >
                    {Object.entries(STATUS_CONFIG).map(([key, cfg]) => (
                      <option key={key} value={key}>{cfg.label}</option>
                    ))}
                  </select>
                </div>
                {["verified", "rejected"].includes(newStatus) && (
                  <div>
                    <label className="text-xs font-medium text-foreground mb-1 block">Verification Result</label>
                    <select
                      value={verificationResult}
                      onChange={e => setVerificationResult(e.target.value)}
                      className="w-full rounded-xl border border-input bg-background px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
                    >
                      <option value="">Select result</option>
                      {RESULT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                  </div>
                )}
                <div>
                  <label className="text-xs font-medium text-foreground mb-1 block">Review Notes</label>
                  <textarea
                    value={reviewNotes}
                    onChange={e => setReviewNotes(e.target.value)}
                    placeholder="Internal notes about the verification..."
                    rows={3}
                    className="w-full rounded-xl border border-input bg-background px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 resize-none"
                  />
                </div>
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setSelectedReq(null)}>Cancel</Button>
            <Button onClick={handleUpdate} disabled={saving} className="gap-2">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle className="h-4 w-4" />}
              Update Request
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
