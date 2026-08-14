// Import salaries (CTC) against existing employees.
//
// Separate from the employee importer on purpose: this runs repeatedly as salaries
// are revised, matches people who already exist rather than creating them, and writes
// EFFECTIVE-DATED rows so a revision never rewrites a past payslip. Importing a new
// salary closes out the previous open-ended one the day before the new one starts.

import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ButtonOrb } from "@/components/ui/thinking-orb";
import { Upload, FileText, CheckCircle, XCircle, AlertTriangle, ArrowLeft } from "lucide-react";
import { resolveColumns } from "@/lib/libraryImport";
import {
  SALARY_COLUMN_ALIASES, buildSalaryRows, detectSalaryHeaderRow, type ParsedSalaryRow,
} from "@/lib/salaryImport";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}

type Step = "upload" | "preview" | "result";

const inr = (n: number) => new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }).format(n);

/** The day before `iso`, used to close out the salary a revision supersedes. */
function dayBefore(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

export function SalaryImportDialog({ open, onOpenChange, onSuccess }: Props) {
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState<Step>("upload");
  const [fileName, setFileName] = useState("");
  const [rows, setRows] = useState<ParsedSalaryRow[]>([]);
  /** employee_number (lowercased) -> employee_profiles.id */
  const [byNumber, setByNumber] = useState<Map<string, { id: string; name: string }>>(new Map());
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<{ imported: number; skipped: number } | null>(null);

  useEffect(() => {
    if (open) return;
    setStep("upload"); setFileName(""); setRows([]); setResult(null);
  }, [open]);

  // Everyone with an employee number, so the sheet can be matched to real people.
  useEffect(() => {
    if (!open) return;
    (async () => {
      const map = new Map<string, { id: string; name: string }>();
      for (let from = 0; ; from += 1000) {
        const { data } = await supabase
          .from("employee_profiles")
          .select("id, employee_number, display_name")
          .not("employee_number", "is", null)
          .range(from, from + 999);
        if (!data?.length) break;
        for (const r of data) {
          if (r.employee_number) map.set(r.employee_number.toLowerCase(), { id: r.id, name: r.display_name ?? "" });
        }
        if (data.length < 1000) break;
      }
      setByNumber(map);
    })();
  }, [open]);

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (fileRef.current) fileRef.current.value = "";
    if (!file) return;

    try {
      const XLSX = await import("xlsx");
      const wb = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: false });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      if (!sheet) throw new Error("The file has no sheets.");
      // raw:false so dates and amounts arrive formatted, not as Excel serials.
      const grid = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1, blankrows: false, defval: "", raw: false })
        .map((r) => (r as unknown[]).map((c) => (c ?? "").toString()));

      const headerIdx = detectSalaryHeaderRow(grid);
      const mapping = resolveColumns(grid[headerIdx] ?? [], SALARY_COLUMN_ALIASES);
      const body = grid.slice(headerIdx + 1).filter((r) => r.some((c) => c.trim()));

      setFileName(file.name);
      setRows(buildSalaryRows(body, mapping, headerIdx + 2));
      setStep("preview");
    } catch (err) {
      toast({
        title: "Could not read the file",
        description: err instanceof Error ? err.message : "Unsupported file.",
        variant: "destructive",
      });
    }
  };

  // A row is importable only if it parsed AND matches somebody we know about.
  const analysed = useMemo(() => rows.map((r) => ({
    row: r,
    match: byNumber.get(r.employeeNumber.toLowerCase()),
  })), [rows, byNumber]);

  const importable = analysed.filter((a) => a.row.valid && a.match);
  const unmatched = analysed.filter((a) => a.row.valid && !a.match);
  const invalid = analysed.filter((a) => !a.row.valid);
  const flagged = importable.filter((a) => a.row.warnings.length > 0);
  const monthlyTotal = importable.reduce((sum, a) => sum + (a.row.monthlyGross ?? 0), 0);

  const runImport = async () => {
    setImporting(true);
    let imported = 0;
    let skipped = 0;
    const today = new Date().toISOString().slice(0, 10);

    try {
      for (const { row, match } of importable) {
        if (!match) continue;
        const effectiveFrom = row.effectiveFrom || today;

        // Close the current open-ended salary the day before this one starts, so the
        // one-current-salary invariant holds and history stays intact.
        const { data: current } = await supabase
          .from("employee_salaries")
          .select("id, effective_from")
          .eq("employee_profile_id", match.id)
          .is("effective_to", null)
          .maybeSingle();

        if (current) {
          // Same start date means this is a correction, not a revision — replace it.
          if (current.effective_from === effectiveFrom) {
            await supabase.from("employee_salaries").delete().eq("id", current.id);
          } else if (current.effective_from < effectiveFrom) {
            await supabase.from("employee_salaries")
              .update({ effective_to: dayBefore(effectiveFrom) })
              .eq("id", current.id);
          } else {
            // The sheet is older than what we already hold — don't overwrite newer data.
            skipped++;
            continue;
          }
        }

        const { error } = await supabase.from("employee_salaries").insert({
          employee_profile_id: match.id,
          monthly_gross: row.monthlyGross!,
          annual_ctc: row.annualCtc,
          effective_from: effectiveFrom,
          source: "keka_ctc_import",
          revision_note: row.annualCtc ? `Imported from ${fileName}` : null,
        });
        if (error) throw error;
        imported++;
      }

      setResult({ imported, skipped });
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Upload className="h-5 w-5" /> Import salaries
          </DialogTitle>
        </DialogHeader>

        {step === "upload" && (
          <div className="space-y-4 py-2">
            <div
              className="rounded-xl border border-dashed border-input p-10 text-center cursor-pointer hover:border-foreground/30 transition-colors"
              onClick={() => fileRef.current?.click()}
            >
              <FileText className="mx-auto h-8 w-8 text-muted-foreground mb-3" />
              <p className="text-sm font-medium text-foreground">Choose a CTC or salary sheet</p>
              <p className="text-xs text-muted-foreground mt-1">
                Matched to people by employee number. Annual CTC is divided by 12 to get monthly gross.
              </p>
              <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" onChange={handleFile} className="hidden" />
            </div>
            <p className="text-[11px] text-muted-foreground">
              Salaries are effective-dated: importing a revision closes the previous one rather
              than overwriting it, so payslips already issued stay correct.
            </p>
          </div>
        )}

        {step === "preview" && (
          <div className="space-y-4 py-2">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline" className="gap-1 text-emerald-600 border-emerald-600/30">
                <CheckCircle className="h-3 w-3" /> {importable.length} to import
              </Badge>
              {unmatched.length > 0 && (
                <Badge variant="outline" className="gap-1 text-amber-600 border-amber-600/30">
                  <AlertTriangle className="h-3 w-3" /> {unmatched.length} no matching employee
                </Badge>
              )}
              {invalid.length > 0 && (
                <Badge variant="outline" className="gap-1 text-destructive border-destructive/30">
                  <XCircle className="h-3 w-3" /> {invalid.length} unreadable
                </Badge>
              )}
            </div>

            <div className="rounded-xl border border-border p-3 text-sm">
              Monthly payroll after import:{" "}
              <strong>₹{inr(monthlyTotal)}</strong>
              <span className="text-muted-foreground"> across {importable.length} employees</span>
            </div>

            {flagged.length > 0 && (
              <div className="flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/5 p-3 text-xs">
                <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
                <div>
                  <p><strong>{flagged.length}</strong> look like placeholders rather than real salaries:</p>
                  <ul className="mt-1 text-muted-foreground">
                    {flagged.slice(0, 5).map((a) => (
                      <li key={a.row.rowNumber}>
                        {a.row.employeeName || a.row.employeeNumber} — ₹{inr(a.row.annualCtc ?? 0)}/year
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            )}

            <div className="rounded-xl border border-border overflow-hidden">
              <div className="max-h-[36vh] overflow-y-auto">
                <table className="w-full text-xs">
                  <thead className="bg-muted/50 sticky top-0">
                    <tr className="text-left">
                      <th className="px-3 py-2 font-medium">Employee</th>
                      <th className="px-3 py-2 font-medium text-right">Annual CTC</th>
                      <th className="px-3 py-2 font-medium text-right">Monthly</th>
                      <th className="px-3 py-2 font-medium">Effective</th>
                      <th className="px-3 py-2 font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {analysed.slice(0, 200).map(({ row, match }) => (
                      <tr key={row.rowNumber} className={row.valid && match ? "" : "bg-muted/30"}>
                        <td className="px-3 py-2">
                          {row.employeeName || "—"}
                          <span className="text-muted-foreground"> · {row.employeeNumber || "no number"}</span>
                        </td>
                        <td className="px-3 py-2 text-right">{row.annualCtc !== null ? inr(row.annualCtc) : "—"}</td>
                        <td className="px-3 py-2 text-right">{row.monthlyGross !== null ? inr(row.monthlyGross) : "—"}</td>
                        <td className="px-3 py-2 text-muted-foreground">{row.effectiveFrom || "—"}</td>
                        <td className="px-3 py-2">
                          {!row.valid ? <span className="text-destructive">{row.error}</span>
                            : !match ? <span className="text-amber-600">No employee with this number</span>
                            : row.warnings.length ? <span className="text-amber-600">Check amount</span>
                            : <span className="text-emerald-600">OK</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="flex justify-between">
              <Button variant="ghost" onClick={() => setStep("upload")}>
                <ArrowLeft className="h-4 w-4 mr-1" /> Back
              </Button>
              <Button disabled={importing || importable.length === 0} onClick={runImport}>
                {importing ? <ButtonOrb state="working" onFilled /> : null}
                {importing ? "Importing…" : `Import ${importable.length} salaries`}
              </Button>
            </div>
          </div>
        )}

        {step === "result" && result && (
          <div className="space-y-4 py-4 text-center">
            <CheckCircle className="mx-auto h-10 w-10 text-emerald-600" />
            <div>
              <p className="text-lg font-semibold text-foreground">{result.imported} salaries imported</p>
              {result.skipped > 0 && (
                <p className="text-sm text-muted-foreground mt-1">
                  {result.skipped} skipped — the sheet was older than the salary already on record.
                </p>
              )}
            </div>
            <Button onClick={() => onOpenChange(false)} className="w-full">Done</Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

export default SalaryImportDialog;
