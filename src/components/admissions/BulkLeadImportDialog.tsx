import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { LEAD_SOURCES } from "@/config/leadSources";
import { Badge } from "@/components/ui/badge";
import { Upload, FileText, Loader2, CheckCircle, XCircle, Download, ArrowRight, ArrowLeft } from "lucide-react";

interface BulkLeadImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
  defaultListMode?: "off" | "new" | "existing";
}

// Fields the importer can write to. The keys are the column names on the
// `leads` table. The optional set is used to gate validation: only `name` and
// `phone` are required for an insert to succeed.
type LeadField =
  | "name"
  | "phone"
  | "email"
  | "source"
  | "guardian_name"
  | "guardian_phone"
  | "notes";

const LEAD_FIELDS: { key: LeadField; label: string; required?: boolean; help?: string }[] = [
  { key: "name",            label: "Name",            required: true },
  { key: "phone",           label: "Phone",           required: true, help: "10+ digits, country code optional" },
  { key: "email",           label: "Email" },
  { key: "source",          label: "Source",          help: `One of: ${LEAD_SOURCES.map(s => s.value).join(", ")}` },
  { key: "guardian_name",   label: "Guardian name" },
  { key: "guardian_phone",  label: "Guardian phone" },
  { key: "notes",           label: "Notes" },
];

// Common aliases counsellors paste from spreadsheets — used to auto-pick the
// matching CSV column for each lead field. Lowercased + underscored before
// matching, so "Phone Number" → "phone_number" → matches "phone".
const FIELD_ALIASES: Record<LeadField, string[]> = {
  name:           ["name", "full_name", "student_name", "lead_name", "fullname"],
  phone:          ["phone", "phone_number", "mobile", "mobile_number", "contact", "contact_number", "whatsapp", "whatsapp_number"],
  email:          ["email", "email_address", "e_mail"],
  source:         ["source", "lead_source", "channel"],
  guardian_name:  ["guardian_name", "parent_name", "father_name", "mother_name", "guardian", "parent"],
  guardian_phone: ["guardian_phone", "parent_phone", "father_phone", "mother_phone", "guardian_mobile", "parent_mobile"],
  notes:          ["notes", "note", "remarks", "comment", "comments", "description"],
};

const VALID_SOURCES = LEAD_SOURCES.map(s => s.value);
const NONE = "__none__";

// RFC-4180-ish parser: handles quoted fields, embedded commas, and "" escapes
// for an embedded quote. Newlines inside quoted fields are NOT supported here
// (the file is split by \n before parsing), which matches every CSV we've
// actually seen counsellors paste from Excel / Google Sheets.
function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') { inQuotes = false; }
      else { cur += ch; }
    } else {
      if (ch === ',') { out.push(cur); cur = ""; }
      else if (ch === '"' && cur === "") { inQuotes = true; }
      else { cur += ch; }
    }
  }
  out.push(cur);
  return out.map(s => s.trim());
}

function normaliseHeader(h: string): string {
  return h.trim().toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, "");
}

// Mirror of the DB trigger `normalize_lead_phone`: strip non-digits, take the
// last 10, prefix with "+91". Used pre-insert so the dedupe lookup matches
// however the phone was formatted in the CSV vs the stored canonical form.
function canonicalisePhone(raw: string): string | null {
  const digits = (raw || "").replace(/\D/g, "");
  if (digits.length < 10) return null;
  return "+91" + digits.slice(-10);
}

interface ParsedRow {
  // Field-mapped values pulled out of the CSV row at import time. Kept on
  // each parsed row so the preview table can show them as users will see them.
  name: string;
  phone: string;
  email?: string;
  source?: string;
  guardian_name?: string;
  guardian_phone?: string;
  notes?: string;
  valid: boolean;
  error?: string;
}

type Step = "upload" | "map" | "preview" | "result";

interface ExistingList {
  id: string;
  name: string;
  member_count: number;
}

export function BulkLeadImportDialog({ open, onOpenChange, onSuccess, defaultListMode = "off" }: BulkLeadImportDialogProps) {
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState<Step>("upload");
  const [fileName, setFileName] = useState<string>("");
  const [headers, setHeaders] = useState<string[]>([]);
  const [rawRows, setRawRows] = useState<string[][]>([]); // every data row, post-split
  // mapping[leadField] = csv header (or NONE if intentionally unmapped)
  const [mapping, setMapping] = useState<Record<LeadField, string>>({
    name: NONE, phone: NONE, email: NONE, source: NONE,
    guardian_name: NONE, guardian_phone: NONE, notes: NONE,
  });

  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<{ success: number; failed: number; duplicates: number; listId?: string | null; listName?: string } | null>(null);
  const [triggerAiCalls, setTriggerAiCalls] = useState(false);

  // Optional manual source override — applied to every imported lead,
  // overriding whatever was in the CSV (or filling it in when missing).
  // Empty string = "use CSV value, fall back to 'other'".
  const [sourceOverride, setSourceOverride] = useState<string>("");
  const [otherSourceName, setOtherSourceName] = useState<string>("");

  // Notes can be assembled from multiple CSV columns (e.g. campaign_name +
  // ad_set + remarks) concatenated with a separator. When this list is
  // non-empty it OVERRIDES the single `mapping.notes` value — the mapping
  // dropdown for notes is hidden in favour of a multi-pick UI.
  const [notesColumns, setNotesColumns] = useState<string[]>([]);
  const [notesSeparator, setNotesSeparator] = useState<", " | " " | " | ">(", ");
  const [notesIncludeLabels, setNotesIncludeLabels] = useState(true);

  // Save-as-list controls (preview step). Three modes:
  //   off       — don't create / append any list
  //   new       — create a new list with `listName`
  //   existing  — append to the list with id `existingListId`
  const [listMode, setListMode] = useState<"off" | "new" | "existing">(defaultListMode);
  const [listName, setListName] = useState("");
  const [existingListId, setExistingListId] = useState<string>("");
  const [existingLists, setExistingLists] = useState<ExistingList[]>([]);

  // Reset everything when the dialog closes so reopening starts clean.
  useEffect(() => {
    if (!open) {
      setStep("upload"); setFileName(""); setHeaders([]); setRawRows([]);
      setMapping({ name: NONE, phone: NONE, email: NONE, source: NONE, guardian_name: NONE, guardian_phone: NONE, notes: NONE });
      setResult(null); setTriggerAiCalls(false);
      setListMode(defaultListMode); setListName(""); setExistingListId("");
      setSourceOverride(""); setOtherSourceName("");
      setNotesColumns([]); setNotesSeparator(", "); setNotesIncludeLabels(true);
    }
  }, [open, defaultListMode]);

  // Lazy-load existing lists once the user lands on the preview step and
  // toggles to "append" mode. Most imports are one-shot so this avoids the
  // round-trip on the upload step.
  useEffect(() => {
    if (step !== "preview" || listMode !== "existing" || existingLists.length > 0) return;
    (async () => {
      const { data } = await supabase
        .from("lead_lists" as any)
        .select("id, name, member_count")
        .order("created_at", { ascending: false })
        .limit(200);
      setExistingLists((data as any) || []);
    })();
  }, [step, listMode, existingLists.length]);

  // ── Upload step ─────────────────────────────────────────────────────────
  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = (ev.target?.result as string) || "";
      // Strip BOM that Excel loves to add to UTF-8 CSVs.
      const cleaned = text.replace(/^﻿/, "");
      const lines = cleaned.split(/\r?\n/).map(l => l).filter(l => l.trim().length > 0);
      if (lines.length < 2) {
        toast({ title: "Empty CSV", description: "CSV must have a header row and at least one data row.", variant: "destructive" });
        return;
      }
      const rawHeaders = splitCsvLine(lines[0]);
      const rows = lines.slice(1).map(splitCsvLine);

      setFileName(file.name);
      setHeaders(rawHeaders);
      setRawRows(rows);

      // Auto-detect mapping by alias match against normalised headers.
      const normalised = rawHeaders.map(normaliseHeader);
      const next: Record<LeadField, string> = { ...mapping };
      for (const f of LEAD_FIELDS) {
        if (f.key === "notes") continue; // notes is multi-pick, handled below
        const aliases = FIELD_ALIASES[f.key];
        const idx = normalised.findIndex(h => aliases.includes(h));
        next[f.key] = idx >= 0 ? rawHeaders[idx] : NONE;
      }
      // Notes: any matching column is added to the multi-pick.
      const notesAliases = FIELD_ALIASES.notes;
      const detectedNotes = rawHeaders.filter((_, i) => notesAliases.includes(normalised[i]));
      setNotesColumns(detectedNotes);
      setMapping(next);
      setStep("map");
    };
    reader.readAsText(file);
    // Clear so re-selecting the same file fires onChange again.
    if (fileRef.current) fileRef.current.value = "";
  };

  // ── Mapping → parsed rows ──────────────────────────────────────────────
  // Materialised whenever we enter the preview step or the mapping changes,
  // so the preview always reflects the current mapping.
  const parsed = useMemo<ParsedRow[]>(() => {
    if (!rawRows.length) return [];
    const idx: Record<LeadField, number> = {} as any;
    for (const f of LEAD_FIELDS) {
      const hdr = mapping[f.key];
      idx[f.key] = hdr === NONE ? -1 : headers.indexOf(hdr);
    }
    // Pre-resolve notes column indices so we don't re-do indexOf per row.
    const notesIdx = notesColumns.map(h => headers.indexOf(h)).filter(i => i >= 0);

    return rawRows.map(cols => {
      const get = (k: LeadField) => (idx[k] >= 0 ? (cols[idx[k]] || "").trim() : "");
      const name = get("name");
      const phone = get("phone");
      const email = get("email") || undefined;
      const source = get("source") || undefined;
      const guardian_name = get("guardian_name") || undefined;
      const guardian_phone = get("guardian_phone") || undefined;
      // Multi-column notes win over single-column mapping. Each picked column
      // gets its header as a label (so "campaign: ABC, ad_set: B" stays
      // meaningful) unless the user opted out of labels.
      let notes: string | undefined;
      if (notesIdx.length > 0) {
        const parts = notesIdx
          .map((i, k) => {
            const v = (cols[i] || "").trim();
            if (!v) return "";
            return notesIncludeLabels ? `${notesColumns[k]}: ${v}` : v;
          })
          .filter(Boolean);
        notes = parts.length ? parts.join(notesSeparator) : undefined;
      } else {
        notes = get("notes") || undefined;
      }

      let valid = true;
      let error = "";
      if (!name) { valid = false; error = "Name required"; }
      else if (!phone || phone.replace(/\D/g, "").length < 10) { valid = false; error = "Invalid phone"; }
      // Skip source validation when the user is overriding it for the whole batch.
      else if (!sourceOverride && source && !VALID_SOURCES.includes(source.toLowerCase())) { valid = false; error = `Invalid source: ${source}`; }

      return {
        name, phone, email,
        source: source ? source.toLowerCase() : undefined,
        guardian_name, guardian_phone, notes,
        valid, error,
      };
    });
  }, [rawRows, headers, mapping, sourceOverride, notesColumns, notesSeparator, notesIncludeLabels]);

  const validCount = parsed.filter(l => l.valid).length;
  const invalidCount = parsed.filter(l => !l.valid).length;
  const requiredMapped = mapping.name !== NONE && mapping.phone !== NONE;
  const trimmedOtherSourceName = otherSourceName.trim();
  const sourceOverrideLabel =
    sourceOverride === "other" && trimmedOtherSourceName
      ? `${LEAD_SOURCES.find(s => s.value === "other")?.label || "Other"} (${trimmedOtherSourceName})`
      : sourceOverride
        ? LEAD_SOURCES.find(s => s.value === sourceOverride)?.label || sourceOverride
        : "";
  const defaultListName =
    sourceOverride === "other" && trimmedOtherSourceName
      ? trimmedOtherSourceName
      : `Imported leads — ${new Date().toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}`;

  const previewSourceLabel = (lead: ParsedRow) => {
    if (sourceOverride) return sourceOverrideLabel;
    return lead.source || "—";
  };

  // ── Import action ───────────────────────────────────────────────────────
  const handleImport = async () => {
    const validLeads = parsed.filter(l => l.valid);
    if (!validLeads.length) return;
    setImporting(true);
    let success = 0, failed = 0, duplicates = 0;

    const insertedIds: string[] = [];
    // Map of canonical phone → existing lead_id for the dupes we found in
    // the preflight check. We use these IDs later when adding everyone
    // (new + dupe) to the target list.
    const existingByPhone = new Map<string, string>();

    // Preflight: find which of these phones already exist in the DB. We
    // canonicalise client-side (mirror of normalize_lead_phone) so the IN()
    // lookup matches the trigger's canonical form. This avoids fighting the
    // partial unique index `idx_leads_phone_unique` (WHERE is_mirror=false)
    // — ON CONFLICT can't match a partial index without supplying its WHERE,
    // and PostgREST doesn't expose that.
    const canonical: string[] = [];
    for (const l of validLeads) {
      const c = canonicalisePhone(l.phone);
      if (c) canonical.push(c);
    }
    for (let i = 0; i < canonical.length; i += 200) {
      const chunk = canonical.slice(i, i + 200);
      const { data: rows } = await supabase
        .from("leads")
        .select("id, phone")
        .in("phone", chunk)
        .eq("is_mirror", false);
      if (rows) {
        for (const r of rows as any[]) existingByPhone.set(r.phone, r.id);
      }
    }

    // Partition into new vs duplicate.
    const newLeads: typeof validLeads = [];
    for (const l of validLeads) {
      const c = canonicalisePhone(l.phone);
      if (c && existingByPhone.has(c)) {
        duplicates++;
      } else {
        newLeads.push(l);
      }
    }

    // Plain INSERT now — no conflicts because dupes were filtered out.
    for (let i = 0; i < newLeads.length; i += 50) {
      const slice = newLeads.slice(i, i + 50);
      const batch = slice.map(l => ({
        name: l.name,
        phone: l.phone,
        email: l.email || null,
        // Manual override wins over CSV. Falls back to CSV value, then "other".
        source: (sourceOverride || l.source || "other") as any,
        guardian_name: l.guardian_name || null,
        guardian_phone: l.guardian_phone || null,
        notes: [
          sourceOverride === "other" && trimmedOtherSourceName ? `Other source: ${trimmedOtherSourceName}` : "",
          l.notes || "",
        ].filter(Boolean).join("\n") || null,
        skip_ai_call: true,
      } as any));

      const { error, data } = await supabase.from("leads").insert(batch).select("id");
      if (error) {
        // Batch failed for a non-dupe reason — fall back to per-row insert.
        console.warn("Batch insert failed, retrying per-row:", error.message);
        for (const row of batch) {
          const { error: rowErr, data: rowData } = await supabase
            .from("leads").insert([row]).select("id");
          if (rowErr) {
            failed++;
            console.warn("Row insert failed:", rowErr.message, row.phone);
          } else if (rowData && rowData[0]) {
            success++;
            insertedIds.push((rowData[0] as any).id);
          }
        }
      } else {
        const inserted = data?.length || 0;
        success += inserted;
        if (data) insertedIds.push(...data.map((d: any) => d.id));
      }
    }

    if (triggerAiCalls && insertedIds.length > 0) {
      supabase.functions.invoke("ai-call-batch", {
        body: { lead_ids: insertedIds, delay_seconds: 30 },
      }).then(({ error: batchErr }) => {
        if (batchErr) console.error("Batch AI call failed:", batchErr);
        else toast({ title: "AI calls queued", description: `${insertedIds.length} calls will be made sequentially.` });
      });
    }

    // Build the full set of lead IDs for the list — newly inserted leads
    // PLUS the existing leads we found in the preflight dedupe. User's
    // mental model is "these 619 people get this campaign", so silently
    // dropping pre-existing leads would surprise them.
    const memberIds = Array.from(new Set([...insertedIds, ...existingByPhone.values()]));

    let listId: string | null = null;
    let savedListName: string | undefined;
    if (memberIds.length > 0 && listMode !== "off") {
      if (listMode === "new") {
        const name = listName.trim() || defaultListName;
        const { data: list, error: listErr } = await supabase
          .from("lead_lists" as any)
          .insert({ name, source: "import", description: `Imported ${memberIds.length} leads from ${fileName || "CSV"}` })
          .select("id, name")
          .single();
        if (listErr || !list) {
          toast({ title: "List not created", description: listErr?.message || "Could not save list.", variant: "destructive" });
        } else {
          listId = (list as any).id;
          savedListName = (list as any).name;
        }
      } else if (listMode === "existing" && existingListId) {
        listId = existingListId;
        savedListName = existingLists.find(l => l.id === existingListId)?.name;
      }

      if (listId) {
        const members = memberIds.map((lead_id) => ({ list_id: listId, lead_id }));
        for (let i = 0; i < members.length; i += 500) {
          const chunk = members.slice(i, i + 500);
          const { error: memErr } = await supabase
            .from("lead_list_members" as any)
            .upsert(chunk, { onConflict: "list_id,lead_id", ignoreDuplicates: true } as any);
          if (memErr) console.error("List member insert failed:", memErr);
        }
        toast({ title: listMode === "new" ? "List created" : "List updated", description: `"${savedListName}" — ${memberIds.length} leads` });
      }
    }

    setResult({ success, failed, duplicates, listId, listName: savedListName });
    setImporting(false);
    setStep("result");
    if (success > 0) onSuccess();
  };

  // ── Template download ───────────────────────────────────────────────────
  const downloadTemplate = () => {
    const csv = "name,phone,email,source,guardian_name,guardian_phone,notes\nJohn Doe,+919876543210,john@email.com,website,Jane Doe,+919876543211,Interested in B.Tech";
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "lead_import_template.csv"; a.click();
    URL.revokeObjectURL(url);
  };

  const closeIfIdle = (o: boolean) => { if (!importing) onOpenChange(o); };

  return (
    <Dialog open={open} onOpenChange={closeIfIdle}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Bulk Import Leads</DialogTitle>
        </DialogHeader>

        {/* Step indicator */}
        {step !== "result" && (
          <ol className="flex items-center gap-2 text-xs text-muted-foreground mt-1">
            {[
              { k: "upload", label: "1. Upload" },
              { k: "map",    label: "2. Map columns" },
              { k: "preview",label: "3. Preview & import" },
            ].map((s, i) => (
              <li key={s.k} className="flex items-center gap-2">
                <span className={`px-2 py-0.5 rounded-full ${step === s.k ? "bg-primary text-primary-foreground" : "bg-muted"}`}>
                  {s.label}
                </span>
                {i < 2 && <ArrowRight className="h-3 w-3 opacity-40" />}
              </li>
            ))}
          </ol>
        )}

        {step === "upload" && (
          <div className="space-y-4 mt-3">
            <div className="border-2 border-dashed border-border rounded-2xl p-12 text-center">
              <Upload className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
              <p className="text-sm font-medium text-foreground mb-1">Upload CSV file</p>
              <p className="text-xs text-muted-foreground mb-4">
                Headers can be anything — you'll map them to lead fields in the next step.
              </p>
              <div className="flex gap-2 justify-center">
                <Button onClick={() => fileRef.current?.click()} className="gap-1.5"><FileText className="h-4 w-4" />Select File</Button>
                <Button variant="outline" onClick={downloadTemplate} className="gap-1.5"><Download className="h-4 w-4" />Template</Button>
              </div>
              <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden" onChange={handleFile} />
            </div>
          </div>
        )}

        {step === "map" && (
          <div className="space-y-4 mt-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-foreground">Map columns</p>
                <p className="text-xs text-muted-foreground">
                  <span className="font-mono">{fileName}</span> · {headers.length} columns · {rawRows.length} rows
                </p>
              </div>
              <Badge variant="outline" className="text-[10px]">{rawRows.length} rows ready</Badge>
            </div>

            <div className="rounded-xl border border-border overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/50">
                    <th className="px-3 py-2 text-left text-xs font-semibold text-muted-foreground w-1/3">Lead field</th>
                    <th className="px-3 py-2 text-left text-xs font-semibold text-muted-foreground">CSV column</th>
                    <th className="px-3 py-2 text-left text-xs font-semibold text-muted-foreground">Sample</th>
                  </tr>
                </thead>
                <tbody>
                  {LEAD_FIELDS.map(f => {
                    // Notes is special: multi-pick + separator.
                    if (f.key === "notes") {
                      const previewParts = notesColumns
                        .map(h => {
                          const i = headers.indexOf(h);
                          const v = i >= 0 ? (rawRows[0]?.[i] || "").trim() : "";
                          if (!v) return "";
                          return notesIncludeLabels ? `${h}: ${v}` : v;
                        })
                        .filter(Boolean);
                      const preview = previewParts.join(notesSeparator);
                      return (
                        <tr key={f.key} className="border-b border-border last:border-0">
                          <td className="px-3 py-2 align-top">
                            <div className="flex items-center gap-1.5">
                              <span className="text-foreground font-medium text-sm">{f.label}</span>
                            </div>
                            <p className="text-[10px] text-muted-foreground mt-0.5">
                              Pick one or more columns — they'll be concatenated.
                            </p>
                          </td>
                          <td className="px-3 py-2" colSpan={2}>
                            <div className="flex flex-wrap gap-1.5">
                              {headers.map(h => {
                                const on = notesColumns.includes(h);
                                return (
                                  <button
                                    key={h}
                                    type="button"
                                    onClick={() => setNotesColumns(prev => on ? prev.filter(x => x !== h) : [...prev, h])}
                                    className={`text-[11px] px-2 py-1 rounded-full border transition-colors ${
                                      on
                                        ? "bg-primary text-primary-foreground border-primary"
                                        : "bg-card border-input text-muted-foreground hover:bg-muted"
                                    }`}
                                  >
                                    {h}
                                  </button>
                                );
                              })}
                              {notesColumns.length > 0 && (
                                <button
                                  type="button"
                                  onClick={() => setNotesColumns([])}
                                  className="text-[11px] px-2 py-1 rounded-full border border-transparent text-muted-foreground hover:text-foreground"
                                >
                                  Clear
                                </button>
                              )}
                            </div>
                            {notesColumns.length > 0 && (
                              <div className="mt-2 space-y-1.5">
                                <div className="flex items-center gap-3 text-[11px]">
                                  <span className="text-muted-foreground">Separator:</span>
                                  {([
                                    { v: ", ", label: "comma" },
                                    { v: " ",  label: "space" },
                                    { v: " | ", label: "pipe" },
                                  ] as const).map(opt => (
                                    <label key={opt.v} className="flex items-center gap-1 cursor-pointer">
                                      <input
                                        type="radio"
                                        checked={notesSeparator === opt.v}
                                        onChange={() => setNotesSeparator(opt.v)}
                                        className="h-3 w-3"
                                      />
                                      <span>{opt.label}</span>
                                    </label>
                                  ))}
                                  <label className="ml-auto flex items-center gap-1 cursor-pointer">
                                    <input
                                      type="checkbox"
                                      checked={notesIncludeLabels}
                                      onChange={e => setNotesIncludeLabels(e.target.checked)}
                                      className="h-3 w-3"
                                    />
                                    <span>Include column labels</span>
                                  </label>
                                </div>
                                <p className="text-[10px] text-muted-foreground">
                                  Preview (row 1): <span className="text-foreground font-mono">{preview || "—"}</span>
                                </p>
                              </div>
                            )}
                          </td>
                        </tr>
                      );
                    }

                    const selectedHeader = mapping[f.key];
                    const colIdx = selectedHeader === NONE ? -1 : headers.indexOf(selectedHeader);
                    const sample = colIdx >= 0 ? (rawRows[0]?.[colIdx] || "") : "";
                    return (
                      <tr key={f.key} className="border-b border-border last:border-0">
                        <td className="px-3 py-2">
                          <div className="flex items-center gap-1.5">
                            <span className="text-foreground font-medium text-sm">{f.label}</span>
                            {f.required && <span className="text-[10px] uppercase tracking-wide text-rose-600 font-semibold">required</span>}
                          </div>
                          {f.help && <p className="text-[10px] text-muted-foreground mt-0.5">{f.help}</p>}
                        </td>
                        <td className="px-3 py-2">
                          <select
                            value={selectedHeader}
                            onChange={(e) => setMapping(m => ({ ...m, [f.key]: e.target.value }))}
                            className="w-full rounded-lg border border-input bg-card py-1.5 px-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring/20"
                          >
                            <option value={NONE}>— Don't import —</option>
                            {headers.map(h => (
                              <option key={h} value={h}>{h}</option>
                            ))}
                          </select>
                        </td>
                        <td className="px-3 py-2 text-xs text-muted-foreground truncate max-w-[200px]" title={sample}>
                          {sample || "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {!requiredMapped && (
              <p className="text-xs text-rose-600">
                Map both <strong>Name</strong> and <strong>Phone</strong> to continue.
              </p>
            )}

            <div className="flex justify-between gap-2">
              <Button variant="outline" onClick={() => setStep("upload")} className="gap-1.5"><ArrowLeft className="h-4 w-4" />Choose another file</Button>
              <Button onClick={() => setStep("preview")} disabled={!requiredMapped} className="gap-1.5">
                Preview {parsed.length} rows <ArrowRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}

        {step === "preview" && (
          <div className="space-y-4 mt-3">
            <div className="flex items-center gap-3">
              <Badge className="bg-pastel-green text-foreground/70 border-0">{validCount} valid</Badge>
              {invalidCount > 0 && <Badge className="bg-pastel-red text-foreground/70 border-0">{invalidCount} invalid</Badge>}
              <span className="text-xs text-muted-foreground ml-auto">{parsed.length} rows total</span>
            </div>

            <div className="max-h-[280px] overflow-y-auto rounded-xl border border-border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/50 sticky top-0">
                    <th className="px-3 py-2 text-left text-xs font-semibold text-muted-foreground">Status</th>
                    <th className="px-3 py-2 text-left text-xs font-semibold text-muted-foreground">Name</th>
                    <th className="px-3 py-2 text-left text-xs font-semibold text-muted-foreground">Phone</th>
                    <th className="px-3 py-2 text-left text-xs font-semibold text-muted-foreground">Email</th>
                    <th className="px-3 py-2 text-left text-xs font-semibold text-muted-foreground">Source</th>
                    <th className="px-3 py-2 text-left text-xs font-semibold text-muted-foreground">Error</th>
                  </tr>
                </thead>
                <tbody>
                  {parsed.slice(0, 100).map((l, i) => (
                    <tr key={i} className="border-b border-border last:border-0">
                      <td className="px-3 py-2">{l.valid ? <CheckCircle className="h-4 w-4 text-primary" /> : <XCircle className="h-4 w-4 text-destructive" />}</td>
                      <td className="px-3 py-2 text-foreground">{l.name}</td>
                      <td className="px-3 py-2 text-muted-foreground font-mono text-xs">{l.phone}</td>
                      <td className="px-3 py-2 text-muted-foreground text-xs">{l.email || "—"}</td>
                      <td className="px-3 py-2 text-muted-foreground text-xs">{previewSourceLabel(l)}</td>
                      <td className="px-3 py-2 text-xs text-destructive">{l.error || ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {parsed.length > 100 && (
                <p className="px-3 py-2 text-[10px] text-muted-foreground bg-muted/30">Showing first 100 — all {parsed.length} will be imported.</p>
              )}
            </div>

            {/* Lead source override — useful for vendor lists with no source column */}
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 space-y-2">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1">
                  <p className="text-xs font-semibold text-amber-900">Lead source</p>
                  <p className="text-[11px] text-amber-800/90 mt-0.5">
                    {sourceOverride
                      ? <>All <strong>{validCount}</strong> leads will be tagged as <strong>{sourceOverrideLabel}</strong>, overriding the CSV.</>
                      : mapping.source !== NONE
                        ? <>Using the <strong>{mapping.source}</strong> column from the CSV. Pick an override below to apply one source to all rows.</>
                        : <>No source column mapped — pick one below or all rows default to <strong>Other</strong>.</>}
                  </p>
                </div>
              </div>
              <select
                value={sourceOverride}
                onChange={(e) => setSourceOverride(e.target.value)}
                className="w-full rounded-lg border border-amber-200 bg-white px-3 py-2 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-amber-300"
              >
                <option value="">— Use CSV value (fallback: Other) —</option>
                {LEAD_SOURCES.map(s => (
                  <option key={s.value} value={s.value}>{s.label}</option>
                ))}
              </select>
              {sourceOverride === "other" && (
                <div className="space-y-1">
                  <label className="text-[11px] font-medium text-amber-900" htmlFor="bulk-import-other-source-name">
                    Other source name
                  </label>
                  <input
                    id="bulk-import-other-source-name"
                    type="text"
                    value={otherSourceName}
                    onChange={e => setOtherSourceName(e.target.value)}
                    placeholder="NEET 2026 Entrance Center Data"
                    className="w-full rounded-lg border border-amber-200 bg-white px-3 py-2 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-amber-300"
                  />
                  <p className="text-[10px] text-amber-800/80">
                    Leads still use source Other, and this name is saved into each lead note.
                  </p>
                </div>
              )}
            </div>

            {/* Save as List — three modes */}
            <div className="rounded-xl border border-violet-200 bg-violet-50 p-3 space-y-3">
              <div className="flex items-start gap-3">
                <div className="flex-1">
                  <p className="text-xs font-semibold text-violet-800">Save these leads as a list</p>
                  <p className="text-[11px] text-violet-700 mt-0.5">
                    Reusable for bulk WhatsApp / email sends from the Lists page.
                  </p>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-2">
                {[
                  { v: "off",      label: "Don't save" },
                  { v: "new",      label: "New list" },
                  { v: "existing", label: "Append to existing" },
                ].map(o => (
                  <Button
                    key={o.v}
                    size="sm"
                    variant={listMode === o.v ? "default" : "outline"}
                    className={`h-8 text-xs ${listMode === o.v ? "" : "border-violet-300 text-violet-700 hover:bg-violet-100"}`}
                    onClick={() => setListMode(o.v as any)}
                  >
                    {o.label}
                  </Button>
                ))}
              </div>
              {listMode === "new" && (
                <input
                  type="text"
                  value={listName}
                  onChange={e => setListName(e.target.value)}
                  placeholder={defaultListName}
                  className="w-full rounded-lg border border-violet-200 bg-white px-3 py-2 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-violet-300"
                />
              )}
              {listMode === "existing" && (
                <select
                  value={existingListId}
                  onChange={e => setExistingListId(e.target.value)}
                  className="w-full rounded-lg border border-violet-200 bg-white px-3 py-2 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-violet-300"
                >
                  <option value="">— Choose a list —</option>
                  {existingLists.map(l => (
                    <option key={l.id} value={l.id}>{l.name} ({l.member_count})</option>
                  ))}
                </select>
              )}
            </div>

            {/* AI Call option */}
            <label className="flex items-start gap-3 p-3 rounded-xl border border-blue-200 bg-blue-50 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={triggerAiCalls}
                onChange={e => setTriggerAiCalls(e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-blue-300 text-blue-600"
              />
              <div>
                <p className="text-xs font-semibold text-blue-800">Trigger AI calls after import</p>
                <p className="text-[11px] text-blue-700 mt-0.5">
                  Each lead will receive an AI voice call sequentially (30s gap between calls).
                  Leads without phone numbers will be skipped.
                </p>
              </div>
            </label>

            <div className="flex justify-between gap-2">
              <Button variant="outline" onClick={() => setStep("map")} className="gap-1.5"><ArrowLeft className="h-4 w-4" />Back to mapping</Button>
              <Button
                onClick={handleImport}
                disabled={importing || !validCount || (listMode === "existing" && !existingListId)}
                className="gap-1.5"
              >
                {importing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                Import {validCount} lead{validCount === 1 ? "" : "s"}{triggerAiCalls ? " + AI Call" : ""}
              </Button>
            </div>
          </div>
        )}

        {step === "result" && result && (
          <div className="text-center py-8 space-y-4">
            <CheckCircle className="h-12 w-12 text-primary mx-auto" />
            <p className="text-lg font-semibold text-foreground">Import Complete</p>
            <div className="flex items-center justify-center gap-2 flex-wrap">
              <Badge className="bg-pastel-green text-foreground/70 border-0">{result.success} new</Badge>
              {result.duplicates > 0 && (
                <Badge className="bg-pastel-yellow text-foreground/70 border-0">{result.duplicates} duplicate phone — already existed</Badge>
              )}
              {result.failed > 0 && (
                <Badge className="bg-pastel-red text-foreground/70 border-0">{result.failed} failed</Badge>
              )}
            </div>
            {result.listId && (
              <p className="text-xs text-violet-700 px-4">
                List <strong>{result.listName}</strong> ready — open the Lists page to send bulk WhatsApp / email. Existing leads matched by phone are also included.
              </p>
            )}
            <Button onClick={() => onOpenChange(false)}>Done</Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
