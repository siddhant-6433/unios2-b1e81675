import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  FileText, Download, Eye, Loader2, Search, Filter, ExternalLink,
  CheckCircle, Clock, CreditCard, Upload, AlertCircle, ChevronDown, ChevronUp, X,
} from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";

interface AppRow {
  id: string;
  application_id: string;
  lead_id: string | null;
  full_name: string;
  phone: string;
  email: string | null;
  status: string;
  payment_status: string | null;
  payment_ref: string | null;
  fee_amount: number | null;
  program_category: string | null;
  course_selections: any[];
  completed_sections: Record<string, boolean>;
  submitted_at: string | null;
  created_at: string;
  flags: string[] | null;
  dob: string | null;
  gender: string | null;
  category: string | null;
  father: any;
  mother: any;
  address: any;
  academic_details: any;
}

const STATUS_BADGE: Record<string, string> = {
  draft: "bg-amber-100 text-amber-700",
  submitted: "bg-emerald-100 text-emerald-700",
  under_review: "bg-blue-100 text-blue-700",
  approved: "bg-green-100 text-green-700",
  rejected: "bg-red-100 text-red-700",
};

const PAYMENT_BADGE: Record<string, string> = {
  paid: "bg-emerald-100 text-emerald-700",
  pending: "bg-amber-100 text-amber-700",
  failed: "bg-red-100 text-red-700",
};

export default function Applications() {
  const { role } = useAuth();
  const [apps, setApps] = useState<AppRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [paymentFilter, setPaymentFilter] = useState<"all" | "paid" | "pending">("all");
  const [statusFilter, setStatusFilter] = useState<"all" | "draft" | "submitted">("all");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [docsDialog, setDocsDialog] = useState<{ appId: string; applicationId: string } | null>(null);
  const [docs, setDocs] = useState<{ name: string; url: string }[]>([]);
  const [docsLoading, setDocsLoading] = useState(false);

  useEffect(() => {
    const fetchApps = async () => {
      setLoading(true);
      let q = (supabase as any).from("applications")
        .select("id, application_id, lead_id, full_name, phone, email, status, payment_status, payment_ref, fee_amount, program_category, course_selections, completed_sections, submitted_at, created_at, flags, dob, gender, category, father, mother, address, academic_details")
        .order("created_at", { ascending: false });

      if (paymentFilter !== "all") q = q.eq("payment_status", paymentFilter);
      if (statusFilter !== "all") q = q.eq("status", statusFilter);

      const { data } = await q;
      setApps(data || []);
      setLoading(false);
    };
    fetchApps();
  }, [paymentFilter, statusFilter]);

  const filtered = apps.filter(a => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      a.full_name?.toLowerCase().includes(q) ||
      a.phone?.includes(q) ||
      a.application_id?.toLowerCase().includes(q) ||
      a.course_selections?.some((c: any) => c.course_name?.toLowerCase().includes(q))
    );
  });

  const completedCount = (cs: Record<string, boolean>) => Object.values(cs || {}).filter(Boolean).length;
  const totalCount = (cs: Record<string, boolean>) => Object.keys(cs || {}).length;

  const fetchDocs = async (appId: string, applicationId: string) => {
    setDocsDialog({ appId, applicationId });
    setDocsLoading(true);
    setDocs([]);

    const { data: files, error } = await supabase.storage
      .from("application-documents")
      .list(applicationId, { limit: 50 });

    if (error || !files?.length) {
      setDocs([]);
      setDocsLoading(false);
      return;
    }

    const docList = files
      .filter(f => f.name && !f.name.startsWith("."))
      .map(f => {
        const { data: urlData } = supabase.storage
          .from("application-documents")
          .getPublicUrl(`${applicationId}/${f.name}`);
        return { name: f.name, url: urlData.publicUrl };
      });

    setDocs(docList);
    setDocsLoading(false);
  };

  const stats = {
    total: apps.length,
    paid: apps.filter(a => a.payment_status === "paid").length,
    submitted: apps.filter(a => a.status === "submitted").length,
    draft: apps.filter(a => a.status === "draft").length,
  };

  if (loading) return <div className="flex items-center justify-center min-h-[60vh]"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;

  return (
    <div className="space-y-5 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Applications</h1>
          <p className="text-sm text-muted-foreground mt-1">All online applications with payment and document status</p>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card className="border-border/60 shadow-none">
          <CardContent className="p-3 flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-blue-100 flex items-center justify-center"><FileText className="h-4 w-4 text-blue-600" /></div>
            <div><p className="text-xl font-bold text-foreground">{stats.total}</p><p className="text-[10px] text-muted-foreground">Total</p></div>
          </CardContent>
        </Card>
        <Card className="border-border/60 shadow-none cursor-pointer hover:bg-muted/30" onClick={() => setPaymentFilter(paymentFilter === "paid" ? "all" : "paid")}>
          <CardContent className="p-3 flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-emerald-100 flex items-center justify-center"><CreditCard className="h-4 w-4 text-emerald-600" /></div>
            <div><p className="text-xl font-bold text-foreground">{stats.paid}</p><p className="text-[10px] text-muted-foreground">Fee Paid</p></div>
          </CardContent>
        </Card>
        <Card className="border-border/60 shadow-none cursor-pointer hover:bg-muted/30" onClick={() => setStatusFilter(statusFilter === "submitted" ? "all" : "submitted")}>
          <CardContent className="p-3 flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-violet-100 flex items-center justify-center"><CheckCircle className="h-4 w-4 text-violet-600" /></div>
            <div><p className="text-xl font-bold text-foreground">{stats.submitted}</p><p className="text-[10px] text-muted-foreground">Submitted</p></div>
          </CardContent>
        </Card>
        <Card className="border-border/60 shadow-none cursor-pointer hover:bg-muted/30" onClick={() => setStatusFilter(statusFilter === "draft" ? "all" : "draft")}>
          <CardContent className="p-3 flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-amber-100 flex items-center justify-center"><Clock className="h-4 w-4 text-amber-600" /></div>
            <div><p className="text-xl font-bold text-foreground">{stats.draft}</p><p className="text-[10px] text-muted-foreground">Draft</p></div>
          </CardContent>
        </Card>
      </div>

      {/* Search + Filters */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <input type="text" value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search name, phone, app ID, course..."
            className="w-full rounded-xl border border-input bg-background pl-9 pr-3 py-2 text-sm outline-none focus:ring-1 focus:ring-primary" />
        </div>
        <select value={paymentFilter} onChange={e => setPaymentFilter(e.target.value as any)}
          className="rounded-xl border border-input bg-background px-3 py-2 text-sm">
          <option value="all">All Payments</option>
          <option value="paid">Paid</option>
          <option value="pending">Pending</option>
        </select>
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value as any)}
          className="rounded-xl border border-input bg-background px-3 py-2 text-sm">
          <option value="all">All Status</option>
          <option value="draft">Draft</option>
          <option value="submitted">Submitted</option>
        </select>
        {(paymentFilter !== "all" || statusFilter !== "all") && (
          <Button variant="ghost" size="sm" onClick={() => { setPaymentFilter("all"); setStatusFilter("all"); }}>
            <X className="h-3.5 w-3.5 mr-1" />Clear
          </Button>
        )}
      </div>

      {/* Table */}
      <Card className="border-border/60 shadow-none">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                <th className="px-4 py-2.5 text-left font-medium text-muted-foreground w-8"></th>
                <th className="px-3 py-2.5 text-left font-medium text-muted-foreground">App ID</th>
                <th className="px-3 py-2.5 text-left font-medium text-muted-foreground">Name</th>
                <th className="px-3 py-2.5 text-left font-medium text-muted-foreground">Phone</th>
                <th className="px-3 py-2.5 text-left font-medium text-muted-foreground">Course</th>
                <th className="px-3 py-2.5 text-left font-medium text-muted-foreground">Progress</th>
                <th className="px-3 py-2.5 text-left font-medium text-muted-foreground">Payment</th>
                <th className="px-3 py-2.5 text-left font-medium text-muted-foreground">Status</th>
                <th className="px-3 py-2.5 text-left font-medium text-muted-foreground">Date</th>
                <th className="px-3 py-2.5 text-left font-medium text-muted-foreground">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(app => {
                const isExpanded = expandedId === app.id;
                const courses = (app.course_selections || []).map((c: any) => c.course_name).join(", ");
                const cc = completedCount(app.completed_sections);
                const tc = totalCount(app.completed_sections);
                const progressPct = tc > 0 ? Math.round((cc / tc) * 100) : 0;

                return (
                  <tr key={app.id} className="border-b border-border/40 hover:bg-muted/20">
                    <td className="px-4 py-2.5">
                      <button onClick={() => setExpandedId(isExpanded ? null : app.id)} className="text-muted-foreground hover:text-foreground">
                        {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                      </button>
                    </td>
                    <td className="px-3 py-2.5">
                      <span className="font-mono text-xs text-primary">{app.application_id}</span>
                    </td>
                    <td className="px-3 py-2.5">
                      <span className={`font-medium ${app.full_name === "Applicant" ? "text-muted-foreground italic" : "text-foreground"}`}>
                        {app.full_name || "—"}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-muted-foreground text-xs">{app.phone}</td>
                    <td className="px-3 py-2.5 text-xs text-foreground max-w-[200px] truncate">{courses || "—"}</td>
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-2">
                        <div className="w-16 h-1.5 bg-muted rounded-full overflow-hidden">
                          <div className={`h-full rounded-full ${progressPct === 100 ? "bg-emerald-500" : progressPct > 0 ? "bg-blue-500" : "bg-gray-300"}`}
                            style={{ width: `${progressPct}%` }} />
                        </div>
                        <span className="text-[10px] text-muted-foreground">{cc}/{tc}</span>
                      </div>
                    </td>
                    <td className="px-3 py-2.5">
                      <Badge className={`text-[10px] border-0 ${PAYMENT_BADGE[app.payment_status || "pending"] || "bg-gray-100 text-gray-600"}`}>
                        {app.payment_status === "paid" ? `Paid${app.fee_amount ? ` ₹${app.fee_amount}` : ""}` : app.payment_status || "pending"}
                      </Badge>
                    </td>
                    <td className="px-3 py-2.5">
                      <Badge className={`text-[10px] border-0 ${STATUS_BADGE[app.status] || "bg-gray-100 text-gray-600"}`}>
                        {app.status}
                      </Badge>
                    </td>
                    <td className="px-3 py-2.5 text-[10px] text-muted-foreground">
                      {new Date(app.created_at).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "2-digit" })}
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-1">
                        {app.lead_id && (
                          <a href={`/admissions/${app.lead_id}`} target="_blank" rel="noreferrer"
                            className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-primary" title="Open Lead">
                            <ExternalLink className="h-3.5 w-3.5" />
                          </a>
                        )}
                        <button onClick={() => fetchDocs(app.id, app.application_id)}
                          className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-primary" title="View Documents">
                          <Upload className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {filtered.length === 0 && (
                <tr><td colSpan={10} className="px-4 py-12 text-center text-muted-foreground">No applications found</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Expanded row details rendered below the table for simplicity */}
      {expandedId && (() => {
        const app = apps.find(a => a.id === expandedId);
        if (!app) return null;
        const courses = app.course_selections || [];
        const cs = app.completed_sections || {};

        return (
          <Card className="border-primary/30 shadow-none bg-primary/5 animate-fade-in">
            <CardContent className="p-5">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-bold text-foreground">{app.application_id} — {app.full_name}</h3>
                <Button variant="ghost" size="sm" onClick={() => setExpandedId(null)}><X className="h-3.5 w-3.5" /></Button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-6 text-xs">
                {/* Personal Details */}
                <div>
                  <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-2">Personal Details</p>
                  <div className="space-y-1">
                    <p><span className="text-muted-foreground">Name:</span> <span className="font-medium">{app.full_name}</span></p>
                    <p><span className="text-muted-foreground">Phone:</span> <span className="font-medium">{app.phone}</span></p>
                    <p><span className="text-muted-foreground">Email:</span> <span className="font-medium">{app.email || "—"}</span></p>
                    <p><span className="text-muted-foreground">DOB:</span> <span className="font-medium">{app.dob || "—"}</span></p>
                    <p><span className="text-muted-foreground">Gender:</span> <span className="font-medium capitalize">{app.gender || "—"}</span></p>
                    <p><span className="text-muted-foreground">Category:</span> <span className="font-medium">{app.category || "—"}</span></p>
                    {app.address?.city && <p><span className="text-muted-foreground">City:</span> <span className="font-medium">{app.address.city}, {app.address.state}</span></p>}
                  </div>
                </div>

                {/* Course & Payment */}
                <div>
                  <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-2">Course Selections</p>
                  <div className="space-y-1.5">
                    {courses.map((c: any, i: number) => (
                      <div key={i} className="flex items-center gap-1.5">
                        <span className="text-[9px] font-bold text-primary bg-primary/10 px-1.5 py-0.5 rounded">{i + 1}</span>
                        <span className="font-medium">{c.course_name}</span>
                        {c.campus_name && <span className="text-muted-foreground">· {c.campus_name}</span>}
                      </div>
                    ))}
                    {courses.length === 0 && <p className="text-muted-foreground">No courses selected</p>}
                  </div>

                  <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-2 mt-4">Payment</p>
                  <div className="space-y-1">
                    <p><span className="text-muted-foreground">Status:</span> <Badge className={`text-[10px] border-0 ml-1 ${PAYMENT_BADGE[app.payment_status || "pending"]}`}>{app.payment_status || "pending"}</Badge></p>
                    {app.fee_amount && <p><span className="text-muted-foreground">Amount:</span> <span className="font-medium">₹{app.fee_amount.toLocaleString("en-IN")}</span></p>}
                    {app.payment_ref && <p><span className="text-muted-foreground">Ref:</span> <span className="font-mono text-[10px]">{app.payment_ref}</span></p>}
                  </div>
                </div>

                {/* Section Progress */}
                <div>
                  <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-2">Section Progress</p>
                  <div className="space-y-1.5">
                    {Object.entries(cs).map(([key, done]) => (
                      <div key={key} className="flex items-center gap-2">
                        {done ? <CheckCircle className="h-3.5 w-3.5 text-emerald-500" /> : <AlertCircle className="h-3.5 w-3.5 text-amber-400" />}
                        <span className={`capitalize ${done ? "text-foreground" : "text-muted-foreground"}`}>{key.replace(/_/g, " ")}</span>
                      </div>
                    ))}
                  </div>

                  <div className="mt-4 flex gap-2">
                    <Button size="sm" variant="outline" className="text-xs h-7" onClick={() => fetchDocs(app.id, app.application_id)}>
                      <Upload className="h-3 w-3 mr-1" />Documents
                    </Button>
                    {app.lead_id && (
                      <a href={`/admissions/${app.lead_id}`} target="_blank" rel="noreferrer">
                        <Button size="sm" variant="outline" className="text-xs h-7">
                          <ExternalLink className="h-3 w-3 mr-1" />Lead Page
                        </Button>
                      </a>
                    )}
                  </div>

                  {app.flags?.length ? (
                    <div className="mt-3 flex flex-wrap gap-1">
                      {app.flags.map((f, i) => (
                        <Badge key={i} className="text-[9px] border-0 bg-gray-100 text-gray-600">{f}</Badge>
                      ))}
                    </div>
                  ) : null}
                </div>
              </div>
            </CardContent>
          </Card>
        );
      })()}

      {/* Documents Dialog */}
      <Dialog open={!!docsDialog} onOpenChange={() => setDocsDialog(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Upload className="h-4 w-4" />
              Documents — {docsDialog?.applicationId}
            </DialogTitle>
          </DialogHeader>
          {docsLoading ? (
            <div className="flex items-center justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
          ) : docs.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Upload className="h-8 w-8 mx-auto mb-2 opacity-30" />
              <p className="text-sm">No documents uploaded</p>
            </div>
          ) : (
            <div className="space-y-2 max-h-[60vh] overflow-y-auto">
              {docs.map((doc, i) => {
                const isImage = /\.(jpg|jpeg|png|gif|webp)/i.test(doc.name);
                const isPdf = /\.pdf$/i.test(doc.name);
                const label = doc.name.split("-").slice(0, -1).join("-").replace(/_/g, " ") || doc.name;

                return (
                  <div key={i} className="flex items-center justify-between rounded-lg border border-border p-3">
                    <div className="flex items-center gap-3 min-w-0">
                      {isImage ? (
                        <img src={doc.url} alt={doc.name} className="w-10 h-10 rounded object-cover border border-border shrink-0" />
                      ) : (
                        <div className="w-10 h-10 rounded bg-muted flex items-center justify-center shrink-0">
                          <FileText className="h-4 w-4 text-muted-foreground" />
                        </div>
                      )}
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-foreground capitalize truncate">{label}</p>
                        <p className="text-[10px] text-muted-foreground">{isPdf ? "PDF" : isImage ? "Image" : "File"}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <a href={doc.url} target="_blank" rel="noreferrer"
                        className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-primary" title="View">
                        <Eye className="h-3.5 w-3.5" />
                      </a>
                      <a href={doc.url} download
                        className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-primary" title="Download">
                        <Download className="h-3.5 w-3.5" />
                      </a>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
