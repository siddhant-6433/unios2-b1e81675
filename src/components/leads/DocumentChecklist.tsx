import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Upload, Check, X, FileText, Loader2, Eye, AlertTriangle, ShieldCheck,
} from "lucide-react";

interface ChecklistItem {
  id: string;
  document_name: string;
  is_required: boolean;
  sort_order: number;
}

interface LeadDocument {
  id: string;
  checklist_item_id: string | null;
  document_name: string;
  file_url: string | null;
  file_name: string | null;
  status: string;
  rejection_reason: string | null;
  uploaded_at: string | null;
  verified_at: string | null;
}

interface DocumentRow {
  checklist_item_id: string;
  document_name: string;
  is_required: boolean;
  doc: LeadDocument | null;
}

interface Props {
  leadId: string;
  courseId: string | null;
}

const STATUS_CONFIG: Record<string, { label: string; badge: string; icon: typeof Check }> = {
  pending: { label: "Pending", badge: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400", icon: FileText },
  uploaded: { label: "Uploaded", badge: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400", icon: Upload },
  verified: { label: "Verified", badge: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400", icon: ShieldCheck },
  rejected: { label: "Rejected", badge: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400", icon: X },
};

export function DocumentChecklist({ leadId, courseId }: Props) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [rows, setRows] = useState<DocumentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState<string | null>(null);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState("");

  const fetchData = async () => {
    if (!courseId) {
      setLoading(false);
      return;
    }

    const [checklistRes, docsRes] = await Promise.all([
      supabase
        .from("document_checklists" as any)
        .select("*")
        .eq("course_id", courseId)
        .order("sort_order"),
      supabase
        .from("lead_documents" as any)
        .select("*")
        .eq("lead_id", leadId),
    ]);

    const checklist: ChecklistItem[] = (checklistRes.data || []) as any;
    const docs: LeadDocument[] = (docsRes.data || []) as any;

    const merged: DocumentRow[] = checklist.map((item) => ({
      checklist_item_id: item.id,
      document_name: item.document_name,
      is_required: item.is_required,
      doc: docs.find((d) => d.checklist_item_id === item.id) || null,
    }));

    setRows(merged);
    setLoading(false);
  };

  useEffect(() => {
    fetchData();
  }, [leadId, courseId]);

  const handleUpload = async (checklistItemId: string, documentName: string, file: File) => {
    setUploading(checklistItemId);

    const filePath = `${leadId}/${checklistItemId}_${Date.now()}_${file.name}`;
    const { error: uploadErr } = await supabase.storage
      .from("lead-documents")
      .upload(filePath, file);

    if (uploadErr) {
      toast({ title: "Upload failed", description: uploadErr.message, variant: "destructive" });
      setUploading(null);
      return;
    }

    const { data: urlData } = supabase.storage.from("lead-documents").getPublicUrl(filePath);

    // Check if document already exists for this checklist item
    const existing = rows.find((r) => r.checklist_item_id === checklistItemId)?.doc;

    if (existing) {
      await supabase
        .from("lead_documents" as any)
        .update({
          file_url: urlData.publicUrl,
          file_name: file.name,
          file_size: file.size,
          status: "uploaded",
          rejection_reason: null,
          uploaded_at: new Date().toISOString(),
        } as any)
        .eq("id", existing.id);
    } else {
      await supabase.from("lead_documents" as any).insert({
        lead_id: leadId,
        checklist_item_id: checklistItemId,
        document_name: documentName,
        file_url: urlData.publicUrl,
        file_name: file.name,
        file_size: file.size,
        status: "uploaded",
      } as any);
    }

    // Log activity
    await supabase.from("lead_activities").insert({
      lead_id: leadId,
      user_id: user?.id || null,
      type: "info_update",
      description: `Document uploaded: ${documentName}`,
    });

    setUploading(null);
    fetchData();
  };

  const handleVerify = async (docId: string, docName: string) => {
    let profileId: string | null = null;
    if (user?.id) {
      const { data: p } = await supabase.from("profiles").select("id").eq("user_id", user.id).single();
      profileId = p?.id || null;
    }

    await supabase
      .from("lead_documents" as any)
      .update({
        status: "verified",
        verified_by: profileId,
        verified_at: new Date().toISOString(),
        rejection_reason: null,
      } as any)
      .eq("id", docId);

    await supabase.from("lead_activities").insert({
      lead_id: leadId,
      user_id: user?.id || null,
      type: "info_update",
      description: `Document verified: ${docName}`,
    });

    fetchData();
  };

  const handleReject = async (docId: string, docName: string) => {
    if (!rejectReason.trim()) return;

    await supabase
      .from("lead_documents" as any)
      .update({
        status: "rejected",
        rejection_reason: rejectReason.trim(),
      } as any)
      .eq("id", docId);

    await supabase.from("lead_activities").insert({
      lead_id: leadId,
      user_id: user?.id || null,
      type: "info_update",
      description: `Document rejected: ${docName} — ${rejectReason.trim()}`,
    });

    setRejectingId(null);
    setRejectReason("");
    fetchData();
  };

  if (loading) {
    return <div className="flex h-20 items-center justify-center"><Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /></div>;
  }

  if (!courseId) {
    return <p className="text-sm text-muted-foreground text-center py-8">No course assigned — document checklist unavailable</p>;
  }

  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground text-center py-8">No document checklist configured for this course</p>;
  }

  const requiredMissing = rows.filter((r) => r.is_required && (!r.doc || r.doc.status === "pending" || r.doc.status === "rejected"));
  const verifiedCount = rows.filter((r) => r.doc?.status === "verified").length;

  return (
    <div className="space-y-3">
      {/* Summary */}
      <div className="flex items-center gap-3 text-xs">
        <Badge className="bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400 border-0 font-semibold">
          {verifiedCount}/{rows.length} verified
        </Badge>
        {requiredMissing.length > 0 && (
          <Badge className="bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 border-0 font-semibold">
            <AlertTriangle className="h-2.5 w-2.5 mr-0.5" />
            {requiredMissing.length} required missing
          </Badge>
        )}
      </div>

      {/* Document list */}
      <div className="space-y-2">
        {rows.map((row) => {
          const cfg = STATUS_CONFIG[row.doc?.status || "pending"];
          const StatusIcon = cfg.icon;

          return (
            <div key={row.checklist_item_id} className="rounded-lg border border-border/60 px-3 py-2.5">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <StatusIcon className={`h-4 w-4 flex-shrink-0 ${
                    row.doc?.status === "verified" ? "text-emerald-500" :
                    row.doc?.status === "rejected" ? "text-red-500" :
                    row.doc?.status === "uploaded" ? "text-blue-500" : "text-muted-foreground"
                  }`} />
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-sm font-medium text-foreground truncate">{row.document_name}</span>
                      {row.is_required && (
                        <span className="text-[9px] text-red-500 font-bold uppercase flex-shrink-0">Required</span>
                      )}
                    </div>
                    {row.doc?.file_name && (
                      <p className="text-[10px] text-muted-foreground truncate">{row.doc.file_name}</p>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-1.5 flex-shrink-0">
                  <Badge className={`text-[9px] font-semibold border-0 ${cfg.badge}`}>{cfg.label}</Badge>

                  {/* View button */}
                  {row.doc?.file_url && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      onClick={() => window.open(row.doc!.file_url!, "_blank")}
                    >
                      <Eye className="h-3.5 w-3.5" />
                    </Button>
                  )}

                  {/* Verify / Reject buttons */}
                  {row.doc && (row.doc.status === "uploaded" || row.doc.status === "rejected") && (
                    <>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50"
                        onClick={() => handleVerify(row.doc!.id, row.document_name)}
                        title="Verify"
                      >
                        <Check className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-red-600 hover:text-red-700 hover:bg-red-50"
                        onClick={() => setRejectingId(row.doc!.id)}
                        title="Reject"
                      >
                        <X className="h-3.5 w-3.5" />
                      </Button>
                    </>
                  )}

                  {/* Upload button */}
                  <label className="cursor-pointer">
                    <input
                      type="file"
                      className="hidden"
                      accept=".pdf,.jpg,.jpeg,.png,.doc,.docx"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) handleUpload(row.checklist_item_id, row.document_name, f);
                        e.target.value = "";
                      }}
                    />
                    <div className={`flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:text-primary hover:bg-primary/5 transition-colors ${uploading === row.checklist_item_id ? "pointer-events-none" : ""}`}>
                      {uploading === row.checklist_item_id ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Upload className="h-3.5 w-3.5" />
                      )}
                    </div>
                  </label>
                </div>
              </div>

              {/* Rejection reason */}
              {row.doc?.status === "rejected" && row.doc.rejection_reason && (
                <p className="text-[10px] text-red-600 mt-1.5 ml-6">Reason: {row.doc.rejection_reason}</p>
              )}

              {/* Reject reason input */}
              {rejectingId === row.doc?.id && (
                <div className="flex items-center gap-2 mt-2 ml-6">
                  <input
                    type="text"
                    value={rejectReason}
                    onChange={(e) => setRejectReason(e.target.value)}
                    placeholder="Rejection reason..."
                    className="flex-1 rounded-lg border border-input bg-background px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-ring/20"
                    autoFocus
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleReject(row.doc!.id, row.document_name);
                      if (e.key === "Escape") { setRejectingId(null); setRejectReason(""); }
                    }}
                  />
                  <Button size="sm" variant="destructive" className="h-7 text-xs" onClick={() => handleReject(row.doc!.id, row.document_name)}>
                    Reject
                  </Button>
                  <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => { setRejectingId(null); setRejectReason(""); }}>
                    Cancel
                  </Button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
