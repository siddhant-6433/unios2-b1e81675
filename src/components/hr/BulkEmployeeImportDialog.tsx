// Bulk employee import — upload → map → preview → result.
//
// Follows BulkLeadImportDialog's wizard shape, with two differences that matter
// here: Excel is accepted (HR's staff registers are .xlsx far more often than
// .csv), and imported rows land as verification_status='pending' so somebody has
// to look at each one and set a campus before it joins the real directory.
//
// Rows are inserted with user_id = null. Most support staff have no login, and
// making them wait for an auth invite would mean no import at all.

import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { usePermissions } from "@/contexts/PermissionContext";
import { useOrgUnits } from "@/hooks/useOrgUnits";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ButtonOrb } from "@/components/ui/thinking-orb";
import { Upload, FileText, CheckCircle, XCircle, Download, ArrowRight, ArrowLeft, AlertTriangle } from "lucide-react";
import {
  EMPLOYEE_COLUMN_ALIASES, EMPLOYEE_IMPORT_FIELDS, BANK_FIELDS,
  buildEmployeeRows, detectEmployeeHeaderRow, resolveColumns,
  templateHeaders, failedRowsCsv, type ParsedEmployeeRow,
} from "@/lib/employeeImport";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}

const NONE = "__none__";
const BATCH_SIZE = 50;

// employee_profiles columns the importer writes. Everything else in the parsed
// row (campus/institution/department names, bank fields) is handled separately.
const PROFILE_COLUMNS = [
  "employee_number", "first_name", "middle_name", "last_name", "display_name",
  "gender", "date_of_birth", "marital_status", "blood_group", "nationality",
  "work_email", "personal_email", "mobile_number", "work_number",
  "date_of_joining", "job_title", "worker_type", "time_type", "employment_status",
  "pan_number", "aadhaar_number",
] as const;

const FIELD_LABEL: Record<string, string> = Object.fromEntries(
  EMPLOYEE_IMPORT_FIELDS.map((f) => [f, EMPLOYEE_COLUMN_ALIASES[f][0]]),
);

type Step = "upload" | "map" | "preview" | "result";

function downloadFile(name: string, content: string, type = "text/csv;charset=utf-8") {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

export function BulkEmployeeImportDialog({ open, onOpenChange, onSuccess }: Props) {
  const { toast } = useToast();
  const { can } = usePermissions();
  const org = useOrgUnits();
  const fileRef = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState<Step>("upload");
  const [fileName, setFileName] = useState("");
  const [headers, setHeaders] = useState<string[]>([]);
  const [body, setBody] = useState<string[][]>([]);
  const [headerOffset, setHeaderOffset] = useState(2);
  // mapping[field] = header string, or NONE when deliberately unmapped.
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [existingKeys, setExistingKeys] = useState<Set<string>>(new Set());
  const [entities, setEntities] = useState<{ id: string; name: string }[]>([]);

  // Applied to every row that didn't carry its own campus/institution. HR
  // usually imports one campus at a time, so this is the common path.
  const [defaultCampusId, setDefaultCampusId] = useState("");
  const [defaultInstitutionId, setDefaultInstitutionId] = useState("");

  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<{ success: number; skipped: number; bank: number; csv: string } | null>(null);

  const canEditBank = can("hr", "bank_edit");

  useEffect(() => {
    if (open) return;
    setStep("upload"); setFileName(""); setHeaders([]); setBody([]);
    setMapping({}); setResult(null); setDefaultCampusId(""); setDefaultInstitutionId("");
  }, [open]);

  useEffect(() => {
    if (!defaultCampusId && org.lockedCampusId) setDefaultCampusId(org.lockedCampusId);
  }, [org.lockedCampusId, defaultCampusId]);

  // Existing employee numbers / work emails, so re-uploading the same sheet
  // doesn't create a second copy of everyone. Paginated: the PostgREST response
  // is capped at 1000 rows and a silent truncation here would look like "no
  // duplicates found".
  useEffect(() => {
    if (!open) return;
    supabase.from("legal_entities").select("id, name").then(({ data }) =>
      setEntities((data as { id: string; name: string }[]) ?? []));
  }, [open]);

  useEffect(() => {
    if (!open) return;
    (async () => {
      const keys = new Set<string>();
      for (let from = 0; ; from += 1000) {
        const { data, error } = await supabase
          .from("employee_profiles")
          .select("employee_number, work_email")
          .range(from, from + 999);
        if (error || !data?.length) break;
        for (const r of data) {
          if (r.employee_number) keys.add(r.employee_number.toLowerCase());
          if (r.work_email) keys.add(r.work_email.toLowerCase());
        }
        if (data.length < 1000) break;
      }
      setExistingKeys(keys);
    })();
  }, [open]);

  // ── Upload ────────────────────────────────────────────────────────────
  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (fileRef.current) fileRef.current.value = "";
    if (!file) return;

    try {
      // xlsx is already a dependency and reads CSV too, so one code path
      // handles both. Dynamic import keeps it out of the main bundle.
      const XLSX = await import("xlsx");
      const wb = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: false });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      if (!sheet) throw new Error("The file has no sheets.");
      // `raw: false` belongs on sheet_to_json, not read(). Without it every date
      // cell arrives as an Excel serial number (41091) instead of "01-Jul-2012",
      // and every joining date is silently dropped as unparseable.
      const rows = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1, blankrows: false, defval: "", raw: false })
        .map((r) => (r as unknown[]).map((c) => (c ?? "").toString()));

      const headerIdx = detectEmployeeHeaderRow(rows);
      const headerRow = rows[headerIdx] ?? [];
      const dataRows = rows.slice(headerIdx + 1).filter((r) => r.some((c) => c.trim()));
      if (!dataRows.length) {
        toast({ title: "Nothing to import", description: "No data rows found below the header.", variant: "destructive" });
        return;
      }

      // Auto-map, then let the user correct it on the next step.
      const resolved = resolveColumns(headerRow, EMPLOYEE_COLUMN_ALIASES);
      const next: Record<string, string> = {};
      for (const field of EMPLOYEE_IMPORT_FIELDS) {
        const idx = resolved[field];
        next[field] = idx === undefined ? NONE : headerRow[idx];
      }

      setFileName(file.name);
      setHeaders(headerRow);
      setBody(dataRows);
      setHeaderOffset(headerIdx + 2); // 1-indexed sheet row of the first data row
      setMapping(next);
      setStep("map");
    } catch (err) {
      toast({
        title: "Could not read the file",
        description: err instanceof Error ? err.message : "Unsupported file.",
        variant: "destructive",
      });
    }
  };

  // ── Mapping → parsed rows ─────────────────────────────────────────────
  const parsed = useMemo<ParsedEmployeeRow[]>(() => {
    if (!body.length) return [];
    const idx: Record<string, number> = {};
    for (const field of EMPLOYEE_IMPORT_FIELDS) {
      const hdr = mapping[field];
      idx[field] = !hdr || hdr === NONE ? -1 : headers.indexOf(hdr);
    }
    return buildEmployeeRows(body, idx, existingKeys, headerOffset);
  }, [body, headers, mapping, existingKeys, headerOffset]);

  const validRows = parsed.filter((r) => r.valid);
  const invalidRows = parsed.filter((r) => !r.valid);
  const nameMapped = (mapping.full_name && mapping.full_name !== NONE) || (mapping.first_name && mapping.first_name !== NONE);
  const mappedHeaderCount = EMPLOYEE_IMPORT_FIELDS.filter((f) => mapping[f] && mapping[f] !== NONE).length;

  // ── Import ────────────────────────────────────────────────────────────
  const handleImport = async () => {
    setImporting(true);
    try {
      const batchId = crypto.randomUUID();
      const payloads = validRows.map((r) => {
        const v = r.values;
        const campusId = org.matchByName(org.campuses, v.campus) || defaultCampusId || null;
        const institutionId =
          org.matchByName(org.institutionsFor(campusId), v.institution) || defaultInstitutionId || null;
        const departmentId = org.matchByName(org.departmentsFor(institutionId), v.department) || null;

        // Keka's legal entity arrives as a name in any casing.
        const entityName = (v.legal_entity || "").trim().toLowerCase();
        const legalEntityId = entityName
          ? entities.find((e) => e.name.toLowerCase() === entityName)?.id ?? null
          : null;

        const row: Record<string, unknown> = {
          user_id: null,
          verification_status: "pending",
          import_batch_id: batchId,
          campus_id: campusId,
          institution_id: institutionId,
          department_id: departmentId,
          legal_entity_id: legalEntityId,
          // Preserved verbatim: these are HR concepts, not the academic
          // campus/department they superficially resemble.
          work_location: v.campus || null,
          hr_department: v.department || null,
          hr_sub_department: v.sub_department || null,
          reports_to_name: v.reports_to_name || null,
          business_unit: v.business_unit || null,
        };
        for (const c of PROFILE_COLUMNS) row[c] = v[c] || null;
        return { row, bank: r };
      });

      let success = 0;
      const failed: ParsedEmployeeRow[] = [];
      const insertedIds: { id: string; source: ParsedEmployeeRow }[] = [];

      for (let i = 0; i < payloads.length; i += BATCH_SIZE) {
        const slice = payloads.slice(i, i + BATCH_SIZE);
        const { data, error } = await supabase
          .from("employee_profiles")
          .insert(slice.map((p) => p.row) as never[])
          .select("id");

        if (error) {
          // One bad row rejects the whole batch, so retry it row by row and
          // report exactly which ones failed rather than losing 50 at once.
          for (const p of slice) {
            const { data: one, error: oneErr } = await supabase
              .from("employee_profiles")
              .insert(p.row as never)
              .select("id")
              .single();
            if (oneErr || !one) {
              failed.push({ ...p.bank, error: oneErr?.message || "Insert failed" });
            } else {
              success++;
              insertedIds.push({ id: one.id, source: p.bank });
            }
          }
        } else {
          success += data?.length ?? 0;
          (data ?? []).forEach((d, k) => insertedIds.push({ id: d.id, source: slice[k].bank }));
        }
      }

      // Bank details, only for rows that actually carried them and only when
      // the caller holds hr:bank_edit (RLS would reject them otherwise).
      let bank = 0;
      if (canEditBank) {
        const bankRows = insertedIds
          .filter(({ source }) => BANK_FIELDS.some((f) => source.values[f]))
          .map(({ id, source }) => ({
            employee_profile_id: id,
            account_holder_name: source.values.bank_account_holder_name || source.values.display_name || null,
            account_number: source.values.bank_account_number || null,
            ifsc: source.values.bank_ifsc || null,
            bank_name: source.values.bank_name || null,
            branch: source.values.bank_branch || null,
          }));
        for (let i = 0; i < bankRows.length; i += BATCH_SIZE) {
          const { error } = await supabase
            .from("employee_bank_details")
            .insert(bankRows.slice(i, i + BATCH_SIZE) as never);
          if (!error) bank += Math.min(BATCH_SIZE, bankRows.length - i);
        }
      }

      const allFailed = [...invalidRows, ...failed];
      setResult({
        success,
        skipped: allFailed.length,
        bank,
        csv: failedRowsCsv(allFailed, EMPLOYEE_IMPORT_FIELDS),
      });
      setStep("result");
      onSuccess();
    } catch (err) {
      toast({
        title: "Import failed",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setImporting(false);
    }
  };

  const selectCls = "w-full rounded-lg border border-input bg-background px-2 py-1.5 text-sm";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Upload className="h-5 w-5" /> Import employees
          </DialogTitle>
        </DialogHeader>

        {/* ── Upload ─────────────────────────────────────────────────── */}
        {step === "upload" && (
          <div className="space-y-4 py-2">
            <div
              className="rounded-xl border border-dashed border-input p-10 text-center cursor-pointer hover:border-foreground/30 transition-colors"
              onClick={() => fileRef.current?.click()}
            >
              <FileText className="mx-auto h-8 w-8 text-muted-foreground mb-3" />
              <p className="text-sm font-medium text-foreground">Choose an Excel or CSV file</p>
              <p className="text-xs text-muted-foreground mt-1">
                Column names are matched automatically — you can correct them on the next step.
              </p>
              <input
                ref={fileRef}
                type="file"
                accept=".xlsx,.xls,.csv"
                onChange={handleFile}
                className="hidden"
              />
            </div>
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>Imported employees land in the verification queue, not the live directory.</span>
              <button
                className="inline-flex items-center gap-1 text-primary hover:underline"
                onClick={() => downloadFile("employee-import-template.csv", templateHeaders().join(",") + "\n")}
              >
                <Download className="h-3.5 w-3.5" /> Download template
              </button>
            </div>
          </div>
        )}

        {/* ── Map ────────────────────────────────────────────────────── */}
        {step === "map" && (
          <div className="space-y-4 py-2">
            <p className="text-xs text-muted-foreground">
              {fileName} · {body.length} rows · {mappedHeaderCount} columns matched
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-h-[45vh] overflow-y-auto pr-1">
              {EMPLOYEE_IMPORT_FIELDS.filter((f) => canEditBank || !BANK_FIELDS.includes(f as never)).map((field) => (
                <div key={field}>
                  <label className="block text-[11px] font-medium text-muted-foreground mb-1">
                    {FIELD_LABEL[field]}
                    {field === "full_name" && <span className="text-destructive"> *</span>}
                  </label>
                  <select
                    value={mapping[field] ?? NONE}
                    onChange={(e) => setMapping((m) => ({ ...m, [field]: e.target.value }))}
                    className={selectCls}
                  >
                    <option value={NONE}>— not in file —</option>
                    {headers.map((h, i) => (
                      <option key={`${h}-${i}`} value={h}>{h || `(column ${i + 1})`}</option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
            {!nameMapped && (
              <p className="text-xs text-destructive flex items-center gap-1">
                <AlertTriangle className="h-3.5 w-3.5" /> Map a name column before continuing.
              </p>
            )}
            <div className="flex justify-between">
              <Button variant="ghost" onClick={() => setStep("upload")}>
                <ArrowLeft className="h-4 w-4 mr-1" /> Back
              </Button>
              <Button disabled={!nameMapped} onClick={() => setStep("preview")}>
                Preview <ArrowRight className="h-4 w-4 ml-1" />
              </Button>
            </div>
          </div>
        )}

        {/* ── Preview ────────────────────────────────────────────────── */}
        {step === "preview" && (
          <div className="space-y-4 py-2">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline" className="gap-1 text-emerald-600 border-emerald-600/30">
                <CheckCircle className="h-3 w-3" /> {validRows.length} to import
              </Badge>
              {invalidRows.length > 0 && (
                <Badge variant="outline" className="gap-1 text-destructive border-destructive/30">
                  <XCircle className="h-3 w-3" /> {invalidRows.length} skipped
                </Badge>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-medium text-muted-foreground mb-1">
                  Default campus <span className="font-normal">(for rows without one)</span>
                </label>
                <select
                  value={defaultCampusId}
                  onChange={(e) => { setDefaultCampusId(e.target.value); setDefaultInstitutionId(""); }}
                  className={selectCls}
                >
                  <option value="">Set during verification</option>
                  {org.campuses.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-[11px] font-medium text-muted-foreground mb-1">Default institution</label>
                <select
                  value={defaultInstitutionId}
                  onChange={(e) => setDefaultInstitutionId(e.target.value)}
                  className={selectCls}
                  disabled={!defaultCampusId}
                >
                  <option value="">Set during verification</option>
                  {org.institutionsFor(defaultCampusId).map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
                </select>
              </div>
            </div>

            <div className="rounded-xl border border-border overflow-hidden">
              <div className="max-h-[38vh] overflow-y-auto">
                <table className="w-full text-xs">
                  <thead className="bg-muted/50 sticky top-0">
                    <tr className="text-left">
                      <th className="px-3 py-2 font-medium">Row</th>
                      <th className="px-3 py-2 font-medium">Name</th>
                      <th className="px-3 py-2 font-medium">Emp no.</th>
                      <th className="px-3 py-2 font-medium">Designation</th>
                      <th className="px-3 py-2 font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {parsed.slice(0, 200).map((r) => (
                      <tr key={r.rowNumber} className={r.valid ? "" : "bg-destructive/5"}>
                        <td className="px-3 py-2 text-muted-foreground">{r.rowNumber}</td>
                        <td className="px-3 py-2">{r.values.display_name || "—"}</td>
                        <td className="px-3 py-2 text-muted-foreground">{r.values.employee_number || "—"}</td>
                        <td className="px-3 py-2 text-muted-foreground">{r.values.job_title || "—"}</td>
                        <td className="px-3 py-2">
                          {r.valid ? (
                            r.warnings.length > 0 ? (
                              <span className="text-amber-600" title={r.warnings.join("\n")}>
                                {r.warnings.length} warning{r.warnings.length > 1 ? "s" : ""}
                              </span>
                            ) : <span className="text-emerald-600">OK</span>
                          ) : (
                            <span className="text-destructive">{r.error}</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {parsed.length > 200 && (
                <p className="px-3 py-2 text-[11px] text-muted-foreground border-t border-border">
                  Showing the first 200 of {parsed.length} rows. All {validRows.length} valid rows will be imported.
                </p>
              )}
            </div>

            <div className="flex justify-between">
              <Button variant="ghost" onClick={() => setStep("map")}>
                <ArrowLeft className="h-4 w-4 mr-1" /> Back
              </Button>
              <Button disabled={importing || validRows.length === 0} onClick={handleImport}>
                {importing ? <ButtonOrb state="working" onFilled /> : null}
                {importing ? "Importing…" : `Import ${validRows.length} employees`}
              </Button>
            </div>
          </div>
        )}

        {/* ── Result ─────────────────────────────────────────────────── */}
        {step === "result" && result && (
          <div className="space-y-4 py-4 text-center">
            <CheckCircle className="mx-auto h-10 w-10 text-emerald-600" />
            <div>
              <p className="text-lg font-semibold text-foreground">{result.success} employees imported</p>
              <p className="text-sm text-muted-foreground mt-1">
                They are waiting in <strong>Needs verification</strong> — set each one's campus and institution there.
              </p>
              {result.bank > 0 && (
                <p className="text-xs text-muted-foreground mt-1">{result.bank} bank records saved.</p>
              )}
            </div>
            {result.skipped > 0 && (
              <div className="rounded-xl border border-border p-4">
                <p className="text-sm text-foreground">{result.skipped} rows were skipped.</p>
                <button
                  className="mt-2 inline-flex items-center gap-1 text-xs text-primary hover:underline"
                  onClick={() => downloadFile("employee-import-failed-rows.csv", result.csv)}
                >
                  <Download className="h-3.5 w-3.5" /> Download the skipped rows to fix and re-upload
                </button>
              </div>
            )}
            <Button onClick={() => onOpenChange(false)} className="w-full">Done</Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

export default BulkEmployeeImportDialog;
