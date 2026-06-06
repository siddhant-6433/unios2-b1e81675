import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { invokeEdge } from "@/integrations/supabase/edge";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  FileText, Loader2, Upload, ExternalLink, Trash2, ShieldCheck, Car, Heart,
  Wind, Smartphone, BookOpen, BadgeCheck, CreditCard, AlertTriangle,
  ChevronRight, MoreVertical, Pencil,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

type DocType =
  | "health_insurance" | "life_insurance" | "vehicle_insurance" | "vehicle_pollution"
  | "vehicle_rc" | "driving_license" | "passport" | "aadhaar" | "pan" | "other";

interface PersonalDoc {
  id: string;
  owner_email: string;
  doc_type: DocType;
  label: string;
  file_path: string;
  mime_type: string | null;
  source: "web" | "whatsapp";
  issuer: string | null;
  policy_number: string | null;
  vehicle_reg: string | null;
  insured_name: string | null;
  issued_on: string | null;
  expires_on: string | null;
  notes: string | null;
  created_at: string;
}

const TYPE_META: Record<DocType, { label: string; icon: LucideIcon; iconBg: string; iconColor: string; tab: string }> = {
  health_insurance:  { label: "Health Insurance",  icon: Heart,       iconBg: "bg-rose-100",    iconColor: "text-rose-500",   tab: "health" },
  life_insurance:    { label: "Life Insurance",    icon: ShieldCheck, iconBg: "bg-blue-100",    iconColor: "text-blue-500",   tab: "health" },
  vehicle_insurance: { label: "Car Insurance",     icon: Car,         iconBg: "bg-amber-100",   iconColor: "text-amber-600",  tab: "vehicle" },
  vehicle_pollution: { label: "Vehicle PUC",       icon: Wind,        iconBg: "bg-emerald-100", iconColor: "text-emerald-600",tab: "vehicle" },
  vehicle_rc:        { label: "Vehicle RC",        icon: Car,         iconBg: "bg-orange-100",  iconColor: "text-orange-500", tab: "vehicle" },
  driving_license:   { label: "Driving License",   icon: CreditCard,  iconBg: "bg-purple-100",  iconColor: "text-purple-500", tab: "other" },
  passport:          { label: "Passport",          icon: BookOpen,    iconBg: "bg-indigo-100",  iconColor: "text-indigo-500", tab: "other" },
  aadhaar:           { label: "Aadhaar",           icon: BadgeCheck,  iconBg: "bg-green-100",   iconColor: "text-green-600",  tab: "other" },
  pan:               { label: "PAN Card",          icon: BadgeCheck,  iconBg: "bg-orange-100",  iconColor: "text-orange-500", tab: "other" },
  other:             { label: "Other",             icon: FileText,    iconBg: "bg-slate-100",   iconColor: "text-slate-500",  tab: "other" },
};

const TABS = [
  { key: "all",     label: "All" },
  { key: "health",  label: "Health & Life" },
  { key: "vehicle", label: "Vehicle" },
  { key: "other",   label: "Other" },
];

function daysUntil(iso: string | null): number | null {
  if (!iso) return null;
  const ms = new Date(iso + "T00:00:00").getTime() - new Date(new Date().toISOString().slice(0, 10) + "T00:00:00").getTime();
  return Math.round(ms / 86400000);
}

function statusFor(iso: string | null) {
  const d = daysUntil(iso);
  if (d === null) return { label: "No expiry", color: "text-muted-foreground", badge: "outline" as const };
  if (d < 0)     return { label: `Expired ${-d}d ago`, color: "text-red-500", badge: "destructive" as const };
  if (d <= 7)    return { label: `Expires in ${d}d`, color: "text-red-500", badge: "destructive" as const };
  if (d <= 30)   return { label: `Expires in ${d}d`, color: "text-amber-600", badge: "secondary" as const };
  return { label: `Valid ${d}d`, color: "text-emerald-600", badge: "default" as const };
}

const MyDocs = () => {
  const { user, loading, role, roleLoaded, profile } = useAuth();
  const { toast } = useToast();
  const [docs, setDocs] = useState<PersonalDoc[]>([]);
  const [loadingDocs, setLoadingDocs] = useState(true);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [tab, setTab] = useState("all");

  const allowed = role === "super_admin";
  const waPhone = profile?.phone || null;

  const refresh = useCallback(async () => {
    if (!user?.email) return;
    setLoadingDocs(true);
    const { data, error } = await supabase
      .from("personal_documents")
      .select("*")
      .order("expires_on", { ascending: true, nullsFirst: false });
    if (error) {
      toast({ title: "Couldn't load documents", description: error.message, variant: "destructive" });
    } else {
      setDocs((data || []) as PersonalDoc[]);
    }
    setLoadingDocs(false);
  }, [user?.email, toast]);

  useEffect(() => { if (allowed && roleLoaded) refresh(); }, [allowed, roleLoaded, refresh]);

  const filtered = useMemo(() => {
    if (tab === "all") return docs;
    return docs.filter(d => TYPE_META[d.doc_type].tab === tab);
  }, [docs, tab]);

  const expiringSoon = useMemo(
    () => docs.filter(d => { const n = daysUntil(d.expires_on); return n !== null && n <= 30; }),
    [docs],
  );

  if (loading || !roleLoaded) {
    return <div className="flex items-center justify-center h-screen"><Loader2 className="animate-spin" /></div>;
  }

  if (!allowed) {
    return (
      <div className="max-w-md mx-auto mt-24 text-center space-y-4 p-6">
        <ShieldCheck className="mx-auto h-12 w-12 text-muted-foreground" />
        <h1 className="text-xl font-semibold">Personal Dashboard</h1>
        <p className="text-muted-foreground text-sm">This dashboard is restricted. Your account doesn't have access.</p>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto p-6 space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Your Policies</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Manage your documents & renewals</p>
        </div>
        <Button onClick={() => setUploadOpen(true)} className="gap-2">
          <Upload className="h-4 w-4" /> Upload document
        </Button>
      </div>

      {/* Expiring soon banner */}
      {expiringSoon.length > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 flex items-start gap-3">
          <AlertTriangle className="h-4 w-4 text-amber-500 mt-0.5 shrink-0" />
          <div className="text-sm text-amber-900">
            <span className="font-medium">{expiringSoon.length} document{expiringSoon.length > 1 ? "s" : ""} expiring soon — </span>
            {expiringSoon.map(d => d.label).join(", ")}
          </div>
        </div>
      )}

      {/* WhatsApp hint */}
      {waPhone && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 px-4 py-3 flex items-start gap-3">
          <Smartphone className="h-4 w-4 text-emerald-600 mt-0.5 shrink-0" />
          <div className="text-sm text-emerald-900">
            <span className="font-medium">Forward documents on WhatsApp</span>
            <span className="text-emerald-800/80"> — send a photo or PDF from </span>
            <b>{waPhone}</b>
            <span className="text-emerald-800/80"> to </span>
            <b>+91 96676 41872</b>
            <span className="text-emerald-800/80"> with caption </span>
            <code className="px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-900 text-xs">#mydoc</code>
          </div>
        </div>
      )}

      {/* Tab filter */}
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="h-9">
          {TABS.map(t => (
            <TabsTrigger key={t.key} value={t.key} className="text-sm px-4">
              {t.label}
              {t.key !== "all" && (
                <span className="ml-1.5 text-xs text-muted-foreground">
                  {docs.filter(d => TYPE_META[d.doc_type].tab === t.key).length || ""}
                </span>
              )}
              {t.key === "all" && (
                <span className="ml-1.5 text-xs text-muted-foreground">{docs.length || ""}</span>
              )}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {/* Document list */}
      {loadingDocs ? (
        <div className="flex items-center justify-center h-40"><Loader2 className="animate-spin" /></div>
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center text-muted-foreground text-sm">
            {docs.length === 0
              ? "No documents yet. Upload your first one above, or forward via WhatsApp."
              : "No documents in this category."}
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {filtered.map(d => <DocRow key={d.id} doc={d} onChanged={refresh} />)}
        </div>
      )}

      <UploadDialog
        open={uploadOpen}
        onOpenChange={setUploadOpen}
        ownerEmail={user!.email!}
        onUploaded={() => { setUploadOpen(false); refresh(); }}
      />
    </div>
  );
};

/* ── Single document row ─────────────────────────────────────────────────── */
const DocRow = ({ doc, onChanged }: { doc: PersonalDoc; onChanged: () => void }) => {
  const status = statusFor(doc.expires_on);
  const meta = TYPE_META[doc.doc_type];
  const Icon = meta.icon;
  const { toast } = useToast();
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const isVehicle = doc.doc_type === "vehicle_insurance" || doc.doc_type === "vehicle_pollution" || doc.doc_type === "vehicle_rc";
  const isHealthOrLife = doc.doc_type === "health_insurance" || doc.doc_type === "life_insurance";

  // Primary identifying subtitle: vehicle reg, insured name, policy number, or issuer
  const subtitle = isVehicle && doc.vehicle_reg
    ? doc.vehicle_reg
    : isHealthOrLife && doc.insured_name
      ? doc.insured_name
      : doc.policy_number || doc.issuer || null;

  const openFile = async () => {
    const { data } = await supabase.storage.from("personal-documents").createSignedUrl(doc.file_path, 60 * 30);
    if (data?.signedUrl) window.open(data.signedUrl, "_blank");
  };

  const remove = async () => {
    await supabase.storage.from("personal-documents").remove([doc.file_path]).catch(() => {});
    const { error } = await supabase.from("personal_documents").delete().eq("id", doc.id);
    if (error) {
      toast({ title: "Delete failed", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Deleted" });
      onChanged();
    }
    setConfirmDelete(false);
  };

  return (
    <>
      <div className="group flex items-center gap-4 rounded-xl border bg-white px-4 py-3.5 hover:shadow-sm transition-shadow">
        {/* Left: type icon */}
        <div className={`shrink-0 flex items-center justify-center w-11 h-11 rounded-xl ${meta.iconBg}`}>
          <Icon className={`h-5 w-5 ${meta.iconColor}`} />
        </div>

        {/* Middle: info */}
        <div className="flex-1 min-w-0">
          <div className="text-[11px] font-medium uppercase tracking-widest text-muted-foreground mb-0.5">
            {meta.label}
            {doc.source === "whatsapp" && (
              <span className="ml-2 normal-case tracking-normal text-[10px] text-emerald-600">· WhatsApp</span>
            )}
          </div>
          <div className="font-semibold text-sm leading-snug truncate">{doc.label}</div>
          {subtitle && (
            <div className={`text-sm mt-0.5 truncate ${isVehicle && doc.vehicle_reg ? "font-mono tracking-wide text-foreground/80" : "text-foreground/70"}`}>
              {subtitle}
            </div>
          )}
          <div className="text-xs text-muted-foreground mt-1">
            {doc.expires_on
              ? `Expires ${new Date(doc.expires_on + "T00:00:00").toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}`
              : "No expiry on file"}
          </div>
        </div>

        {/* Right: status + actions */}
        <div className="shrink-0 flex items-center gap-2">
          <span className={`text-xs font-medium whitespace-nowrap ${status.color}`}>{status.label}</span>
          <Button size="sm" variant="outline" className="h-7 px-2.5 text-xs gap-1 opacity-0 group-hover:opacity-100 transition-opacity" onClick={openFile}>
            <ExternalLink className="h-3.5 w-3.5" /> View
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="icon" variant="ghost" className="h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity">
                <MoreVertical className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => setEditing(true)}>
                <Pencil className="h-4 w-4 mr-2" /> Edit details
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => setConfirmDelete(true)} className="text-red-600 focus:text-red-600">
                <Trash2 className="h-4 w-4 mr-2" /> Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <ChevronRight className="h-4 w-4 text-muted-foreground/50" />
        </div>
      </div>

      <EditDialog open={editing} onOpenChange={setEditing} doc={doc} onSaved={() => { setEditing(false); onChanged(); }} />

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this document?</AlertDialogTitle>
            <AlertDialogDescription>This removes the file and its record permanently.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={remove}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};

/* ── Upload dialog ───────────────────────────────────────────────────────── */
interface ExtractResult {
  doc_type: DocType;
  label: string;
  issuer: string | null;
  policy_number: string | null;
  vehicle_reg: string | null;
  insured_name: string | null;
  issued_on: string | null;
  expires_on: string | null;
  raw: unknown;
}

const UploadDialog = ({
  open, onOpenChange, ownerEmail, onUploaded,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  ownerEmail: string;
  onUploaded: () => void;
}) => {
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [filePath, setFilePath] = useState<string | null>(null);
  const [form, setForm] = useState<ExtractResult | null>(null);
  const [typeHint, setTypeHint] = useState<DocType | "auto">("auto");

  const reset = () => {
    setFile(null); setUploading(false); setExtracting(false);
    setFilePath(null); setForm(null); setTypeHint("auto");
  };

  useEffect(() => { if (!open) reset(); }, [open]);

  const onPick = (f: File | null) => {
    if (!f) return;
    if (!/^image\/|application\/pdf/.test(f.type)) {
      toast({ title: "Unsupported file", description: "Please upload an image or PDF.", variant: "destructive" });
      return;
    }
    setFile(f);
  };

  const upload = async () => {
    if (!file) return;
    setUploading(true);
    let uploadedPath: string | null = null;
    try {
      const ext = file.name.split(".").pop()?.toLowerCase() || (file.type === "application/pdf" ? "pdf" : "jpg");
      const id = crypto.randomUUID();
      const path = `${ownerEmail}/${id}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from("personal-documents")
        .upload(path, file, { contentType: file.type, upsert: false });
      if (upErr) throw upErr;
      uploadedPath = path;

      setExtracting(true);
      const { data, error } = await invokeEdge<ExtractResult>("extract-personal-doc", {
        body: { file_path: path, doc_type_hint: typeHint === "auto" ? undefined : typeHint },
      });
      if (error) throw new Error(error.message);
      if (!data) throw new Error("No extraction result returned.");

      setFilePath(path);
      setForm(data);
    } catch (e: unknown) {
      if (uploadedPath) {
        await supabase.storage.from("personal-documents").remove([uploadedPath]).catch(() => {});
      }
      const message = e instanceof Error ? e.message : String(e);
      toast({
        title: uploadedPath ? "Extraction failed" : "Upload failed",
        description: message,
        variant: "destructive",
      });
    } finally {
      setUploading(false);
      setExtracting(false);
    }
  };

  const save = async () => {
    if (!form || !filePath || !file) return;
    const { error } = await supabase.from("personal_documents").insert({
      owner_email: ownerEmail,
      doc_type: form.doc_type,
      label: form.label,
      file_path: filePath,
      mime_type: file.type,
      source: "web",
      issuer: form.issuer,
      policy_number: form.policy_number,
      vehicle_reg: form.vehicle_reg,
      insured_name: form.insured_name,
      issued_on: form.issued_on,
      expires_on: form.expires_on,
      raw_extracted: form.raw,
    });
    if (error) {
      toast({ title: "Save failed", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Document saved" });
    onUploaded();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Upload document</DialogTitle>
          <DialogDescription>We'll auto-extract issuer, policy number and expiry — review before saving.</DialogDescription>
        </DialogHeader>

        {!form && (
          <div className="space-y-4">
            <div
              className="border-2 border-dashed rounded-xl p-8 text-center cursor-pointer hover:bg-accent/30 transition-colors"
              onClick={() => fileRef.current?.click()}
              onDragOver={e => e.preventDefault()}
              onDrop={e => { e.preventDefault(); onPick(e.dataTransfer.files?.[0] || null); }}
            >
              <Upload className="h-6 w-6 mx-auto text-muted-foreground" />
              <div className="text-sm mt-2 font-medium">{file ? file.name : "Click to choose or drop a file"}</div>
              <div className="text-xs text-muted-foreground mt-1">PDF or image, up to ~10 MB</div>
              <input ref={fileRef} type="file" accept="image/*,application/pdf" className="hidden"
                     onChange={e => onPick(e.target.files?.[0] || null)} />
            </div>

            <div className="space-y-1.5">
              <Label>Type hint (optional)</Label>
              <Select value={typeHint} onValueChange={v => setTypeHint(v as DocType | "auto")}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="auto">Auto-detect</SelectItem>
                  {(Object.keys(TYPE_META) as DocType[]).map(t => (
                    <SelectItem key={t} value={t}>{TYPE_META[t].label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        )}

        {form && <ReviewForm value={form} onChange={setForm} />}

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          {!form ? (
            <Button onClick={upload} disabled={!file || uploading || extracting} className="gap-2">
              {(uploading || extracting) && <Loader2 className="h-4 w-4 animate-spin" />}
              {extracting ? "Extracting…" : uploading ? "Uploading…" : "Upload & extract"}
            </Button>
          ) : (
            <Button onClick={save}>Save document</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

/* ── Review / edit form ──────────────────────────────────────────────────── */
const ReviewForm = ({
  value, onChange,
}: { value: ExtractResult; onChange: (v: ExtractResult) => void }) => {
  const set = <K extends keyof ExtractResult>(k: K, v: ExtractResult[K]) => onChange({ ...value, [k]: v });
  return (
    <div className="grid grid-cols-2 gap-3">
      <div className="col-span-2 space-y-1.5">
        <Label>Label</Label>
        <Input value={value.label} onChange={e => set("label", e.target.value)} />
      </div>
      <div className="space-y-1.5">
        <Label>Type</Label>
        <Select value={value.doc_type} onValueChange={v => set("doc_type", v as DocType)}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            {(Object.keys(TYPE_META) as DocType[]).map(t => (
              <SelectItem key={t} value={t}>{TYPE_META[t].label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1.5">
        <Label>Issuer</Label>
        <Input value={value.issuer || ""} onChange={e => set("issuer", e.target.value || null)} />
      </div>
      <div className="space-y-1.5">
        <Label>Policy #</Label>
        <Input value={value.policy_number || ""} onChange={e => set("policy_number", e.target.value || null)} />
      </div>
      <div className="space-y-1.5">
        <Label>Vehicle reg</Label>
        <Input value={value.vehicle_reg || ""} onChange={e => set("vehicle_reg", e.target.value.toUpperCase() || null)} />
      </div>
      <div className="space-y-1.5">
        <Label>Issued on</Label>
        <Input type="date" value={value.issued_on || ""} onChange={e => set("issued_on", e.target.value || null)} />
      </div>
      <div className="space-y-1.5">
        <Label>Expires on</Label>
        <Input type="date" value={value.expires_on || ""} onChange={e => set("expires_on", e.target.value || null)} />
      </div>
      <div className="col-span-2 space-y-1.5">
        <Label>Insured / cardholder name</Label>
        <Input value={value.insured_name || ""} onChange={e => set("insured_name", e.target.value || null)} />
      </div>
    </div>
  );
};

/* ── Edit dialog ─────────────────────────────────────────────────────────── */
const EditDialog = ({
  open, onOpenChange, doc, onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  doc: PersonalDoc;
  onSaved: () => void;
}) => {
  const { toast } = useToast();
  const [form, setForm] = useState<ExtractResult>(() => toForm(doc));
  const [notes, setNotes] = useState<string>(doc.notes || "");
  useEffect(() => { setForm(toForm(doc)); setNotes(doc.notes || ""); }, [doc]);

  const save = async () => {
    const { error } = await supabase.from("personal_documents").update({
      doc_type: form.doc_type,
      label: form.label,
      issuer: form.issuer,
      policy_number: form.policy_number,
      vehicle_reg: form.vehicle_reg,
      insured_name: form.insured_name,
      issued_on: form.issued_on,
      expires_on: form.expires_on,
      notes: notes || null,
    }).eq("id", doc.id);
    if (error) {
      toast({ title: "Save failed", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Saved" });
    onSaved();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>Edit document</DialogTitle></DialogHeader>
        <ReviewForm value={form} onChange={setForm} />
        <div className="space-y-1.5 mt-3">
          <Label>Notes</Label>
          <Textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3} />
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={save}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

function toForm(doc: PersonalDoc): ExtractResult {
  return {
    doc_type: doc.doc_type,
    label: doc.label,
    issuer: doc.issuer,
    policy_number: doc.policy_number,
    vehicle_reg: doc.vehicle_reg,
    insured_name: doc.insured_name,
    issued_on: doc.issued_on,
    expires_on: doc.expires_on,
    raw: null,
  };
}

export default MyDocs;
