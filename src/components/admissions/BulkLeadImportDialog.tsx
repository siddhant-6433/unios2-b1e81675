import { useState, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Upload, FileText, Loader2, CheckCircle, XCircle, Download } from "lucide-react";

interface BulkLeadImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}

interface ParsedLead {
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

const VALID_SOURCES = ["website", "meta_ads", "google_ads", "shiksha", "walk_in", "consultant", "justdial", "referral", "education_fair", "other"];

export function BulkLeadImportDialog({ open, onOpenChange, onSuccess }: BulkLeadImportDialogProps) {
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [parsed, setParsed] = useState<ParsedLead[]>([]);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<{ success: number; failed: number } | null>(null);

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      const lines = text.split("\n").map(l => l.trim()).filter(Boolean);
      if (lines.length < 2) { toast({ title: "Error", description: "CSV must have a header row and data rows", variant: "destructive" }); return; }
      const headers = lines[0].split(",").map(h => h.trim().toLowerCase().replace(/\s+/g, "_"));
      const nameIdx = headers.indexOf("name");
      const phoneIdx = headers.indexOf("phone");
      if (nameIdx === -1 || phoneIdx === -1) { toast({ title: "Error", description: "CSV must have 'name' and 'phone' columns", variant: "destructive" }); return; }

      const leads: ParsedLead[] = lines.slice(1).map(line => {
        const cols = line.split(",").map(c => c.trim());
        const name = cols[nameIdx] || "";
        const phone = cols[phoneIdx] || "";
        const email = cols[headers.indexOf("email")] || undefined;
        const source = cols[headers.indexOf("source")] || undefined;
        const guardian_name = cols[headers.indexOf("guardian_name")] || undefined;
        const guardian_phone = cols[headers.indexOf("guardian_phone")] || undefined;
        const notes = cols[headers.indexOf("notes")] || undefined;

        let valid = true;
        let error = "";
        if (!name) { valid = false; error = "Name required"; }
        else if (!phone || phone.length < 10) { valid = false; error = "Invalid phone"; }
        else if (source && !VALID_SOURCES.includes(source)) { valid = false; error = `Invalid source: ${source}`; }

        return { name, phone, email, source, guardian_name, guardian_phone, notes, valid, error };
      });
      setParsed(leads);
      setResult(null);
    };
    reader.readAsText(file);
  };

  const handleImport = async () => {
    const validLeads = parsed.filter(l => l.valid);
    if (!validLeads.length) return;
    setImporting(true);
    let success = 0, failed = 0;

    // Batch insert in chunks of 50
    for (let i = 0; i < validLeads.length; i += 50) {
      const batch = validLeads.slice(i, i + 50).map(l => ({
        name: l.name,
        phone: l.phone,
        email: l.email || null,
        source: (l.source || "other") as any,
        guardian_name: l.guardian_name || null,
        guardian_phone: l.guardian_phone || null,
        notes: l.notes || null,
      }));
      const { error, data } = await supabase.from("leads").insert(batch).select("id");
      if (error) { failed += batch.length; } else { success += (data?.length || 0); }
    }

    setResult({ success, failed });
    setImporting(false);
    if (success > 0) onSuccess();
  };

  const downloadTemplate = () => {
    const csv = "name,phone,email,source,guardian_name,guardian_phone,notes\nJohn Doe,+919876543210,john@email.com,website,Jane Doe,+919876543211,Interested in B.Tech";
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "lead_import_template.csv"; a.click();
    URL.revokeObjectURL(url);
  };

  const validCount = parsed.filter(l => l.valid).length;
  const invalidCount = parsed.filter(l => !l.valid).length;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!importing) { onOpenChange(o); setParsed([]); setResult(null); } }}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Bulk Import Leads</DialogTitle>
        </DialogHeader>

        {!parsed.length && !result ? (
          <div className="space-y-4 mt-2">
            <div className="border-2 border-dashed border-border rounded-2xl p-12 text-center">
              <Upload className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
              <p className="text-sm font-medium text-foreground mb-1">Upload CSV file</p>
              <p className="text-xs text-muted-foreground mb-4">Required columns: name, phone. Optional: email, source, guardian_name, guardian_phone, notes</p>
              <div className="flex gap-2 justify-center">
                <Button onClick={() => fileRef.current?.click()} className="gap-1.5"><FileText className="h-4 w-4" />Select File</Button>
                <Button variant="outline" onClick={downloadTemplate} className="gap-1.5"><Download className="h-4 w-4" />Template</Button>
              </div>
              <input ref={fileRef} type="file" accept=".csv" className="hidden" onChange={handleFile} />
            </div>
          </div>
        ) : result ? (
          <div className="text-center py-8 space-y-3">
            <CheckCircle className="h-12 w-12 text-primary mx-auto" />
            <p className="text-lg font-semibold text-foreground">Import Complete</p>
            <p className="text-sm text-muted-foreground">{result.success} leads imported, {result.failed} failed</p>
            <Button onClick={() => { onOpenChange(false); setParsed([]); setResult(null); }}>Done</Button>
          </div>
        ) : (
          <div className="space-y-4 mt-2">
            <div className="flex items-center gap-3">
              <Badge className="bg-pastel-green text-foreground/70 border-0">{validCount} valid</Badge>
              {invalidCount > 0 && <Badge className="bg-pastel-red text-foreground/70 border-0">{invalidCount} invalid</Badge>}
              <span className="text-xs text-muted-foreground ml-auto">{parsed.length} rows total</span>
            </div>
            <div className="max-h-[300px] overflow-y-auto rounded-xl border border-border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/50">
                    <th className="px-3 py-2 text-left text-xs font-semibold text-muted-foreground">Status</th>
                    <th className="px-3 py-2 text-left text-xs font-semibold text-muted-foreground">Name</th>
                    <th className="px-3 py-2 text-left text-xs font-semibold text-muted-foreground">Phone</th>
                    <th className="px-3 py-2 text-left text-xs font-semibold text-muted-foreground">Source</th>
                    <th className="px-3 py-2 text-left text-xs font-semibold text-muted-foreground">Error</th>
                  </tr>
                </thead>
                <tbody>
                  {parsed.slice(0, 100).map((l, i) => (
                    <tr key={i} className="border-b border-border last:border-0">
                      <td className="px-3 py-2">{l.valid ? <CheckCircle className="h-4 w-4 text-primary" /> : <XCircle className="h-4 w-4 text-destructive" />}</td>
                      <td className="px-3 py-2 text-foreground">{l.name}</td>
                      <td className="px-3 py-2 text-muted-foreground">{l.phone}</td>
                      <td className="px-3 py-2 text-muted-foreground">{l.source || "—"}</td>
                      <td className="px-3 py-2 text-xs text-destructive">{l.error || ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => { setParsed([]); setResult(null); }}>Back</Button>
              <Button onClick={handleImport} disabled={importing || !validCount} className="gap-1.5">
                {importing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                Import {validCount} Leads
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
