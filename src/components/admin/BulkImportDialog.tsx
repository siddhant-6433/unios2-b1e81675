import { useState, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Upload, X, FileSpreadsheet, CheckCircle2, AlertCircle, Download } from "lucide-react";
import type { Database } from "@/integrations/supabase/types";

type AppRole = Database["public"]["Enums"]["app_role"];

const VALID_ROLES: AppRole[] = [
  "super_admin", "campus_admin", "principal", "admission_head",
  "counsellor", "accountant", "faculty", "teacher",
  "data_entry", "office_admin", "office_assistant", "hostel_warden", "student", "parent",
];

interface ParsedUser {
  email: string;
  display_name: string;
  campus: string;
  role: string;
  valid: boolean;
  error?: string;
}

interface BulkResult {
  email: string;
  success: boolean;
  error?: string;
}

interface BulkImportDialogProps {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

function parseCSV(text: string): ParsedUser[] {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return [];

  const headerLine = lines[0].toLowerCase();
  const headers = headerLine.split(",").map((h) => h.trim());

  const emailIdx = headers.findIndex((h) => h === "email");
  const nameIdx = headers.findIndex((h) => h === "name" || h === "display_name" || h === "full_name");
  const campusIdx = headers.findIndex((h) => h === "campus");
  const roleIdx = headers.findIndex((h) => h === "role");

  if (emailIdx === -1) return [];

  return lines.slice(1).filter((l) => l.trim()).map((line) => {
    const cols = line.split(",").map((c) => c.trim());
    const email = cols[emailIdx] || "";
    const display_name = nameIdx >= 0 ? cols[nameIdx] || "" : "";
    const campus = campusIdx >= 0 ? cols[campusIdx] || "" : "";
    const role = roleIdx >= 0 ? (cols[roleIdx] || "").toLowerCase().replace(/\s+/g, "_") : "";

    const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
    const roleValid = VALID_ROLES.includes(role as AppRole);

    let error: string | undefined;
    if (!emailValid) error = "Invalid email";
    else if (!role) error = "Missing role";
    else if (!roleValid) error = `Invalid role: ${role}`;

    return {
      email,
      display_name,
      campus,
      role,
      valid: emailValid && roleValid && !!role,
      error,
    };
  });
}

const SAMPLE_CSV = `email,name,campus,role
john@example.com,John Doe,Main Campus,student
jane@example.com,Jane Smith,North Campus,faculty
admin@example.com,Admin User,Main Campus,campus_admin`;

const BulkImportDialog = ({ open, onClose, onSuccess }: BulkImportDialogProps) => {
  const [parsedUsers, setParsedUsers] = useState<ParsedUser[]>([]);
  const [fileName, setFileName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [results, setResults] = useState<BulkResult[] | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  if (!open) return null;

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setResults(null);

    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      const users = parseCSV(text);
      if (users.length === 0) {
        toast({ title: "Invalid CSV", description: "Could not parse CSV. Ensure it has an 'email' column header.", variant: "destructive" });
        return;
      }
      setParsedUsers(users);
    };
    reader.readAsText(file);
  };

  const handleSubmit = async () => {
    const validUsers = parsedUsers.filter((u) => u.valid);
    if (validUsers.length === 0) return;

    setSubmitting(true);
    try {
      const { data, error } = await supabase.functions.invoke("bulk-invite-users", {
        body: {
          users: validUsers.map((u) => ({
            email: u.email,
            display_name: u.display_name || undefined,
            campus: u.campus || undefined,
            role: u.role,
          })),
        },
      });

      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      setResults(data.results);
      toast({
        title: "Bulk import complete",
        description: `${data.succeeded} invited, ${data.failed} failed.`,
        variant: data.failed > 0 ? "destructive" : "default",
      });
      onSuccess();
    } catch (err: any) {
      toast({ title: "Import failed", description: err.message, variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  const handleDownloadSample = () => {
    const blob = new Blob([SAMPLE_CSV], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "sample-users.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleClose = () => {
    setParsedUsers([]);
    setFileName("");
    setResults(null);
    onClose();
  };

  const validCount = parsedUsers.filter((u) => u.valid).length;
  const invalidCount = parsedUsers.filter((u) => !u.valid).length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="fixed inset-0 bg-foreground/20 backdrop-blur-sm" onClick={handleClose} />
      <div className="relative z-10 w-full max-w-2xl rounded-2xl bg-card card-shadow p-6 mx-4 animate-fade-in max-h-[85vh] flex flex-col">
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-2">
            <FileSpreadsheet className="h-5 w-5 text-primary" />
            <h2 className="text-lg font-semibold text-foreground">Bulk Import Users</h2>
          </div>
          <button onClick={handleClose} className="text-muted-foreground hover:text-foreground transition-colors">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Upload area */}
        {parsedUsers.length === 0 && !results && (
          <div className="space-y-4">
            <div
              onClick={() => fileRef.current?.click()}
              className="border-2 border-dashed border-input rounded-xl p-10 text-center cursor-pointer hover:border-primary/40 hover:bg-muted/30 transition-colors"
            >
              <Upload className="h-8 w-8 text-muted-foreground mx-auto mb-3" />
              <p className="text-sm font-medium text-foreground">Click to upload CSV file</p>
              <p className="text-xs text-muted-foreground mt-1">Columns: email, name, campus, role</p>
              <input ref={fileRef} type="file" accept=".csv" onChange={handleFile} className="hidden" />
            </div>
            <button
              onClick={handleDownloadSample}
              className="flex items-center gap-2 text-xs text-primary hover:text-primary/80 transition-colors"
            >
              <Download className="h-3.5 w-3.5" />
              Download sample CSV template
            </button>
          </div>
        )}

        {/* Preview */}
        {parsedUsers.length > 0 && !results && (
          <>
            <div className="flex items-center gap-3 mb-3">
              <span className="text-xs text-muted-foreground">{fileName}</span>
              <span className="rounded-md bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary">
                {validCount} valid
              </span>
              {invalidCount > 0 && (
                <span className="rounded-md bg-destructive/10 px-2 py-0.5 text-[11px] font-semibold text-destructive">
                  {invalidCount} invalid
                </span>
              )}
            </div>
            <div className="overflow-auto flex-1 rounded-xl border border-border mb-4">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left bg-muted/30">
                    <th className="px-3 py-2 font-medium text-muted-foreground">Status</th>
                    <th className="px-3 py-2 font-medium text-muted-foreground">Email</th>
                    <th className="px-3 py-2 font-medium text-muted-foreground">Name</th>
                    <th className="px-3 py-2 font-medium text-muted-foreground">Campus</th>
                    <th className="px-3 py-2 font-medium text-muted-foreground">Role</th>
                  </tr>
                </thead>
                <tbody>
                  {parsedUsers.map((u, i) => (
                    <tr key={i} className="border-b border-border last:border-0">
                      <td className="px-3 py-2">
                        {u.valid ? (
                          <CheckCircle2 className="h-4 w-4 text-primary" />
                        ) : (
                          <span title={u.error}>
                            <AlertCircle className="h-4 w-4 text-destructive" />
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-foreground">{u.email}</td>
                      <td className="px-3 py-2 text-muted-foreground">{u.display_name || "—"}</td>
                      <td className="px-3 py-2 text-muted-foreground">{u.campus || "—"}</td>
                      <td className="px-3 py-2">
                        <span className={`text-[11px] font-semibold ${u.valid ? "text-foreground" : "text-destructive"}`}>
                          {u.role || "—"}
                        </span>
                        {u.error && <span className="block text-[10px] text-destructive">{u.error}</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => { setParsedUsers([]); setFileName(""); }}
                disabled={submitting}
                className="flex-1 rounded-xl border border-input bg-background px-4 py-2.5 text-sm font-medium text-foreground hover:bg-muted transition-colors"
              >
                Choose Different File
              </button>
              <button
                onClick={handleSubmit}
                disabled={submitting || validCount === 0}
                className="flex-1 rounded-xl bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {submitting ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Inviting {validCount} users…
                  </>
                ) : (
                  <>
                    <Upload className="h-4 w-4" />
                    Invite {validCount} Users
                  </>
                )}
              </button>
            </div>
          </>
        )}

        {/* Results */}
        {results && (
          <>
            <div className="overflow-auto flex-1 rounded-xl border border-border mb-4">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left bg-muted/30">
                    <th className="px-3 py-2 font-medium text-muted-foreground">Status</th>
                    <th className="px-3 py-2 font-medium text-muted-foreground">Email</th>
                    <th className="px-3 py-2 font-medium text-muted-foreground">Details</th>
                  </tr>
                </thead>
                <tbody>
                  {results.map((r, i) => (
                    <tr key={i} className="border-b border-border last:border-0">
                      <td className="px-3 py-2">
                        {r.success ? (
                          <CheckCircle2 className="h-4 w-4 text-primary" />
                        ) : (
                          <AlertCircle className="h-4 w-4 text-destructive" />
                        )}
                      </td>
                      <td className="px-3 py-2 text-foreground">{r.email}</td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">
                        {r.success ? "Invite sent" : r.error}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <button
              onClick={handleClose}
              className="w-full rounded-xl bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
            >
              Done
            </button>
          </>
        )}
      </div>
    </div>
  );
};

export default BulkImportDialog;
