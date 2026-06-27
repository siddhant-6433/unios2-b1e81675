import { useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { invokeEdge } from "@/integrations/supabase/edge";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Loader2, Send, Upload, X, Plus, Image as ImageIcon } from "lucide-react";

type HeaderType = "NONE" | "TEXT" | "IMAGE" | "VIDEO" | "DOCUMENT";
type ButtonType = "URL" | "QUICK_REPLY" | "PHONE_NUMBER";

interface TemplateButton {
  type: ButtonType;
  text: string;
  url?: string;
  phone_number?: string;
  example?: string;
}

interface WhatsAppTemplateFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called after a successful submission so the parent can refetch. */
  onSubmitted: () => void;
  /** Optional pre-fill (e.g. from a suggested template). */
  initial?: { name?: string; category?: string; body?: string };
}

const inputCls =
  "w-full rounded-xl border border-input bg-background px-3 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring/20";

const MEDIA_ACCEPT: Record<HeaderType, string> = {
  NONE: "",
  TEXT: "",
  IMAGE: "image/jpeg,image/png",
  VIDEO: "video/mp4,video/3gpp",
  DOCUMENT: "application/pdf",
};

interface MediaUploadResult {
  handle: string;
  format: "IMAGE" | "VIDEO" | "DOCUMENT";
  mime: string;
  size: number;
}

async function readErrorBody(response: Response) {
  const fallback = `HTTP ${response.status}`;
  const contentType = response.headers.get("content-type") || "";
  try {
    if (contentType.includes("application/json")) {
      const body = await response.json();
      return body?.error || body?.message || JSON.stringify(body) || fallback;
    }
    const text = await response.text();
    return text || fallback;
  } catch {
    return fallback;
  }
}

async function uploadTemplateMedia(file: File): Promise<MediaUploadResult> {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
  const anonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
  const accessToken = sessionData.session?.access_token;

  if (sessionError || !accessToken) {
    throw new Error(sessionError?.message || "You must be signed in to upload media");
  }
  if (!supabaseUrl || !anonKey) {
    throw new Error("Supabase client is not configured");
  }

  const form = new FormData();
  form.append("file", file);

  const response = await fetch(`${supabaseUrl}/functions/v1/whatsapp-template-media-upload`, {
    method: "POST",
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${accessToken}`,
    },
    body: form,
  });

  if (!response.ok) {
    throw new Error(await readErrorBody(response));
  }

  const data = await response.json();
  if (data?.error) {
    throw new Error(data.error);
  }
  if (!data?.handle) {
    throw new Error("Media upload did not return a Meta header handle");
  }

  return data as MediaUploadResult;
}

export function WhatsAppTemplateForm({ open, onOpenChange, onSubmitted, initial }: WhatsAppTemplateFormProps) {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [name, setName] = useState(initial?.name ?? "");
  const [category, setCategory] = useState(initial?.category ?? "UTILITY");
  const [headerType, setHeaderType] = useState<HeaderType>("NONE");
  const [headerText, setHeaderText] = useState("");
  const [headerExample, setHeaderExample] = useState("");
  const [body, setBody] = useState(initial?.body ?? "");
  const [bodyExamples, setBodyExamples] = useState<string[]>([]);
  const [footer, setFooter] = useState("");
  const [buttons, setButtons] = useState<TemplateButton[]>([]);

  const [mediaHandle, setMediaHandle] = useState<string | null>(null);
  const [mediaFileName, setMediaFileName] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Placeholder count drives the sample-value inputs.
  const placeholderCount = useMemo(
    () => (body.match(/\{\{\d+\}\}/g) || []).length,
    [body],
  );

  const headerHasVar = useMemo(
    () => /\{\{\d+\}\}/.test(headerText),
    [headerText],
  );

  const isMediaHeader = headerType === "IMAGE" || headerType === "VIDEO" || headerType === "DOCUMENT";

  const reset = () => {
    setName(""); setCategory("UTILITY"); setHeaderType("NONE"); setHeaderText("");
    setHeaderExample(""); setBody(""); setBodyExamples([]); setFooter(""); setButtons([]);
    setMediaHandle(null); setMediaFileName(null);
  };

  const handleMediaSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setMediaHandle(null);
    try {
      const data = await uploadTemplateMedia(file);
      setMediaHandle(data.handle);
      setMediaFileName(file.name);
      toast({ title: "Media uploaded", description: file.name });
    } catch (err: unknown) {
      toast({ title: "Upload failed", description: err instanceof Error ? err.message : "Unexpected error", variant: "destructive" });
    }
    setUploading(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const setExampleAt = (i: number, val: string) => {
    setBodyExamples((prev) => {
      const next = [...prev];
      next[i] = val;
      return next;
    });
  };

  const addButton = () => {
    if (buttons.length >= 3) return;
    setButtons((prev) => [...prev, { type: "QUICK_REPLY", text: "" }]);
  };

  const updateButton = (i: number, patch: Partial<TemplateButton>) => {
    setButtons((prev) => prev.map((b, idx) => (idx === i ? { ...b, ...patch } : b)));
  };

  const removeButton = (i: number) => {
    setButtons((prev) => prev.filter((_, idx) => idx !== i));
  };

  const canSubmit =
    name.trim().length > 0 &&
    body.trim().length > 0 &&
    !submitting &&
    !uploading &&
    (!isMediaHeader || !!mediaHandle);

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    const payload: Record<string, unknown> = {
      action: "create",
      name: name.trim(),
      category,
      body_text: body,
      header_format: headerType,
    };
    if (headerType === "TEXT") {
      payload.header_text = headerText;
      if (headerHasVar) payload.header_example = headerExample || "example";
    }
    if (isMediaHeader && mediaHandle) payload.header_handle = mediaHandle;
    if (placeholderCount > 0) payload.body_examples = bodyExamples.slice(0, placeholderCount);
    if (footer.trim()) payload.footer_text = footer.trim();
    if (buttons.length > 0) {
      payload.buttons = buttons
        .filter((b) => b.text.trim())
        .map((b) =>
          b.type === "URL"
            ? { type: "URL", text: b.text, url: b.url, example: b.example }
            : b.type === "PHONE_NUMBER"
              ? { type: "PHONE_NUMBER", text: b.text, phone_number: b.phone_number }
              : { type: "QUICK_REPLY", text: b.text },
        );
    }

    const { data, error } = await invokeEdge<{ error?: string }>("whatsapp-templates", { body: payload });
    if (error || data?.error) {
      toast({ title: "Submission failed", description: data?.error || error?.message, variant: "destructive" });
    } else {
      toast({ title: "Template submitted", description: "Sent to Meta for approval." });
      reset();
      onOpenChange(false);
      onSubmitted();
    }
    setSubmitting(false);
  };

  // Live preview body with sample values substituted.
  const previewBody = useMemo(() => {
    let out = body;
    for (let i = 0; i < placeholderCount; i += 1) {
      const sample = bodyExamples[i]?.trim() || `{{${i + 1}}}`;
      out = out.replace(new RegExp(`\\{\\{${i + 1}\\}\\}`, "g"), sample);
    }
    return out;
  }, [body, bodyExamples, placeholderCount]);

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) reset(); onOpenChange(o); }}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Submit WhatsApp Template to Meta</DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-1 md:grid-cols-[1fr_280px] gap-5">
          {/* ── Form ── */}
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-medium text-muted-foreground mb-1">Template Name *</label>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "_"))}
                  placeholder="my_template_name"
                  className={inputCls + " font-mono"}
                />
              </div>
              <div>
                <label className="block text-[11px] font-medium text-muted-foreground mb-1">Category</label>
                <select value={category} onChange={(e) => setCategory(e.target.value)} className={inputCls}>
                  <option value="UTILITY">Utility</option>
                  <option value="MARKETING">Marketing</option>
                  <option value="AUTHENTICATION">Authentication</option>
                </select>
              </div>
            </div>

            {/* Header */}
            <div>
              <label className="block text-[11px] font-medium text-muted-foreground mb-1">Header (optional)</label>
              <select
                value={headerType}
                onChange={(e) => {
                  setHeaderType(e.target.value as HeaderType);
                  setMediaHandle(null);
                  setMediaFileName(null);
                }}
                className={inputCls}
              >
                <option value="NONE">None</option>
                <option value="TEXT">Text</option>
                <option value="IMAGE">Image</option>
                <option value="VIDEO">Video</option>
                <option value="DOCUMENT">Document</option>
              </select>
            </div>

            {headerType === "TEXT" && (
              <div className="space-y-2">
                <input
                  value={headerText}
                  onChange={(e) => setHeaderText(e.target.value)}
                  placeholder="Header text (you may use {{1}})"
                  className={inputCls}
                />
                {headerHasVar && (
                  <input
                    value={headerExample}
                    onChange={(e) => setHeaderExample(e.target.value)}
                    placeholder="Sample value for header {{1}}"
                    className={inputCls + " text-xs"}
                  />
                )}
              </div>
            )}

            {isMediaHeader && (
              <div className="rounded-xl border border-dashed border-border p-3">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept={MEDIA_ACCEPT[headerType]}
                  className="hidden"
                  onChange={handleMediaSelect}
                />
                {mediaHandle ? (
                  <div className="flex items-center gap-2 text-xs">
                    <ImageIcon className="h-4 w-4 text-emerald-600" />
                    <span className="flex-1 truncate text-foreground">{mediaFileName}</span>
                    <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => { setMediaHandle(null); setMediaFileName(null); }}>
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ) : (
                  <Button variant="outline" size="sm" className="gap-2 w-full" disabled={uploading} onClick={() => fileInputRef.current?.click()}>
                    {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                    Upload {headerType.toLowerCase()} sample
                  </Button>
                )}
                <p className="text-[10px] text-muted-foreground mt-1.5">
                  Meta requires a sample media file to approve a media-header template.
                </p>
              </div>
            )}

            {/* Body */}
            <div>
              <label className="block text-[11px] font-medium text-muted-foreground mb-1">Body Text *</label>
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                rows={6}
                className={inputCls + " text-xs"}
                placeholder={"Hi {{1}}, thank you for your interest in {{2}} at NIMT."}
              />
              <p className="text-[10px] text-muted-foreground mt-1">{placeholderCount} variable(s) detected</p>
            </div>

            {placeholderCount > 0 && (
              <div className="space-y-2">
                <p className="text-[11px] font-medium text-muted-foreground">Sample values</p>
                {Array.from({ length: placeholderCount }, (_, i) => (
                  <input
                    key={i}
                    value={bodyExamples[i] ?? ""}
                    onChange={(e) => setExampleAt(i, e.target.value)}
                    placeholder={`Sample value for {{${i + 1}}}`}
                    className={inputCls + " text-xs"}
                  />
                ))}
              </div>
            )}

            {/* Footer */}
            <div>
              <label className="block text-[11px] font-medium text-muted-foreground mb-1">Footer (optional)</label>
              <input
                value={footer}
                onChange={(e) => setFooter(e.target.value)}
                placeholder="e.g. NIMT Educational Institutions"
                className={inputCls + " text-xs"}
              />
            </div>

            {/* Buttons */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-[11px] font-medium text-muted-foreground">Buttons (optional, max 3)</label>
                <Button variant="ghost" size="sm" className="h-7 gap-1 text-xs" disabled={buttons.length >= 3} onClick={addButton}>
                  <Plus className="h-3 w-3" /> Add
                </Button>
              </div>
              {buttons.map((b, i) => (
                <div key={i} className="rounded-lg border border-border p-2 space-y-2">
                  <div className="flex items-center gap-2">
                    <select
                      value={b.type}
                      onChange={(e) => updateButton(i, { type: e.target.value as ButtonType })}
                      className={inputCls + " text-xs py-1.5"}
                    >
                      <option value="QUICK_REPLY">Quick reply</option>
                      <option value="URL">URL</option>
                      <option value="PHONE_NUMBER">Call</option>
                    </select>
                    <input
                      value={b.text}
                      onChange={(e) => updateButton(i, { text: e.target.value })}
                      placeholder="Button text"
                      className={inputCls + " text-xs py-1.5"}
                    />
                    <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={() => removeButton(i)}>
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                  {b.type === "URL" && (
                    <input
                      value={b.url ?? ""}
                      onChange={(e) => updateButton(i, { url: e.target.value })}
                      placeholder="https://uni.nimt.ac.in/…"
                      className={inputCls + " text-xs py-1.5"}
                    />
                  )}
                  {b.type === "PHONE_NUMBER" && (
                    <input
                      value={b.phone_number ?? ""}
                      onChange={(e) => updateButton(i, { phone_number: e.target.value })}
                      placeholder="+91…"
                      className={inputCls + " text-xs py-1.5"}
                    />
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* ── Live preview ── */}
          <div className="md:sticky md:top-0 h-fit">
            <p className="text-[11px] font-medium text-muted-foreground mb-1.5">Preview</p>
            <div className="rounded-xl bg-[#e5ddd5] dark:bg-slate-800 p-3">
              <div className="rounded-lg bg-white dark:bg-slate-700 shadow-sm p-2.5 text-xs space-y-1.5">
                {headerType === "TEXT" && headerText && (
                  <p className="font-semibold text-foreground">{headerText}</p>
                )}
                {isMediaHeader && (
                  <div className="rounded bg-muted/60 h-20 flex items-center justify-center text-[10px] text-muted-foreground">
                    {mediaFileName || `${headerType} header`}
                  </div>
                )}
                <p className="text-foreground whitespace-pre-wrap">{previewBody || "Body preview…"}</p>
                {footer && <p className="text-[10px] text-muted-foreground">{footer}</p>}
                {buttons.filter((b) => b.text.trim()).length > 0 && (
                  <div className="border-t border-border/40 pt-1.5 space-y-1">
                    {buttons.filter((b) => b.text.trim()).map((b, i) => (
                      <p key={i} className="text-center text-[11px] text-sky-600 font-medium">{b.text}</p>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={!canSubmit} className="gap-2">
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            Submit to Meta
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
