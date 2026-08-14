// Employee documents, in Keka's shape: a left rail with "Upload pending — N" and
// folders, and a list on the right where each expected document is a row whether or
// not a file exists.
//
// Listing the expected documents rather than the uploaded ones is the whole design.
// A screen that only shows what has been uploaded cannot tell you what is missing,
// which is the question HR is actually asking during onboarding.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { usePermissions } from "@/contexts/PermissionContext";
import { Button } from "@/components/ui/button";
import { ButtonOrb } from "@/components/ui/thinking-orb";
import {
  Upload, FileText, Check, X, AlertTriangle, Search, Download, Clock, FolderOpen,
} from "lucide-react";
import {
  buildSlots, outstanding, mandatoryOutstanding, byFolder, STATUS_LABEL,
  documentPath, type DocSlot, type DocType, type DocRow, type DocStatus,
} from "@/lib/employeeDocuments";

interface Props {
  employeeProfileId: string;
  /** Self-service view: the employee uploads, HR verifies. */
  isSelf?: boolean;
}

const STATUS_STYLE: Record<DocStatus, string> = {
  missing: "bg-muted text-muted-foreground",
  pending: "bg-warning/15 text-warning",
  verified: "bg-success/15 text-success",
  rejected: "bg-destructive/15 text-destructive",
};

export function EmployeeDocuments({ employeeProfileId, isSelf = false }: Props) {
  const { toast } = useToast();
  const { can } = usePermissions();
  const canReview = can("hr", "employees_edit");

  const [types, setTypes] = useState<DocType[]>([]);
  const [docs, setDocs] = useState<DocRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [folder, setFolder] = useState<string | "pending" | "all">("pending");
  const [query, setQuery] = useState("");
  const uploadFor = useRef<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [typeRes, docRes] = await Promise.all([
      supabase.from("employee_document_types")
        .select("code, name, folder, is_mandatory, has_expiry, sort_order")
        .eq("is_active", true),
      supabase.from("employee_documents")
        .select("id, doc_key, file_name, file_path, mime_type, status, review_note, issued_on, expires_on, uploaded_at")
        .eq("employee_id", employeeProfileId),
    ]);
    setTypes((typeRes.data as DocType[]) ?? []);
    setDocs((docRes.data as DocRow[]) ?? []);
    setLoading(false);
  }, [employeeProfileId]);

  useEffect(() => { void load(); }, [load]);

  const slots = useMemo(() => buildSlots(types, docs), [types, docs]);
  const pending = useMemo(() => outstanding(slots), [slots]);
  const mandatoryPending = useMemo(() => mandatoryOutstanding(slots), [slots]);
  const folders = useMemo(() => byFolder(slots), [slots]);

  const visible = useMemo(() => {
    let list = folder === "pending" ? pending : folder === "all" ? slots : slots.filter((s) => s.type.folder === folder);
    if (query.trim()) {
      const q = query.toLowerCase();
      list = list.filter((s) => s.type.name.toLowerCase().includes(q));
    }
    return list;
  }, [folder, slots, pending, query]);

  const pickFile = (docKey: string) => {
    uploadFor.current = docKey;
    fileInput.current?.click();
  };

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    const docKey = uploadFor.current;
    e.target.value = "";
    if (!file || !docKey) return;

    if (file.size > 10 * 1024 * 1024) {
      toast({ title: "Too large", description: "Keep it under 10 MB.", variant: "destructive" });
      return;
    }

    setBusyKey(docKey);
    try {
      const path = documentPath(employeeProfileId, docKey, file.name, Date.now());
      const { error: upErr } = await supabase.storage
        .from("employee-documents").upload(path, file, { contentType: file.type, upsert: true });
      if (upErr) throw upErr;

      // A re-upload replaces the previous row and resets it to pending, so a
      // rejected document stops counting as rejected the moment it is redone.
      const { error } = await supabase.from("employee_documents").upsert({
        employee_id: employeeProfileId,
        doc_key: docKey,
        file_path: path,
        file_url: path,
        file_name: file.name,
        original_file_name: file.name,
        mime_type: file.type || null,
        file_size: file.size,
        storage_provider: "supabase",
        uploaded_source: isSelf ? "careers_portal" : "hr",
        uploaded_by: (await supabase.auth.getUser()).data.user?.id ?? null,
        status: "pending",
        review_note: null,
        verified_by: null,
        verified_at: null,
        uploaded_at: new Date().toISOString(),
      } as never, { onConflict: "employee_id,doc_key" });
      if (error) throw error;

      toast({ title: "Uploaded", description: isSelf ? "HR will review it." : "Marked for review." });
      await load();
    } catch (err) {
      toast({
        title: "Upload failed",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setBusyKey(null);
    }
  };

  const open = async (slot: DocSlot) => {
    if (!slot.doc) return;
    // Private bucket, so a signed URL rather than a public one.
    const { data, error } = await supabase.storage
      .from("employee-documents").createSignedUrl(slot.doc.file_path, 60 * 30);
    if (error || !data?.signedUrl) {
      toast({ title: "Could not open the file", description: error?.message, variant: "destructive" });
      return;
    }
    window.open(data.signedUrl, "_blank", "noopener");
  };

  const review = async (slot: DocSlot, status: "verified" | "rejected") => {
    if (!slot.doc) return;
    let note: string | null = null;
    if (status === "rejected") {
      note = window.prompt(`Why is "${slot.type.name}" being sent back?`)?.trim() || null;
      if (!note) return; // the RPC rejects an empty reason anyway
    }
    setBusyKey(slot.type.code);
    const { error } = await supabase.rpc("review_employee_document", {
      _document_id: slot.doc.id, _status: status, _note: note ?? undefined,
    });
    setBusyKey(null);
    if (error) {
      toast({ title: "Could not save the review", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: status === "verified" ? "Verified" : "Sent back" });
    await load();
  };

  if (loading) {
    return <div className="rounded-xl border border-border p-10 text-center text-sm text-muted-foreground">Loading…</div>;
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[240px_1fr]">
      <input ref={fileInput} type="file" className="hidden"
        accept="image/*,application/pdf" onChange={onFile} />

      {/* Left rail */}
      <aside className="space-y-4">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search"
            className="w-full rounded-lg border border-input bg-background py-1.5 pl-9 pr-3 text-xs focus:outline-none focus:ring-1 focus:ring-ring/20" />
        </div>

        <div>
          <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Actions</p>
          <RailItem active={folder === "pending"} onClick={() => setFolder("pending")}
            icon={<AlertTriangle className={`h-4 w-4 ${pending.length ? "text-warning" : "text-muted-foreground"}`} />}
            title="Upload pending"
            subtitle={pending.length
              ? `${pending.length} document${pending.length === 1 ? "" : "s"}${mandatoryPending.length ? ` · ${mandatoryPending.length} mandatory` : ""}`
              : "Nothing outstanding"} />
          <RailItem active={folder === "all"} onClick={() => setFolder("all")}
            icon={<FileText className="h-4 w-4 text-muted-foreground" />}
            title="All documents" subtitle={`${slots.length} in the list`} />
        </div>

        <div>
          <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Folders</p>
          {folders.map((f) => (
            <RailItem key={f.folder} active={folder === f.folder} onClick={() => setFolder(f.folder)}
              icon={<FolderOpen className="h-4 w-4 text-muted-foreground" />}
              title={f.folder}
              subtitle={`${f.uploaded} of ${f.slots.length} uploaded`} />
          ))}
        </div>
      </aside>

      {/* List */}
      <section className="rounded-xl border border-border">
        <div className="border-b border-border px-4 py-3">
          <h3 className="text-sm font-semibold text-foreground">
            {folder === "pending" ? "Documents pending for upload"
              : folder === "all" ? "All documents" : folder}
          </h3>
          <p className="text-xs text-muted-foreground">
            {folder === "pending"
              ? "Everything not yet uploaded, or sent back for a replacement."
              : `${visible.length} document${visible.length === 1 ? "" : "s"}`}
          </p>
        </div>

        {visible.length === 0 ? (
          <div className="p-10 text-center">
            <Check className="mx-auto mb-2 h-8 w-8 text-success/40" />
            <p className="text-sm text-muted-foreground">
              {folder === "pending" ? "Every expected document is in." : "Nothing here."}
            </p>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {visible.map((slot) => (
              <div key={slot.type.code} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm text-foreground">{slot.type.name}</p>
                    {slot.type.is_mandatory && (
                      <span className="rounded bg-warning/15 px-1.5 py-0.5 text-[10px] font-medium text-warning">Mandatory</span>
                    )}
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${STATUS_STYLE[slot.status]}`}>
                      {STATUS_LABEL[slot.status]}
                    </span>
                    {slot.expiry === "expired" && (
                      <span className="flex items-center gap-1 text-[10px] text-destructive">
                        <Clock className="h-3 w-3" /> Expired
                      </span>
                    )}
                    {slot.expiry === "expiring" && (
                      <span className="flex items-center gap-1 text-[10px] text-warning">
                        <Clock className="h-3 w-3" /> Expires in {slot.daysToExpiry}d
                      </span>
                    )}
                  </div>
                  {slot.doc && (
                    <p className="truncate text-[11px] text-muted-foreground">
                      {slot.doc.file_name} · {new Date(slot.doc.uploaded_at).toLocaleDateString("en-IN")}
                    </p>
                  )}
                  {slot.status === "rejected" && slot.doc?.review_note && (
                    <p className="mt-0.5 text-[11px] text-destructive">Sent back: {slot.doc.review_note}</p>
                  )}
                </div>

                <div className="flex shrink-0 items-center gap-1.5">
                  {slot.doc && (
                    <Button size="sm" variant="ghost" className="h-7 text-[11px]" onClick={() => open(slot)}>
                      <Download className="mr-1 h-3 w-3" /> View
                    </Button>
                  )}
                  {canReview && slot.doc && slot.status !== "verified" && (
                    <Button size="sm" variant="outline" className="h-7 text-[11px]"
                      disabled={busyKey === slot.type.code} onClick={() => review(slot, "verified")}>
                      <Check className="mr-1 h-3 w-3" /> Verify
                    </Button>
                  )}
                  {canReview && slot.doc && slot.status !== "rejected" && (
                    <Button size="sm" variant="ghost" className="h-7 text-[11px] text-muted-foreground hover:text-destructive"
                      disabled={busyKey === slot.type.code} onClick={() => review(slot, "rejected")}>
                      <X className="mr-1 h-3 w-3" /> Send back
                    </Button>
                  )}
                  {(canReview || isSelf) && (
                    <Button size="sm" variant={slot.doc ? "ghost" : "outline"} className="h-7 text-[11px]"
                      disabled={busyKey === slot.type.code} onClick={() => pickFile(slot.type.code)}>
                      {busyKey === slot.type.code ? <ButtonOrb state="working" /> : <Upload className="mr-1 h-3 w-3" />}
                      {slot.doc ? "Replace" : "Add details"}
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

const RailItem = ({ active, onClick, icon, title, subtitle }: {
  active: boolean; onClick: () => void; icon: React.ReactNode; title: string; subtitle: string;
}) => (
  <button onClick={onClick}
    className={`mb-1 flex w-full items-center gap-2.5 rounded-lg border px-2.5 py-2 text-left transition-colors ${
      active ? "border-primary/30 bg-primary/5" : "border-transparent hover:bg-muted/50"}`}>
    {icon}
    <span className="min-w-0">
      <span className="block truncate text-xs font-medium text-foreground">{title}</span>
      <span className="block truncate text-[10px] text-muted-foreground">{subtitle}</span>
    </span>
  </button>
);

export default EmployeeDocuments;
