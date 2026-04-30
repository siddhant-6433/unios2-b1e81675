import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Upload, X, Plus, Image as ImageIcon, FileImage, Save, Star, Eye } from "lucide-react";

interface Branding {
  id: string;
  slug: string;
  name: string;
  letterhead_url: string | null;
  footer_url: string | null;
  signature_url: string | null;
  signatory_name: string | null;
  signatory_designation: string | null;
  address: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  website: string | null;
  gstin: string | null;
  is_default: boolean;
  applies_to: string[];
  updated_at: string;
}

const DOC_TYPES: { value: string; label: string }[] = [
  { value: "all",                label: "All documents" },
  { value: "offer_letter",       label: "Offer Letter" },
  { value: "receipt",            label: "Payment Receipt" },
  { value: "admission_letter",   label: "Admission Letter" },
  { value: "application_form",   label: "Application Form" },
  { value: "transcript",         label: "Transcript" },
  { value: "bona_fide",          label: "Bona Fide" },
];

const ASSET_FIELDS: { key: keyof Branding; label: string; hint: string }[] = [
  { key: "letterhead_url", label: "Letterhead (A4)", hint: "Background image used as the page backdrop. PNG / JPG, A4-aspect (210×297mm)." },
  { key: "footer_url",     label: "Footer band",    hint: "Optional separate footer image. Leave blank to use the bottom of the letterhead instead." },
  { key: "signature_url",  label: "Signature",      hint: "Authority's signature. Transparent PNG works best. ~120×60 px on the page." },
];

export function BrandingPanel() {
  const { toast } = useToast();
  const [rows, setRows] = useState<Branding[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState<string | null>(null); // "<id>:<field>"
  const [saving, setSaving] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [newSlug, setNewSlug] = useState("");
  const [newName, setNewName] = useState("");
  const [previewing, setPreviewing] = useState<{ slug: string; name: string } | null>(null);
  const [previewDocType, setPreviewDocType] = useState<string>("offer_letter");
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    const { data } = await supabase.from("institution_branding").select("*").order("is_default", { ascending: false }).order("name");
    setRows((data ?? []) as Branding[]);
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const updateField = async (id: string, field: keyof Branding, value: any) => {
    setSaving(id);
    const { error } = await supabase.from("institution_branding").update({ [field]: value }).eq("id", id);
    setSaving(null);
    if (error) toast({ title: "Save failed", description: error.message, variant: "destructive" });
    else load();
  };

  const handleUpload = async (row: Branding, field: "letterhead_url" | "footer_url" | "signature_url", file: File) => {
    setUploading(`${row.id}:${field}`);
    try {
      const ext = file.name.split(".").pop() || "png";
      const path = `branding/${row.slug}/${field}-${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from("application-documents")
        .upload(path, file, { contentType: file.type, upsert: true });
      if (upErr) throw upErr;
      const { data: pub } = supabase.storage.from("application-documents").getPublicUrl(path);
      await updateField(row.id, field, pub?.publicUrl || path);
    } catch (e: any) {
      toast({ title: "Upload failed", description: e.message, variant: "destructive" });
    } finally {
      setUploading(null);
    }
  };

  const setDefault = async (id: string) => {
    setSaving(id);
    // Clear current default first (constraint is partial-unique, so two trues simultaneously fail).
    await supabase.from("institution_branding").update({ is_default: false }).eq("is_default", true);
    const { error } = await supabase.from("institution_branding").update({ is_default: true }).eq("id", id);
    setSaving(null);
    if (error) toast({ title: "Save failed", description: error.message, variant: "destructive" });
    else load();
  };

  const addNew = async () => {
    if (!newSlug.trim() || !newName.trim()) return;
    const { error } = await supabase.from("institution_branding").insert({
      slug: newSlug.trim().toLowerCase().replace(/\s+/g, "_"),
      name: newName.trim(),
    });
    if (error) { toast({ title: "Create failed", description: error.message, variant: "destructive" }); return; }
    setShowAdd(false); setNewSlug(""); setNewName("");
    load();
  };

  const inputCls = "w-full rounded-xl border border-input bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring/20";

  const fetchPreview = async (slug: string, docType: string) => {
    setPreviewLoading(true);
    if (previewUrl) { URL.revokeObjectURL(previewUrl); setPreviewUrl(null); }
    try {
      const { data, error } = await supabase.functions.invoke("preview-document", {
        body: { slug, doc_type: docType },
      });
      if (error) throw error;
      const blob = data instanceof Blob ? data : new Blob([data as any], { type: "application/pdf" });
      setPreviewUrl(URL.createObjectURL(blob));
    } catch (e: any) {
      toast({ title: "Preview failed", description: e?.message, variant: "destructive" });
    } finally {
      setPreviewLoading(false);
    }
  };

  const openPreview = (row: Branding, docType: string) => {
    setPreviewing({ slug: row.slug, name: row.name });
    setPreviewDocType(docType);
    fetchPreview(row.slug, docType);
  };

  const changePreviewDocType = (docType: string) => {
    if (!previewing) return;
    setPreviewDocType(docType);
    fetchPreview(previewing.slug, docType);
  };

  const closePreview = () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
    setPreviewing(null);
  };

  if (loading) {
    return <div className="flex items-center justify-center py-12"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-foreground">Institution Branding</h2>
          <p className="text-xs text-muted-foreground">Letterheads, signatures, and address blocks used by offer letters, payment receipts, and admission documents.</p>
        </div>
        <button
          onClick={() => setShowAdd(true)}
          className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          <Plus className="h-4 w-4" /> Add Institution
        </button>
      </div>

      {showAdd && (
        <div className="rounded-2xl border border-border bg-card p-4 space-y-3">
          <h3 className="text-sm font-semibold">New institution branding</h3>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-medium text-muted-foreground mb-1">Slug</label>
              <input value={newSlug} onChange={e => setNewSlug(e.target.value)} className={inputCls} placeholder="nimt_school" />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-muted-foreground mb-1">Display Name</label>
              <input value={newName} onChange={e => setNewName(e.target.value)} className={inputCls} placeholder="NIMT School" />
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={addNew} disabled={!newSlug.trim() || !newName.trim()} className="rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50">Create</button>
            <button onClick={() => { setShowAdd(false); setNewSlug(""); setNewName(""); }} className="rounded-lg border border-input px-3 py-1.5 text-xs font-medium text-muted-foreground">Cancel</button>
          </div>
        </div>
      )}

      <div className="space-y-4">
        {rows.map(row => (
          <div key={row.id} className="rounded-2xl border border-border bg-card p-5 space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1 space-y-1.5">
                <div className="flex items-center gap-2 flex-wrap">
                  <BlurInput
                    label=""
                    value={row.name}
                    onSave={v => updateField(row.id, "name", v || row.name)}
                    inline
                  />
                  <span className="font-mono text-[10px] bg-muted px-1.5 py-0.5 rounded text-muted-foreground">{row.slug}</span>
                  {row.is_default && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 dark:bg-amber-950/40 px-2 py-0.5 text-[10px] font-semibold text-amber-700 dark:text-amber-400">
                      <Star className="h-2.5 w-2.5" /> Default
                    </span>
                  )}
                </div>
                {/* Applies-to pills + multi-select */}
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Use for</span>
                  {(row.applies_to || []).map(t => (
                    <button
                      key={t}
                      onClick={() => updateField(row.id, "applies_to", row.applies_to.filter(x => x !== t))}
                      className="inline-flex items-center gap-1 rounded-full bg-primary/10 text-primary px-2 py-0.5 text-[10px] font-medium hover:bg-primary/20"
                      title="Click to remove"
                    >
                      {DOC_TYPES.find(d => d.value === t)?.label || t}
                      <X className="h-2.5 w-2.5" />
                    </button>
                  ))}
                  <select
                    value=""
                    onChange={(e) => {
                      const v = e.target.value;
                      if (!v) return;
                      const next = Array.from(new Set([...(row.applies_to || []), v]));
                      updateField(row.id, "applies_to", next);
                    }}
                    className="rounded-full border border-dashed border-input bg-background px-2 py-0.5 text-[10px] font-medium text-muted-foreground hover:bg-muted"
                  >
                    <option value="">+ Add doc type</option>
                    {DOC_TYPES.filter(d => !(row.applies_to || []).includes(d.value)).map(d => (
                      <option key={d.value} value={d.value}>{d.label}</option>
                    ))}
                  </select>
                </div>
                <p className="text-[10px] text-muted-foreground/70">Last updated {new Date(row.updated_at).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}</p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  onClick={() => openPreview(row, (row.applies_to || []).find(t => t !== "all") || "offer_letter")}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-input bg-card px-2.5 py-1 text-[11px] font-medium text-foreground hover:bg-muted"
                >
                  <Eye className="h-3 w-3" /> Preview
                </button>
                {!row.is_default && (
                  <button onClick={() => setDefault(row.id)} disabled={saving === row.id} className="text-xs text-muted-foreground hover:text-amber-600 underline">
                    Make default
                  </button>
                )}
              </div>
            </div>

            {/* Asset uploads */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {ASSET_FIELDS.map(({ key, label, hint }) => {
                const url = row[key] as string | null;
                const upKey = `${row.id}:${key}`;
                return (
                  <div key={key} className="space-y-1.5">
                    <label className="block text-[11px] font-medium text-muted-foreground">{label}</label>
                    {url ? (
                      <div className="rounded-lg border border-input bg-background p-2 flex items-start gap-2">
                        <div className="flex h-12 w-12 items-center justify-center rounded bg-muted shrink-0 overflow-hidden">
                          <img src={url} alt={label} className="max-h-full max-w-full object-contain" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <a href={url} target="_blank" rel="noopener" className="text-[10px] text-primary hover:underline truncate block">View</a>
                          <p className="text-[10px] text-muted-foreground/70 line-clamp-2">{hint}</p>
                        </div>
                        <button onClick={() => updateField(row.id, key, null)} className="text-muted-foreground hover:text-destructive shrink-0">
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ) : (
                      <label className="flex items-center justify-center gap-1.5 rounded-lg border border-dashed border-input bg-card px-2 py-3 text-[11px] text-muted-foreground hover:bg-muted cursor-pointer">
                        {uploading === upKey ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
                        <span>{uploading === upKey ? "Uploading…" : "Upload"}</span>
                        <input
                          type="file"
                          accept="image/png,image/jpeg"
                          className="hidden"
                          onChange={e => { const f = e.target.files?.[0]; if (f) handleUpload(row, key as any, f); }}
                        />
                      </label>
                    )}
                    <p className="text-[10px] text-muted-foreground/60 leading-tight">{hint}</p>
                  </div>
                );
              })}
            </div>

            {/* Text fields */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <BlurInput label="Signatory Name" value={row.signatory_name} onSave={v => updateField(row.id, "signatory_name", v)} />
              <BlurInput label="Signatory Designation" value={row.signatory_designation} onSave={v => updateField(row.id, "signatory_designation", v)} />
              <BlurInput label="Contact Email" value={row.contact_email} onSave={v => updateField(row.id, "contact_email", v)} />
              <BlurInput label="Contact Phone" value={row.contact_phone} onSave={v => updateField(row.id, "contact_phone", v)} />
              <BlurInput label="Website" value={row.website} onSave={v => updateField(row.id, "website", v)} />
              <BlurInput label="GSTIN" value={row.gstin} onSave={v => updateField(row.id, "gstin", v)} />
              <div className="sm:col-span-2">
                <BlurInput label="Address" value={row.address} onSave={v => updateField(row.id, "address", v)} multiline />
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Preview modal — sample PDF rendered with the current branding */}
      {previewing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={closePreview}>
          <div className="relative w-full max-w-4xl h-[90vh] rounded-2xl bg-card shadow-2xl flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-border">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-foreground truncate">Preview — {previewing.name}</p>
                <p className="text-[11px] text-muted-foreground">Sample data on the current letterhead. Real generated docs will use actual lead/payment values.</p>
              </div>
              <div className="flex items-center gap-2">
                <select
                  value={previewDocType}
                  onChange={(e) => changePreviewDocType(e.target.value)}
                  className="rounded-lg border border-input bg-background px-2 py-1 text-xs"
                >
                  {DOC_TYPES.filter(d => d.value !== "all").map(d => (
                    <option key={d.value} value={d.value}>{d.label}</option>
                  ))}
                </select>
                <button onClick={closePreview} className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground">
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>
            <div className="flex-1 bg-muted/40 relative">
              {previewLoading && (
                <div className="absolute inset-0 flex items-center justify-center">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              )}
              {previewUrl && (
                <iframe src={previewUrl} title="Document preview" className="w-full h-full bg-white" />
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function BlurInput({ label, value, onSave, multiline, inline }: { label: string; value: string | null; onSave: (v: string | null) => void; multiline?: boolean; inline?: boolean }) {
  const [v, setV] = useState(value || "");
  useEffect(() => { setV(value || ""); }, [value]);
  const dirty = v !== (value || "");
  const cls = "w-full rounded-xl border border-input bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring/20";
  if (inline) {
    return (
      <input
        value={v}
        onChange={e => setV(e.target.value)}
        onBlur={() => dirty && onSave(v.trim() || null)}
        className="text-base font-semibold text-foreground bg-transparent border-b border-transparent hover:border-input focus:border-primary focus:outline-none px-0.5 min-w-[200px]"
        placeholder="Template name…"
      />
    );
  }
  return (
    <div className="space-y-1">
      <label className="block text-[11px] font-medium text-muted-foreground">{label}</label>
      {multiline ? (
        <textarea value={v} onChange={e => setV(e.target.value)} onBlur={() => dirty && onSave(v.trim() || null)} className={`${cls} resize-none`} rows={2} />
      ) : (
        <input value={v} onChange={e => setV(e.target.value)} onBlur={() => dirty && onSave(v.trim() || null)} className={cls} />
      )}
    </div>
  );
}
